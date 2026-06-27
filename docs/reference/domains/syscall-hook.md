# 系统调用挂钩

域名：`syscall-hook`

系统调用挂钩域，提供系统调用监控和映射能力。

## Profile

- full

## 典型场景

- 系统调用监控
- API 挂钩
- 行为分析

## 常见组合

- syscall-hook + process
- syscall-hook + instrumentation

## 工具清单（9）

| 工具 | 说明 |
| --- | --- |
| `syscall_start_monitor` | 使用 ETW、strace 或 dtrace 启动系统调用监控。 |
| `syscall_stop_monitor` | 停止系统调用监控。 |
| `syscall_capture_events` | 从活跃或上一次监控会话中捕获系统调用事件。 |
| `syscall_correlate_js` | 将捕获的系统调用与可能的 JavaScript 函数关联。 |
| `syscall_filter` | 按系统调用名称过滤已捕获的系统调用事件。 |
| `syscall_get_stats` | 获取系统调用监控统计。 |
| `syscall_ebpf_trace` | 通过 Linux eBPF/bpftrace 追踪系统调用。需要 root 或 CAP_BPF。 |
| `syscall_resolve_ssn` | 待补充中文：Resolve NT syscall service numbers (SSN) from on-disk ntdll.dll. Parses the export table to extract Zw* → SSN mappings and locates a syscall;ret gadget for direct invocation stubs. Win32 only. |
| `syscall_direct_invoke` | 待补充中文：Direct NT syscall invocation guidance. Resolves SSN for a given NT function and returns a stub template with usage instructions for in-process direct syscall invocation. Bypasses user-mode hooks on ntdll.dll. Win32 only. |
