# network 域军工级审计报告

> 审查日期: 2026-06-20 | 审查人: Claude Opus 4.8 | 范围: 8 核心文件 + 关联继承链
> 原则: 只读不改, 每发现带文件+行号, 归类 Critical/High/Medium/Low

---

## 概况

| 维度 | 数据 |
|------|------|
| 审查文件数 | 13 (8 核心 + 5 辅助) |
| 裸 `as` 总数 | ~66 (含 `as unknown as Record<...>`) |
| `args['x'] as T` 模式 | 15 (全部集中在 tls-bot-handlers.ts) |
| 其他 `args.x as T` | ~28 (replay 12 + old-runtime-replay 12 + intercept 3 + base.core 5) |
| `try/catch` 块数 | 37 (含 11 个 DNS 子处理器 + 5 latency + 2 http2 + others) |
| 已用 `handleSafe` 的 handler | ~18 (提升空间: ~12 仍用裸 try/catch) |
| 已用 `parse-args` (argNumber/argEnum/...) | ~22 处 (提升空间: ~50) |
| 测试文件数 | 37 (~12,600 行) |
| 审计接入 | 无 (memory 域有 MemoryAuditTrail, network 域无等价物) |

### 审计等级分类

| 等级 | 数量 | 主要分布 |
|------|------|---------|
| Critical | 2 | replay authorization 包绕过, 输出路径符号链接竞态 |
| High | 9 | tls-bot 全裸 as 参数注入, latency enum 缺校验, 重复代码 divergence |
| Medium | 18 | DNS 裸 enum cast, intercept args 裸 as, 未使用 handleSafe |
| Low | 14 | R.merge 适配 as, request/response 内联类型适配 |

---

## Critical

### C1. replay-handlers.ts:219-221 — 输出路径 TOCTOU (符号链接绕过)

**文件**: `src/server/domains/network/handlers/replay-handlers.ts`
**行号**: 219-221 (及 `handlers.impl.core.runtime.replay.ts:204-206`)

```typescript
// 当前: lstat 检查符号链接, 但 check 和 write 之间无锁
if (resolvedOutputPath) {
  try {
    const stat = await fs.lstat(resolvedOutputPath);
    if (stat.isSymbolicLink()) {
      return R.fail('outputPath must not be a symbolic link.').json();
    }
  } catch {
    // File doesn't exist yet
  }
  await fs.writeFile(resolvedOutputPath, JSON.stringify(har, null, 2), 'utf-8');  // ← race window
```

**问题**: lstat 和 writeFile 之间存在 TOCTOU 竞态窗口。攻击者可在此窗口内替换目标路径为符号链接, 绕过检查写入任意位置。

**修法**: 使用 `fs.open(path, O_WRONLY|O_CREAT|O_NOFOLLOW, mode)` 原子化打开+写, 或 check → open(fd) → write 在同一 fd 上操作。

**影响**: 任意文件写入 (限制在 CWD 或 tmp 内, 但 tmp 可跨越)

**重复出现**: `handlers.impl.core.runtime.replay.ts:241-251` (相同代码, 相同 bug)

---

### C2. handlers.impl.core.runtime.replay.ts:297-310 — Replay SSRF 绕过 (bodyPatch 无校验)

**文件**: `src/server/domains/network/handlers.impl.core.runtime.replay.ts` (及 replay-handlers.ts 同结构)
**行号**: 297-310

```typescript
return handleSafe(async () => {
  const authorization = parseReplayAuthorization(args, requestId);
  const result = await replayRequest(base, {
    requestId,
    headerPatch: args.headerPatch as Record<string, string> | undefined,  // 裸 as, 无校验
    sessionProfile: args.sessionProfile as SessionProfile | undefined,    // 裸 as, 无校验
    bodyPatch: args.bodyPatch as string | undefined,                      // 裸 as, 无校验
    methodOverride: args.methodOverride as string | undefined,            // 裸 as, 无校验
    urlOverride: args.urlOverride as string | undefined,                  // 裸 as, 无校验
    timeoutMs: args.timeoutMs as number | undefined,                      // 裸 as, 无校验
    dryRun: args.dryRun !== false,
    authorization,
  });
  return result as unknown as Record<string, unknown>;
});
```

**问题**:
- `urlOverride` 裸 as string: 攻击者可注入任意 URL, 若未传 authorization 或 authorization 覆盖不全, replay 会发请求到攻击者控制的主机
- `headerPatch` 裸 as Record<string, string>: 可注入 `Host`/`X-Forwarded-For` 等头绕过 SSRF
- `timeoutMs` 裸 as number: NaN/负数可能导致无限挂起

**修法**: 
1. `urlOverride` 必须过 `resolveAuthorizedTransportTarget`
2. `headerPatch` 必须过滤禁止头 (Host, X-Forwarded-*, etc.)
3. `timeoutMs` 必须 `argNumber` 带 min/max 限制
4. `methodOverride` 必须 enum 校验合法 HTTP method

**重复出现**: `replay-handlers.ts:311-325` (相同代码)

---

## High

### H1. tls-bot-handlers.ts:17-87 — 全参数裸 as, 15 处, 无 parse-args

**文件**: `src/server/domains/network/handlers/tls-bot-handlers.ts`
**行号**: 17, 27-30, 32-34, 38, 82-87, 122, 146

```typescript
// 全部是 args['x'] as T 模式:
const mode = args['mode'] as string;                              // L17
const tlsVersions = (args['tlsVersions'] as string[]) || [];     // L27
const ciphers = (args['ciphers'] as string[]) || [];             // L28
const protocol = (args['protocol'] as string) === 'quic' ...    // L32-36
const headers = (args['httpHeaders'] as string[]) || [];         // L82
const requestId = args['requestId'] as string;                   // L122
const secDetails = (req as unknown as Record<string, unknown>)   // L146,237
  ['securityDetails'] as Record<string, unknown> | undefined;
```

**问题**: 全文件零使用 parse-args 工具。如果 MCP SDK 序列化了 number→string, 所有 `as string[]` 的数组断言都将失败并返回空数组 (静默降级), 用户无感知。

**修法**:
- `mode` → `argEnum(args, 'mode', new Set(['compute_tls','compute_http','analyze_request']))`
- 所有 `as string[]` → `argStringArray(args, key)`
- `requestId` → `argStringRequired(args, 'requestId')`
- `protocol` → `argEnum(args, 'protocol', new Set(['tls','quic','dtls']), 'tls')`
- 总改动量: ~15 行替换, 新增 ~8 行导入

---

### H2. raw-latency-handlers.ts:39-41, 159-161 — probeType enum 自校验但缺 parse-args 集成

**文件**: `src/server/domains/network/handlers/raw-latency-handlers.ts`
**行号**: 39-41 (handleNetworkRttMeasure), 159-161 (handleNetworkLatencyStats)

```typescript
// L39-41: 自校验但用裸 as 断定类型
const probeType = (parseOptionalString(args.probeType, 'probeType') ?? 'tcp') as
  | 'tcp'
  | 'tls'
  | 'http';
if (!['tcp', 'tls', 'http'].includes(probeType)) {
  throw new Error('probeType must be one of: tcp, tls, http');
}
// ← 重复 checked 两次 (includes + as 断言重复)

// 应改为:
const PROBE_TYPES = new Set(['tcp', 'tls', 'http'] as const);
const probeType = argEnum(args, 'probeType', PROBE_TYPES, 'tcp');
```

**文件级问题**: `handleNetworkTraceroute` 和 `handleNetworkIcmpProbe` 的 `args.maxHops`/`args.timeout`/`args.packetSize` 用 `Number(args.x)` + `clamp()` 自校验, 但 `Number()` 不抛错, NaN 被 clamp 吞掉。应用 `argNumber` 带 min/max 参数。

**行号**: 135-141, 256-262

---

### H3. 重复代码: replay-handlers.ts 与 handlers.impl.core.runtime.replay.ts 完全重复

**文件**: 
- `src/server/domains/network/handlers/replay-handlers.ts` (331 行)
- `src/server/domains/network/handlers.impl.core.runtime.replay.ts` (312 行)

**问题**: 两个文件包含近乎完全相同的代码:
- `parseReplayAuthorization()` — 两个文件各有一份 (121 行重复)
- `decodeAuthorizationCapability()` — 两个文件各有一份 (33 行重复)
- `isReplayableRequest` / `parseStringArray` / `parseOptionalString` / `parseOptionalBoolean` — 两个文件各有一份
- `handleNetworkExtractAuth` / `handleNetworkExportHar` / `handleNetworkReplayRequest` — 相同的三个 handler

任何 bug 修复需要双倍工作, 且已观察到 divergence (C1 中 TOCTOU 双份, C2 中参数注入双份)。

**修法**: replay-handlers.ts 应该是新重构的版本 (使用 handleSafe, 从 AdvancedToolHandlersRuntime 提取), handlers.impl.core.runtime.replay.ts 应该被废弃并改为 re-export。但需要确认哪个是活跃的 handler 注册入口。

---

### H4. handlers.base.core.ts:258, 285 — R.merge(... as Record<string, unknown>) 绕过类型安全

**文件**: `src/server/domains/network/handlers.base.core.ts`
**行号**: 258, 285, 439 (及 handlers.impl.core.runtime.replay.ts:270,309; replay-handlers.ts:285,325; raw-dns-http-handlers.ts:276; raw-http2-handlers.ts:258; raw-latency-handlers.ts:146,267; intercept-handlers.ts:98)

```typescript
// 模式: R.ok().merge(result as unknown as Record<string, unknown>).json()
return R.ok()
  .merge(result as unknown as Record<string, unknown>)
  .json();
```

**问题**: 虽非安全漏洞, 但 `as unknown as Record<string, unknown>` 完全绕过 TypeScript 类型检查。若 result 包含循环引用或不可序列化对象, `JSON.stringify` 会抛错或产生意外输出。

**修法**: 用 `R.ok().json(result as Record<string, unknown>)` (R.ok().json 接受 generic), 或定义 explicit response 类型。优先级 Medium-Low, 但出现 14+ 次应整理。

---

### H5. intercept-handlers.ts:159 — 内部 toInterceptRule 裸 as string

**文件**: `src/server/domains/network/handlers/intercept-handlers.ts`
**行号**: 159, 165

```typescript
private toInterceptRule(source: Record<string, unknown>): InterceptRuleInput {
  return {
    urlPattern: source.urlPattern as string,  // ← 裸 as, 但 caller 已检查 typeof
    // ...
    responseHeaders: isObjectRecord(source.responseHeaders)
      ? (source.responseHeaders as Record<string, string>)  // ← 裸 as, 但已 guard
      : undefined,
```

**问题**: `source.urlPattern as string` 虽被 `parseInterceptRules` 的 `typeof rawRule.urlPattern === 'string'` 检查保护, 但防御性不够 — 若未来有人直接调用 `toInterceptRule` 跳过检查, 会注入非字符串 urlPattern。

**修法**: 将 `toInterceptRule` 收为 `parseInterceptRule` 并内置校验 (throw on invalid)。

---

### H6. raw-dns-http-handlers.ts — 11 个 try/catch 包裹全 handler, 含校验逻辑

**文件**: `src/server/domains/network/handlers/raw-dns-http-handlers.ts`
**行号**: 46-66, 69-82, 85-122, 125-176, 179-241, 244-281, 284-405

```typescript
async handleDnsResolve(args: Record<string, unknown>) {
  try {
    const hostname = parseOptionalString(args.hostname, 'hostname');
    // ... validation + doWork ...
    return R.ok().json({ ... });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return R.fail(`DNS resolve failed: ${message}`).json();  // ← 丢失工具名上下文
  }
}
```

**问题**: 
1. 校验错误和运行时错误混在同一 catch 块
2. 错误消息不带工具名 (compare memory 域的 `requireStringArg(value, fieldName, toolName)`)
3. DNS 操作本身就应该失败, 但 validate 的失败不应该包装成 "DNS resolve failed"

**修法**: 用 `handleSafe` 包裹, 校验在 handleSafe 外部做 (或校验抛 tool-named 错误)。

---

### H7. tls-bot-handlers.ts:199, 200 — botDetectAnalyze limit/includeDetails 裸类型

**文件**: `src/server/domains/network/handlers/tls-bot-handlers.ts`
**行号**: 199-200

```typescript
const limit = typeof args['limit'] === 'number' ? args['limit'] : BOT_DETECT_LIMIT_DEFAULT;
const includeDetails = args['includeDetails'] === true;
```

**问题**: `limit` 无 min/max 校验。传入 `-1` 会 slice(0, -1) = 截断最后一个元素; 传入超大值可能造成 huge 响应。

**修法**: `const limit = argNumber(args, 'limit', BOT_DETECT_LIMIT_DEFAULT)` + clamp min 1 max 500。

---

### H8. raw-http2-handlers.ts:50 — body 为 object 时用 JSON.stringify 但缺 try/catch

**文件**: `src/server/domains/network/handlers/raw-http2-handlers.ts`
**行号**: 50-52

```typescript
const bodyString =
  typeof rawBody === 'string' ? rawBody : bodyIsObject ? JSON.stringify(rawBody) : '';
```

**问题**: `JSON.stringify` 遇到循环引用或 BigInt 会抛 TypeError, 且不在 try/catch 内 (try 始于 line 31)。

**修法**: 包装 `JSON.stringify` 调用并抛 `body must be a string or JSON-serializable object`。

---

### H9. raw-latency-handlers.ts:308, 312 — createPinnedLookup 内部用 as 绕过 TS 类型

**文件**: `src/server/domains/network/handlers/raw-latency-handlers.ts`
**行号**: 306-312

```typescript
'all' in (optionsOrCallback as Record<string, unknown>) &&
(optionsOrCallback as { all?: boolean }).all
```

**问题**: Node.js `net.LookupFunction` 的 options 参数类型是 union, TS 需要 narrowing。当前用 `as` 绕过, 但如果未来 Node 改了类型签名, 静默错误。

**修法**: 写 proper type guard: `isLookupAllOptions(optionsOrCallback): optionsOrCallback is { all: boolean }`。

---

## Medium

### M1. handlers.base.core.ts:57, 64 — argBool/argNumber wrapper 用 {value} as Record

**文件**: `src/server/domains/network/handlers.base.core.ts`
**行号**: 57, 64

```typescript
protected parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
  return argBool({ value } as Record<string, unknown>, 'value', defaultValue);  // ← 无意义的 as
}
protected parseNumberArg(value: unknown, options: {...}): number {
  const raw = argNumber({ value } as Record<string, unknown>, 'value', options.defaultValue);
  // ...
}
```

**问题**: 这些是基类 wrapper, 但 `argBool`/`argNumber` 直接接受对应类型, 不需要 `{value} as Record<string, unknown>` 的包装。

**修法**: 
```typescript
protected parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}
```
`parse-args` 的 `argBool` 已经做了这个检查, 基类 wrapper 是多余的一层。

---

### M2. handlers.impl.core.runtime.intercept.ts — 3 处裸 as, 与 intercept-handlers.ts 重复

**文件**: `src/server/domains/network/handlers.impl.core.runtime.intercept.ts`
**行号**: 39, 59, 133

与 `intercept-handlers.ts` 相同代码相同问题 (H5)。`handlers.impl.core.runtime.intercept.ts` 是旧文件, `intercept-handlers.ts` 是重构后的新文件。应废弃旧文件。

---

### M3. raw-dns-http-handlers.ts:52, 91, 188 — rrType as (typeof DNS_RR_TYPES)[number] + as never

**文件**: `src/server/domains/network/handlers/raw-dns-http-handlers.ts`
**行号**: 52, 91, 188

```typescript
if (!DNS_RR_TYPES.includes(rrType as (typeof DNS_RR_TYPES)[number])) { ... }
// 和:
const records = await dns.resolve(hostname, rrType as never);
```

**问题**: `as (typeof DNS_RR_TYPES)[number]` 是为了让 TS includes 检查通过, 但这是 self-validated (先检查再 as never 调用 dns.resolve)。可以更干净:

```typescript
const DNS_RR_TYPE_SET = new Set(DNS_RR_TYPES);
const rrType = argEnum(args, 'rrType', DNS_RR_TYPE_SET, 'A');
```

这样 `dns.resolve(hostname, rrType as never)` 的 `as never` 可以保留 (因为 node:dns 类型定义不认 string union)。

---

### M4. raw-helpers.ts:98, 147 — parseNetworkAuthorization 内部 as Record

**文件**: `src/server/domains/network/handlers/raw-helpers.ts` (L98), `raw-runtime-helpers.ts` (L147)
**行号**: 98, 147

```typescript
const record = value as Record<string, unknown>;
```

**问题**: 已通过 `typeof value !== 'object'` 检查后才 as, 但更好用类型 guard + early return。

---

### M5. handlers.base.core.ts:364, 367 — 运行时 mutation 用裸 as

**文件**: `src/server/domains/network/handlers.base.core.ts`
**行号**: 364, 367

```typescript
(req as Record<string, unknown>).securityDetails = resp.securityDetails;
(req as Record<string, unknown>).serverAddr = resp.remoteAddress;
```

**问题**: 请求对象 `NetworkRequestPayload` 有 `[key: string]: unknown` 索引签名 (见 L46 of types), 所以不需要 `as Record<string, unknown>`。直接用 `req.securityDetails = ...` 即可。

---

### M6. raw-dns-http-handlers.ts — httpVersion as '1.0' | '1.1' | undefined 裸 as

**文件**: `src/server/domains/network/handlers/raw-dns-http-handlers.ts`
**行号**: 260-262

```typescript
httpVersion:
  (parseOptionalString(args.httpVersion, 'httpVersion') as '1.0' | '1.1' | undefined) ??
  '1.1',
```

**问题**: 无校验直接 as。应改用 `argEnum` 或至少检查值 ∈ {'1.0', '1.1'}。

---

### M7. handlers.base.ts:77, 88 — R 返回用 as Record 适配

**文件**: `src/server/domains/network/handlers.base.ts`
**行号**: 77, 88

```typescript
return { message: 'Injected buffers cleared', ...(result as Record<string, unknown>) };
```

**问题**: `consoleMonitor.clearInjectedBuffers()` 返回值类型未知, 展开到 response。可用 `R.ok().merge(result as Record<string, unknown>).json()` 规范化。

---

### M8-M14. 其他 Low-severity as 模式

见 Low 分类。

---

## Low

### L1-L14. 类型适配 / R.merge 桥接 as

14 处 `as unknown as Record<string, unknown>` 或 `as Record<string, unknown>` 用于:
- `.merge(result as unknown as Record<string, unknown>)` — 8 处 (跨越多个文件)
- `(value as Record<string, unknown>).property` — 6 处

这些是 TypeScript strict 模式下的类型适配, 无运行时安全影响。批量改为 explicit typed response 可消除, 但优先级最低。

---

## 重构工作估算

| 优先级 | 文件 | 改动类型 | 人时 | 风险 |
|--------|------|---------|------|------|
| **Phase 1: Critical** | replay-handlers.ts + handlers.impl.core.runtime.replay.ts | C1 TOCTOU 修复 + C2 参数校验 | 3h | 中 (文件写入逻辑) |
| **Phase 2: High 消裸 as** | tls-bot-handlers.ts | H1: 15 处 args['x'] as T → parse-args | 2h | 低 (纯替换) |
| | raw-latency-handlers.ts | H2: probeType enum + Number→argNumber | 1.5h | 低 |
| | intercept-handlers.ts | H5: toInterceptRule 校验 | 0.5h | 低 |
| | raw-http2-handlers.ts | H8: JSON.stringify try/catch | 0.5h | 低 |
| | raw-dns-http-handlers.ts | H6, M3: handleSafe + argEnum | 2h | 中 (DNS 错误处理) |
| **Phase 3: 重复代码消除** | replay-handlers.ts vs handlers.impl.core.runtime.replay.ts | H3: 废弃旧文件, de-dupe | 3h | 中 (需确认注册入口) |
| | intercept-handlers.ts vs handlers.impl.core.runtime.intercept.ts | M2: 废弃旧文件 | 1h | 低 |
| **Phase 4: Medium + Low 整理** | handlers.base.core.ts, handlers.base.ts, raw-helpers.ts 等 | 6 处 Medium + 14 处 Low | 4h | 低 |
| **Phase 5: 测试增强** | 所有测试文件 | 新增 reject/invalid-input 测试 | 8h | 低 |
| **合计** | ~10 文件 | | ~25.5h | |

### 建议执行顺序

1. C1 + C2 (Critical first)
2. H1 (tls-bot 全文件重写参数解析 — top offender)
3. H3 (消除 replay 重复代码 — 减少后续维护成本)
4. H2 + H5 + H6 + H8 (剩余 High)
5. Medium + Low
6. 测试增强

---

## memory 域 pattern 适用性

### validation.ts 可复用函数

| memory/validation.ts 函数 | network 域适用场景 | 适用文件 |
|---------------------------|-------------------|---------|
| `requireStringArg(value, fieldName, toolName)` | requestId/hostname/url 必选参数 | replay, intercept, tls-bot, dns, latency |
| `requirePositiveIntArg(value, fieldName, toolName)` | limit/maxDepth/retries 正整数参数 | base.core, core-handlers |
| `requirePositiveNumberArg(value, fieldName, toolName)` | timeoutMs/maxBodyBytes 正数参数 | http2, latency, dns |
| `parseJsonArg<T>(value, fieldName, toolName)` | body/authorization JSON 参数 | http2, replay |
| `validateHexAddress` / `validateBytesArray` | 不适用 (network 域无 native memory) | — |

**建议**: 将 `requireStringArg`/`requirePositiveIntArg`/`requirePositiveNumberArg`/`parseJsonArg` 提升到 `src/server/domains/shared/parse-args.ts` 或新的 `shared/validation.ts`, 供所有域复用。当前这些是 memory 域私有函数。

### parse-args 覆盖数

| parse-args 函数 | network 域已用 | network 域未用/可替换 |
|----------------|---------------|---------------------|
| `argString` | ~8 处 | ~20 处 (tls-bot 15 + replay 5) |
| `argNumber` | ~18 处 (含 shared.ts 本地版) | ~8 处 (latency: maxHops/timeout/packetSize) |
| `argBool` | ~14 处 | ~3 处 |
| `argEnum` | 1 处 (performance coverage) | ~5 处 (probeType, httpVersion, mode, protocol, action) |
| `argStringArray` | 0 处 | ~6 处 (tlsVersions, ciphers, extensions, httpHeaders, etc.) |
| `argStringRequired` | 0 处 | ~4 处 (requestId, url, method, target) |
| `argObject` | 0 处 | ~2 处 (authorization, sessionProfile) |

**总计**: network 域约 50 处可用 parse-args 替换裸 as/自校验, 已用约 40 处 (含本地 shared.ts 版 parseNumberArg/parseBooleanArg)。

---

## 测试现状

### 测试覆盖概览

| 类别 | 测试文件 | 行数 | 覆盖 |
|------|---------|------|------|
| 基础模块测试 | definitions.test.ts, exports.test.ts, manifest.test.ts | 350 | 工具定义+导出 |
| 核心 handlers | runtime-base.test.ts, runtime-requests.test.ts, runtime-console.test.ts, runtime-performance.test.ts | 2,252 | enable/disable/status/requests/response/exceptions |
| 拦截+重放 | runtime-intercept.test.ts, runtime-replay.test.ts, replay.test.ts, replay-additional.test.ts, replay-handlers.coverage.test.ts, handlers.impl.core.runtime.replay.coverage.test.ts | 2,795 | intercept + replay 全量 |
| Raw handlers | runtime-raw.test.ts, raw-handlers.coverage.test.ts, raw-helpers.coverage.test.ts, raw-latency-ssrf-regression.test.ts, raw-latency-stats.test.ts, raw-dns-primitives.test.ts | 2,253 | HTTP2/DNS/RTT/latency/ICMP |
| TLS/指纹/加密 | tls-fingerprint.test.ts, har.test.ts, har-protocol.test.ts, har-protocol-integration.test.ts, har-normalize-protocol.test.ts | 1,894 | TLS fingerprint + HAR |
| SSRF 安全 | ssrf-policy.test.ts | 429 | 网络策略授权 |
| 认证提取 | auth-extractor.test.ts | 518 | auth token 提取 |
| HTTP raw | http-raw.test.ts, http2-raw.test.ts, request-merge.test.ts | 799 | HTTP/1.x + HTTP/2 raw |
| 重构后 coverage | core-handlers.coverage.test.ts, intercept-handlers.coverage.test.ts, console-handlers.coverage.test.ts, replay-handlers.coverage.test.ts, shared.coverage.test.ts | 1,073 | 新 handler 拆分后 coverage |
| **总计** | **37 文件** | **~12,363** | |

### 对比 memory 域增强模式

| 指标 | memory 域 (增强后) | network 域 (当前) |
|------|-------------------|-------------------|
| 总测试数 | ~1,298 (含 native+webgpu) | ~12,363 行 (但测试数未统计) |
| validation 专用测试 | 29 (handlers/validation.test.ts) | 0 (无 validation.ts) |
| per-handler reject 测试 | 52 | 少量 (见于 raw-latency-ssrf-regression.test.ts 177 行) |
| 审计测试 | audit trail assertions | 无 |
| 裸 as 替换率 | 100% | ~60% |
| handleSafe 采用率 | 100% (顶层) | ~60% |

### 缺失测试

1. **Invalid-input rejection tests**: memory 域有 52 个 per-handler 拒绝测试; network 域极少 (仅 SSRF regression 涵盖部分)
2. **TOCTOU 测试**: 输出路径符号链接竞态 (C1) 无测试
3. **tls-bot-handlers 拒绝测试**: 15 个裸 as 参数 + includeDetails 类型错误无测试
4. **replay authorizationCapability 测试**: base64url 解码失败/capability version mismatch/requestId mismatch 有测试? (需确认 coverage)
5. **urlRegex ReDoS 测试**: base.core.ts L318-331 有 ReDoS 守卫, 但测试覆盖未知

---

## 附录: 完整文件清单

### 审查核心文件 (13)

1. `src/server/domains/network/handlers/raw-http2-handlers.ts` (261 行)
2. `src/server/domains/network/handlers/raw-latency-handlers.ts` (414 行)
3. `src/server/domains/network/handlers/raw-dns-http-handlers.ts` (406 行)
4. `src/server/domains/network/handlers/tls-bot-handlers.ts` (377 行)
5. `src/server/domains/network/handlers/replay-handlers.ts` (331 行)
6. `src/server/domains/network/handlers/intercept-handlers.ts` (182 行)
7. `src/server/domains/network/handlers/performance-handlers.ts` (228 行)
8. `src/server/domains/network/handlers/core-handlers.requests.ts` (335 行)
9. `src/server/domains/network/handlers/core-handlers.status.ts` (112 行)
10. `src/server/domains/network/handlers/core-handlers.helpers.ts` (72 行)
11. `src/server/domains/network/handlers/core-handlers.response-body.ts` (136 行)
12. `src/server/domains/network/handlers/raw-runtime-helpers.ts` (456 行)
13. `src/server/domains/network/handlers/raw-helpers.ts` (~457+ 行)

### 审查继承链文件 (4)

14. `src/server/domains/network/handlers.base.core.ts` (627 行)
15. `src/server/domains/network/handlers.base.ts` (106 行)
16. `src/server/domains/network/handlers.base.types.ts` (171 行)
17. `src/server/domains/network/handlers.base.performance.ts` (未全读)

### 旧 runtime 文件 (已部分重构, 仍活跃)

18. `src/server/domains/network/handlers.impl.core.runtime.intercept.ts` (183 行)
19. `src/server/domains/network/handlers.impl.core.runtime.replay.ts` (312 行)

### 引用文件

20. `src/server/domains/network/handlers/shared.ts` (97 行) — 本地 parse-args 变体
21. `src/server/domains/shared/parse-args.ts` (120 行) — 官方 parse-args
22. `src/server/domains/memory/handlers/validation.ts` (113 行) — memory 域 validation 参考

---

## 结论

network 域的健壮性状态:

- **parse-args 采用率 ~60%**: 核心请求处理管线 (base.core, core-handlers) 较好, 但 tls-bot-handlers (0%), raw-latency (部分), replay (部分) 仍需工作
- **handleSafe 采用率 ~60%**: 新重构文件 (core-handlers, intercept-handlers, replay-handlers) 使用良好, 旧 runtime 文件和 raw-* 文件用裸 try/catch
- **Critical bugs**: 2 (TOCTOU 文件写入 + replay SSRF 参数注入)
- **重复代码**: 2 对文件 (replay + intercept) 的旧/新版本并存, 需废弃旧文件
- **测试**: 量充足但侧重 happy path, 缺 reject/invalid-input 测试 (对比 memory 域 +81)
- **审计**: 无 (replay HAR 写入应审计, 见 C1)
