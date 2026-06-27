# Memory Domain — Military-Grade Audit

**Score: 9.0/10** | Tools: 33 (42 Win32, 27 macOS/Linux) | Platform: Win32/macOS/Linux

## Tools
- memory_first_scan / memory_next_scan / memory_unknown_scan — value scanning
- memory_pointer_scan / memory_pointer_chain — pointer chain resolution
- memory_structure_analyze / memory_vtable_parse / memory_structure_export_c / memory_structure_compare — structure analysis
- memory_patch_bytes / memory_patch_nop / memory_patch_undo / memory_code_caves — code patching
- memory_write_value / memory_freeze / memory_dump / memory_write_history — memory control
- memory_heap_enumerate / memory_heap_stats / memory_heap_anomalies — heap analysis (Win32)
- memory_pe_headers / memory_pe_imports_exports / memory_inline_hook_detect — PE introspection (Win32)
- memory_anticheat_detect / memory_guard_pages / memory_integrity_check — anti-cheat/integrity
- memory_breakpoint — hardware breakpoints (Win32)
- memory_speedhack — time manipulation (Win32)
- memory_region_enumerate — cross-platform region enumeration (PlatformMemoryAPI: VirtualQuery/procfs/vm_region)
- memory_aob_scan — AOB signature scanning with ?? wildcards
- memory_find_accesses — find code accessing address with auto-rearm hardware breakpoints

## Key Strengths
1. 8 inline hook patterns matching pe-sieve PatchAnalyzer (9 patterns with INT3)
2. Heap entropy analysis matching Volatility3 malfind heuristic
3. Address formula parser inspired by ReClass.NET
4. Two-layer speedhack trampoline with lazy base init
5. Audit trail injected into all 7 handler sub-modules
6. Cross-platform region enumeration (PlatformMemoryAPI: VirtualQuery/procfs/vm_region)
7. AOB signature scanning with ?? wildcard bytes
8. Find-accesses with auto-rearm hardware breakpoints (DR0-DR3)

## Top Gaps
1. [HIGH] No memory forensics dump file (.dmp/.vmem) analysis
2. [MED] No fuzzy/approximate value scanning
3. [MED] No persistent pointer chain cache
4. [MED] Pointer chain max offset 64KB may miss deep chains
5. [LOW] Speedhack range capped at 100x vs CE's 1000x

## Round 1 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| A5: HeapAnalyzer 实现 double-free 检测 | ✅ | 在堆异常检测模块中新增 Use-After-Free / Double-Free 模式匹配 |

**修正评分**: 8.5 → 8.6/10
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口（.dmp/.vmem 取证分析、fuzzy 扫描、pointer chain 缓存）+ [[../../military-grade-audit-fixes/requirements]] Tie2/3

## Gap Scan 完成 (2026-06-27)

| 新增工具 | 变更 |
|----------|------|
| memory_region_enumerate | 跨平台区域枚举 (PlatformMemoryAPI: VirtualQuery/procfs/vm_region) |
| memory_aob_scan | AOB 签名扫描, ?? 通配符 |
| memory_find_accesses | 硬件断点查找访问地址的代码 (DR0-DR3, auto-rearm) |

**修正评分**: 8.6 → **9.0** (+0.4, +3 tools, +39 tests)
**Round 3 关联**: [[../../handoff#Gap Scan 完成]] exploit-dev +3 tools +23 tests
