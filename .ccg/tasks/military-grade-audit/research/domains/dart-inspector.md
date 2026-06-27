# Dart-Inspector Domain — Military-Grade Audit

**Score: 9.0/10** | Tools: 12 | Platform: all

## Tools
- dart_strings_extract — streaming ASCII/UTF-16LE with ReDoS guard
- dart_smi_scan — aligned word scanning for Smi recovery
- dart_symbolize — obfuscation map resolution
- flutter_packages_detect — package detection
- dart_snapshot_header_parse / dart_version_fingerprint / dart_object_pool_dump — snapshot analysis
- dart_load_snapshot / dart_list_functions / dart_call_function / dart_inspect_object_pool / dart_trace_execution — execution + tracing

## Key Strengths
1. ARM64 emulator for actual function execution (DartAotExecutor)
2. Dual ReDoS guard (compile-time heuristic + runtime timeout) — production-grade
3. Streaming string extraction with classification + custom regex rules
4. scanWindow/scanStride for surgical binary analysis

## Top Gaps
1. [HIGH] dart_call_function/dart_trace_execution use simplified runtime with mock built-ins
2. [MED] No snapshot modification/recompilation (read-only)
3. [LOW] Cannot faithfully execute real Flutter framework functions
