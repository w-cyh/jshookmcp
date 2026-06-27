# Binary-Instrument Domain — Military-Grade Audit

**Score: 6.5/10** | Tools: 32 | Platform: all

## Tools
- frida_attach / frida_run_script / frida_detach / frida_list_sessions / frida_dex_dump — Frida instrument
- frida_enumerate_modules / frida_enumerate_functions / frida_find_symbols — symbol discovery
- frida_generate_script / export_hook_script / generate_hooks — hook generation
- ghidra_analyze / ghidra_decompile — Ghidra analysis
- ida_decompile — IDA Pro
- jadx_decompile / jadx_decompile_apk / jadx_search_code — JADX decompilation
- apktool_decode / apk_manifest_dump / apk_manifest_query / apk_static_triage / apk_dex_intake — APK analysis
- dex_scan_file / binary_strings_extract — binary scanning
- unidbg_launch / unidbg_call / unidbg_trace / unidbg_emulate — Unidbg emulation
- android_runtime_dump_session — runtime dump

## Key Strengths
1. JADX integration is best-in-class (smart class resolution, scoring, method extraction)
2. APK static triage is comprehensive (7-section structured response)
3. Frida session management with diagnostics + EventBus

## Top Gaps
1. [CRITICAL] Plugin bridge mandatory dependency (Frida/Ghidra/IDA/JADX all require external plugins)
2. [CRITICAL] IDA Pro only 18-line thin wrapper
3. [HIGH] No anti-debug/anti-emulation detection module
4. [HIGH] Unidbg JNI argument marshaling is string-only
5. [MED] Code duplication between jadx.ts and analysis-handlers.ts
