# MCP 架构深度改进计划

> 基于 `interview_preparation.md` 8,284 行面试文档，逐项对照 jshookmcp 源码分析
> 聚焦：MCP 协议能力、MCP 安全模型、MCP 工具发现、MCP 可观测性
> 约束：**项目不含任何攻击 payload**，所有安全功能仅用于防御分析

---

## 零、Payload 安全审计结果

### 审计结论

对 `src/` 全目录进行 payload/exploit/shellcode 关键词扫描：

- `payload` 出现 843 次 / 150 文件 — **全部为合法用法**：
  - 协议分析域（network packet payload、TLS record payload）
  - MCP 响应结构体（`structuredContent` 内的 payload 字段）
  - 事件总线（event payload）
  - 数据总线（WorkflowDataBus payload）
- `exploit|rce|remote.?code` 出现在 250 文件 — **全部为防御性用途**：
  - `SecurityCodeAnalyzer.ts`：检测 `eval()` 危险调用并给出修复建议
  - `ObfuscationDetector.ts`：检测混淆模式（如 `eval(function(p,a,c,k)`)）
  - `ExecutionSandbox.ts`：沙箱内安全执行
  - `Deobfuscator` 系列：反混淆，不生成攻击代码
- `shellcode|backdoor|reverse.?shell`：**零匹配**
- `new Function` / `eval()` 调用点：全部位于分析器（检测目标代码中的危险模式）或 QuickJS 沙箱内

**结论：项目无攻击 payload，所有安全功能均为防御/分析性质。**

### 需要注意的边界情况

| 文件 | 代码 | 风险评估 |
|------|------|---------|
| `native/CodeInjector.ts` | 进程代码注入 | 用于内存分析/反作弊检测，需确保不暴露给未授权调用者 |
| `native/Speedhack.ts` | 时间函数 hook | 用于测试/分析，需工具级权限控制 |
| `modules/process/memory/injector.ts` | 进程内存注入 | 用于调试/分析，同上 |
| `modules/external/ExternalToolRunner.ts` | 外部工具执行 | 需严格白名单 |
| `modules/binary-instrument/FridaSession.ts` | Frida 动态插桩 | 需权限确认 |

**建议**：上述高风险工具应标记 `requiresConfirmation: true`（详见 Phase 3）。

---

## 一、MCP 协议能力补全（面试 Q9-Q10, Q7）

### 现状 vs 应有

| MCP 能力 | 当前实现 | 面试要求 | 差距 |
|----------|---------|---------|------|
| **Tools** | 470+ 工具，36 域 | 完整 | ✓ 已满足 |
| **Resources** | 4 个（evidence graph × 2, instrumentation × 2） | 动态发现、多类型 | **严重不足** |
| **Prompts** | 3 个（reverse_engineering_assistant, analyze_anti_debug, hook_generation_guide） | 领域专用 prompt 模板 | **不足** |
| **Logging** | 自定义 logger（chalk） | MCP 标准日志协议 | **未实现** |
| **Sampling** | 无 | MCP 协议原生的 LLM 请求能力 | **未实现** |
| **Notifications** | `tools/list_changed` 事件触发 | 工具列表变更通知 | 已有基础 |
| **Completion** | 无 | 参数自动补全 | **未实现** |

### 1.1 MCP Resources 扩展

**当前文件**：`src/server/MCPServer.resources.ts`（130 行，4 个资源）

**应增加的资源**：

```
jshook://search/stats           → 搜索引擎统计（查询次数、命中率、热门工具）
jshook://search/index-status    → Embedding 索引状态（已索引工具数、向量维度、最后更新时间）
jshook://activation/state       → 当前激活域列表 + TTL 状态 + 自动修剪预测
jshook://token-budget/stats     → TokenBudgetManager 快照（当前用量、工具分布、建议）
jshook://cache/stats            → UnifiedCacheManager 全局统计
jshook://browser/tabs           → 当前打开的浏览器标签页列表
jshook://network/interceptions  → 当前活跃的网络拦截规则
jshook://workflows/running      → 正在运行的工作流列表
jshook://eval/metrics           → Agent 评估指标（Phase 4 新增）
```

**实现步骤**：
1. 每个域的 manifest 中声明 `resources?: ResourceRegistration[]`
2. `discovery.ts` 中自动收集域级资源注册
3. `MCPServer.resources.ts` 中批量注册
4. 使用 `ResourceTemplate` 实现动态资源列表（参考已有的 `sessionTemplate`）

**预估工作量**：1.5 天

### 1.2 MCP Prompts 扩展

**当前文件**：`src/server/MCPServer.prompts.ts`（~80 行，3 个 prompt）

**应增加的 prompt 模板**：

| Prompt 名称 | 用途 | 对应面试话题 |
|------------|------|------------|
| `workflow_planner` | 将自然语言任务分解为 MCP 工具调用链 | Q12 Planner-Executor |
| `code_analysis_runbook` | JS 代码安全审计流程 | Q19 安全 |
| `network_analysis_runbook` | 网络流量分析与拦截流程 | Q7 Function Calling |
| `deobfuscation_runbook` | 反混淆策略选择与执行流程 | Q5 Agent |
| `agent_eval_report` | 生成 Agent 效果评估报告 | Q23 评估 |

**Prompt 应支持参数化**（MCP 协议原生支持 prompt arguments）：

```typescript
ctx.server.prompt(
  'deobfuscation_runbook',
  'Step-by-step deobfuscation strategy for obfuscated JavaScript.',
  { target_url: z.string().optional(), obfuscation_type: z.enum(['jsvmp', 'obfuscator.io', 'custom']).optional() },
  (args) => ({
    messages: [
      { role: 'user', content: { type: 'text', text: `分析 ${args.target_url ?? '目标页面'} 的混淆代码...` } },
      // ...
    ],
  }),
);
```

**预估工作量**：1 天

### 1.3 MCP Logging 协议

**面试关联**：Q30 可观测性

**当前**：自定义 `logger.ts`（chalk 彩色日志到 stderr）

**应实现**：MCP 标准日志协议（`notifications/message`），让 Host 能接收结构化日志

```
Server → Client: {
  "method": "notifications/message",
  "params": {
    "level": "info",
    "logger": "jshook.search",
    "data": { "query": "hook fetch", "results": 5, "latency_ms": 23 }
  }
}
```

**实现步骤**：
1. 在 `logger.ts` 中增加 MCP transport 层（当 server 连接时启用）
2. 支持日志级别过滤（debug/info/warning/error）
3. 结构化日志数据（JSON 而非纯文本）

**预估工作量**：0.5 天

### 1.4 MCP Completion（参数自动补全）

**面试关联**：Q7 Function Calling 最佳实践

**实现**：为高频工具的枚举参数提供补全建议

```typescript
// 工具定义中声明 completion
{
  name: "network_intercept",
  inputSchema: {
    properties: {
      action: { type: "string", enum: ["continue", "abort", "fulfill"] }
    }
  }
}

// MCP completion handler
server.completion("network_intercept/action", (query) => {
  return ["continue", "abort", "fulfill"].filter(a => a.startsWith(query));
});
```

**预估工作量**：0.5 天

---

## 二、MCP 安全模型深化（面试 Q19-Q20, Q5-Q8）

### 现状 vs 应有

| 安全维度 | 当前实现 | 面试要求（A2SPA） | 差距 |
|----------|---------|------------------|------|
| **传输层** | HTTP Bearer Token + Origin 校验 | ✓ | 已满足 |
| **速率限制** | IP 级 sliding window 60/min | ✓ | 已满足 |
| **工具级权限** | 无分层，所有工具平等对待 | 工具级 RBAC/ABAC | **缺失** |
| **执行确认** | 无（高危工具直接执行） | Human-in-the-Loop | **缺失** |
| **Prompt 注入检测** | 无 | 输入隔离 + 输出校验 | **缺失** |
| **Payload 完整性** | 无（A2SPA） | 执行前 hash 验证 | **缺失** |

### 2.1 工具权限分层

**目标**：实现面试文档 Q8 描述的 `ToolPermission` 模式

**定义三级权限**：

```typescript
type ToolPermissionTier = 'auto' | 'confirm' | 'approval';

interface ToolPermissionConfig {
  tier: ToolPermissionTier;
  maxCallsPerSession?: number;
  allowedInSandboxOnly?: boolean;
  auditLog?: boolean;
}
```

**工具分级**：

| Tier | 工具示例 | 理由 |
|------|---------|------|
| `auto` | `search_tools`, `page_screenshot`, `network_capture` | 只读、低风险 |
| `confirm` | `page_evaluate`, `hook_install`, `network_intercept` | 修改页面状态 |
| `approval` | `memory_write`, `process_inject`, `code_inject`, `speedhack_enable` | 高危操作 |

**实现位置**：
- 新增 `src/server/security/ToolPermissionManager.ts`
- 在 `DomainManifest` 的 `ToolRegistration` 中增加 `permission?: ToolPermissionConfig`
- `ToolCallContextGuard.ts` 在执行前检查权限
- 通过 MCP `tool` 定义的 `annotations` 字段暴露权限信息给 Host

**预估工作量**：2 天

### 2.2 Prompt 注入检测

**目标**：实现面试文档 Q19 的输入隔离 + 输出校验

**检测策略**：

```typescript
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?)/i,
  /system\s*:\s*/i,
  /you\s+are\s+now\s+/i,
  /forget\s+(everything|all|your)\s+/i,
  /<\|im_start\|>/,
  /\[INST\]/,
  /```system\n/,
];
```

**实现位置**：
- 在 `ToolCallContextGuard.ts` 中增加 `detectInjection(args)` 方法
- 对 `code`/`script`/`expression` 类型的工具参数进行检测
- 检测到时在响应中附加 `_securityWarning` 标记（不阻断，让 Host 决定）
- 同时对工具返回结果进行 sanitize（防止间接注入）

**预估工作量**：1 天

### 2.3 A2SPA 执行时鉴权（可选，长期）

**面试文档 Q6 的 A2SPA 模式**：执行前验证 Payload 完整性

**简化实现**：
- 对 `approval` 级工具，记录调用意图的 hash
- 执行时校验 args hash 与意图一致（防止中间篡改）
- 目前 MCP 协议无原生支持，需在 Host 侧配合

**预估工作量**：1.5 天（可与 2.1 合并）

---

## 三、MCP 工具发现优化（面试 Q7, Q11-Q13, Q21, Q23）

### 现状 vs 应有

| 发现能力 | 当前实现 | 面试最佳实践 | 差距 |
|----------|---------|------------|------|
| **搜索管线** | 9 级（Normalize→Synonym→BM25+Trigram+Embedding→RRF→Intent→Affinity→Tier→Recency） | ✓ 业界领先 | **优秀** |
| **Re-ranker** | 无 | Cross-Encoder 精排 | **缺失** |
| **工具描述质量** | 描述偏重"做什么" | "何时用" > "做什么" + input_examples | **不足** |
| **Self-RAG** | 每次都走全管线 | 简单查询跳过重型步骤 | **可优化** |
| **搜索评估** | 无 | Recall@K, MRR, NDCG | **缺失** |
| **Circuit Breaker** | 无 | 熔断器防止级联失败 | **缺失** |
| **工具参数 ≤ 8** | 未审计 | 超过 8 参数准确率骤降 | **待审计** |

### 3.1 Re-ranker 层

**目标**：在 RRF 融合后增加 Cross-Encoder 精排

**架构**：

```
现有管线输出 top-20 → Re-ranker(top-20 → top-5) → 返回给 Agent
```

**实现方案**：

**方案 A：轻量级本地 Re-ranker（推荐）**
- 使用 `@xenova/transformers` 加载 `cross-encoder/ms-marco-MiniLM-L-6-v2`（~80MB）
- 在 `EmbeddingWorker.ts` 的 Worker 线程中运行（避免阻塞主线程）
- 只对 top-20 结果精排，延迟增加 ~50-100ms
- 首次加载模型较慢（~3s），之后缓存

**方案 B：基于规则的 Re-ranker（快速实现）**
- 利用 `IntentBoost` 已有的正则模式作为特征
- 增加工具描述与查询的 n-gram 重叠度作为特征
- 加权打分精排
- 无额外依赖，延迟 ~5ms

**推荐**：先实现方案 B 作为 baseline，后续替换为方案 A

**实现文件**：
- 新增 `src/server/search/ReRanker.ts`
- 修改 `ToolSearchEngineImpl.ts` 在 `search()` 方法末尾调用

**预估工作量**：1 天（方案 B）/ 2 天（方案 A）

### 3.2 工具描述质量审计

**面试关联**：Q23 "如何写好 Tool 的描述"、Q7 工具 Schema 设计最佳实践

**审计维度**：

```
1. description 写"何时用"而非"做什么"
   ❌ "Search tools using BM25 or vector similarity"
   ✓ "Use when you need to find specific MCP tools by name, capability, or use case"

2. 参数说明完整性
   每个参数的 description 是否包含：类型约束 + 使用示例 + 边界值

3. input_examples（Anthropic 原生支持）
   为高频工具添加示例输入

4. 参数数量审计
   统计参数 > 8 的工具，考虑合并或使用 object 参数分组

5. 嵌套层级审计
   检查超过 3 层嵌套的 inputSchema
```

**实施步骤**：
1. 写一个审计脚本扫描所有 `definitions.tools.*.ts`
2. 生成审计报告（每个工具的参数数量、描述长度、是否有 input_examples）
3. 按优先级修复（先修复 search/workflow tier 的工具）
4. 为 top-20 高频工具添加 `input_examples`

**预估工作量**：2-3 天

### 3.3 Self-RAG 快速路径

**面试关联**：Q28 Self-RAG

**目标**：简单查询跳过 Embedding 计算

**判断逻辑**：

```typescript
function isSimpleQuery(normalized: string): boolean {
  // 精确工具名查询（如 "page_navigate"）
  if (/^[a-z_]+$/.test(normalized) && toolNameIndex.has(normalized)) return true;
  // 单词查询（如 "hook"）
  if (normalized.split(' ').length === 1) return true;
  // 带域前缀的查询（如 "browser navigate"）
  if (domainPrefixes.some(p => normalized.startsWith(p))) return true;
  return false;
}
```

**简单查询路径**：BM25 + Trigram → 返回（跳过 Embedding + Synonym + RRF）

**实现位置**：`ToolSearchEngineImpl.ts` 的 `search()` 方法入口

**预估工作量**：0.5 天

### 3.4 Circuit Breaker

**面试关联**：Q22 超时和重试、Q18 并发熔断

**目标**：对高失败率的工具自动熔断，防止 Agent 陷入重试死循环

**实现**：

```typescript
class ToolCircuitBreaker {
  private failures = new Map<string, { count: number; lastFailure: number }>();
  private readonly THRESHOLD = 3;       // 连续失败 3 次触发
  private readonly RECOVERY_MS = 30_000; // 30s 后尝试恢复

  isBreakerOpen(toolName: string): boolean {
    const state = this.failures.get(toolName);
    if (!state || state.count < this.THRESHOLD) return false;
    return Date.now() - state.lastFailure < this.RECOVERY_MS;
  }

  recordSuccess(toolName: string): void {
    this.failures.delete(toolName);
  }

  recordFailure(toolName: string): void {
    const state = this.failures.get(toolName) ?? { count: 0, lastFailure: 0 };
    state.count++;
    state.lastFailure = Date.now();
    this.failures.set(toolName, state);
  }
}
```

**集成位置**：
- `MCPServer.ts` 的工具调用链（`callToolHandler` 方法，约 612 行）
- 在 `ToolCallContextGuard.recordCall()` 之后检查熔断器状态
- 熔断时返回结构化错误 `{ success: false, error: "Circuit breaker open", retryAfter: 30 }`

**预估工作量**：0.5 天

### 3.5 搜索质量评估

**面试关联**：Q13 召回率与评测

**目标**：量化搜索管线质量，建立可观测指标

**指标**：

| 指标 | 含义 | 目标 |
|------|------|------|
| Recall@5 | 前 5 结果中正确工具的召回率 | > 0.9 |
| MRR | 首个正确工具的排名倒数 | > 0.8 |
| Latency P50 | 搜索延迟中位数 | < 100ms |
| Latency P99 | 搜索延迟长尾 | < 500ms |

**实现**：
- 新增 `src/server/search/SearchQualityTracker.ts`
- 记录每次搜索：查询、返回工具列表、Agent 实际调用的工具
- 通过 `FeedbackTracker` 的已有接口追踪"搜索结果是否被使用"
- 暴露为 MCP Resource：`jshook://search/quality-metrics`
- 定期输出质量报告

**预估工作量**：1.5 天

---

## 四、MCP 可观测性（面试 Q30, Q20）

### 现状 vs 应有

| 可观测性 | 当前实现 | 面试要求 | 差距 |
|----------|---------|---------|------|
| **Tracing** | `InstrumentationContract` + `NoopInstrumentation` | OpenTelemetry span 链路 | **仅接口，无实现** |
| **Metrics** | `MetricNames` 常量定义 | Prometheus Counter/Histogram/Gauge | **仅定义，无导出** |
| **Logging** | chalk logger → stderr | 结构化 JSON 日志 + MCP 协议 | **格式不标准** |
| **事件追踪** | `EventBus`（内存，进程内） | 跨进程事件流 | **单进程限制** |

### 4.1 实现 OpenTelemetry 后端

**目标**：将 `NoopInstrumentation` 替换为可配置的真实实现

**实现**：

```
InstrumentationContract
  ├── NoopInstrumentation         ← 默认（当前）
  ├── OtelInstrumentation         ← 可选：导出到 Jaeger/Zipkin
  └── PrometheusInstrumentation   ← 可选：导出 /metrics 端点
```

**配置方式**：通过环境变量 `MCP_INSTRUMENTATION=otel|prometheus|noop`

**关键 Span**（已在 `SpanNames` 中定义）：
- `tool.execute`：工具调用链路
- `tool.validate_input`：参数校验
- `registry.discovery`：域发现
- `workflow.run` / `workflow.step`：工作流执行

**Prometheus 指标**（已在 `MetricNames` 中定义）：
- `tool_calls_total`：工具调用计数（按 tool_name 维度）
- `tool_duration_ms`：工具执行延迟直方图
- `tool_errors_total`：工具错误计数
- `workflow_duration_ms`：工作流延迟

**实现文件**：
- `src/server/observability/OtelInstrumentation.ts`
- `src/server/observability/PrometheusInstrumentation.ts`
- 修改 `MCPServer.ts` 构造函数中初始化逻辑

**预估工作量**：2 天

### 4.2 结构化事件日志

**目标**：所有关键事件输出结构化 JSON

**实现**：
- 扩展 `EventBus.ts` 的 `emit()` 方法，同时写入 JSON 日志文件
- 日志格式：`{ timestamp, event, toolName, domain, duration_ms, success, ... }`
- 通过 MCP Resource 暴露：`jshook://logs/recent`

**预估工作量**：0.5 天

---

## 五、MCP Agent 评估框架（面试 Q23, Q17 评测集）

### 5.1 Agent 评估指标收集

**目标**：收集面试文档 Q23 列出的 5 个关键指标

```typescript
interface AgentEvalMetrics {
  taskCompletionRate: number;    // 任务完成率
  toolSelectionAccuracy: number; // 工具选择准确率
  avgTokenEfficiency: number;    // Token 效率（完成率/token 消耗）
  p50Latency: number;            // 响应延迟 P50
  errorRate: number;             // 工具调用错误率
}
```

**数据来源**：
- `EventBus` 的 `tool:called` 事件 → 工具调用记录
- `TokenBudgetManager` → token 消耗
- `FeedbackTracker` → 搜索结果使用率
- `InstrumentationSession` → 执行链路

**暴露方式**：
- MCP Resource：`jshook://eval/metrics`
- MCP Prompt：`agent_eval_report`（生成人类可读的评估报告）

**预估工作量**：1.5 天

### 5.2 搜索评测集

**面试关联**：Q17 Agent 评测集构建

**目标**：构建搜索管线的 ground truth 评测集

```typescript
interface SearchTestCase {
  id: string;
  query: string;
  expectedTools: string[];   // 期望返回的工具名列表
  expectedDomains: string[]; // 期望涉及的域
  difficulty: 'easy' | 'medium' | 'hard';
}
```

**评测集示例**：

```typescript
const SEARCH_EVAL = [
  { id: 'SE001', query: 'hook fetch requests', expectedTools: ['network_intercept'], expectedDomains: ['network', 'hooks'], difficulty: 'easy' },
  { id: 'SE002', query: 'analyze anti-debug protection', expectedTools: ['antidebug_detect', 'antidebug_bypass'], expectedDomains: ['antidebug'], difficulty: 'easy' },
  { id: 'SE003', query: 'extract encrypted parameters from login API', expectedTools: ['network_capture', 'crypto_detect', 'hook_install'], expectedDomains: ['network', 'hooks', 'analysis'], difficulty: 'hard' },
  // ... 50-100 条
];
```

**评测脚本**：`tests/eval/search-eval.test.ts`
- 运行所有 test case
- 计算 Recall@K、MRR、NDCG
- CI 集成：回归时搜索质量不下降

**预估工作量**：1.5 天

---

## 六、上下文管理优化（面试 Q3 补充）

### 现状 vs 应有

| 上下文管理 | 当前实现 | Claude Code 做法 | 差距 |
|-----------|---------|-----------------|------|
| **L1 工具结果预算** | `ToolResponseOffloader` + `DetailedDataManager` | 持久化到磁盘，保留 2KB 预览 | ✓ 类似 |
| **L2 History Snip** | 无 | 修剪消息列表冗余部分 | **缺失** |
| **L3 Microcompact** | 无 | 工具结果替换为 `[cleared]` | **缺失** |
| **L4 Context Collapse** | 无 | 非破坏性折叠视图 | **缺失** |
| **Token 估算** | `TokenBudgetManager`（字符/4 估算） | 锚点法（误差 <5%） | **可优化** |
| **渐进激活** | Search/Workflow/Full 三级 | ✓ | ✓ 已有 |

**说明**：L2-L4 是 MCP Host 侧的功能（Claude Code / Cursor 实现），MCP Server 侧无法直接控制消息历史。但 Server 可以优化返回内容的大小。

### 6.1 工具结果智能压缩

**目标**：大结果返回摘要 + 完整数据引用，而非全部内容

**当前已有**：`ToolResponseOffloader.ts` 在响应 > 512KB 时持久化

**增强**：
- 阈值从 512KB 降低到 50KB（Claude Code L1 用 50K 字符）
- 摘要结构化：返回 `{ summary: "...", detailId: "xxx", totalItems: 1500, preview: [...] }`
- `DetailedDataManager.store()` 增加 `generateSummary()` 智能摘要（按数据类型：数组返回前 10 项，对象返回 key 列表）

**预估工作量**：1 天

---

## 实施路线图

### Phase 1：高优先级（面试核心话题，1-2 周）

| 序号 | 改进项 | 工作量 | 依赖 | 面试价值 |
|------|--------|--------|------|---------|
| 1.1 | MCP Resources 扩展 | 1.5d | 无 | 高（Q9-Q10 MCP 三大能力） |
| 1.2 | MCP Prompts 扩展 | 1d | 无 | 高（Q9-Q10） |
| 1.3 | 工具权限分层 | 2d | 无 | 极高（Q5-Q8 安全模型） |
| 1.4 | Circuit Breaker | 0.5d | 无 | 高（Q22-Q23 可靠性） |
| 1.5 | Re-ranker（方案 B） | 1d | 无 | 高（Q6, Q18 检索质量） |
| 1.6 | 工具描述审计 | 2d | 无 | 极高（Q7, Q23 Schema 设计） |

**Phase 1 总计**：~8 天

### Phase 2：中优先级（面试加分项，1 周）

| 序号 | 改进项 | 工作量 | 依赖 |
|------|--------|--------|------|
| 2.1 | Prompt 注入检测 | 1d | 1.3 |
| 2.2 | 搜索质量评估 | 1.5d | 1.5 |
| 2.3 | Agent 评估指标 | 1.5d | 1.4 |
| 2.4 | Self-RAG 快速路径 | 0.5d | 无 |
| 2.5 | MCP Logging 协议 | 0.5d | 无 |
| 2.6 | 工具结果智能压缩 | 1d | 无 |

**Phase 2 总计**：~6 天

### Phase 3：长期优化（架构提升，1-2 周）

| 序号 | 改进项 | 工作量 | 依赖 |
|------|--------|--------|------|
| 3.1 | OpenTelemetry/Prometheus 实现 | 2d | 2.5 |
| 3.2 | 搜索评测集 | 1.5d | 2.2 |
| 3.3 | Re-ranker（方案 A，本地 Cross-Encoder） | 2d | 1.5 |
| 3.4 | A2SPA 执行时鉴权 | 1.5d | 1.3, 2.1 |
| 3.5 | MCP Completion（参数补全） | 0.5d | 1.6 |

**Phase 3 总计**：~7.5 天

---

## 验收标准

每个改进项完成后必须通过：

1. **单元测试**：覆盖率 ≥ 85%（branches）
2. **集成测试**：`pnpm test` 全部通过
3. **类型检查**：`pnpm typecheck` 无错误
4. **Lint**：`pnpm lint` 无警告
5. **Payload 安全**：新增代码不包含任何攻击性 payload
6. **文档同步**：更新对应域的 CLAUDE.md
7. **E2E 验证**：对 MCP 协议变更（Resources/Prompts/Logging），需在 Claude Desktop 或 MCP Inspector 中验证
