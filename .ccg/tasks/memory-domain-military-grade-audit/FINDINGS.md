# Memory Domain Military-Grade Audit — 2026-06-23

## Executive Summary

**29 工具 | ~1,760 行 handler 代码 | ~7,600 行模塊層 | 2,300+ 行原生引擎**

| 维度 | 评级 | 说明 |
|------|------|------|
| **基础功能覆盖** | ✅ 优秀 | 扫描/写/断点/PE/inline hook/堆/结构分析全部具备 |
| **输入安全性** | ⚠️ 良好（已增强） | 2026-06-20 军工级 hardening，共享 validation.ts + parseArgs，但仍有若干 handler 层遗漏 |
| **审计追踪** | ⚠️ 不完整 | 仅 Hook/ReadWrite 注入，Scan/Session/PointerChain/Structure/Integrity 缺失 |
| **行业对齐度** | ⚠️ 有差距 | 对比 Cheat Engine / x64dbg / pe-sieve / Volatility3 存在 15+ 项可改进点 |
| **前沿技术覆盖** | ❌ 不足 | IAT hook 检测、动态反调试、AI 结构推断等前沿特性缺失 |
| **工藝極限** | ❌ 未觸及 | SIMD 加速掃描、GPU 並行、CET/Shadow Stack 交互等 2024-2026 新技術未實現 |

---

## Part 1: Per-Tool Military-Grade Assessment

### ✅ Tier 1 — 已达军工级（无重大缺陷）

| 工具 | 评级 | 已实现的军工特性 |
|------|------|-----------------|
| `memory_breakpoint` | ✅ | DR0-DR3 完整实现、DR7 编码正确、所有线程上下文操作、单步异常收集 |
| `memory_patch_bytes` | ✅ | VirtualProtectEx 保护切换、原始字节保存、撤销机制、审计接入 |
| `memory_inline_hook_detect` | ✅ | **8 种 hook 模式**（pe-sieve 对齐）、目标解码、padding/CC 检测 |
| `memory_heap_anomalies` | ✅ | **volatility malfind 风格熵检测**（≥7.0 bits/byte）、堆喷/释放后使用/可疑大小 |
| `memory_pe_imports_exports` | ✅ | 完整 PE 导入表解析、按名称/序号/转发导出 |
| `memory_code_caves` | ✅ | NOP/CC/0x00 扫描、按大小降序排列 |
| `memory_write_history` | ✅ | undo/redo 栈、审计接入 |

### ⚠️ Tier 2 — 有显著缺陷，需增强

| 工具 | 严重性 | 核心缺陷 |
|------|--------|---------|
| `memory_first_scan` | **高** | 值格式未做 valueType 一致性校验（"abc" + int32 能通过 handler） |
| `memory_next_scan` | **高** | between 模式不强制 value2；非存在 sessionId 不验证 |
| `memory_pointer_scan` | **高** | maxDepth/maxOffset 无边界检查（文档说 1-6，但 handler 不 enforce） |
| `memory_structure_analyze` | **高** | size 无上限（1GB+ 可传入）；vtable 不对齐检查 |
| `memory_pe_headers` | **中** | 无 MZ 头验证；section 详情不暴露 |
| `memory_anticheat_detect` | **严重** | 仅扫描导入表；动态解析/手动 syscall 检测为零；无内核级反作弊检测 |
| `memory_patch_nop` | **高** | count 无上限（2,147,483,647 字节 NOP 可传入） |
| `memory_speedhack` | **高** | **trampoline 不应用时间倍率**（共享内存存储倍率但 trampoline 仅透传） |
| `memory_write_value` | **高** | value-valueType 一致性不校验；write protection 不预检 |
| `memory_freeze` | **高** | 无最大并发 freeze 限制；intervalMs=1 无最小间隔保护 |

### ❌ Tier 3 — 有重大功能缺口

| 缺口 | 来源工具 | 行业对标 |
|------|---------|---------|
| **无 IAT hook 检测** | `memory_inline_hook_detect` | pe-sieve 有 IAT 扫描模式；x64dbg 检测所有三种 hook 类型 |
| **无动态反调试检测** | `memory_anticheat_detect` | pe-sieve + Volatility 检查运行时调用模式，不仅导入表 |
| **无内核反作弊检测** | `memory_anticheat_detect` | EAC/BattlEye/Vanguard 都是内核驱动 |
| **无写保护自动更改** | `memory_patch_bytes`/`memory_write_value` | Cheat Engine/x64dbg 提示并自动修改 |
| **无 DR 寄存器耗尽检查** | `memory_breakpoint` | CE 显示"所有调试寄存器已占用" |
| **无 per-address undo** | `memory_write_history` | CE 按地址维护撤销栈 |
| **无 scan cancellation** | `memory_first_scan`/`memory_next_scan` | CE 可随时中止扫描 |
| **无 .rdata/.data 完整性检查** | `memory_integrity_check` | pe-sieve 检查所有可执行段 |
| **无 scan 取消/超时** | 全局 | 长时操作无 AbortController 包装 |
| **无并发/重入保护** | 全局 | 同一 PID 并发扫描/写/断点无 mutex |
| **无 Windows 签名验证** | `injection-validator` | `checkWindowsSignature` 返回硬编码 `false` |

---

## Part 2: Cross-Cutting Handler Layer Issues

### 🔴 Critical — PID Fallback 不安全（所有 6 个 handler）

每个 handler 的 `resolvePid()` 在 `processManager` 不存在时执行：
```typescript
// hooks.ts:44, integrity.ts:28, pointer-chain.ts:20, readwrite.ts:44, scan.ts:65, structure.ts:85
if (!processManager) return value as number;  // ❌ value 可以是 undefined/"abc"
```

**影响**: undefined 被强制转为 `NaN` → 传递到原生层 → 产生无法理解的 FFI 错误。

**修复**: 与 validation.ts 中的 `requirePositiveNumberArg` 对齐，handler 层始终做正数验证。

### 🔴 Critical — AntiCheatDetector 静态检测不足

当前仅扫描导入表。2024-2025 反作弊检测技术已演进：

| 检测能力 | 当前状态 | 行业标准 |
|---------|---------|---------|
| 导入表扫描 | ✅ 实现 | 基础 |
| 运行时调用模式 | ❌ 无 | pe-sieve/Volatility 标准 |
| 手动 syscall 检测 | ❌ 无 | EAC/Vanguard 均使用 |
| ETW 回调监控 | ❌ 无 | Windows 10+ EDR 标配 |
| 内核驱动枚举 | ❌ 无 | 必须能力 |

### 🟠 High — Speedhack 功能不完整

**关键发现**: trampoline 不应用时间倍率！

```
sharedMem 偏移 0 → 存储 speed 倍率 double
sharedMem 偏移 8 → 存储 base timestamp
trampoline 代码 → 仅执行原始 prologue + jump back（无缩放逻辑）
```

`hookTimeFunction` 构建的是**透传 detour**，而非**时间缩放 detour**。倍率存储在共享内存中，但 trampoline 代码从不读取它。

**额外问题**: 不 hook `GetTickCount`（32 位版本）；两次调用 `apply()` 会重复 hook；无显式 "restore/remove" 操作。

---

## Part 3: Cutting-Edge Research & Enhancement Opportunities

### 🔬 Category 1: Inline Hook Detection 前沿

**来源**: pe-sieve (hasherezade), iored.team, MalwareTech 2023-2025

#### 3.1 IAT/EAT Hook 检测（pe-sieve 已验证）
- **当前**: `memory_inline_hook_detect` 仅检查函数开头（inline hooks）
- **前沿**: pe-sieve 4.7+ 有专门的 IAT 扫描模式 — 遍历每个模块的 `IMAGE_IMPORT_DESCRIPTOR`，对比 IAT 条目与对应模块导出表地址
- **实现**: 可在 PEAnalyzer 增加 `detectIATHooks()`，复用现有的导入表解析逻辑

#### 3.2 Ghost Frame / Stack Walking Hook 检测（DEF CON 31）
- **来源**: "StackMoonwalk" DEF CON 31 — LACUNA 研究
- **技术**: 通过手动遍历栈帧检测 call stack 篡改， defeating 所有基于 call stack 的 EDR 检测
- **实现价值**: 可作为 `memory_inline_hook_detect` 的扩展模式 — "deep scan" 选项

#### 3.3 Syscall Stub 检测（ired.team 2025）
- **来源**: [ired.team — Detecting Hooked Syscalls](https://www.ired.team/offensive-security/defense-evasion/detecting-hooked-syscall-functions)
- **技术**: 对比 ntdll.dll `Zw*` 函数入口与 ntdll.dll `.text` 段中的真实 syscall 指令
- **实现**: 可在 PEAnalyzer 增加 `compareWithDisk()` 参数，支持比对 on-disk PE vs in-memory

### 🔬 Category 2: Memory Forensics 前沿

#### 3.4 Volatility3 2025 Windows NT Heap 深度分析
- **来源**: [reversea.me — Uncovering Threats in the Windows NT Heap](https://reversea.me/index.php/uncovering-threats-in-the-wwindow-nt-heap-with-volatility-3/)
- **技术**: 提取并结构化分析 Windows NT heap 条目，包含 LFH (Low Fragmentation Heap) 子段分析
- **实现价值**: `memory_heap_analyze` 可增加 LFH 感知 — 检测 LFH 子段中的异常分配模式

#### 3.5 Volatility Plugin Contest 2025 获奖插件
- **来源**: [volatilityfoundation.org — 2025 Contest Results](https://volatilityfoundation.org/the-2025-volatility-plugin-contest-results-are-in/)
- **APCWatch**: APC (Asynchronous Procedure Call) 枚举和基线分析 — 检测注入的 APC
- **MalAPC**: 高级 APC 检测 — 检测 shellcode 通过 APC 注入
- **实现价值**: `memory_heap_anomalies` 可扩展为 APC 注入检测；新增 `memory_apc_detect` 工具

#### 3.6 AI-Augmented Memory Reverse Engineering (arXiv 2025-2026)
- **来源**: [arXiv 2606.17398 — SoK: AI-Augmented Binary Reversing](https://arxiv.org/html/2606.17398v1)
- **来源**: [MDPI — Transformer-Based Memory Reverse Engineering](https://www.mdpi.com/2073-431X/15/1/8)
- **技术**: 
  - 将原始内存字节作为 linguistic tokens 用 Transformer 处理
  - TYGR: 使用 GNN 对 stripped binary 做类型推断
  - LLM-assisted RE: NDSS 2026 首个人机协作 RE 系统研究
- **实现价值**: `memory_structure_analyze` 的 `parseRtti` 可升级为 AI 辅助 — 当 RTTI 失败时，LLM 可基于内存字节模式推断结构类型

### 🔬 Category 3: Anti-Cheat Bypass Detection 前沿

#### 3.7 EAC/BattlEye/Vanguard 2024-2025 检测技术分析
- **来源**: [s4dbrd.github.io — How Kernel Anti-Cheats Work](https://s4dbrd.github.io/posts/how-kernel-anti-cheats-work/)
- **来源**: [sknexus — Kernel-Level Anti-Cheat 2025](https://www.sknexus.org/p/kernel-level-anti-cheat)
- **2025 年关键洞察**:
  - **EAC**: 使用 `PsSetCreateProcessNotifyRoutine` + `ObRegisterCallbacks` 监控进程创建
  - **BattlEye**: 用户态 + 内核态双重扫描，使用 `MmGetSystemRoutineAddress` 直接调用内核函数绕过用户态 hook
  - **Vanguard (Riot)**: 最早启动（早于 Windows 登录），使用 `WPP` 软件追踪 + 自定义内核回调
- **当前差距**: `memory_anticheat_detect` 完全不检测这些 — 只检查导入表

#### 3.8 Black Hat USA 2025 — "Watching the Watchers"
- **来源**: [YouTube — Exploring and Testing Defenses of Anti-Cheat Systems](https://www.youtube.com/watch?v=lAW2mAl96KI)
- **内容**: 主动测试反作弊防御机制的技术
- **实现价值**: 可将反作弊"系统指纹识别"增强为双向 — 不仅检测反 cheat，还能识别特定反 cheat 版本和配置

### 🔬 Category 4: Hardware Breakpoint Innovations

#### 3.9 CET (Control-flow Enforcement Technology) / Shadow Stack
- **来源**: [connormcgarr.github.io — Kernel Mode Shadow Stacks](https://connormcgarr.github.io/km-shadow-stacks/)
- **来源**: [windows-internals.com — CET on Windows](https://windows-internals.com/cet-on-windows/)
- **技术**: Intel CET (Windows 10 20H1+) 引入 Shadow Stack — 一个独立的"影子栈"跟踪返回地址
- **实现价值**: `memory_breakpoint` 可增加 CET 感知 — 检测目标进程是否启用 CET，以及 DR 寄存器与 Shadow Stack 的交互
- **注意**: CET 程序禁用传统 DR 硬件断点（`#VC` 异常替代），当前实现需处理此兼容性

### 🔬 Category 5: Scanning Algorithm Innovations

#### 3.10 SIMD-Accelerated Memory Scanning
- **来源**: 未见 2025 年新论文，但 Cheat Engine 社区持续优化
- **技术**: SSE2/AVX2 指令集并行比较 — 32 字节/周期 vs 当前逐字节扫描
- **实现价值**: `memory_first_scan` 的核心循环可替换为 koffi 调用的 SIMD 函数

#### 3.11 Parallel/Chunked Scanning 优化
- **当前**: 16MB chunk + overlap carryover
- **前沿**: 多线程分区扫描 — 将地址空间划分为 N 个区域并行扫描
- **注意**: 受 ReadProcessMemory 速率限制，收益有限但可实验

---

## Part 4: Prioritized Enhancement Roadmap

### 🔴 Phase 1 — Critical Security Fixes（立即，< 1 天）

| # | 优先级 | 工具/模块 | 修复内容 |
|---|--------|---------|---------|
| 1 | P0 | **所有 handler** | `resolvePid()` 替换 `value as number` 为 `requirePositiveNumberArg` |
| 2 | P0 | `memory_speedhack` | **修复 trampoline**: 实现时间缩放逻辑（读取 sharedMem 倍率，缩放 QPC/GetTickCount 返回值） |
| 3 | P0 | `injection-validator` | 替换 `checkWindowsSignature` stub 为真实实现（或标记为 known-limitation） |
| 4 | P1 | `memory_anticheat_detect` | 增加"已知局限"文档；标记为"import-only"基线版本 |

### 🟠 Phase 2 — High-Impact Feature Gaps（1-3 天）

| # | 优先级 | 工具/模块 | 增强内容 |
|---|--------|---------|---------|
| 5 | P1 | `memory_inline_hook_detect` | **增加 IAT hook 检测模式**（pe-sieve 4.7 对齐）；新增 `scanMode` 参数: `inline\|iat\|both` |
| 6 | P1 | `memory_first_scan` / `memory_next_scan` | valueType 一致性校验（"hello" + int32 → handler 层拒绝）；scan cancellation 支持 AbortController |
| 7 | P1 | `memory_breakpoint` | DR 寄存器耗尽检查（DR0-DR3 全用时返回明确错误） |
| 8 | P1 | `memory_patch_nop` | maxCount 上限（默认 1024 字节，可配置） |
| 9 | P1 | `memory_freeze` | maxFreezeCount 限制 + intervalMs 下限（默认 10ms） |
| 10 | P2 | `memory_write_history` | per-PID undo 栈替代全局栈 |
| 11 | P2 | `memory_integrity_check` | 扩展至 .rdata/.data 段；增加可配置 compareLength |
| 12 | P2 | `memory_anticheat_detect` | 增加"运行时 anti-debug 检测"：RDTSC 时序检测 + ETW 回调枚举 + 内核驱动列表 |

### 🟡 Phase 3 — Industry Alignment（3-7 天）

| # | 优先级 | 工具/模块 | 增强内容 |
|---|--------|---------|---------|
| 13 | P2 | `memory_structure_analyze` | vtable 对齐检查（8 字节）；maxSize 上限（默认 64KB） |
| 14 | P2 | `memory_pe_headers` | MZ 头预验证；section table 详情输出 |
| 15 | P2 | `memory_patch_bytes` / `memory_write_value` | write protection 预检 + 自动调整权限选项 |
| 16 | P2 | `memory_speedhack` | hook `GetTickCount`（32位）；add `restore` action；防重复 hook |
| 17 | P2 | `memory_scan_session` | 导出结果大小限制/分页；delete 返回详细状态 |
| 18 | P3 | `memory_pointer_chain` | JSON schema 验证；maxDepth/maxOffset 边界 enforce |
| 19 | P3 | `memory_group_scan` | 偏移重叠检测；pattern count 上限 |
| 20 | P3 | `memory_heap_analyze` | LFH 感知检测；per-heap 过滤；APC 注入检测（Volatility 2025 获奖插件 APCWatch 启发） |

### 🟢 Phase 4 — Cutting-Edge Research（1-2 周）

| # | 优先级 | 研究方向 | 实现内容 |
|---|--------|---------|---------|
| 21 | P3 | **IAT hook 深度检测** | 完整 IAT/EAT 遍历 + 磁盘 vs 内存对比 + IAT hook 解码目标 |
| 22 | P3 | **Volatility malfind 启发** | `memory_memory_integrity_check` 增加 VAD (Virtual Address Descriptor) 分析，检测隐藏/修改的 VAD 条目 |
| 23 | P3 | **AI 辅助结构推断** | `memory_structure_analyze` 的 fallback 模式：当 RTTI 失败时，调用 LLM 基于字节模式推断结构（arXiv 2606.17398 启发） |
| 24 | P3 | **APC 注入检测** | 新增 `memory_apc_detect` 工具：枚举 APC 队列，检测注入的 shellcode（Volatility APCWatch 2025 启发） |
| 25 | P4 | **CET/Shadow Stack 感知** | `memory_breakpoint` 检测目标 CET 状态；在 CET 进程中使用 VEH 替代 DR |
| 26 | P4 | **RDTSC 时序反调试** | `memory_anticheat_detect` 增加代码段 RDTSC/RDTSCP 指令扫描 |
| 27 | P4 | **Pointer Scan 压缩数据库** | `memory_pointer_chain` 增加压缩指针链存储 + 交叉验证（Cheat Engine 2025 社区特性） |

---

## Part 5: Handler 层遗漏的 Audit Trail 注入

当前只有 HookHandlers + ReadWriteHandlers 注入 MemoryAuditTrail。以下应补充：

| Handler | 应注入理由 |
|---------|-----------|
| `ScanHandlers` | first/next/unknown scan 记录 sessionId、结果数、耗时 |
| `SessionHandlers` | export/delete 操作记录 |
| `PointerChainHandlers` | chain scan/resolve/export 记录链深度、结果数 |
| `StructureHandlers` | structure analyze/vtable/compare 记录地址、大小 |
| `IntegrityHandlers` | PE 完整性检查记录模块名、hash 差异 |

---

## Part 6: Key Research References

| 来源 | 内容 | 相关性 |
|------|------|--------|
| [pe-sieve GitHub](https://github.com/hasherezade/pe-sieve) | 8-pattern inline hook + IAT hook 检测 | 极高 |
| [pe-sieve IAT Wiki](https://github.com/hasherezade/pe-sieve/wiki/4.7.-Scan-for-IAT-Hooks-(iat)) | IAT hook 扫描专项文档 | 极高 |
| [Volatility3 malfind](https://volatility3.readthedocs.io/en/stable/volatility3.plugins.windows.malfind.html) | 内存注入检测标准 | 高 |
| [Volatility 2025 Contest](https://volatilityfoundation.org/the-2025-volatility-plugin-contest-results-are-in/) | APCWatch + MalAPC | 高 |
| [ired.team — Hooked Syscalls](https://www.ired.team/offensive-security/defense-evasion/detecting-hooked-syscall-functions) | 手动 syscall 检测 | 高 |
| [arXiv 2606.17398](https://arxiv.org/html/2606.17398v1) — SoK: AI-Augmented Binary Reversing | AI 辅助逆向工程综述 | 中 |
| [MDPI 2025](https://www.mdpi.com/2073-431X/15/1/8) — Transformer-Based Memory RE | Transformer 处理内存字节 | 中 |
| [NDSS 2026](https://www.ndss-symposium.org/wp-content/uploads/2026-f380-paper.pdf) — Human-LLM RE | 人机协作逆向 | 中 |
| [s4dbrd — Kernel Anti-Cheat](https://s4dbrd.github.io/posts/how-kernel-anti-cheats-work/) | EAC/BattlEye/Vanguard 内核机制 | 高 |
| [connormcgarr — Kernel Shadow Stacks](https://connormcgarr.github.io/km-shadow-stacks/) | CET Shadow Stack 内核实现 | 中 |
| [LACUNA / StackMoonwalk](https://0xmaz.me/posts/LACUNA-Chain-Ghost-Frames-defeats-All-EDR-layers-of-call-stack-based-detection/) | Ghost Frame  defeating call stack EDR | 高 |

---

## Part 7: 总结评级

### 军工级达标率

| 类别 | 达标 | 部分达标 | 未达标 |
|------|------|---------|--------|
| 扫描引擎（first/next/unknown/group） | 2/4 | 2 | 0 |
| 写操作（patch/write/freeze） | 2/4 | 1 | 1 |
| 断点/调试 | 1/1 | 0 | 0 |
| PE 分析 | 2/3 | 1 | 0 |
| Inline Hook 检测 | 1/1 | 0 | 0 |
| 堆分析 | 1/1 | 0 | 0 |
| 反作弊检测 | 0/1 | 0 | 1 |
| 结构分析 | 0/2 | 1 | 1 |
| 速度修改 | 0/1 | 0 | 1 |

**综合评级: B+ (良好，但非军工级)**

"军工级"需要:
1. ✅ 输入验证完整性 → 基本达标（validation.ts + parseArgs 覆盖）
2. ❌ 行业功能对齐 → 部分达标（缺 IAT hook、动态反调试、SIGINT cancellation）
3. ⚠️ 审计追踪完整覆盖 → 部分达标（5/7 handler 缺失）
4. ⚠️ 无已知功能性缺陷 → **speedhack trampoline 不工作** 是功能性缺陷

要达到 **A (军工级)**，需完成 Phase 1 P0 修复 + Phase 2 P1 增强。
