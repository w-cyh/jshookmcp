# Master Plan: 打造业界领先的 ARM64 仿真器

**目标**: 超越 QEMU/Unicorn/Unidbg，成为 ARM64 native 仿真的黄金标准  
**范围**: 补全所有关键风险 + 实现所有改进建议  
**预估工作量**: **XL+** (预计 8-12 个独立任务，每个 L-XL 级别)  

---

## Phase 1: 基础设施增强（关键风险修复）

### Task 1.1: FP 异常处理层 [L]
**目标**: 实现 IEEE754 异常检测和可选陷入

**范围**:
- [ ] 实现 FPCR/FPSR 寄存器（浮点控制/状态）
- [ ] 异常位：IOC(无效操作)/DZC(除零)/OFC(溢出)/UFC(下溢)/IXC(不精确)
- [ ] Rounding modes: RN(最近偶)/RP(正无穷)/RM(负无穷)/RZ(零)
- [ ] FP 操作插桩：每次 FADD/FMUL/FDIV 检查结果并设置 flags
- [ ] 可配置陷入模式（默认关闭，兼容 ARM 工具链）

**验证**:
- IEEE754 edge cases: `1.0/0.0`→Inf + DZC, `0.0/0.0`→NaN + IOC, `sqrt(-1)`→NaN + IOC
- 测试用例覆盖所有 5 种异常类型
- 性能回归测试：异常检查关闭时零开销

**文件**:
- 新增 `src/modules/native-emulator/fp-exceptions.ts`
- 修改 `simd-fp.ts` 所有操作函数加异常检测

---

### Task 1.2: 完整 NEON Widening/Saturating 实现 [XL]
**目标**: 补全 NEON 长尾，消除"诚实边界"

#### Subtask 1.2.1: Widening（扩展宽度）指令 [L]
**范围**:
- [ ] SADDL/UADDL, SSUBL/USUBL（8→16, 16→32, 32→64）
- [ ] SADDW/UADDW, SSUBW/USUBW（宽+窄→宽）
- [ ] SMULL/UMULL, SMLAL/UMLAL, SMLSL/UMLSL（乘法扩展）
- [ ] SADDLP/UADDLP（成对加法扩展）
- [ ] SXTL/UXTL（符号/零扩展）

**实现策略**:
```typescript
// 模式：读窄 lane → 扩展 → 算术 → 写宽 lane
function vaddl(vd: number, vn: number, vm: number, size: number, signed: boolean) {
  const laneCount = size === 0 ? 8 : size === 1 ? 4 : 2; // 8/16/32
  const wideLaneSize = (8 << size) * 2; // 16/32/64
  for (let i = 0; i < laneCount; i++) {
    const nVal = signed ? signExtend(readLane(vn, i, size), 8 << size) 
                         : readLane(vn, i, size);
    const mVal = signed ? signExtend(readLane(vm, i, size), 8 << size) 
                         : readLane(vm, i, size);
    writeLane(vd, i, size + 1, nVal + mVal); // size+1 = 宽一级
  }
}
```

**验证**:
- 边界测试：最大值扩展、符号位保留
- 真实库压测：libbarhopper_v3.so（ML Kit，大量 widening 操作）

---

#### Subtask 1.2.2: Saturating（饱和）指令 [L]
**范围**:
- [ ] SQADD/UQADD, SQSUB/UQSUB（饱和加减）
- [ ] SQSHL/UQSHL, SQRSHL/UQRSHL（饱和移位）
- [ ] SQDMULH/SQRDMULH（饱和倍乘高位）
- [ ] SQXTN/UQXTN（饱和窄化）
- [ ] 设置 QC (cumulative saturation) flag in FPSR

**饱和逻辑**:
```typescript
function saturate(value: bigint, bits: number, signed: boolean): bigint {
  if (signed) {
    const max = (1n << BigInt(bits - 1)) - 1n;
    const min = -(1n << BigInt(bits - 1));
    if (value > max) { setQC(); return max; }
    if (value < min) { setQC(); return min; }
  } else {
    const max = (1n << BigInt(bits)) - 1n;
    if (value > max) { setQC(); return max; }
    if (value < 0n) { setQC(); return 0n; }
  }
  return value;
}
```

**验证**:
- 溢出测试：0x7FFF + 1 → 0x7FFF (SQADD), 0x8000 - 1 → 0x8000 (SQSUB)
- QC flag 设置验证

---

#### Subtask 1.2.3: LD2/LD3/LD4 De-interleave [M]
**目标**: 实现多结构 load/store 的 de-interleave 模式

**范围**:
- [ ] LD2 {Vt.8B, Vt2.8B}, [Xn] — 交错读取 2 个向量
- [ ] LD3/LD4 同理（3/4 路交错）
- [ ] ST2/ST3/ST4 写入
- [ ] Post-index 和寄存器偏移模式

**De-interleave 逻辑**:
```typescript
// LD2 示例：内存 [a0,b0,a1,b1,...] → Va=[a0,a1,...], Vb=[b0,b1,...]
function ld2(vt: number, vt2: number, addr: bigint, lanes: number) {
  for (let i = 0; i < lanes; i++) {
    const a = mem.read8(addr + BigInt(i * 2));
    const b = mem.read8(addr + BigInt(i * 2 + 1));
    writeLane(vt, i, 0, a);  // size=0 (8-bit)
    writeLane(vt2, i, 0, b);
  }
}
```

**验证**:
- FFmpeg NEON 内核（`ff_*_neon` 函数大量使用）
- 真实视频解码压测（如果用户明确需要视频场景）

---

### Task 1.3: NULL 间接调用检测优化 [S]
**目标**: 更智能的假返回检测

**改进**:
- [ ] 增加 heuristic：连续 3 次 `BLR/BR` 目标递减（栈回溯模式）→ 可能是假返回
- [ ] 可选严格模式：记录所有合法函数入口点（符号表 + 代码段扫描），跳转到非入口点 → 警告
- [ ] 性能优化：入口点白名单用 Bloom filter 减少查询开销

**文件**:
- 修改 `decoder/BranchSystem.ts`

---

## Phase 2: Dart AOT 层（主线目标）[XL+]

### Task 2.1: Dart Snapshot 格式解析 [L]
**目标**: 解析 libapp.so 中的 Dart AOT snapshot

**范围**:
- [ ] Snapshot 头部解析（magic, version, features）
- [ ] Cluster 结构：Code/ObjectPool/PcDescriptors/Instructions
- [ ] 对象布局：RawObject header, RawCode, RawObjectPool
- [ ] 提取所有 Code objects 和它们的指令地址

**参考**:
- Dart SDK `runtime/vm/clustered_snapshot.cc`
- blutter 工具的 snapshot 解析逻辑
- reFlutter 的 Dart 结构定义

**验证**:
- 解析真实 Flutter APK 的 libapp.so，输出 Code 对象数量和总指令大小
- 与 blutter 输出对比一致性

**文件**:
- 新增 `src/modules/native-emulator/dart/SnapshotParser.ts`

---

### Task 2.2: Dart 调用约定 [L]
**目标**: 实现 Dart 专用寄存器约定和 tagged pointer

**范围**:
- [ ] 特殊寄存器：x15=THR(Thread), x27=PP(ObjectPool), x26=NULL, x28=HEAP_BASE
- [ ] Tagged pointer 解码：低位 tag (Smi/HeapObject), kHeapObjectTag=1
- [ ] Smi（小整数）编码：值左移 1 位
- [ ] 拦截对 THR/PP 的访问，映射到 Dart runtime 结构

**实现**:
```typescript
// 扩展 CpuEngine 的寄存器读取
function readDartRegister(reg: number): bigint {
  if (reg === 15) return this.dartThread; // THR
  if (reg === 27) return this.dartObjectPool; // PP
  if (reg === 26) return this.dartNullObject; // NULL
  if (reg === 28) return this.dartHeapBase; // HEAP_BASE
  return this.x[reg];
}

function detagPointer(ptr: bigint): bigint {
  return ptr & ~0x1n; // 清除低位 tag
}

function isSmi(ptr: bigint): boolean {
  return (ptr & 0x1n) === 0n; // Smi tag = 0
}

function smiValue(smi: bigint): bigint {
  return smi >> 1n; // 右移还原
}
```

**验证**:
- 手工构造简单 Dart 函数调用，验证寄存器约定
- 解析 ObjectPool，验证 tagged pointer 解码

**文件**:
- 新增 `src/modules/native-emulator/dart/DartRuntime.ts`

---

### Task 2.3: ObjectPool 间接调用 [M]
**目标**: 实现通过 ObjectPool 的函数调用

**范围**:
- [ ] ObjectPool 结构解析：entries[] 数组，每个 entry = {type, value}
- [ ] 常见 entry 类型：kTaggedObject, kImmediate, kNativeFunction
- [ ] 间接调用模式：`LDR x8, [PP, #offset]` → `BLR x8`
- [ ] 拦截 PP 相对 load，查询 ObjectPool entry，返回真实地址

**实现**:
```typescript
class ObjectPool {
  entries: Array<{type: 'object' | 'immediate' | 'native', value: bigint}>;
  
  lookup(offset: number): bigint {
    const index = offset / 8; // 8-byte entries
    const entry = this.entries[index];
    if (entry.type === 'native') {
      return entry.value; // 函数指针
    }
    // ... 其他类型
  }
}

// CpuEngine load 拦截
if (baseReg === 27 && this.dartObjectPool) {
  return this.dartObjectPool.lookup(offset);
}
```

**验证**:
- 跟踪真实 libapp.so 的函数调用链，确认 ObjectPool 查询正确
- 对比 blutter 的反编译输出

**文件**:
- 修改 `dart/DartRuntime.ts`，新增 `ObjectPool` 类

---

### Task 2.4: Dart 内建函数桩 [L]
**目标**: 实现常用 Dart runtime 函数的桩

**范围**:
- [ ] `_List::[]` / `_List::[]=`（数组访问）
- [ ] `_StringBase::_interpolate`（字符串插值）
- [ ] `_Double::+`, `_Double::*` 等（数值运算）
- [ ] `_Type::_toString`（类型转字符串）
- [ ] Allocate 系列（对象分配，简化为返回 mock 对象）

**实现策略**:
- 识别 Dart 内建函数符号（前缀 `_`）
- 注册 host 函数桩，返回合理默认值
- 不求完整运行 Dart 代码，只求"不崩溃 + 关键路径通"

**验证**:
- 运行简单 Flutter 函数（如 `main()` 调用链），看能走多远
- 记录遇到的未实现内建函数，按需补充

**文件**:
- 新增 `src/modules/native-emulator/dart/DartBuiltins.ts`

---

### Task 2.5: Dart 域工具接入 [M]
**目标**: 暴露 Dart AOT 分析工具给 MCP

**新工具**:
- [ ] `dart_load_snapshot` — 加载 libapp.so，解析 snapshot，返回统计信息
- [ ] `dart_list_functions` — 列出所有 Dart Code objects（名称、地址、大小）
- [ ] `dart_call_function` — 调用指定 Dart 函数（通过地址或名称）
- [ ] `dart_inspect_object_pool` — 查看 ObjectPool 内容
- [ ] `dart_trace_execution` — 执行并记录 Dart 调用栈

**集成**:
- 扩展 `NativeEmulator` 门面，增加 `loadDartSnapshot()` / `callDartFunction()` 方法
- 新增 `src/server/domains/dart-inspector/` （当前 dart-inspector 只做静态字符串，需分离动态执行）

**验证**:
- 端到端：加载真实 Flutter APK → 列出函数 → 调用 `main()` → 追踪调用栈

---

## Phase 3: 性能优化（可选但推荐）[L-XL]

### Task 3.1: 热路径 JIT 编译 [XL]
**目标**: 将频繁执行的指令序列编译为 Wasm

**策略**:
- [ ] Profiling 层：记录每条指令的执行次数
- [ ] 热点检测：执行次数 > 10,000 的基本块标记为热点
- [ ] Trace JIT：记录热点基本块的指令序列
- [ ] Wasm codegen：将 ARM64 指令序列翻译为 Wasm 函数
- [ ] 混合执行：热路径走 Wasm，冷路径走解释器

**Wasm codegen 示例**:
```typescript
// ARM64: ADD x0, x1, x2 → Wasm: (i64.add (local.get $x1) (local.get $x2))
function compileAdd(rd: number, rn: number, rm: number): WasmFunc {
  return wasmModule.addFunction([
    { op: 'i64.add', args: [`$x${rn}`, `$x${rm}`] },
    { op: 'local.set', args: [`$x${rd}`] }
  ]);
}
```

**预期加速**:
- 解释器：~17 ns/指令
- Wasm JIT：预计 ~3-5 ns/指令（3-5x 加速）

**风险**:
- 复杂度极高（XL），可能不值得（工具场景非生产运行时）
- Wasm 编译开销可能抵消收益（小热点不划算）

**建议**: 最后做，前面都完成了再考虑

---

### Task 3.2: 指令缓存和解码优化 [M]
**目标**: 减少重复解码开销

**范围**:
- [ ] 解码缓存：`Map<pc, DecodedInstruction>`，缓存已解码的指令
- [ ] 基本块识别：一次性解码整个基本块（到分支指令为止）
- [ ] 预取优化：顺序执行时预取下 N 条指令

**预期加速**: 10-20%（热循环中重复解码的场景）

---

## Phase 4: 探针驱动 NEON 补充 [L]

### Task 4.1: 自动化 opcode 缺口分析 [S]
**目标**: 系统化真实库 NEON 指令覆盖分析

**工具**:
- [ ] 扩展 `scripts/native-emulator-probe.ts`，输出详细 opcode 直方图
- [ ] 自动分类：已实现 / widening / saturating / LD-interleave / 其他
- [ ] 按真实库分组统计（哪个库需要哪些指令）

**输出**:
```
=== NEON Instruction Coverage ===
Total unique opcodes: 347
Implemented: 253 (72.9%)
Widening (missing): 38 (11.0%)
Saturating (missing): 29 (8.4%)
LD2/3/4 (missing): 12 (3.5%)
Other (missing): 15 (4.3%)

Top 10 missing by frequency:
1. SADDL (94 occurrences in libbarhopper_v3.so)
2. SQADD (76 occurrences in libimage_processing.so)
...
```

---

### Task 4.2: Top-K 缺口实现 [M]
**目标**: 按真实需求优先级补充

**策略**:
- 运行 Task 4.1 工具，拿到 Top-20 缺失指令
- 按命中频率排序，优先实现 Top-10
- 每实现一批，重新运行探针，验证覆盖率提升

**目标覆盖率**: 95%+ （基于真实库命中，而非全部 ARM64 指令集）

---

## Phase 5: 文档和生态 [M]

### Task 5.1: 性能基准测试套件 [S]
**范围**:
- [ ] 标准 benchmark：AES 加密吞吐、SHA256 哈希速率、NEON 矩阵乘
- [ ] 对比基线：QEMU/Unicorn（如果能跑）
- [ ] 发布 benchmark 结果到 README

---

### Task 5.2: 完整能力矩阵 [S]
**范围**:
- [ ] 更新 `nemu_capabilities` 工具，输出详细 JSON：
  ```json
  {
    "isa": "aarch64-complete",
    "features": {
      "integer": "100%",
      "neon": {
        "core": "100%",
        "widening": "100%",
        "saturating": "100%",
        "load_store": "100%"
      },
      "crypto": {"aes": true, "sha1": true, "sha256": true, "sha512": false, "pmull": true},
      "fp": {"scalar": true, "exceptions": true, "simd": true},
      "dart": {"snapshot": true, "calling_convention": true, "builtins": "partial"}
    },
    "test_coverage": {"lines": 95.3, "branches": 89.7}
  }
  ```

---

### Task 5.3: 学术论文和博客 [M]
**目标**: 宣传技术优势，吸引贡献者

**内容**:
- [ ] 博客文章：《超越 QEMU：打造零依赖的 ARM64 仿真器》
- [ ] 技术深度文：《Dart AOT 逆向工程：从 Snapshot 到函数调用》
- [ ] （可选）学术论文投稿：《A Lightweight ARM64 Emulator for Mobile Reverse Engineering》

---

## 总工作量估算

| Phase | Tasks | 总复杂度 | 预估时间（人周） |
|-------|-------|---------|---------------|
| Phase 1 | 1.1-1.3 | L+XL+S = **XL** | 3-4 周 |
| Phase 2 | 2.1-2.5 | L+L+M+L+M = **XL+** | 4-6 周 |
| Phase 3 | 3.1-3.2 | XL+M = **XL** | 3-4 周（可选） |
| Phase 4 | 4.1-4.2 | S+M = **M** | 1-2 周 |
| Phase 5 | 5.1-5.3 | S+S+M = **M** | 1-2 周 |
| **总计** | **13 tasks** | **XL+++** | **12-18 周（3-4.5 月）** |

---

## 执行策略

### 推荐顺序
1. **Phase 1 → Phase 4** （先补全 NEON 基础，探针验证）
2. **Phase 2** （Dart AOT，主线目标）
3. **Phase 5** （文档和生态）
4. **Phase 3** （性能优化，最后做）

### 里程碑
- **M1 (4 周)**: Phase 1 完成，FP 异常 + NEON widening/saturating 全实现
- **M2 (8 周)**: Phase 2 完成，Dart AOT 基础能力（解析 + 调用约定 + ObjectPool）
- **M3 (10 周)**: Phase 4 完成，95%+ 真实库覆盖率
- **M4 (12 周)**: Phase 5 完成，发布 v1.0 "Industry-Leading ARM64 Emulator"

---

## 风险和缓解

| 风险 | 缓解 |
|------|------|
| **Dart AOT 格式变化** | 支持多版本 snapshot（Flutter 2.x/3.x/4.x） |
| **NEON 长尾无底洞** | 严格按探针驱动，不实现未命中的指令 |
| **性能优化效果不明显** | Phase 3 放最后，可砍 |
| **工作量超预期** | 按 Phase 交付，每个 Phase 可独立发版 |

---

## 下一步

你想：
1. **全速执行** — 我立即开始 Phase 1.1（FP 异常处理）
2. **调整优先级** — 修改计划（如先做 Dart AOT）
3. **逐步推进** — 一次做一个 Task，你确认后再继续
4. **需要更多细节** — 我展开某个 Task 的技术设计

你的选择？
