# trace+protocol-analysis+sourcemap+syscall-hook 域军工级审计报告

> 审查日期：2026-06-20 | 审查范围：6 个 handler 文件 ~2,200 行 | 基准：memory 域 2026-06-20 增强标准

---

## 1. 概况

| 指标 | trace | prot-ip | prot-link | prot-pcap | sourcemap | syscall |
|------|-------|---------|-----------|-----------|-----------|---------|
| 行数 | 593 | 213 | 134 | 131 | 704 | 479 |
| 裸 `as` (args 提取) | **27** | 0 | **2** | 0 | **2** | 0 |
| 裸 `as` (DB row) | **14** | 0 | 0 | 0 | 0 | 0 |
| 使用 parse-args | 1 处 (argEnum) | 0 | 0 | 0 | 0 | 0 |
| 手写 validator | handler-utils.ts | 共享 parseXxx | 共享 parseXxx | 共享 parseXxx | shared.ts | 内联 readXxx |
| 使用 ToolError | Y | N | N | N | N | N |
| 使用 handleSafe / R.fail() | 部分 (R) | N | N | N | fail() helper | N |
| try/catch 块 | 1 catch + 6 finally | 2 catch | 2 catch | 2 catch | 6 catch | 2 catch |
| 审计接入 | N | N | N | N | N | N |
| 特定安全风险 | SQL 注入 | N | N | N | 路径穿越 | 模板注入 |
| 测试文件数 | 5 | 3 | shared | shared | 9 | 3 |

---

## 2. Critical 级别（必须修）

### 2.1 trace: SQL 注入 — 用户输入直接拼接 SQL

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.ts:209-211` | `eventTimeExpr` (用户控制 `timeDomain`) 直接拼入 SELECT |
| `handlers.ts:218-219` | `timestamp` (用户输入 number) 直接拼入 SELECT -- `WHERE timestamp <= ${timestamp}` |
| `handlers.ts:232-237` | 同上，network query 分支 |
| `handlers.ts:243-245` | 同上，heap snapshot query 分支 |
| `handlers.ts:375-378` | `snapshotId1`/`snapshotId2` 直接拼入 SQL |

**攻击面**：虽然 `timestamp` 和 `snapshotId1` 的 typo schema 声明为 `number`，但 handler 用 `as number` 裸提取，无运行时校验。若 MCP 客户端传入字符串 `"100; DROP TABLE events--"`，裸 `as` 不会阻止，直接进 SQL。

**修法建议**：
```typescript
// 替代: const timestamp = args['timestamp'] as number;
const timestamp = argNumberRequired(args, 'timestamp');
if (!Number.isFinite(timestamp) || timestamp < 0) {
  throw new ToolError('VALIDATION', 'seek_to_timestamp: timestamp must be a finite non-negative number');
}
```

### 2.2 trace: 文件写入路径无校验

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.ts:456-504` | `outputPath` 直接传入 `writeFile`，无路径穿越/sandbox 校验 |

**修法建议**：在 `writeFile` 前校验 `outputPath` 是否为绝对路径、是否在允许的 output 目录下。

### 2.3 sourcemap: 文件写入路径无校验

| 文件:行号 | 问题 |
|-----------|------|
| `sourcemap-handlers.ts:299-308` | `outputDir` 用户输入直接传入 `mkdir` + `resolve` |
| `sourcemap-handlers.ts:322` | `resolve(outputRoot, relativePath)` — `relativePath` 来自 sourcemap 的 `sources` 数组，若 sourcemap 含 `../../../etc/passwd` 则可路径穿越 |

**修法建议**：
```typescript
// 在 resolve 之后校验
const resolved = resolve(outputRoot, relativePath);
if (!resolved.startsWith(outputRoot)) {
  skippedFiles += 1; // or throw
  continue;
}
```

### 2.4 syscall-hook: bpftrace 脚本模板注入

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.impl.ts:395-396` | `targetSyscalls` 直接拼入 bpftrace template: `tracepoint:syscalls:sys_enter_${sc}` |
| `handlers.impl.ts:402-448` | script template 中多处 `${pid}`、`${durationSec}`、`${targetSyscalls.join(', ')}` 拼入 shell 脚本 |

虽然有 `isValidSyscallName` 校验在 `316-323`，但 bpftrace 脚本输出中包含 `script.replace(/'/g, "'\\''")` (line 460)，仍不够稳健。若未来新增 syscall 名绕过 regex，可注入 bpftrace 指令。

**修法建议**：在 bpftrace 脚本构建处额外做一次 syscall name 白名单校验；pid/duration 用 `Number.isInteger` + 范围检查后再拼入。

---

## 3. High 级别（应该修）

### 3.1 trace: 27 处裸 `as` 参数提取

| 文件:行号 | 代码 |
|-----------|------|
| `54-59` | `args['cdpDomains'] as string[] \| undefined` ×6 |
| `142` | `args['sql'] as string` |
| `143, 183, 295, 363, 456, 457, 523` | `args['dbPath'] as string \| undefined` ×7 |
| `182` | `args['timestamp'] as number` |
| `184` | `args['windowMs'] as number` |
| `361, 362` | `args['snapshotId1/2'] as number` ×2 |
| `392, 393` | `snapXRow['summary'] as string` ×2 |
| `395, 396` | `summaryX['objectCounts'] as Record<string, number>` ×2 |
| `422, 423` | `summaryX['totalSize'] as number` ×2 |
| `473-476` | `row[0] as number` ×4 (export_trace) |
| `544-549` | `row[0..5] as number/string` ×6 (summarize_trace) |
| `556-561` | `row[0..5] as number/string` ×6 (summarize_trace deltas) |

**修法建议**：
- args 提取：`argString`, `argNumber`, `argBool`, `argStringArray` from `parse-args`
- enum: `argEnum(args, 'timeDomain', new Set(['wall', 'monotonic']), 'wall')`
- DB row access：已有 `rowToObject` 模式可用；row 级别的 `as` 可替换为 `typeof row[n] === 'number' ? row[n] : 0` 保护式

### 3.2 trace: 1 处 reflexive try/catch

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.ts:67-77` | `try { ... createCDPSession() ... } catch { /* silent */ }` — 吞掉所有异常，包括意外错误 |

**修法建议**：
```typescript
let cdpSession: CDPSessionLike | null = null;
if (this.ctx.collector) {
  const page = await this.ctx.collector.getActivePage();
  if (page) {
    try {
      const pageAny = page as { createCDPSession?: () => Promise<CDPSessionLike> };
      if (typeof pageAny.createCDPSession === 'function') {
        cdpSession = await pageAny.createCDPSession();
      }
    } catch (err) {
      // Log but don't fail — CDP recording is optional
      void this.ctx.eventBus?.emit('trace:cdp_session_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```

### 3.3 protocol-analysis: 6 处 reflexive try/catch — 全函数包裹

| 文件:行号 | 函数 | 问题 |
|-----------|------|------|
| `ip-packet-handlers.ts:31-143` | `handleRawIpPacketBuild` | 全函数 try/catch，返回 `{ success: false, error }` |
| `ip-packet-handlers.ts:158-210` | `handleIcmpEchoBuild` | 同上 |
| `link-layer-handlers.ts:30-62` | `handleEthernetFrameBuild` | 同上 |
| `link-layer-handlers.ts:76-132` | `handleArpBuild` | 同上 |
| `pcap-handlers.ts:36-81` | `handlePcapWrite` | 同上 |
| `pcap-handlers.ts:91-121` | `handlePcapRead` | 同上 |

**核心问题**：每一处都是整个函数体包在 `try { ... } catch (error) { return { success: false, error } }` 里。这是 "inline error return" 反模式，违反 `handleSafe` 原则。正确做法：用 `handleSafe` 或 `R.fail()` + throw `ToolError`。

**修法建议**：将这 6 个 handler 改为 throw-on-error 模式，由调用方 `handleSafe` 统一捕获。现有的自定义 `parseXxx` helpers 已经正确 throw，只需删除 wrapping try/catch。

### 3.4 protocol-analysis: link-layer — 2 处裸 `as`

| 文件:行号 | 代码 | 问题 |
|-----------|------|------|
| `link-layer-handlers.ts:115` | `args.senderIp as string` | 重新断言 parseIpv4Address 已验证过的值 |
| `link-layer-handlers.ts:117` | `args.targetIp as string` | 同上 |

**修法建议**：直接使用 `senderIp` / `targetIp` 的 Buffer 表示，或在 parseIpv4Address 中同时返回 string 形式。

### 3.5 sourcemap: 2 处裸 `as`

| 文件:行号 | 代码 | 严重度 |
|-----------|------|--------|
| `sourcemap-handlers.ts:61` | `as unknown as CdpSessionLike` | Low — 必要的 CDP bridge |
| `sourcemap-handlers.ts:143` | `parsed.map.sourcesContent as Array<string \| null>` | Medium — 类型断言无运行时校验 |

### 3.6 trace: 无审计接入

| 操作 | 审计信号 |
|------|---------|
| `trace_recording:start` | 记录开始时间/sessionId/config |
| `trace_recording:stop` | 记录 eventCount/networkCount/duration |
| `export_trace` | **破坏性** — 写文件到磁盘，需审计路径/大小 |
| `query_trace_sql` | 记录 SQL 语句（安审需求） |

**修法建议**：参照 `MemoryAuditTrail` 模式，在 trace 域新增 `TraceAuditTrail`，注入 TraceToolHandlers ctor，记录 recording lifecycle + export + SQL 查询。

### 3.7 sourcemap: 未使用 parse-args

sourcemap 域有自定义的 `shared.ts` 中的 `requiredStringArg`、`optionalStringArg`、`parseBooleanArg`，功能等价于 parse-args 的 `argStringRequired`、`argString`、`argBool`。不一致的 helper 位置增加维护负担。

### 3.8 syscall-hook: Error 返回模式不兼容 handleSafe

syscall-hook 使用 `{ ok: false, error: '...' }` 内联错误返回（lines 145-148, 186-191, 204-207 等），而非 throw ToolError + handleSafe 捕获。与 memory 域增强后的标准不一致。

---

## 4. Medium 级别（建议修）

### 4.1 trace: 3 处 `as` 在枚举分支上漏校验

| 文件:行号 | 代码 | 问题 |
|-----------|------|------|
| `handlers.ts:185` | `(args['timeDomain'] as 'wall' \| 'monotonic' \| undefined) ?? 'wall'` | 任意字符串会通过，不是 'wall'/'monotonic' 时行为未定义 |
| `handlers.ts:522` | `(args['detail'] as SummaryDetail) ?? 'balanced'` | 同上，任意字符串通过 |

**修法建议**：
```typescript
const timeDomain = argEnum(args, 'timeDomain', new Set(['wall', 'monotonic']), 'wall');
```

### 4.2 trace: handleExportTrace — DB row 映射非原子

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.ts:472-492` | `allEvents.rows.map(row => { ... row[0] as number ... })` — 14 行裸 row 访问，无类型保护 |

**修法建议**：复用已有的 `rowToObject` utility 替代裸 row 下标。

### 4.3 trace: handleSummarizeTrace — 同上

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.ts:543-550` | events row 映射 6 行裸 `as` |
| `handlers.ts:555-562` | deltas row 映射 6 行裸 `as` |

### 4.4 sourcemap: handleSourcemapLookup — Number() 静默 NaN

| 文件:行号 | 代码 |
|-----------|------|
| `sourcemap-handlers.ts:240-241` | `const line = Number(args.line); const column = Number(args.column);` |

`Number(undefined)` → `NaN`, `Number('abc')` → `NaN`。后续 `!Number.isInteger(line)` 检查能捕获，但错误消息不如直接用 `argNumberRequired` 清晰。

### 4.5 sourcemap: handleSourcemapCoverage — 无 sourceMapUrl req 校验分离

| 文件:行号 | 问题 |
|-----------|------|
| `sourcemap-handlers.ts:151-233` | `handleSourcemapCoverage` 不是工具定义中的函数名？需确认是否映射到正确的 handler。 |

### 4.6 protocol-analysis: 共享 helpers 与 parse-args 重复

`parseNonNegativeInteger`, `parsePositiveInteger`, `parseByte`, `parseEncoding` 等存在于 `handlers/shared/payload/core.ts`，功能与 `argNumber` + 内联范围检查等价。

### 4.7 syscall-hook: PID 校验不一致

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.impl.ts:153-160` | handleSyscallStartMonitor: pid 校验逻辑好 |
| `handlers.impl.ts:298-302` | handleSyscallEbpfTrace: **重复了同一段 pid 校验** — 应提取为 `validatePidArg(args, toolName)` |

### 4.8 syscall-hook: handleSyscallFilter 中 `names` 和 `filter` 的语义重复

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.impl.ts:255-278` | `handleSyscallFilter` 使用 `captureEvents({ name: names })`，但 `handleSyscallCaptureEvents` 使用 `readFilter(args['filter'])` — 两个接口对同一概念的命名不一致 |

---

## 5. Low 级别（可选修）

### 5.1 protocol-analysis: Error 消息不含工具名

| 文件:行号 | 示例 |
|-----------|------|
| `ip-packet-handlers.ts:37-38` | `'dscp must be between 0 and 63'` |
| `ip-packet-handlers.ts:40-41` | `'ecn must be between 0 and 3'` |
| `ip-packet-handlers.ts:55-56` | `'identification must be between 0 and 65535'` |
| `link-layer-handlers.ts:38-39` | `'packets must be an array'` |
| `pcap-handlers.ts:126-127` | `'path must be a non-empty string'` |

**修法建议**：在所有 `throw new Error(...)` 前加工具名前缀，使 MCP 客户端/日志能快速定位失败的 handler。

### 5.2 trace: handleStartTraceRecording — dbPath 无返回值透传

| 文件:行号 | 问题 |
|-----------|------|
| `handlers.ts:91-104` | 返回 `sessionId` + `dbPath`，但 `sessionId` 是内部标识，`dbPath` 是文件路径 — 若泄露到 multi-tenant 环境有信息暴露风险 |

### 5.3 syscall-hook: 模拟数据无明确可区分离线标记

| 文件:行号 | 代码 | 评价 |
|-----------|------|------|
| `handlers.impl.ts:362-363` | `_simulated: true, simulated: true` | 已有 watermark，good |

### 5.4 sourcemap: `handleSourcemapFetchAndParse` — sourcesContent 无长度限制

| 文件:行号 | 问题 |
|-----------|------|
| `sourcemap-handlers.ts:131-148` | sourcesContent 可能极长（内联 sourcemap），响应无裁剪，可能导致 context 溢出 |

---

## 6. 重构估算

### 6.1 trace 域

| 任务 | 预计改动 (行) | 预计工时 |
|------|-------------|---------|
| 替换 27 处裸 `as` → parse-args | ~80 行改 | 2h |
| SQL 注入修复 (timestamp/snapshotId → 参数化) | ~30 行改 | 1h |
| 替换 row[] 裸 as → rowToObject/type-guard | ~40 行改 | 1h |
| 删除 reflexive try/catch (line 67-77) | ~15 行改 | 0.5h |
| 新增 TraceAuditTrail + 注入 | ~60 行新 | 1.5h |
| 新增 trace handlers/validation.ts | ~40 行新 | 0.5h |
| 测试补充 (rejection + audit assertions) | ~100 行 | 2h |
| **合计** | ~365 行 | **8.5h** |

### 6.2 protocol-analysis 域

| 任务 | 预计改动 (行) | 预计工时 |
|------|-------------|---------|
| 删除 6 处 reflexive try/catch → handleSafe | ~80 行改 | 1.5h |
| Error 消息加工具名前缀 | ~15 行改 | 0.5h |
| 2 处裸 `as` 替换 | ~5 行改 | 0.3h |
| 审计接入 (raw_ip_packet_build 事件记录) | ~30 行新 | 1h |
| 测试补充 | ~100 行 | 2h |
| **合计** | ~230 行 | **5.3h** |

### 6.3 sourcemap 域

| 任务 | 预计改动 (行) | 预计工时 |
|------|-------------|---------|
| 路径穿越修复 (resolve prefix check) | ~8 行改 | 0.5h |
| 2 处裸 `as` 替换 | ~5 行改 | 0.3h |
| 切换到 parse-args (opt-in) | ~20 行改 | 0.5h |
| sourcesContent 长度限制 | ~10 行改 | 0.3h |
| 审计接入 (reconstruct_tree 文件写入) | ~25 行新 | 1h |
| 测试补充 | ~80 行 | 1.5h |
| **合计** | ~148 行 | **4.1h** |

### 6.4 syscall-hook 域

| 任务 | 预计改动 (行) | 预计工时 |
|------|-------------|---------|
| 切换到 throw-on-error + handleSafe | ~60 行改 | 1.5h |
| bpftrace 模板注入额外防护 | ~10 行改 | 0.5h |
| PID 校验去重 (提取 validatePidArg) | ~15 行改 | 0.3h |
| 审计接入 (syscall monitor start/stop) | ~25 行新 | 1h |
| 测试补充 | ~80 行 | 1.5h |
| **合计** | ~190 行 | **4.8h** |

### 总计

| 域 | 工时 |
|----|------|
| trace | 8.5h |
| protocol-analysis | 5.3h |
| sourcemap | 4.1h |
| syscall-hook | 4.8h |
| **合计** | **22.7h (~3 工作日)** |

---

## 7. memory pattern 适用性分析

### 可直接复用的 memory/validation.ts helpers

| Helper | trace | prot-ip | prot-link | prot-pcap | sourcemap | syscall |
|--------|-------|---------|-----------|-----------|-----------|---------|
| `validateHexAddress` | N (无 hex addr) | N (有 parseHexPayload) | N | N | N | N |
| `validateBytesArray` | N | N | N | N | N | N |
| `requireStringArg` | Y (sql, dbPath, outputPath) | N (已有 parseXxx) | N | Y (parseRequiredPath) | Y (替代 requiredStringArg) | N (已有 readString) |
| `requirePositiveNumberArg` | Y (timestamp, snapshotId1/2) | N | N | N | N | N |
| `requirePositiveIntArg` | Y (snapshotId1/2, chunkLimit) | N | N | N | N | N |
| `parseJsonArg` | N (safeParseJSON 已存在) | N | N | N | N | N |

### memory 增强模式映射

| memory 模式 | trace 适用 | prot 适用 | sourcemap 适用 | syscall 适用 |
|------------|----------|----------|---------------|-------------|
| parse-args 替换裸 as | Y (27处) | 部分 (2处) | Y (opt-in) | 已有 (OK) |
| handleSafe wrapping | Y (已有R) | Y (替换try/catch) | 已有 (fail helper) | Y (替换{ok:false}) |
| AuditTrail 注入 | Y (recording/export/SQL) | Y (raw packet ops) | Y (file writes) | Y (monitor lifecycle) |
| validation.ts 共享 | Y (新增) | N (自有helpers) | N (自有helpers) | N (自有helpers) |
| ToolError/PrerequisiteError | Y (已用) | N (需引入) | N (需引入) | N (需引入) |

### 关键差异

1. **protocol-analysis 域**的自定义 `parseXxx` helpers 已经较成熟（27 个 parse helpers），不需要全部替换为 parse-args。但需**添加工具名前缀到 error 消息** + **删除 wrapping try/catch**。

2. **syscall-hook 域**已有 `readXxx` 类型安全 helpers（readNumber, readString, readBoolean, readStringArray, readBackend, readFilter, isSyscallEvent），实际上**已实现了解析安全**。唯二的问题：(a) 内联 error return 模式不是 throw-on-error，(b) 无审计。

3. **trace 域**问题最严重：SQL 注入 + 27 裸 as + 无审计。应作为最高优先级。

---

## 8. 测试现状

| 域 | 测试文件 | 关键测试 | 缺失 |
|----|---------|---------|------|
| trace | `handlers.test.ts` (101 个 test/it) | 基础 handler 功能 | 无 rejection 测试、无 SQL 注入防护测试、无审计断言 |
| prot-analysis | `handlers.test.ts` (676 行) | handler 功能 | 无 error-message-format 测试、无 reflexive-catch 验证 |
| sourcemap | `handlers.test.ts` (522 行) + `v4-scope-decode.test.ts` | VLQ 解码、discover/parse 核心路径 | 无路径穿越测试、无 sourcesContent 溢出测试 |
| syscall-hook | `handlers.test.ts` (88 行) + `handlers.coverage.test.ts` (774 行) | 边界覆盖充分 | 无 bpftrace 注入测试、无审计断言 |

**memory 域增强后测试增长参考**：530→611 (+81: 29 validation + 52 rejection/audit)。预期 4 域合计需 +200-300 测试。

---

## 9. 风险矩阵汇总

| 风险 | 域 | 严重度 | 利用条件 | 影响 |
|------|----|--------|---------|------|
| SQL 注入 | trace | Critical | MCP 客户端传入非 number 到 timestamp/snapshotId | 数据泄露/损坏 |
| 路径穿越 | trace | Critical | outputPath 参数可控 | 任意文件写入 |
| 路径穿越 | sourcemap | Critical | 恶意 sourcemap (sources 数组含 ../) | 任意文件写入 |
| bpftrace 注入 | syscall | High | syscall 名绕过 regex | 特权指令执行 |
| 异常吞没 | trace | Medium | CDP 连接失败 | 静默降级（设计如此，但应记录） |
| 无审计 | 全部 | Medium | — | 无法追溯操作来源 |
| 错误消息无工具名 | prot | Low | — | 调试困难 |

---

## 10. 推荐实施顺序

```
Phase 1 (Critical): trace SQL 注入 + 路径穿越修复 (3h)
Phase 2 (Critical): sourcemap 路径穿越修复 (0.5h)
Phase 3 (High):     trace 裸 as 全替换 (2h)
Phase 4 (High):     prot try/catch → throw-on-error (1.5h)
Phase 5 (High):     syscall bpftrace 模板加固 (0.5h)
Phase 6 (High):     全域审计接入 (4h)
Phase 7 (Medium):   错误消息标准化 + 测试补充 (4h)
Phase 8 (Low):      代码整洁 + 去重 (2h)
                   = 17.5h
```
