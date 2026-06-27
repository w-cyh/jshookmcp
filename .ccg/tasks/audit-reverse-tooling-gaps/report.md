# jshook 逆向工具链缺口调研报告

> **任务**: 13 个候选工具归类决策
> **方法**: 4 路并行 explore — domains 现状 / binary-instrument 深查 / extension SDK / workflow 引擎
> **生成**: 2026-05-25

---

## TL;DR — 13 工具归类总览

| 归类 | 数量 | 工具 |
|------|------|------|
| ✅ **已有（无需新增）** | 1 | crypto_pattern_detect |
| 🔄 **本体增强**（在现有 domain 加 tool） | 5 | api_endpoint_discover, api_schema_reconstruct, binary_key_extract, jadx_search_code, api_collection_export |
| 🆕 **新增 domain** (`dart-inspector`) | 4 | dart_strings_extract, dart_snapshot_parse, dart_class_enumerate, flutter_packages_detect |
| ⚙️ **纯 workflow**（编排已有工具） | 2 | jadx_batch_decompile, reverse_report_generate |
| 🧩 **Extension**（独立演进） | 1 | mock_server_generate |

**核心结论**：13 个工具里只有 **1 个已经覆盖**，**5 个可以增强现有 domain**，**4 个必须新开 `dart-inspector` domain**，**2 个用 workflow 编排即可**，**1 个适合 extension**。

---

## 详细分类

### ① 已有，无需新增（1）

| 工具 | 落地 | 说明 |
|------|------|------|
| **crypto_pattern_detect** | `analysis.detect_crypto` + `transform.crypto_extract_standalone` | 已识别 AES/RSA/HMAC/MD5 等。**直接告诉用户用这两个工具，无需开发** |

### ② 本体增强（5）— 在现有 domain 加 tool / 拓宽适用范围

| # | 工具 | 落地 domain | 实施建议 |
|---|------|------------|----------|
| 5 | **api_endpoint_discover** | `analysis`（新增）+ `binary-instrument`（新增） | analysis 现有 `search_in_scripts` 是 JS。新增 `binary_strings_extract`（通用 ELF/SO 字符串提取，含 URL/路径正则分类）；analysis 加 `endpoint_discover`（对 JS/Java 反编译产物扫 endpoint） |
| 6 | **api_schema_reconstruct** | `graphql`（增强）+ `analysis`（新增） | 现有 `graphql_introspect` 只覆盖 GraphQL。加 `analysis.json_schema_infer`，从 `fromJson`/`fromMap` 模板代码反推 JSON Schema |
| 8 | **binary_key_extract** | `encoding`（增强） | 已有 `binary_entropy_analysis`，扩展为 `binary_key_extract`：高熵区域 + Base64/Hex 候选 + 16/24/32 字节对齐 |
| 10 | **jadx_search_code** | `binary-instrument`（新增） | 现有 `analysis.search_in_scripts` 仅 JS。新增 `jadx_search_code`：在 jadx 反编译输出根目录做 ripgrep（spawn `rg --json`） |
| 13 | **api_collection_export** | `network`（增强） | 现有 `network_export_har`。增加 `network_export_postman` 和 `network_export_openapi`（HAR → Postman/OpenAPI 转换器，纯 JS） |

**为何归本体而非 extension**：
- 这些工具与 `analysis`/`graphql`/`encoding`/`network` 的核心使命同源
- 用户期望"jshook 默认能做"（不需要装插件）
- 实现轻量，无外部进程依赖

### ③ 新增 domain — `dart-inspector`（4）

| # | 工具 | 工作原理 | 实现复杂度 |
|---|------|----------|-----------|
| 1 | **dart_strings_extract** | 读 libapp.so，扫描 ASCII/UTF-16 字符串，正则分类（urls/paths/classNames/packageRefs/cryptoKeywords） | **低**（纯 Node，类似 `strings -a` + regex） |
| 4 | **flutter_packages_detect** | 从 `package:` 引用列表去重 → 第三方依赖 + 出现频次 | **低**（基于 #1 输出） |
| 2 | **dart_snapshot_parse** | 解析 Dart VM Snapshot 格式（魔数 / cluster / object pool / class table / string table） | **高**（需要按 Dart SDK 版本适配，参考 `darter`/`dart_snapshot_view`） |
| 3 | **dart_class_enumerate** | 基于 #2 输出，结构化所有类 + 方法签名 + 字段 | **中**（依赖 #2） |

**为何新增独立 domain 而非塞 binary-instrument**：
- binary-instrument 已经 18 工具，职责是"调外部反编译器"，dart 是"自己解析二进制"
- Dart Snapshot 解析逻辑独立性强（无外部 CLI 依赖），适合作为单独的解析器 domain
- 未来可扩展 `dart_vm_attach`（Dart Observatory 协议）、`flutter_engine_info` 等
- 参考 `v8-inspector`、`boringssl-inspector`、`skia-capture` 的命名风格 — 都是"特定运行时解析器"

**建议目录结构**：
```
src/server/domains/dart-inspector/
  manifest.ts
  definitions.ts
  handlers.ts
src/modules/dart-inspector/
  StringsExtractor.ts          # P0
  PackageDetector.ts           # P0
  SnapshotParser.ts            # P1（按 Dart 2.x/3.x 版本分发）
  ClassEnumerator.ts           # P1（依赖 SnapshotParser）
```

**实施分两阶段**：
- **Phase 1（P0，1 周）**：`dart_strings_extract` + `flutter_packages_detect` — 解决用户 80% 痛点
- **Phase 2（P1，3-4 周）**：`dart_snapshot_parse` + `dart_class_enumerate` — 啃硬骨头

### ④ Workflow 编排（2）— 不写新 tool，纯组合

| # | 工具 | Workflow 设计 |
|---|------|---------------|
| 9 | **jadx_batch_decompile** | `parallelStep` 节点，对类列表并发调 `jadx_decompile`，`maxConcurrency: 4`，`failFast: false`，聚合 `stepResults` |
| 11 | **reverse_report_generate** | `sequenceStep`：apk_manifest_dump → apktool_decode → dart_strings_extract → api_endpoint_discover → detect_crypto → flutter_packages_detect。`onFinish` 钩子拼装 Markdown/HTML |

**为何归 workflow**：
- 都是"已有工具的组合"，没有新的核心逻辑
- WorkflowEngine 已支持并行/串行/数据传递 + `${step.field}` 模板
- 用户可以通过 `extension-registry` 安装/共享这些 workflow

**落地路径**：
1. 在 `src/server/workflows/` 下加 `reverse-report.workflow.ts` 和 `jadx-batch.workflow.ts`
2. 注册到 workflow domain，通过 `run_extension_workflow` 调用
3. 同时考虑做成 SDK 示例放在 `packages/extension-sdk/examples/`

### ⑤ Extension（1）— 独立演进

| # | 工具 | 为何做 extension |
|---|------|------------------|
| 12 | **mock_server_generate** | ① 需要代码生成（workflow 引擎不支持 LLM） ② 输出物是 **可运行的 Node/Python 项目**，超出 jshook 本职 ③ 用户群体小（仅做 mock 联调时需要） ④ 模板可能频繁迭代（Express/Fastify/Koa/...），不适合塞本体 |

**实施**：
- 创建 `plugins/mock-server-generator/`
- Plugin 通过 `allowTool: ['network_get_requests', 'workflow.run_extension_workflow']` 取已有 API 数据
- 调外部 OpenAPI codegen（或调 LLM API）生成代码
- `setRuntimeData` 缓存生成历史

---

## 实施路线图（按 ROI 排序）

### 🔥 Sprint 1（1-2 周）— 解决用户 80% 痛点

1. **dart_strings_extract**（新 domain `dart-inspector`，P0 模块）
2. **flutter_packages_detect**（同 domain，基于 #1）
3. **binary_key_extract**（`encoding` 增强）
4. **jadx_search_code**（`binary-instrument` 新增 tool）

**完成后**：用户不再需要手写 30+ 次 Python 正则。

### 🚀 Sprint 2（1 周）— Workflow 编排

5. **jadx_batch_decompile**（workflow）
6. **reverse_report_generate**（workflow，先用 Markdown 模板）
7. **api_collection_export**（`network` 增强：HAR → Postman/OpenAPI）

**完成后**：一键产出完整逆向报告 + Postman 集合。

### 🎯 Sprint 3（2-3 周）— 增强分析能力

8. **api_endpoint_discover**（`analysis` 新增 + 跨 binary/JS 通用）
9. **api_schema_reconstruct**（`analysis.json_schema_infer`，从 fromJson 推断）

### 🏗️ Sprint 4（3-4 周）— 啃硬骨头

10. **dart_snapshot_parse**（核心难度大，需要研究 Dart SDK 各版本格式）
11. **dart_class_enumerate**（依赖 #10）

### 🧪 Sprint 5（可选，1-2 周）— Extension

12. **mock_server_generate**（plugin）

### ❌ 不做

13. **crypto_pattern_detect** — 已被 `analysis.detect_crypto` 覆盖，无需重复

---

## 关键决策依据汇总

| 决策维度 | 判定规则 | 应用案例 |
|---------|---------|---------|
| **本体 vs Extension** | 通用刚需 / 高频 / 无外部依赖 → 本体；行业专用 / 大依赖 / 实验性 → extension | mock_server_generate 走 extension（依赖代码生成） |
| **新 domain vs 扩 domain** | 一类新对象（Dart Snapshot）→ 新 domain；单点能力增强 → 扩现有 domain | dart-inspector 新建；jadx_search_code 加入 binary-instrument |
| **Tool vs Workflow** | 纯编排 + 已有工具足够 → workflow；新核心逻辑 → tool | jadx_batch_decompile（parallelStep）走 workflow；dart_strings_extract（新解析）必须 tool |
| **优先级** | 用户痛点频次 × 实现成本 | dart_strings_extract（极痛 + 极易）= P0 顶 |

---

## 对 jshook 架构的小建议（顺便）

调研中观察到的可优化点：

1. **workflow domain 缺通用接口**：目前只有 `run_extension_workflow`，建议补 `define_workflow_inline` 让用户临时拼一个 workflow 而无需先注册 extension。
2. **WorkflowEngine 缺 loop 原语**：`jadx_batch_decompile` 这种"对 N 个目标做同一件事"需要手写 parallelStep 数组。建议加 `forEachStep`。
3. **没有统一的"二进制字符串提取"模块**：Ghidra fallback 里有，但没暴露为独立工具。建议抽出 `src/modules/binary-strings/` 给 dart_strings_extract 复用。
4. **API discovery 跨 domain**：`network.network_get_requests`（动态）和未来的 `analysis.endpoint_discover`（静态）应该输出统一 schema，方便 `api_collection_export` 消费。

---

## 下一步建议

请挑一个开始：

- **A. 启动 Sprint 1**：我立即创建 `dart-inspector` domain 骨架 + `dart_strings_extract` 实现
- **B. 先做 Workflow（更轻）**：先做 `reverse_report_generate` 这个一键报告（最大显性收益，0 新代码）
- **C. 先增强本体**：从 `binary_key_extract` 或 `jadx_search_code` 这种小切口开始
- **D. 写 RFC 文档**：把这份报告升格为 `docs/rfc/0001-flutter-reverse-tooling.md`，征求意见后再开工
