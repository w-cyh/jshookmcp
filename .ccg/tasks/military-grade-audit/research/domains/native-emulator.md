# Native-Emulator Domain — Military-Grade Audit

**Score: 8.5/10** | Tools: 19 | Platform: all (pure TS, zero deps)

## Tools
- nemu_capabilities / nemu_create_session / nemu_destroy_session / nemu_list_sessions — session lifecycle
- nemu_load_library / nemu_inspect_imports / nemu_list_symbols — ELF loading
- nemu_extract_apk_libs / nemu_load_apk_library — APK integration
- nemu_call_symbol / nemu_call_jni_export / nemu_trace / nemu_disassemble — execution
- nemu_setup_java_mock / nemu_setup_java_field — JNI mocking
- nemu_new_byte_array / nemu_read_byte_array — JNI memory
- nemu_alloc_memory / nemu_read_memory / nemu_write_memory — guest memory

## Key Strengths
1. Self-built, license-clean ARM64 interpreter (no GPL unicorn.js)
2. 16-module ISA architecture (integer + NEON SIMD + AES/SHA/PMULL crypto + scalar FP)
3. Session isolation with idle TTL (Map<sessionId, NativeEmulator>, 5min TTL, 64 max)
4. FIPS-validated AES/SHA crypto-extension emulation
5. Import inspector for PLT/GOT diagnostics before emulation

## Top Gaps
1. [HIGH] No x86/x64 emulation (ARM64 only)
2. [HIGH] Long/widening/saturating NEON variants not fully validated
3. [MED] LD2/LD3/LD4 multi-structure load/store unsupported
4. [MED] Bump allocator never reclaims (long-running session risk)
5. [LOW] No multi-threading semantics (LDXR/STXR degraded to single-threaded)
