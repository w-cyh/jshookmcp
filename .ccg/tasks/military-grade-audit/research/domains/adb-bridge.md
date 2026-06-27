# ADB-Bridge Domain — Military-Grade Audit

**Score: 8.0/10** | Tools: 12 | Platform: all (requires ADB)

## Tools
- adb_device_list — device enumeration
- adb_shell — shell command execution
- adb_apk_pull / adb_apk_analyze / adb_package_summary — APK operations
- adb_logcat_query — logcat with in-process regex filtering
- adb_app_cold_start_trace — cold-start timing with Looper extraction
- adb_file_pull / adb_file_push — file transfer
- adb_pull_native_libs — native library extraction
- adb_webview_list / adb_webview_attach — WebView CDP bridge

## Key Strengths
1. Cold-start trace with Looper timing extraction
2. WebView CDP bridge (connect Chrome DevTools to Android WebView)
3. In-process logcat regex filtering + PID resolution
4. Native lib extraction with path parsing

## Top Gaps
1. [HIGH] No rooted-device tools (no run-as/su/data/data direct access)
2. [HIGH] No Frida-server deployment or Gadget injection pipeline
3. [LOW] No multi-device parallel operations
