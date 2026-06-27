# jshookmcp 全域工具工业级水准审查报告

**审查日期**: 2026-06-16  
**审查范围**: 31 个域，465 个工具  
**审查方法**: 代码静态分析 + 行业顶尖工具/论文/论坛对标  
**报告位置**: `.ccg/tasks/audit-tool-industrial-quality/reports/`

---

## 一、执行摘要

**总体评分: 73/100 — 达到工业级水准**

jshookmcp 是一个功能极其丰富的 MCP 服务器，在浏览器自动化、JavaScript 逆向工程、原生仿真、内存分析、网络分析等领域均达到了工业级水准。项目最大的差异化优势在于**自研 ARM64 解释器**（native-emulator），该实现零外部依赖，在 AES/SHA/PMULL 加密扩展和 NEON SIMD 上做到了 bit-exact 对齐，这在同类开源/商业工具中都属于顶尖水平。

然而，项目仍存在若干 Critical 级别的安全缺陷和功能缺口，主要集中在：
- 动态代码执行点的输入验证不足
- 部分工具 manifest 注册缺失
- 现代协议（HTTP/3/QUIC/gRPC）支持不足
- V8 堆分析深度不够

---

## 二、域组评分

| 域组 | 域 | 工具数 | 评分 | 结论 |
|------|-----|--------|------|------|
| **Browser Automation** | browser, canvas, debugger, v8-inspector, instrumentation, coordination | 114 | **76** | 工业级 |
| **Reverse Engineering** | analysis, binary-instrument, native-emulator, wasm, dart-inspector, platform | 139 | **77** | 工业级，ARM64 解释器领先 |
| **Network & Security** | network, proxy, protocol-analysis, streaming, boringssl-inspector, graphql | 86 | **71** | 工业级，缺 HTTP/3/gRPC |
| **System & Native** | process, memory, adb-bridge, native-bridge, syscall-hook, trace | 90 | **72** | 工业级，memory 接近 Cheat Engine |
| **Infrastructure & Utilities** | maintenance, workflow, encoding, sourcemap, transform, extension-registry, mojo-ipc, cross-domain | 61 | **70** | 良好/准工业级 |
| **Security & Input Validation** | 跨域 | 465 | **66** | 准工业级，需修复关键风险 |

**综合评分: 73/100**

---

## 三、全球领先的差异化能力

1. **自研 ARM64 解释器**（native-emulator）
   - 零外部依赖，进程内仿真 Android `.so`
   - AES/SHA/PMULL crypto-ext bit-exact 对齐 FIPS-197/180-4/180-1
   - NEON SIMD + 标量 FP IEEE-754 对齐
   - JNI 模拟与 Java mock，支持 native 签名/加密算法还原

2. **浏览器反检测与人类行为模拟**
   - Camoufox 集成 + 指纹生成 + CDP jitter
   - 验证码检测/等待/外部求解/widget hook 全链路
   - 三次贝塞尔曲线鼠标轨迹、类人滚动、带错别字的打字

3. **MCP 深度集成**
   - 465 个工具统一 schema
   - workflow 编排、证据图、跨域协调
   - 大响应 offload、LLM 上下文感知过滤

4. **内存分析**
   - 扫描、指针链、结构体推断、硬件断点、speedhack
   - 接近 Cheat Engine 的核心能力

---

## 四、Critical 缺陷（必须修复）

| ID | 域 | 工具 | 问题 | 修复建议 |
|----|-----|------|------|----------|
| CRIT-01 | browser | page_evaluate | Camoufox 路径使用 `new Function()` 直接执行用户代码 | 改用安全评估路径或 AST 白名单 |
| CRIT-02 | browser | browser_jsdom_execute | 使用 `window.eval()` 执行用户代码 | 隔离到 Worker/QuickJS 沙箱 |
| CRIT-03 | process | electron_attach | evaluateExpr 通过 `new Function()` 在 Electron renderer 执行 | AST 白名单校验 |
| CRIT-04 | native | OpenProcess/injectDll/injectShellcode | 原生注入仅受常量门控，无目标验证 | 增加权限限制、目标白名单、审计日志 |
| CRIT-05 | v8-inspector | v8_heap_snapshot_analyze | 仅返回 size 级指标，无 dominator tree | 集成 Chrome DevTools 堆快照解析器 |
| CRIT-06 | native-emulator | nemu_destroy_session | 未显式释放 NativeEmulator 资源 | 添加 dispose() 调用 |
| CRIT-07 | process | process_find/get/kill/list | 实现存在但 manifest 未注册 | 补全 manifest 注册 |
| CRIT-08 | network | network_export_har | 硬编码 HTTP/1.1 | 从 CDP 事件读取真实协议版本 |
| CRIT-09 | network | network_replay_request | 无 HTTP/2 多路复用支持 | 使用 Node http2 模块 |
| CRIT-10 | memory | breakpoint/integrity handlers | macOS/Linux 路径非空断言可能导致 TypeError | 提供 stub 实现或提前返回 |

---

## 五、主要行业差距

| 能力 | 行业标杆 | 当前状态 | 差距 |
|------|---------|---------|------|
| HTTP/3 & QUIC | curl --http3, nghttp3 | 无原生探测 | 高 |
| gRPC | grpcurl, BloomRPC | 无请求构造器/反射 | 高 |
| 多架构仿真 | Unicorn Engine, QEMU | 仅 ARM64 | 高 |
| V8 堆分析 | Chrome DevTools Memory | 仅 size 级指标 | 高 |
| 视频/PDF/多指触控 | Playwright | 缺失 | 中 |
| 扩展沙箱 | VS Code extension host | 主进程运行 | 中 |
| 可视化 workflow | n8n, Node-RED | 缺失 | 低 |

---

## 六、建议优先级

### P0（立即修复）
1. 修复所有 Critical 安全缺陷（new Function/eval/注入）
2. 补全 process manifest 注册
3. 修复 memory 跨平台 TypeError 风险
4. 修复 HAR HTTP 版本硬编码

### P1（短期）
1. 增加 HTTP/3 探测工具
2. 增加 gRPC 请求构造器/反射客户端
3. 为 native-emulator 添加显式资源释放
4. 增强 parseArgs 语义校验（URL/regex/path）

### P2（中期）
1. ARM32/Thumb 仿真支持
2. V8 堆快照真实解析器
3. 浏览器视频录制/PDF/权限管理
4. 扩展沙箱隔离

### P3（长期）
1. 可视化 workflow 编辑器
2. OpenTelemetry 兼容
3. Prometheus metrics 导出
4. 分布式多机协调

---

## 七、结论

jshookmcp 是一个**工程成熟度很高、功能覆盖面极广**的项目，在多个垂直领域已经具备工业级甚至全球领先的竞争力。项目当前的 465 个工具覆盖了从浏览器自动化到原生仿真的完整逆向工程链路，MCP 集成深度也是业界少有。

如果优先修复 10 个 Critical 缺陷，并补足 HTTP/3/gRPC、多架构仿真、V8 堆分析深度等关键能力，整体评分可以从 73 提升至 **78-80**，真正达到顶尖工业工具水准。

---

## 八、附录：报告文件

- `browser-automation-audit.json` — 浏览器自动化域组
- `reverse-engineering-audit.json` — 逆向工程域组
- `network-security-audit.json` — 网络与安全域组
- `system-native-audit.json` — 系统原生域组
- `infra-utility-audit.json` — 基础设施与工具域组
- `SECURITY-INPUT-VALIDATION-audit.json` — 安全与输入验证
- `summary-audit.json` — 综合汇总
- `README.md` — 报告索引
