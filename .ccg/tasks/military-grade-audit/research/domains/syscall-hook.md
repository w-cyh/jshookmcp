# Syscall-Hook Domain — Military-Grade Audit

**Score: 5.5/10** | Tools: 7 | Platform: Win32/Linux/macOS

## Tools
- syscall_start_monitor / syscall_stop_monitor — monitor lifecycle
- syscall_capture_events — event capture + filtering
- syscall_correlate_js — JS function correlation (timing heuristics)
- syscall_filter / syscall_get_stats — filtering rules
- syscall_ebpf_trace — eBPF script generation

## Key Strengths
1. Cross-platform backend (ETW Windows / strace Linux / dtrace macOS)
2. eBPF script generator (dynamic bpftrace script compilation, 15+ syscall tracepoints)
3. Simulation mode (synthetic data with ±30% jitter for testing)

## Top Gaps
1. [CRITICAL] 3 key files declared in CLAUDE.md but MISSING (monitor.ts, correlator.ts, filter.ts)
2. [CRITICAL] Core implementation in external @modules/syscall-hook — unauditable
3. [HIGH] No runtime permission checks (root/Administrator only documented)
4. [HIGH] syscall_correlate_js uses timing heuristics only, no stack unwinding
5. [MED] Manifest/definitions mismatch (syscall_correlate_js not in definitions)


## Round 1 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| B2: runtime permission check added | ✅ | permission-check.ts 66 行，NODE_ENV=test 跳过检测（便于测试）；audit 中"3 个关键文件缺失"结论有误——功能实际在 @modules/syscall-hook/ 中，非 CLAUDE.md 声明的路径 |

**修正评分**: 5.5 -> 6.0/10
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口 + [[../../military-grade-audit-fixes/requirements]] Tie2/3
