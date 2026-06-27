# process 域军工级审计报告

> 审计日期：2026-06-20
> 范围：`src/server/domains/process/handlers/` 全部文件 + `handlers.base*.ts` + runtime 文件
> 方法：静态审查，不改代码

---

## 概况

| 指标 | 数值 |
|------|------|
| 审查文件数 | 15（含 re-export 桩 6 个，实审 9 个） |
| 总裸 `as` 转换 | **6**（全在 injection-handlers.ts） |
| 使用了 parse-args 的文件 | 2（handlers.base.process.ts、process-management.ts） |
| 接入了 AuditTrail | 是（memory-operations.ts + injection-handlers.ts） |
| try/catch 总数 | 52 |
| 反射性 try/catch | 0（全为 fail-soft 边界） |
| 严重程度 | **0 Critical, 3 High, 5 Medium, 3 Low** |

> 注意：任务描述中 "memory-operations.ts 33 处裸 as" 和 "injection-handlers.ts 27 处裸 as" 的实际统计口径不同——这是 `args.x` 访问总数而非裸 `as` 转换数。memory-operations.ts 已全部通过 `requireString/requirePositiveNumber/normalizeEncoding/normalizePatternType` 等辅助函数访问 args，**0 处裸 as**。

---

## Critical（必须修）

**无。**

---

## High

### H1：injection-handlers.ts encoding 裸 as 无枚举校验（3 处）

**文件：行号**
- `src/server/domains/process/handlers/injection-handlers.ts:216`
- `src/server/domains/process/handlers/injection-handlers.ts:240`
- `src/server/domains/process/handlers/injection-handlers.ts:268`

**问题**：`encoding` 参数用裸 `as` 转换：
```typescript
const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
```
这里 `args.encoding` 可以是任意值（数字、对象、`'binary'` 等），`as` 只是类型擦除不做任何校验。对比 `memory-operations.ts:496-503` 的 `normalizeEncoding()` 方法——同文件内已有 validator，injection-handlers 没复用。

**修法建议**：统一使用 `argEnum` 或复用已有的 `normalizeEncoding` pattern：
```typescript
const ENCODINGS = new Set(['hex', 'base64'] as const);
const encoding = argEnum(args, 'encoding', ENCODINGS, 'hex' as const);
```
或者复用 `memory-operations.ts` 的 `normalizeEncoding`（提取为共享函数）。

---

### H2：injection-handlers.ts electron_attach 参数 3 处裸 as（L390-392）

**文件：行号**
- `src/server/domains/process/handlers/injection-handlers.ts:390-392`

**当前代码**：
```typescript
const wsEndpointArg = (args.wsEndpoint as string | undefined) ?? '';
const evaluateExpr = (args.evaluate as string | undefined) ?? '';
const pageUrl = (args.pageUrl as string | undefined) ?? '';
```

**问题**：
- `args.wsEndpoint` 可能是数字/对象，`as string | undefined` 不做校验
- `evaluateExpr` 尽管下游有 `validateExpression()`，但上游参数解析不应信任类型
- `pageUrl` 无任何校验就传给 `String.includes()` 做 URL 匹配，可能 crash

**修法建议**：
```typescript
const wsEndpointArg = argString(args, 'wsEndpoint') ?? '';
const evaluateExpr = argString(args, 'evaluate') ?? '';
const pageUrl = argString(args, 'pageUrl') ?? '';
```

---

### H3：代码重复 —— ProcessHandlersCore 与 ProcessManagementHandlers 双轨

**文件**：
- `src/server/domains/process/handlers.base.process.ts` (519 行, ProcessHandlersCore)
- `src/server/domains/process/handlers/process-management.ts` (595 行, ProcessManagementHandlers)

**问题**：两套独立实现覆盖相同的 handler 方法（handleProcessFind/Get/Windows/CheckDebugPort/LaunchDebug/Kill + buildMemoryDiagnostics/safeBuildMemoryDiagnostics/recordMemoryAudit）。生产路径走 `process-management.ts` → `handlers.impl.ts` 组合 facade；`handlers.base.ts` 的 `ProcessHandlersBase extends ProcessHandlersCore` 仅由旧测试引用。

这是 **近 1000 行重复**，任何改动需要同步两处。

**修法建议**：将 `handlers.base.ts` 也迁移到使用 `ProcessManagementHandlers` 组合（和 `handlers.impl.ts` 一致），然后标记 ProcessHandlersCore 为 `@deprecated`，最终删除 `handlers.base.process.ts`。旧测试文件 `tests/server/domains/process/handlers.base.test.ts` 改为使用组合 facade。

---

## Medium

### M1：验证函数缺少工具名上下文

**文件**：
- `src/server/domains/process/handlers.base.types.ts:78-91`

**当前代码**：
```typescript
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export function requirePositiveNumber(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}
```

**问题**：错误消息只含字段名不含工具名——用户看到 `"address must be a non-empty string"` 无法知道哪个工具报错。对比 memory 域的 `requireStringArg(value, fieldName, toolName)` 在消息中带工具名（如 `"memory_patch_bytes: missing or invalid required argument "address"..."`）。

**修法建议**：添加可选的 `toolName` 参数，或在 handler catch 层包装错误消息。两个函数都被 10+ 处调用，统一修改可大幅改善可调试性。

---

### M2：injection-handlers 内重复的辅助函数

**文件**：`src/server/domains/process/handlers/injection-handlers.ts:32-53`

**当前代码**（injection-handlers.ts 内的本地副本）：
```typescript
function getOptionalPid(value: unknown): number | null { ... }     // L32-35
function formatUnknownError(error: unknown): string { ... }        // L37-49
function getOptionalString(value: unknown): string | null { ... }  // L51-53
function getShellcodeSize(shellcode: string, encoding: ...) { ... } // L55-61
```

**问题**：
- `getOptionalPid`/`getOptionalString` 在 `handlers.base.types.ts` 已有（返回 `undefined` 而非 `null`）
- `getShellcodeSize` 与 `handlers.base.types.ts:getWriteSize()` 功能完全一致——唯一的区别是两处都对 hex 做 `replace(/\s+/g, '')` 并 `Math.ceil(length/2)`，对 base64 用 `Buffer.from`

**修法建议**：删除 injection-handlers.ts 中的本地副本，改为 `import { getOptionalPid, getOptionalString, getWriteSize as getShellcodeSize } from '../handlers.base.types'`。

---

### M3：hex 地址无格式校验

**范围**：所有 memory 操作 handler（memory-operations.ts 和 injection-handlers.ts）

**问题**：`requireString(args.address, 'address')` 只检查非空字符串，不校验地址格式。用户传入 `"not an address"` 或 `"0xGGGG"` 会一路传递到 native 层才报错，错误信息是底层 FFI 的原始报错，不可读。

对比 memory 域的 `validateHexAddress()`（`src/server/domains/memory/handlers/validation.ts:21-28`）——相同的 `HEX_ADDRESS_RE = /^(0x)?[0-9a-fA-F]+$/` 可直接复用。

**修法建议**：
1. 在 `handlers.base.types.ts` 添加
```typescript
import { validateHexAddress } from '@server/domains/memory/handlers/validation';
export { validateHexAddress };
```
2. 在 `requireString` 之后加：
```typescript
const address = validateHexAddress(requireString(args.address, 'address'), 'address');
```

**影响范围**：memory-operations.ts L50/L104/L240/L295 的 address 参数，共 4-5 处。

---

### M4：`memory_check_protection` 和 `memory_scan_filtered` 等操作无审计

**文件**：
- `src/server/domains/process/handlers/memory-operations.ts:237-247` (handleMemoryCheckProtection)
- `src/server/domains/process/handlers/memory-operations.ts:249-271` (handleMemoryScanFiltered)
- `src/server/domains/process/handlers/memory-operations.ts:273-289` (handleMemoryBatchWrite)
- `src/server/domains/process/handlers/memory-operations.ts:291-306` (handleMemoryDumpRegion)
- `src/server/domains/process/handlers/memory-operations.ts:308-317` (handleMemoryListRegions)

**问题**：这些 handler 不调用 `this.host.recordMemoryAudit()`。对比 `handleMemoryRead/Write/Scan` 有完整的 `auditedResultResponse/auditedExceptionResponse` 流程。`handleMemoryBatchWrite` 是破坏性操作（写多个地址），`handleMemoryDumpRegion` 读大量数据——两者都应审计。

**修法建议**：为 `handleMemoryBatchWrite`, `handleMemoryDumpRegion` 添加审计；`handleMemoryCheckProtection`, `handleMemoryScanFiltered`, `handleMemoryListRegions` 为只读，可跳过。

---

### M5：`handleMemoryScanFiltered`, `handleMemoryBatchWrite`, `handleMemoryDumpRegion`, `handleMemoryListRegions` 缺少 diagnostics

**同上文件**：这些 handler 的 catch 块不调用 `safeBuildMemoryDiagnostics()`，失败时不返回结构化诊断信息。对比 `handleMemoryRead/Write/Scan` 在 `auditedExceptionResponse` 中有完整的 diagnostics 构建。

---

## Low

### L1：process-management.ts 和 handlers.base.process.ts 共用 `handleProcessList` 问题

**文件**：
- `src/server/domains/process/handlers/process-management.ts:177` — `handleProcessList(_args)` 忽略参数
- `handlers.base.process.ts` 内无 `handleProcessList`

**问题**：manifest 将 `process_list` 映射到 `handleProcessFind`（复用），`process-management.ts` 的 `handleProcessList` 未被 manifest 使用。这是死代码或需要 manifest 修正。

---

### L2：`handleElectronAttach` 端口校验内联

**文件**：`src/server/domains/process/handlers/injection-handlers.ts:375-389`

**当前代码**：
```typescript
const rawPort = args.port ?? 9229;
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  return { ... error response ... };
}
```

**问题**：端口验证逻辑内嵌在 handler 中，未使用 `argNumber`。不影响功能但风格不一致。

**修法建议**：提取为 `validatePort(value: unknown): number` 复用函数。

---

### L3：Re-export 桩文件过多

**文件**（6 个桩，总共 ~25 行）：
- `handlers.impl.core.runtime.base.ts`
- `handlers.impl.core.runtime.inject.ts`
- `handlers.impl.core.runtime.memory.ts`
- `handlers.impl.core.runtime.ts`
- `handlers.impl.core.ts`
- `handlers.impl.ts`

这些都是从 `handlers.impl` 的向后兼容 re-export。`handlers.ts` 已正确扁平化（直接从 handlers.impl 导出）。6 个文件可考虑全部删除/合并到 `handlers.ts`，统一一个 re-export 入口。

---

## 重构工作估算

| 类别 | 文件数 | 预计人时 | 说明 |
|------|--------|----------|------|
| H1-H2: 裸 as 修复 | 1 | 1h | injection-handlers.ts 5 处 as 替换为 argEnum/argString |
| H3: 代码去重 | 3 | 3h | 迁移 handlers.base.ts → 组合 facade，删除 handlers.base.process.ts，更新测试 |
| M1: 工具名上下文 | 2 | 1h | requireString/requirePositiveNumber 加 toolName 参数，批量替换调用点 |
| M2: 去重辅助函数 | 1 | 0.5h | injection-handlers.ts 本地函数替换为 import |
| M3: hex 地址校验 | 2 | 0.5h | import validateHexAddress，在 address 参数处校验 |
| M4-M5: 审计覆盖 | 1 | 1h | 给 handleMemoryBatchWrite/DumpRegion 加审计+diagnostics |
| L1-L3: 低优先级 | 2 | 1h | 端口校验 + 死代码清理 |
| 测试补充 | 3-4 | 3h | 新版 validation 单元测试 + handler 拒绝路径测试 |
| **合计** | **~8** | **~11h** | 约 1.5 工作日 |

### 建议执行顺序

1. **先做 M1**（加 toolName 参数）——这是所有后续改动的基石
2. **再做 H1-H2**（裸 as 修复）——最小改动消除类型不安全
3. **然后 M2-M3**（去重 + hex 校验）——消除重复代码
4. **H3**（代码去重）——需要较多测试更新，排后面
5. **M4-M5**（审计补全）——纯增量，风险最低
6. **L1-L3**（死代码清理）——最后收尾

---

## memory 域 pattern 适用性评估

### 可复用函数（`src/server/domains/memory/handlers/validation.ts`）

| 函数 | process 域可复用 | 使用场景 |
|------|-----------------|----------|
| `validateHexAddress` | **是** | memory_read/write/dump 的 address 参数 |
| `validateBytesArray` | 否 | process 域不暴露 bytes 数组参数 |
| `requireStringArg` | **是** | 替代 `requireString`，加 toolName 上下文 |
| `requirePositiveNumberArg` | **是** | 替代 `requirePositiveNumber`，加 toolName 上下文 |
| `requirePositiveIntArg` | **是** | size/count 等整数参数 |
| `parseJsonArg` | 否 | process 域无 JSON string arg |

### AuditTrail 接入状态

**结论：已接入，但覆盖不全。**

- `AuditTrail` 在 `ProcessHandlerDeps` 中传递（`handlers/shared-types.ts:16-19`），`ProcessManagementHandlers` 构造函数接收（L31）
- `memory-operations.ts`：read/write/scan 有完整 `auditedResultResponse/auditedExceptionResponse` 流程；check_protection/scan_filtered/batch_write/dump/regions 无审计
- `injection-handlers.ts`：dll/shellcode 有审计（成功+失败+异常全路径）；check_debug_port/enumerate_modules/electron_attach 无审计
- `auditTrail.record()` 是 fail-soft（wrap 在 try/catch 内，日志 warn）

### parse-args 使用统计

| 文件 | argNumber | argString | argBool | argStringArray | argEnum | argObject |
|------|-----------|-----------|---------|----------------|---------|-----------|
| handlers.base.process.ts | 1 | 0 | 0 | 1 | 0 | 0 |
| process-management.ts | 1 | 0 | 0 | 1 | 0 | 0 |
| memory-operations.ts | 0 | 0 | 0 | 0 | 0 | 0 |
| injection-handlers.ts | 0 | 0 | 0 | 0 | 0 | 0 |

- **argString**：可用于 injection-handlers.ts L390-392 的 3 处 `as string`；可用于 injection-handlers.ts L164-167 的 `typeof args.confirmed === 'boolean'` → `argBool`
- **argEnum**：可用于 injection-handlers.ts L216/L240/L268 的 3 处 encoding as 转换
- **argNumber**：可用于 injection-handlers.ts L375 的端口解析 → `argNumber(args, 'port', 9229)`
- **memory-operations.ts 无需改动**——已通过本地验证函数（requireString/requirePositiveNumber/normalizeEncoding/normalizePatternType）正确封装，这些是比 parse-args 更严格（有错误消息+校验）的 choices

---

## 测试现状

### 相关测试文件（11 文件, ~169 测试用例）

| 文件 | 测试数 | 覆盖内容 |
|------|--------|---------|
| `tests/server/domains/process/handlers.base.test.ts` | 32 | validatePid/requireString/requirePositiveNumber + handleProcessWindows/LaunchDebug + buildMemoryDiagnostics |
| `tests/server/domains/process/handlers.test.ts` | 5 | ProcessToolHandlers facade 集成 |
| `tests/server/domains/process/handlers.inject.test.ts` | 24 | injection disabled/enabled 分支 + electron_attach |
| `tests/server/domains/process/handlers.memory.test.ts` | 7 | memory operation handler 响应 |
| `tests/server/domains/process/runtime-memory-additional.test.ts` | 76 | memory operations 边缘情况 |
| `tests/server/domains/process/handlers.electron-attach-security.test.ts` | 21 | electron_attach 表达式安全 |
| `tests/server/domains/process/injection-validation-integration.test.ts` | 22 | 注入验证集成 |
| `tests/server/domains/process/missing-tools.test.ts` | 19 | 工具注册完整性 |
| `tests/server/domains/process/definitions.test.ts` | 4 | tool definitions 结构 |
| `tests/server/domains/process/exports.test.ts` | 2 | 模块导出 |
| `tests/server/domains/process/process-manifest-platform.test.ts` | 3 | 平台过滤 |
| **总计** | **~215**（含 describe） | |

实际 `it/test` 计数：~169 个测试用例。

### 新增测试预估

| 改动 | 新增测试数 | 测试类型 |
|------|-----------|---------|
| H1: encoding 枚举校验 | +8 | 无效 encoding 值返回错误 |
| H2: wsEndpoint/evaluate/pageUrl 类型校验 | +5 | 非字符串 arg 返回错误 |
| H3: 代码去重 | 0（维持现有测试绿） | 重构不改变行为 |
| M1: validateHexAddress | +6 | 无效地址、空字符串、格式错误 |
| M2: normalizeEncoding 复用 | +3 | boundary cases |
| M4-M5: 审计覆盖 | +8 | audit 记录存在 + diagnostics |
| **合计** | **+30** | |

---

## 附录 A：文件清单

### 审查文件（实审）

| 文件 | 行数 | 裸 as | try/catch 数 | 评价 |
|------|------|-------|-------------|------|
| `handlers/memory-operations.ts` | 514 | 0 | 9 | 代码质量最高，审计+diagnostics 完善 |
| `handlers/injection-handlers.ts` | 652 | 6 | 15 | 裸 as 集中区，有重复辅助函数 |
| `handlers/process-management.ts` | 595 | 0 | 12 | 与 handlers.base.process.ts 重复 |
| `handlers.base.process.ts` | 519 | 0 | 13 | 已弃用，与 process-management.ts 重复 |
| `handlers.base.types.ts` | 121 | 0 | 0 | 验证函数缺少工具名上下文 |
| `handlers.base.ts` | 74 | 0 | 0 | 旧代码路径，应迁移 |
| `handlers/shared-types.ts` | 41 | 0 | 0 | 接口定义，干净 |
| `handlers/expression-validator.ts` | 208 | 0 | 1 | 安全验证，合理 |
| `handlers.impl.ts` | 176 | 0 | 0 | 组合 facade，干净 |

### Re-export 桩（仅链路）

| 文件 | 行数 | 实质内容 |
|------|------|---------|
| `handlers.impl.core.runtime.base.ts` | 4 | re-export |
| `handlers.impl.core.runtime.inject.ts` | 3 | re-export |
| `handlers.impl.core.runtime.memory.ts` | 3 | re-export |
| `handlers.impl.core.runtime.ts` | 3 | re-export |
| `handlers.impl.core.ts` | 3 | re-export |
| `handlers.ts` | 12 | re-export barrel |

---

## 附录 B：memory-operations.ts 参数解析现状（正面案例）

memory-operations.ts 是 process 域中最接近军工级标准的文件——所有 args 访问均通过严格验证的辅助函数，无裸 as，错误消息带字段名，encoding 枚举有校验，read/write/scan 有完整审计。唯一的差距是缺少 hex 地址格式校验和工具名上下文。

```
handleMemoryRead:  resolvePid ✓, requireString(address) ✓, requirePositiveNumber(size) ✓, audit ✓
handleMemoryWrite:  resolvePid ✓, requireString(address) ✓, requireString(data) ✓, 
                    normalizeEncoding ✓, audit ✓
handleMemoryScan:   resolvePid ✓, requireString(pattern) ✓, normalizePatternType ✓, audit ✓
handleMemoryAuditExport:  clear via ===true ✓, audit ✓
handleMemoryCheckProtection: resolvePid ✓, requireString(address) ✓, NO audit ✗
handleMemoryScanFiltered:    resolvePid ✓, requireString(pattern) ✓, normalizePatternType ✓, 
                              requireStringArray ✓, NO audit ✗, NO diagnostics ✗
handleMemoryBatchWrite:      resolvePid ✓, requirePatches ✓, normalizeEncoding ✓, 
                              NO audit ✗, NO diagnostics ✗
handleMemoryDumpRegion:      resolvePid ✓, requireString(address) ✓, requirePositiveNumber(size) ✓, 
                              requireString(outputPath) ✓, NO audit ✗
handleMemoryListRegions:     resolvePid ✓, NO audit ✗ (只读，可接受)
```
