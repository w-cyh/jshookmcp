# 审查后续行动建议

## P0 — 立即修复（影响安全/可用性）

| # | 行动 | 文件/位置 | 预期影响 |
|---|------|-----------|----------|
| 1 | 移除 page_evaluate Camoufox 路径的 new Function()，改用 pageController.evaluate 或 AST 白名单 | `src/server/domains/browser/handlers/page-evaluation.ts:98` | 消除任意代码执行风险 |
| 2 | 隔离 browser_jsdom_execute 到 Worker/QuickJS 沙箱 | `src/server/domains/browser/handlers/jsdom-tools.ts:261` | 消除 JSDOM eval 风险 |
| 3 | 校验 electron_attach 的 evaluateExpr | `src/server/domains/process/handlers/injection-handlers.ts:441` | 消除 Electron renderer 注入风险 |
| 4 | 为原生注入增加权限限制/目标白名单/审计日志 | `src/native/NativeMemoryManager.impl.ts`, `src/native/Win32API.ts` | 强化权限边界 |
| 5 | 补全 process_find/get/kill/list 的 manifest 注册 | `src/server/domains/process/manifest.ts` | 恢复 4 个核心工具 |
| 6 | 修复 memory 跨平台 handler 的非空断言 TypeError | `src/server/domains/memory/handlers/` | 提升跨平台健壮性 |
| 7 | 修复 HAR 导出 HTTP 版本硬编码 | `src/server/domains/network/har.ts` | 提升 HAR 准确性 |
| 8 | 为 network_replay_request 增加 HTTP/2 支持 | `src/server/domains/network/replay.ts` | 提升现代 API 重放保真度 |
| 9 | 为 native-emulator 添加显式 dispose() | `src/modules/native-emulator/SessionManager.ts:115-117` | 防止内存泄漏 |
| 10 | 限制 CodeAnalyzer 输入大小并添加 try/catch | `src/modules/analyzer/CodeAnalyzer.ts`, `QualityAnalyzer.ts` | 防止解析 OOM |

## P1 — 短期增强（1-2 周）

- 增加 HTTP/3/QUIC 探测工具
- 增加 gRPC 请求构造器/反射客户端
- 增强 parseArgs（argUrl/argRegex/argPath）
- 为 debugger_evaluate 和 breakpoint condition 增加长度/危险模式校验
- 为 proxy URL pattern 增加 ReDoS 保护
- 为 captcha solver 增加代理/退避/熔断

## P2 — 中期能力（1-2 月）

- ARM32/Thumb 仿真支持
- V8 堆快照真实解析器（dominator tree/class histogram/retention path）
- 浏览器视频录制、PDF 生成、权限管理、多指触控
- 扩展沙箱隔离与权限分级

## P3 — 长期愿景

- 可视化 workflow 编辑器
- OpenTelemetry / Prometheus 可观测性
- 分布式多机协调
- 更深层协议解剖器集成（Wireshark/tshark）

## 质量门禁

每次修复后应运行：

```bash
pnpm test
pnpm typecheck
pnpm metadata:check
```

确保工具总数（当前 465）不意外下降，且新增注册不会破坏 profile 过滤。
