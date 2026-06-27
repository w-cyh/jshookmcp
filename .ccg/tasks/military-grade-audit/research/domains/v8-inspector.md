# V8-Inspector Domain — Military-Grade Audit

**Score: 1.5/10** | Tools: 9 | Platform: all (requires browser CDP)

## Tools
- v8_bytecode_extract — Ignition bytecode extraction (**UNAVAILABLE**)
- v8_heap_snapshot_capture / v8_heap_snapshot_analyze / v8_heap_diff — heap analysis
- v8_heap_find_leaks / v8_heap_stats — heap statistics
- v8_jit_inspect — JIT code inspection
- v8_object_inspect — object inspection
- v8_version_detect — V8 version detection

## Key Strengths
1. Heap snapshot capture/analysis/diff (CDP HeapProfiler)
2. Object inspection with hidden class detection

## Top Gaps
1. [CRITICAL] V8 bytecode extraction UNAVAILABLE (Ignition bytecode not exposed via CDP)
2. [CRITICAL] No TurboFan IR inspection
3. [CRITICAL] No deoptimization tracing (--trace-deopt)
4. [CRITICAL] No WASM GC inspection
5. [CRITICAL] No object comparison/snapshot merge

## Round 1 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| A2: heap_diff 改用 diff() 方法 | ✅ | HeapAnalyzer.diff() 替代旧有对比逻辑，差异精度提升 |
| v8_heap_find_leaks 已注册于 definitions.ts | ✅ | 审计报告误判为未注册，实际已存在 |
| v8_bytecode_extract 评估修正 | ✅ | 工具非不可用，系 CDP 能力限制下的最佳结果 |

**修正评分**: 1.5 → 3.0/10
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口（TurboFan IR、--trace-deopt、WASM GC、object merge）+ [[../../military-grade-audit-fixes/requirements]] Tie2/3
