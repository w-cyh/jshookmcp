# Platform Domain — Military-Grade Audit

**Score: 8.0/10** | Tools: 14 | Platform: all

## Tools
- Electron tools: asar_extract / asar_search / electron_inspect_app / electron_scan_userdata
- Electron security: electron_check_fuses / electron_patch_fuses / electron_launch_debug / electron_debug_status / electron_ipc_sniff
- MiniApp tools: miniapp_pkg_scan / miniapp_pkg_unpack / miniapp_pkg_analyze
- V8 bytecode: v8_bytecode_decompile

## Key Strengths
1. ASAR search without extraction (in-archive search)
2. Electron fuse patching with backup
3. Dual-CDP Electron support (auto port allocation)
4. IPC sniffing with action lifecycle
5. Structured MiniApp scan/unpack/analyze pipeline

## Top Gaps
1. [HIGH] No built-in deobfuscation or string decryption for Electron-packed code
2. [MED] electron_patch_fuses modifies binary in-place with no integrity verification
3. [LOW] No Electron context isolation bypass
