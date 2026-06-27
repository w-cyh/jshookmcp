# Domain Merge Handoff — 每域 ≥5 工具

> 任务：合并 ≤5 工具的小域，使所有域都 ≥6 工具。
> 当前：40 域 439 工具 → 目标：~30 域 439 工具（工具不变，域数减少）

---

## 合并方案

基于职能亲和度 + 依赖关系 + 代码量综合判定。原则：
- 职能相近的域合并（同层工具放一起）
- 依赖链上游吸收下游（canvas 吸收 skia-capture）
- 合并后 depKey 用主域名，次域名工具用 `secondaryDepKeys`（已有先例：hooks 域）

### 合并表

| # | 吸收域（主） | 被合并域（次） | 合并后工具数 | 理由 |
|---|------------|--------------|-------------|------|
| 1 | **binary-instrument** (24) | binary-secrets (1), apk-packer (3) | **28** | 都是二进制分析：instrumentation/frida/ghidra + 密钥提取 + 加固识别 |
| 2 | **debugger** (16) | antidebug (2) | **18** | 反反调试是调试器的子集，antidebug 脚本注入走 debugger session |
| 3 | **instrumentation** (5) | hooks (2), evidence (3) | **10** | hooks 是仪器化的核心手段，evidence graph 是 session 的产出 |
| 4 | **canvas** (4) | skia-capture (3) | **7** | 已有 toolDependencies 互相指向，同属渲染分析 |
| 5 | **workflow** (6) | macro (2) | **8** | 宏是多步工作流的特化，workflow 已有脚本库 |
| 6 | **coordination** (7) | shared-state-board (3) | **10** | 共享状态板是跨域协调的基座，coordination 已有 handoff |
| 7 | **maintenance** (12) | sandbox (1) | **13** | 沙箱是运维工具，maintenance 已有环境诊断+扩展管理 |

### 合并后域列表（33 域）

| 域 | 工具数 | 变化 |
|----|--------|------|
| adb-bridge | 7 | 不变 |
| binary-instrument | 28 | +binary-secrets(1) +apk-packer(3) |
| boringssl-inspector | 28 | 不变 |
| browser | 64 | 不变 |
| canvas | 7 | +skia-capture(3) |
| coordination | 10 | +shared-state-board(3) |
| core (analysis) | 22 | 不变 |
| cross-domain | 6 | 不变 |
| dart-inspector | 7 | 不变 |
| debugger | 18 | +antidebug(2) |
| encoding | 5 | 不变（边界，5=5 不合并） |
| extension-registry | 5 | 不变（边界） |
| graphql | 6 | 不变 |
| instrumentation | 10 | +hooks(2) +evidence(3) |
| maintenance | 13 | +sandbox(1) |
| memory | 30 | 不变 |
| mojo-ipc | 5 | 不变（边界） |
| native-emulator | 15 | 不变 |
| network | 37 | 不变 |
| platform | 14 | 不变 |
| process | 17 | 不变 |
| protocol-analysis | 16 | 不变 |
| proxy | 8 | 不变 |
| sourcemap | 6 | 不变 |
| streaming | 5 | 不变（边界） |
| syscall-hook | 7 | 不变 |
| trace | 9 | 不变 |
| transform | 6 | 不变 |
| v8-inspector | 8 | 不变 |
| wasm | 12 | 不变 |
| workflow | 8 | +macro(2) |

**删除的域**（10 个）：binary-secrets, apk-packer, antidebug, hooks, evidence, skia-capture, macro, shared-state-board, sandbox + 原生 inline domains（native-bridge, netproto 不变）

---

## 每个合并的文件架构

### 1. binary-instrument ← binary-secrets + apk-packer

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'binaryInstrumentHandlers' as const;
type H = BinaryInstrumentHandlers;

// 新增 secondaryDepKeys
const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,                        // 'binary-instrument'
  depKey: DEP_KEY,
  profiles: ['full'],
  secondaryDepKeys: ['binarySecretsHandlers', 'apkPackerHandlers'] as const,
  registrations: [
    // ... 现有 24 个 binary-instrument 工具 ...
    // binary-secrets 工具
    { tool: 'binary_key_extract', method: 'handleBinaryKeyExtract' },
    // apk-packer 工具
    { tool: 'apk_packer_detect', method: 'handleApkPackerDetect' },
    { tool: 'apk_packer_list_signatures', method: 'handleApkPackerListSignatures' },
    { tool: 'apk_signing_block_parse', method: 'handleApkSigningBlockParse' },
  ],
  ensure: async (ctx) => { /* same factory */ },
};
```

**文件操作**：
- `src/server/domains/binary-instrument/definitions.ts` — 追加 4 个工具定义（从被合并域 definitions.ts 复制）
- `src/server/domains/binary-instrument/handlers.impl.ts` — 追加 handler 方法（import 原实现 class 或内联）
- `src/server/domains/binary-secrets/` — 整目录删除
- `src/server/domains/apk-packer/` — 整目录删除
- `src/server/registry/generated-domains.ts` — 移除 binary-secrets 和 apk-packer 条目（自动生成，跑 `pnpm build` 更新）

**ensure() 保持不变**：binary-secrets 和 apk-packer 的 handler 是无状态单例，直接 new 然后挂到主 handler 上，或者用 secondaryDepKeys 让 MCPServer 自动 resolve。

---

### 2. debugger ← antidebug

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'debuggerHandlers' as const;
// secondaryDepKeys: ['antidebugHandlers']
// registrations 追加:
//   { tool: 'antidebug_bypass', method: 'handleAntidebugBypass' },
//   { tool: 'antidebug_detect_protections', method: 'handleAntidebugDetectProtections' },
```

**文件操作**：
- `definitions.ts` 追加 2 个工具定义
- `handlers.impl.ts` 追加 2 个 handler（原 antidebug handlers 是 ~1300 行的独立 class，import 它或 inline）
- 删除 `src/server/domains/antidebug/`
- `antidebug/scripts.ts` + `scripts.data.ts` + `scripts.data.*.ts` — 移入 debugger 目录或保持 import 路径不变（这些是注入脚本数据，被 handler 引用）

---

### 3. instrumentation ← hooks + evidence

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'instrumentationHandlers' as const;
// secondaryDepKeys: ['aiHookHandlers', 'hookPresetHandlers', 'evidenceHandlers']
// registrations 追加:
//   hooks: ai_hook, hook_preset
//   evidence: evidence_query, evidence_export, evidence_chain
```

**文件操作**：
- `definitions.ts` 追加 5 个工具定义
- `handlers.impl.ts` 或新 `handlers.hooks.ts` / `handlers.evidence.ts` — 追加 handler
- 删除 `src/server/domains/hooks/`
- 删除 `src/server/domains/evidence/`
- hooks 的 preset-builder/preset-definitions 依赖链保持 import 路径（移入 instrumentation 或改 path）

---

### 4. canvas ← skia-capture

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'canvasHandlers' as const;
// secondaryDepKeys: ['skiaCaptureHandlers']
// registrations 追加:
//   skia_detect_renderer, skia_extract_scene, skia_correlate_objects
```

**文件操作**：
- `definitions.ts` 追加 3 个工具定义
- 追加 handler（skia-capture 的 handlers/ 目录移入 canvas/handlers/）
- 删除 `src/server/domains/skia-capture/`

---

### 5. workflow ← macro

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'workflowHandlers' as const;
// secondaryDepKeys: ['macroHandlers']
// registrations 追加:
//   run_macro, list_macros
```

**文件操作**：
- `definitions.ts` 追加 2 个工具定义
- 追加 handler（原 MacroToolHandlers ~177 行，直接 inline）
- 删除 `src/server/domains/macro/`

---

### 6. coordination ← shared-state-board

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'coordinationHandlers' as const;
// secondaryDepKeys: ['sharedStateBoardHandlers']
// registrations 追加:
//   state_board, state_board_watch, state_board_io
```

**文件操作**：
- `definitions.ts` 追加 3 个工具定义
- 追加 handler
- 删除 `src/server/domains/shared-state-board/`

---

### 7. maintenance ← sandbox

**manifest.ts 变更**：
```typescript
const DEP_KEY = 'maintenanceHandlers' as const;
// secondaryDepKeys: ['sandboxHandlers']
// registrations 追加:
//   execute_sandbox_script
```

**文件操作**：
- `definitions.ts` 追加 1 个工具定义
- 追加 handler
- 删除 `src/server/domains/sandbox/`

---

## 通用操作清单（每个合并都要做）

### A. manifest.ts
1. 在主域 manifest 的 `secondaryDepKeys` 添加被合并域的 depKey
2. 在 `registrations` 追加被合并域的所有 `{ tool, method }` 条目
3. 合并 `workflowRule`（patterns 数组合并，priority 取更高值）
4. 合并 `prerequisites`（按 tool name 合并）
5. 合并 `toolDependencies`

### B. definitions.ts
1. 从被合并域的 definitions.ts 复制 Tool[] 条目到主域 definitions.ts
2. 保持 tool name 不变（不重命名工具）
3. 保持 inputSchema 完全一致

### C. handlers
1. 在主域 handlers 添加对应 method
2. 两种策略选其一：
   - **A（推荐）**：import 原被合并域的 handler class，在 method 中 delegate
   - **B**：直接 inline 代码到主域 handler

### D. ensure()
1. 主域 ensure() 中追加被合并域 handler 的实例化
2. 或靠 secondaryDepKeys 让 MCPServer 自动 resolve

### E. 删除被合并域目录
1. `rm -rf src/server/domains/{domain}/`
2. 更新所有 import 路径引用

### F. generated-domains.ts
1. 跑 `pnpm build` 自动重生成
2. 确认被合并域条目消失

### G. docs
1. 跑 `pnpm docs:generate` — 自动从 manifests 生成新域页面
2. 被合并域的 .md 自动被 `clearGeneratedPages` 清理
3. `sidebar-reference-*.mjs` 自动更新
4. `reference-tool-descriptions.json` 自动同步（`syncZhCoverage`）

### H. META in generate-vitepress-reference.mjs
1. 删除被合并域的 META 条目
2. 主域 META 的 zhTitle/zhSummary/zhScenarios/zhCombos 更新（合并描述）
3. 主域 META 的 enTitle/enSummary 同理

### I. CLAUDE.md 更新
1. 删除被合并域的 `src/server/domains/{domain}/CLAUDE.md`
2. 更新主域 CLAUDE.md 增加被合并工具描述
3. 更新根 CLAUDE.md 域表（域数 40→33，域列表更新）

### J. tests
1. 被合并域的测试文件 `tests/server/domains/{domain}/` — 改 import 路径或移入主域 test 目录
2. 全量测试 `pnpm test` 验证无回归

---

## 执行顺序（依赖关系）

```
Phase 1: 无互相依赖的合并（可并行）
  - canvas ← skia-capture
  - coordination ← shared-state-board
  - workflow ← macro
  - maintenance ← sandbox

Phase 2: 有 import 交叉的合并
  - binary-instrument ← binary-secrets + apk-packer
  - debugger ← antidebug
  - instrumentation ← hooks + evidence

Phase 3: 全局更新
  - pnpm build（重生成 generated-domains.ts）
  - pnpm docs:generate（重生成域页面 + sidebar + i18n）
  - pnpm test（验证无回归）
  - 更新 CLAUDE.md 域表
  - git commit
```

---

## 关键风险

| 风险 | 缓解 |
|------|------|
| hooks 的 dual-depKey（aiHookHandlers + hookPresetHandlers）| 合并后用 secondaryDepKeys 承载两个 |
| antidebug 的 scripts.data 嵌入脚本 | 移入 debugger 或保持原路径 import |
| evidence 的 ReverseEvidenceGraph 共享状态 | 保持单例，instrumentation handler delegate 到它 |
| 被合并域的测试文件 import 路径 | 全局搜索替换 import 路径 |
| 外部工具/扩展引用被合并域名 | 域名在 manifest 的 domain 字段不变，只是目录合并 |

---

## 文件影响矩阵

| 操作 | 涉及文件数（估） |
|------|-----------------|
| 删除域目录 | 10 目录 × ~5 文件 = ~50 文件删除 |
| 修改主域 manifest | 7 文件 |
| 修改主域 definitions | 7 文件 |
| 修改主域 handlers | 7 文件 |
| 重生成 generated-domains | 1 文件（自动） |
| 重生成 docs 页面 | ~20 文件（自动） |
| 更新 CLAUDE.md | ~5 文件 |
| 修改测试 import | ~30 测试文件 |
| **总计** | ~120 文件 |

---

## 验证清单

- [ ] `pnpm build` 无 TS 错误
- [ ] `pnpm test` 全量通过
- [ ] `pnpm docs:generate` 生成 33 域页面
- [ ] `pnpm docs:build` VitePress 构建成功
- [ ] `pnpm check` 全量质量检查通过
- [ ] 被合并域的工具仍可正常调用（call_tool 路径不变）
- [ ] 搜索引擎能找到所有 439 工具
- [ ] 侧边栏显示 33 域，无死链
