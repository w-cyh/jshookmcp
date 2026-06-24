# Process Domain — Military-Grade Audit

**Score: 6.0/10** | Tools: 21 | Platform: all

## Tools
- process_find / process_list / process_get — process enumeration
- process_windows — window handle enumeration
- process_check_debug_port / process_kill — process inspection
- process_launch_debug / electron_attach — launch with debugging
- memory_read / memory_write / memory_scan / memory_scan_filtered — memory operations
- memory_batch_write / memory_dump_region / memory_list_regions / memory_check_protection — memory region ops
- memory_audit_export — audit trail export
- inject_dll / inject_shellcode — code injection (Win32)
- check_debug_port / enumerate_modules / module_list — module checks

## Key Strengths
1. Structured diagnostic payloads (permission, process, address, ASLR, recommendedActions)
2. Injection validation framework (4-mode validation + SHA-256 hash + Authenticode)
3. Cross-platform injection + Electron CDP attach

## Top Gaps
1. [HIGH] No thread enumeration/ops (suspend/resume/context)
2. [HIGH] No Process Hollowing detection
3. [HIGH] No handle enumeration
4. [MED] No user-mode APC injection detection
5. [LOW] No process snapshot + diff analysis

## Round 1+3 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| A4: 新增 process_enum_threads 工具 | ✅ | Win32-only 线程枚举工具已添加 (NtQueryInformationThread) |
| C4: 新增 process_detect_hollowing 工具 | ✅ | Win32-only 进程镂空检测 (PEAnalyzer.compareMemoryWithDisk + SHA-256) |

**修正评分**: 6.0 → 6.5 → **7.5/10**
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口（Process Hollowing 检测、handle 枚举、APC 注入检测）+ [[../../military-grade-audit-fixes/requirements]] Tie2/3
