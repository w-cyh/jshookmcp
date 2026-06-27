# Debugger Domain — Military-Grade Audit

**Score: 8.0/10** | Tools: 24 | Platform: all (requires browser CDP)

## Tools
- debugger_lifecycle / debugger_session / debugger_pause / debugger_resume / debugger_step — lifecycle
- debugger_evaluate / debugger_get_paused_state / debugger_wait_for_paused — state inspection
- debugger_get_call_stack / debugger_get_scope_variables_enhanced — context
- breakpoint (action=set/remove/list) with code/exception/XHR/event types — breakpoints
- watch (action=add/remove/list/evaluate_all) — watch expressions
- blackbox_add / blackbox_list — script blackboxing
- anti-debug bypass (3 tools) — anti-debug protection

## Key Strengths
1. Unified breakpoint dispatcher (single entry for code/exception/XHR/event)
2. Watch expressions with evaluate_all
3. Session persistence (save/load/export debug sessions)
4. Anti-debug bypass (3 dedicated tools + detection)

## Top Gaps
1. [HIGH] No conditional/logged breakpoints (CDP supports condition/logMessage)
2. [MED] Blackbox patterns are string-only (no regex or AST-aware exclusion)
3. [LOW] No memory inspection tools in debugger domain (separate memory domain)


## Round 1 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| B1: logMessage (logpoints) fully wired through CDP -> handler -> BreakpointInfo -> DebuggerSessionManager | ✅ | logpoints 通道已打通，支持条件表达式与静默日志输出；audit 中标注"未实现条件断点"有误——条件断点在审计前已实现 |

**修正评分**: 8.0 -> 8.2/10
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口 + [[../../military-grade-audit-fixes/requirements]] Tie2/3
