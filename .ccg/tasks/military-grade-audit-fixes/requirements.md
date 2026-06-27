# 全域军工级审计 — 需求增强 & 源码验证报告

## 需求完整性评分：8.5/10

| 维度 | 得分 | 说明 |
|------|------|------|
| 目标明确性 | 3/3 | 审计报告 + handoff 明确列出 Top10 缺口和快速收益项 |
| 预期结果 | 2.5/3 | 大方向清晰，但源码验证后发现多项审计结论需修正 |
| 边界范围 | 2/2 | 按优先级分阶段推进 |
| 约束条件 | 1/2 | 时间约束未知，部分缺口（Z3、x86仿真）需数周开发 |

---

## 关键修正：审计报告 vs 源码实测

| # | 审计报告结论 | 源码实测真相 | 修正后优先级 |
|---|------------|------------|------------|
| 1 | **v8_bytecode_extract "不可用"** | 完整多级实现，标准 Chrome 无 `--allow-natives-syntax` 时返回 unavailable 是正确行为。真正缺口已修：①v8_heap_find_leaks 定义已存在（A1 无需修）②v8_heap_diff 已增强 ③TurboFan IR 仍未做 | 🟡 P1 |
| 2 | **syscall-hook "3个关键文件缺失"** | 功能在 `@modules/syscall-hook/` 实现，CLAUDE.md 过时。已修复：①权限运行时检查 ②CLAUDE.md 文档 | 🟡 P1 |
| 3 | **analysis "JSVMP symbolic 未接入"** | 已接入。真正缺口：①JScrambler/Packer/VM 死代码已激活 ②Z3/SMT 仍缺失 | 死代码已激活 |
| 4 | **exploit-dev "无堆利用"** | 确认完全缺失。memory 域有检测，double-free 已实现 | 确认：P0 |
| 5 | **binary-instrument "插件桥强制依赖"** | 部分修正 — Frida/JADX/Ghidra 有独立能力，仅 IDA 是纯透传 | 🟡 部分 P0 |
| 6 | **process "无线程枚举"** | 已暴露 `process_enum_threads` 工具 | ✅ 已修复 |
| 7 | **debugger "无条件断点"** | 条件断点已实现。logMessage (logpoints) 已实现 | ✅ 已修复 |

---

## Round 1 完成状态 (Phase A+B — 2026/06/24)

### ✅ Phase A: P0 代码级修复

| # | 修复项 | 域 | 状态 |
|---|--------|-----|------|
| A1 | 注册 v8_heap_find_leaks 到 definitions.ts | v8-inspector | ✅ 无需修（定义已存在） |
| A2 | 修复 v8_heap_diff 调用已有的 diff() 方法 | v8-inspector | ✅ 完成 |
| A3 | 注册 JScrambler/Packer/VM Deobfuscator 到 deobfuscate 工具 | analysis | ✅ 完成 |
| A4 | 暴露 EnumerateProcessThreads 为 process_enum_threads 工具 | process | ✅ 完成 |
| A5 | 修复 HeapAnalyzer double-free 检测 | memory | ✅ 完成 |

### ✅ Phase B: 快速收益项

| # | 修复项 | 域 | 状态 |
|---|--------|-----|------|
| B1 | debugger logpoints（logMessage CDP 参数） | debugger | ✅ 完成 |
| B2 | syscall-hook 权限运行时检查 | syscall-hook | ✅ 完成（Tests: NODE_ENV=test 跳过） |
| B3 | Angular 状态提取 | browser | ✅ 完成 |
| B4 | 更新 syscall-hook CLAUDE.md | syscall-hook | ❌ 未做（低优先级文档修复） |
| B5 | IDA Pro CLI 封装 | binary-instrument | ❌ 用户取消 |
| B6 | v8 TurboFan IR 查询 | v8-inspector | ❌ 未做（留待后续） |

| # | 修复项 | 域 | 状态 |
|---|--------|-----|------|
| **C4** | 进程镂空检测 (NtUnmapViewOfSection+内存对比) | process | ✅ 完成 (hollowing-detection.ts, +190行 PEAnalyzer扩展) |
| **C5** | 句柄枚举 (NtQuerySystemInformation SystemExtendedHandleInformation) | process | ✅ 完成 (HandleEnumerator + handle-enumeration, +1,115行, +29测试) |

### 📊 Round 3 统计
| 指标 | 值 |
|------|-----|
| 新增代码 | ~1,515行 (C4 hollowing ~400 + C5 handle-enum ~1,115) |
| - process 工具数: 22 → **23** (+process_enum_handles) |
| process 评分 | 7.5 → **8.0** |
| TS typecheck | 零错误 |
| 全量测试 | 14731/14751 pass |

---

## Round 2 完成状态 (2026/06/24 afternoon)

| # | 修复项 | 状态 | 变更 |
|---|--------|------|------|
| **C3** | Shikata Ga Nai 多态编码器 (248行) | ✅ | handlers/ShikataGaNaiEncoder.ts — FPU GetPC + additive feedback |
| **C2(partial)** | 堆利用—spray generator + format string (280行) | ✅ | handlers/HeapExploitGenerator.ts — V8/IE spray + %hn fmt |
| **B6** | v8 TurboFan IR 查询 | ❌ | CDP 不暴露 Turbofan IR (硬限制), 需 --trace-turbo flag |
| **B4** | syscall-hook CLAUDE.md | ✅ | 已更新 (B2 权限检查已同步) |
| **A5 TDD** | double-free 测试补 (75行) | ✅ | 5 个场景: detectDoubleFree |
| **B1 TDD** | logpoints 测试补 (30行) | ✅ | 1 个场景: breakpoint set with logMessage |

### Round 2 统计
| 指标 | 值 |
|------|-----|
| 新增代码 | ~600行 (ShikataGaNai 248 + HeapExploit 280 + tests 105) |
| - exploit-dev 工具数: 10 → **12** (+heap_spray, +format_string)
- process 工具数: 21 → **22** (+process_enum_threads) |
| exploit-dev 评分 | 9.2 → **9.5** |
| TS typecheck | 零错误 |
| 全量测试 | 14698/14718 pass |

---

## Round 3 计划 (下一位接手)

### Tier 1: 最高优先级 (评分提升最大)

| # | 任务 | 域 | 预估 | 目标评分 |
|---|------|-----|------|---------|
| **C1** | Z3 约束求解器 (`npm z3-solver`) | exploit-dev+analysis | 2-3周 | exploit 9.5→9.8, analysis 8.0→8.5 |
| **C4** | 进程镂空检测 (NtUnmapViewOfSection) | process | 4-8h | process 6.5→7.5 |
| **C5** | 句柄枚举 (NtQuerySystemInformation) | process | 8-16h | process 7.5→8.0 |
| **B6** | v8 TurboFan IR (--trace-turbo CDP) | v8-inspector | 4h | v8-inspector 3.0→3.5 |

### Tier 2

| # | 任务 | 域 | 预估 |
|---|------|-----|------|
| C6 | APC注入检测 | process | 4-8h |
| C7 | 内存取证 .dmp | memory | 8-16h |
| C8 | @native/syscall 接入 | syscall-hook | 4-8h |

### Tier 3

| # | 任务 |
|---|------|
| D1 | v8-inspector 重构 |
| D2 | binary-instrument 去依赖化 |
| D3 | 符号执行扩展性 |
5. 不做架构降级 — 保持现有 domain 结构
