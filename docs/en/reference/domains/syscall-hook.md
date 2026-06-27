# Syscall Hook

Domain: `syscall-hook`

System call hooking domain providing system call monitoring and mapping capabilities.

## Profiles

- full

## Typical scenarios

- System call monitoring
- API hooking
- Behavioral analysis

## Common combinations

- syscall-hook + process
- syscall-hook + instrumentation

## Full tool list (9)

| Tool | Description |
| --- | --- |
| `syscall_start_monitor` | Start syscall monitoring. |
| `syscall_stop_monitor` | Stop syscall interception and release all captured events. |
| `syscall_capture_events` | Capture syscall events from the active or last monitoring session. |
| `syscall_correlate_js` | Correlate captured syscalls with likely JavaScript functions. |
| `syscall_filter` | Filter captured syscall events by name, PID, or return value. |
| `syscall_get_stats` | Get syscall monitoring statistics. |
| `syscall_ebpf_trace` | Trace syscalls on Linux with eBPF. Requires root or CAP_BPF. |
| `syscall_resolve_ssn` | Resolve NT syscall service numbers (SSN) from on-disk ntdll.dll. Parses the export table to extract Zw* → SSN mappings and locates a syscall;ret gadget for direct invocation stubs. Win32 only. |
| `syscall_direct_invoke` | Direct NT syscall invocation guidance. Resolves SSN for a given NT function and returns a stub template with usage instructions for in-process direct syscall invocation. Bypasses user-mode hooks on ntdll.dll. Win32 only. |
