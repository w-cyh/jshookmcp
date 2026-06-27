# native-emulator 完整性审查报告 — 2026-06-14

## 执行摘要

**结论**：native-emulator **没有**"全量完全逆向"，但**核心 API 已完成**，剩余缺口有明确路径。

---

## 当前状态（真实数据）

### 1. 工具层 API（MCP 工具）
- **总计**：21 个 `nemu_*` 工具（+1 本轮新增：`nemu_load_library_chain`）
- **新增 API**：`loadLibraryChain(dependencies[], primary)` — 多库依赖链式加载，解决跨库导入
- **测试覆盖**：370 个测试全绿（模块层 + 域层）

### 2. luoys-6.10.apk 真实 APK 压测结果

| 库 | 单库加载 | 链式加载（FFmpeg+SDL） | 状态 |
|---|---|---|---|
| libsqlite3 | 0 未解析 | — | ✅ 能调用 `sqlite3_bind_null` |
| libijksdl | 106 未解析 | — | ✅ 能调用首个导出 |
| libijkplayer | **319 未解析** | **~65 未解析** | ⚠️ 单库失败，链式后降到 65（FFmpeg+SDL 导入已解决） |
| libmmkv | 68 未解析 | — | ✅ 能调用首个导出 |
| libijkffmpeg | 115 未解析 | — | ❌ unmapped memory 0x80800003ac3 |
| libffmpeg_remux | 68 未解析 | — | ❌ NULL indirect call |
| libimage_processing_util_jni | 8 未解析 | — | ⚠️ 纯 JNI（未测 `call_jni_export`） |
| libsurface_util_jni | 5 未解析 | — | ⚠️ 纯 JNI（未测 `call_jni_export`） |

**链式加载效果**（libijkplayer 为例）：
- 单库：319 个未解析导入（全是 avcodec/swscale/SDL_* 跨库调用）
- 二库链（FFmpeg）：160 个未解析（降 50%，SDL_* 仍未解析）
- 三库链（FFmpeg + SDL）：~65 个未解析（降 80%，剩余为 J4AC_* JNI 宏 + misc libc）

---

## "全量完全逆向" 的真实缺口

### ✅ 已完成
1. **integer ISA**：全覆盖（move/arith/logical-imm/mul/div/bitfield/CSEL/TBZ/…）
2. **NEON SIMD**：整数 lane 运算（three-same/two-reg-misc/dup/shift/reductions/permute/EXT/TBL）
3. **crypto-ext**：AES/SHA/PMULL（FIPS-197/180-4/180-1 bit-exact）
4. **scalar FP**：IEEE-754 单/双精度（FADD/FMUL/FDIV/FSQRT/FCMP/FCSEL/…）
5. **ELF 重定位**：RELATIVE/JUMP_SLOT/GLOB_DAT + bias 支持（多库共存）
6. **构造器**：DT_INIT/DT_INIT_ARRAY 自动执行
7. **bionic libc**：50+ 函数（malloc/memcpy/strlen/fopen/…）+ VFS
8. **JNI**：环境表 + 对象句柄 + 字段/方法/异常/数组
9. **多库加载**：`loadLibraryChain` API + `nemu_load_library_chain` 工具

### ❌ 未完成（按优先级）

#### P0 — 阻塞真实 APK 通路
1. **libijkplayer 的 65 个剩余未解析**：
   - **J4AC_*** / **J4A_*** 宏（~40 个）：JNI 桥接宏，需要 Java mock（已有 `setup_java_mock`/`setup_java_field`，但未实测这批宏）
   - **SDL_MixAudio / strerror / ijk_log_vprint**（~10 个）：可补 bionic
   - **__sF**（stdout/stderr 全局）：需要模拟文件描述符表
2. **libijkffmpeg 的 unmapped 0x80800003ac3**：未知原因（可能是重定位 bug、可能是 NEON long/widening 指令）
3. **libffmpeg_remux 的 NULL indirect call**：构造器路径触发未初始化函数指针

#### P1 — 语义验证缺失
4. **sqlite3_initialize 仍崩**：mutex/mmap 子系统建模不完整（非 ISA bug）
5. **libijksdl/libmmkv 的"OK"是假象**：只是首个导出没崩，未验证算法语义正确
6. **2 个纯 JNI 库未测**：libimage_processing_util_jni / libsurface_util_jni 需要走 `call_jni_export` + Java mock

#### P2 — 文档覆盖
7. **HANDOFF.md 只覆盖 FFmpeg 链**：未写 sqlite3_initialize 内存子系统建模路径
8. **J4AC 宏未记录**：下一位不知道如何处理这批 JNI 桥接

---

## 核心 API 已完成（可复用）

### `CpuEngine.loadLibraryChain(deps[], primary, bionic?)`
- **作用**：多库依赖链式加载，每个依赖映射到独立 bias（0x10000000 起，64MB 间隔），主库在 bias 0
- **重定位**：RELATIVE/JUMP_SLOT 用 bias 调整 offset + symbolValue
- **符号解析**：依赖的导出合并到 engine-wide symbol table，主库可绑定
- **构造器**：只执行主库的 .init/.init_array（依赖的跳过，避免部分初始化）
- **测试**：4 个真实 FFmpeg 库测试全绿（319 → 160 → ~65 未解析）

### `NativeEmulator.loadLibraryChain(deps[], primary)`
- L7 facade 暴露给 domain handlers
- 返回 `{entry, unresolvedImports, constructorFaults}`

### `nemu_load_library_chain` 工具
- MCP 工具层 API，接受 `dependencyPaths[]` + `primaryPath`
- 已注册到 manifest（21 个工具）
- 已在 handlers.impl.ts 实现

---

## 下一步（优先级排序）

### 立即可做（有现成工具）
1. **补全 bionic**：添加 strerror/__sF/SDL_MixAudio/ijk_log_vprint（~10 个函数）
2. **J4AC 宏测试**：用 libijkplayer + `setup_java_mock` 注册这批宏，验证能否消除 40 个未解析
3. **纯 JNI 库验证**：对 libimage_processing_util_jni 调用 `call_jni_export` + Java mock

### 需要诊断（复杂）
4. **libijkffmpeg unmapped 0x80800003ac3**：
   - 用 `nemu_trace` 跟踪崩溃前 10 条指令
   - 检查是否触发 long/widening NEON（已知未支持）
   - 检查 bias 计算是否有 off-by-one
5. **libffmpeg_remux NULL indirect call**：
   - 同上，trace 构造器路径
   - 可能是依赖的依赖未加载（remux 依赖 ffmpeg 依赖 xxx）

### 需要建模（重）
6. **sqlite3_initialize 内存子系统**：
   - mutex 真实建模（pthread_mutex_* 一族）
   - mmap 真实分配（当前 bionic mmap 是 malloc 别名）
   - global config 初始化（sqlite3GlobalConfig 结构体）

---

## 测试状态

- **单元测试**：370 个全绿（模块层 + 域层）
- **集成测试**：`CpuEngine.chain.test.ts` 4 个场景（单库 baseline / 二库链 / 三库链 / 内存不重叠）
- **端到端测试**：无（未写 handlers 层的 load_library_chain 集成测试）

---

## 建议

**如果目标是"全量完全逆向"**：
1. 先做立即可做的 3 项（补 bionic + J4AC 测试 + 纯 JNI 验证）— 1-2 天
2. 诊断 2 个 FFmpeg 库崩溃 — 1 天
3. sqlite3 内存子系统建模 — 2-3 天

**如果目标是"交付可用 API"**：
- ✅ 已完成：`loadLibraryChain` 核心 API + 工具 + 测试全绿
- ⚠️ 需要补：handlers 层集成测试（用真实 APK 调 `nemu_load_library_chain` 工具）
- ⚠️ 需要补：HANDOFF.md 补充 J4AC 宏 + sqlite3 路径

**TDD 铁律遵守情况**：
- ✅ 所有 core API 改动都有对应测试先行（chain.test.ts red → green）
- ✅ 没有硬编码 APK 路径（用 env var `NEMU_INTEGRATION_APK` + skipIf 保护）
- ✅ 没有预制 payload（所有测试数据从真实 APK 提取）

---

## 附录：工具计数验证

```bash
$ pnpm run metadata:check 2>&1 | grep tools
[metadata] registry summary: version=0.3.3, domains=31, tools=460
```

- **native-emulator 域**：21 个工具（+1 本轮：nemu_load_library_chain）
- **全局总计**：460 个工具
