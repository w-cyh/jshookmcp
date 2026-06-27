# 军工级审计修复 — 实施计划 (Phase A + B)

## Layer 1: 无依赖，可并行

### A1: v8_heap_find_leaks 定义修复
- **文件**: `src/server/domains/v8-inspector/definitions.ts`
- **变更**: v8_heap_find_leaks 定义已存在（行 58-69），确认 manifest registrations 映射
- **验证**: definitions.ts 已有 9 个工具，manifest 已映射全部

**实际发现：A1 已无需修复** — definitions.ts 包含 `v8_heap_find_leaks`（行 58-69），manifest registrations 由 `v8InspectorTools.map()` 自动注册全部 9 个。
审计 Agent 基于旧快照报告"缺失定义"，源码验证发现已修复。

### A2: v8_heap_diff 增强调用 diff()
- **文件**: `src/server/domains/v8-inspector/handlers/impl.ts` (行 233-264)
- **变更**: 增强 `v8_heap_diff` handler，使用 `HeapSnapshotParser.parseNodes()/parseEdges()` 对比节点集合
- **当前**: 只返回 `sizeDeltaBytes: after - before`
- **目标**: 返回 `added`/`removed`/`increased`/`decreased` 节点集
- **验证**: 单元测试 heap diff 返回结构化对比

### A3: JScrambler/Packer/VM Deobfuscator 死代码激活
- **文件**:
  - `src/server/domains/analysis/definitions.ts` — deobfuscate 工具 engine 扩展
  - `src/server/domains/analysis/handlers/deobfuscation.ts` — handleDeobfuscate 路由逻辑
  - `src/server/domains/analysis/handlers.ts` — 注入新 deobfuscator 依赖
  - `src/server/domains/analysis/manifest.ts` — ensure 中创建新实例
- **变更**:
  1. definitions.ts: `engine` enum 扩展为 `['auto', 'webcrack', 'jscrambler', 'packer', 'vm']`
  2. handlers/deobfuscation.ts: 导入 `JScramberDeobfuscator`, `PackerDeobfuscator`, `VMDeobfuscator`
  3. handleDeobfuscate: 根据 engine 路由到对应 deobfuscator
  4. manifest ensure: 创建 JScrambler/Packer/VM 实例，传入 CoreAnalysisHandlers
- **验证**: deobfuscate 工具 engine='jscrambler' 返回 JScrambler 处理结果

### A4: 暴露 EnumerateProcessThreads 为 process 工具
- **文件**:
  - `src/server/domains/process/definitions.ts` — 添加 `process_enum_threads` 工具定义
  - `src/server/domains/process/handlers.base.ts` 或新文件 — handler 实现
  - `src/server/domains/process/manifest.ts` — 注册新工具
- **变更**: 添加 `process_enum_threads` 工具，调用 `Win32Debug.EnumerateProcessThreads(pid)`
- **Win32-only**: 和 inject_dll 一样，非 Win32 平台过滤
- **验证**: 工具调用返回线程 ID 列表

### A5: HeapAnalyzer double-free 检测实现
- **文件**: `src/native/HeapAnalyzer.ts`
- **变更**: 实现 `possible_double_free` 检测逻辑（类型已声明但函数体为空）
  - 扫描 free block 列表，检测同一地址出现多次 free
  - 或检测 free block 中仍有活跃引用的情况
- **验证**: 异常报告可返回 `possible_double_free` 类型

### B1: debugger logpoints (logMessage)
- **文件**:
  - `src/server/domains/debugger/definitions.tools.core.ts` — breakpoint 工具添加 `logMessage` 参数
  - `src/server/domains/debugger/handlers/breakpoint-basic.ts` — 传递 logMessage 到 CDP
  - `src/modules/debugger/DebuggerManager.impl.core.breakpoints.ts` — BreakpointInfo 添加 logMessage，CDP 调用传递
  - `src/modules/debugger/DebuggerManager.impl.core.class.ts` — BreakpointInfo interface
  - `src/modules/debugger/DebuggerSessionManager.ts` — 序列化/反序列化 logMessage
- **变更**: 添加 logMessage 参数，完整走通 CDP → handler → 调用链
- **验证**: breakpoint type=code action=set logMessage="x={x}" 不暂停只打印

### B2: syscall-hook 权限运行时检查
- **文件**:
  - `src/server/domains/syscall-hook/handlers.impl.ts` — 启动监控前检查权限
  - 新增 `src/server/domains/syscall-hook/permission-check.ts` — 通用权限检查函数
- **变更**:
  1. Linux: `process.geteuid?.() === 0` || `/proc/sys/kernel/yama/ptrace_scope` 读 0
  2. Win32: 尝试 `logman query providers` 探测 ETW 权限
  3. macOS: `getuid() === 0`
  4. 失败时返回 `{ success: false, error: '...', requiredCapabilities: [...] }`
- **验证**: 非 root 用户调用 syscall_start_monitor 收到明确权限错误

### B4: 修正 syscall-hook CLAUDE.md
- **文件**: `src/server/domains/syscall-hook/CLAUDE.md`
- **变更**: 更新工具名称、移除 handlers/ 子目录描述、补充实际架构说明

## Layer 2: 依赖 Layer 1 或需要更多探索

### B3: Angular 状态提取
- **文件**:
  - `src/server/domains/browser/handlers/framework-state.ts` — 添加 extractAngular()
  - 需深入读该文件理解 React/Vue 提取器模式
- **变更**: 添加 `hasAngularMarker` + `extractAngular()` + 注册到 auto-detection flow
- **验证**: 检测 __ngContext__ / ng-reflect-* / window.ng 并提取组件树

### B5: IDA Pro CLI 封装升级
- **文件**:
  - `src/server/domains/binary-instrument/handlers/ida.ts` — 从 18 行升级到 CLI 封装
  - 新增 `src/modules/binary-instrument/IdaProRunner.ts` — idat64 CLI 子进程管理
- **变更**: 探测 idat64/idat64.exe CLI，支持 headless 分析 + IDAPython 脚本生成
- **回退**: 无 CLI 时返回 plugin bridge（保持向后兼容）

### B6: v8 TurboFan IR 查询
- **文件**:
  - `src/server/domains/v8-inspector/handlers/impl.ts` — 新增 v8_turbofan_inspect 工具路由
  - 新增 `src/server/domains/v8-inspector/handlers/turbofan-inspect.ts`
  - `src/server/domains/v8-inspector/definitions.ts` — 工具定义
- **变更**: 利用 Chrome `--trace-opt` / `--trace-deopt` 启动参数，通过 CDP Runtime.evaluate 读取 V8 flags 启用情况
- **风险评估**: 可能受 Chrome 版本限制，需 graceful fallback

---

## 文件归属矩阵（互不重叠）

| Builder | 文件范围 | Layer |
|---------|---------|-------|
| **dev-v8** | `src/server/domains/v8-inspector/*`, `src/modules/v8-inspector/HeapSnapshotParser.ts` | L1 |
| **dev-analysis** | `src/server/domains/analysis/handlers/deobfuscation.ts`, `src/server/domains/analysis/handlers.ts`, `src/server/domains/analysis/definitions.ts`, `src/server/domains/analysis/manifest.ts` | L1 |
| **dev-process** | `src/server/domains/process/definitions.ts`, `src/server/domains/process/manifest.ts`, `src/server/domains/process/handlers.*` | L1 |
| **dev-heap** | `src/native/HeapAnalyzer.ts` | L1 |
| **dev-debugger** | `src/server/domains/debugger/definitions.tools.core.ts`, `src/server/domains/debugger/handlers/*`, `src/modules/debugger/*` | L1 |
| **dev-syscall** | `src/server/domains/syscall-hook/handlers.impl.ts`, `src/server/domains/syscall-hook/CLAUDE.md`, 新 `permission-check.ts` | L1 |
| **dev-browser-ng** | `src/server/domains/browser/handlers/framework-state.ts` | L2 |
| **dev-ida** | `src/server/domains/binary-instrument/handlers/ida.ts`, 新 `IdaProRunner.ts` | L2 |

---

## 测试策略

- 每个 Phase A 项需新增或修订对应测试
- `metadata:check` 维持 451 工具数（A1 不变 + A4 +1 = 452，需确认）
- 失败测试 = 不合并

## 风险及缓解

| 风险 | 缓解 |
|------|------|
| HeapSnapshotParser.diff() 可能实现不完整 | 先读 diff 方法确认可调用，否则仅做节点集对比 |
| Angular 提取依赖 Angular DevTools 协议，可能不稳定 | 多路径探测 + graceful fallback |
| IDA Pro CLI 路径不确定 | 自动探测 idat64 / idat / idat64.exe 多路径 |
| TurboFan IR 需要 Chrome 特殊启动参数 | 仅作为可选工具，返回需重启浏览器提示 |
