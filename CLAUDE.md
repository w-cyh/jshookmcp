# CLAUDE.md — jshookmcp

> MCP server with 38 domains, 439 tools for AI-assisted JavaScript analysis — browser automation, CDP debugging, network monitoring, JS hooks, deobfuscation, and workflow orchestration.
>
> **Generated**: 2026-05-31 | **Version**: 0.3.2 | **License**: AGPL-3.0-only

---

## Changelog

### 2026-05-31 — Merge binary-secrets + apk-packer into binary-instrument
- **refactor(binary-instrument)**: absorbed `binary-secrets` (1 tool: `binary_key_extract`) and `apk-packer` (3 tools: `apk_packer_detect`, `apk_packer_list_signatures`, `apk_signing_block_parse`) into `binary-instrument` as sub-domains. Both former standalone domains removed. Domain count 40 → 38; tool count unchanged (4 tools moved, not removed). `binary-instrument` manifest gains `secondaryDepKeys: ['apkPackerHandlers', 'binarySecretsHandlers']`. Source files moved to `binary-instrument/secrets/` and `binary-instrument/apk-packer/`; test files moved accordingly; `MCPServer.context.ts` type imports and `MCPServer.ts` DOMAIN_INSTANCE_KEYS updated.

### 2026-05-30 — native-emulator: STUR/LDUR unscaled fix + .init_array constructors (SQLCipher semantic stress-test)
- **fix(native-emulator)**: **STUR/LDUR (unscaled-offset load/store) silently lost every access with a non-zero offset.** `CpuEngine.execLoadStore` computed `addr = idx===0b11 ? base+imm9 : base`, treating the unscaled form (idx=00) like post-index (access at bare `base`, ignoring imm9). Since unscaled and pre-index both add imm9 to the effective address (only post-index uses bare base), every `STUR/LDUR x,[xn,#nonzero]` hit the wrong address — a pervasive correctness bug affecting **all** `.so`, not just the target. Now distinguishes the three idx forms correctly (00 unscaled: base+imm9 no writeback; 01 post: base then writeback; 11 pre: base+imm9 with writeback). Found via semantic stress-test of SQLCipher: `sqlite3_initialize` inlines `sqlite3MutexInit`, which copies the default (noop) mutex method table into `sqlite3GlobalConfig` via a CSEL+STUR sequence; the broken STUR dropped every store, leaving `xMutexInit`=NULL, so `BLR xMutexInit` jumped to 0 and `sqlite3_open_v2` short-circuited (89 instructions, NULL db handle). New unscaled STUR/LDUR regression tests in `CpuEngine.ldrstr.test.ts`.
- **feat(native-emulator)**: **DT_INIT/DT_INIT_ARRAY constructors now execute after relocation**, like a real dynamic linker. `ElfLoader` parses `DT_INIT`/`DT_INIT_ARRAY`/`DT_INIT_ARRAYSZ` and exposes `initializers()`; `CpuEngine.loadElf` reads each (relocated) init-array slot and runs the constructor C-style (argc=0, argv=envp=NULL) on a fresh frame. Without this, a `.so` with C++ static constructors leaves its globals uninitialized. New `init-array-constructors` feature in `nemu_capabilities`; `CpuEngine.initArray.test.ts` builds a minimal `.so` with a RELATIVE-fixed-up init_array slot and asserts the constructor runs.
- **note**: SQLCipher now passes mutex init (BLR reaches the real noop-mutex fn and returns; open_v2 advances 89→136 instructions), but the db handle is still NULL — the deeper mem-alloc/VFS path remains. The STUR fix likely changes earlier stress-test conclusions (FFmpeg opcode gaps, "ran-to-return" judgements were all made with the broken STUR).

### 2026-05-30 — fix(browser/cache): data: URI blobs no longer overflow LLM context (issue #62)
- **fix(#62)**: a captured request whose `url` was an inline multi-MB `data:base64` blob made `get_detailed_data` re-emit the full base64 and crash the LLM context window. Two layers failed: the producer (`AdaptiveDataSerializer`/`DetailedDataManager.store`) cached `data:` URIs verbatim with no field-level cap, and the defensive `LargeDataOffloader` skipped any response whose text matched `/"_?offload"|detailId|_filePath/` — which a `get_detailed_data` wrapper *always* contains, so the payload escaped 100% of the time. **Fix (A+B+C)**: new `src/utils/sanitizeForCache.ts` recursively replaces `data:` URIs (any size) and >64KB strings with a disk-backed `{_offload:{type:'file',path,size,mimeType,sample}}` placeholder (cycle-safe, idempotent, **synchronous** `writeFileSync` so `store()` stays sync — no async cascade); `DetailedDataManager.storeWithSize` sanitizes at the single cache entry point (covers every store path); `LargeDataOffloader` now structurally detects a detail-wrapper and recurses into its `data` branch instead of blanket-skipping (defense-in-depth for future bypasses); `AdaptiveDataSerializer` summary/sample previews are sanitized too (they bypass `store()`). Original bytes are preserved to `artifacts/offloaded/` and retrievable via the **new `get_offloaded_data` tool** (438 → 439 tools, path-traversal guarded). New `OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES` constant + `'offloaded'` artifact category.

### 2026-05-30 — native-emulator: SIMD/FP/crypto extension (integer-ISA boundary closed)
- **feat(native-emulator)**: extended the AArch64 interpreter past the integer ISA into the Advanced SIMD & FP encoding space, all validated against official vectors. **(1) Crypto extension** — AESE/AESD/AESMC/AESIMC (FIPS-197 bit-exact), SHA256H/H2/SU0/SU1 (FIPS-180-4), SHA1C/P/M/H/SU0/SU1 (FIPS-180-1), PMULL/PMULL2 (carry-less GF(2)[x] for GHASH/GCM). **(2) Scalar IEEE-754 FP** — FADD/FSUB/FMUL/FDIV/FSQRT/FABS/FNEG/FMOV, FCVT single↔double, SCVTF/UCVTF/FCVTZS/FCVTZU (saturating, NaN→0), FCMP/FCMPE (NZCV), FCSEL; float32 rounds via `Math.fround`. **(3) NEON integer-lane SIMD** — three-same (ADD/SUB/MUL, AND/ORR/EOR/BIC/ORN, CMEQ/CMGT/CMGE/CMHI/CMHS/CMTST, S/U MIN/MAX), two-register-misc (NEG/ABS/NOT/CNT/CLZ/REVn), DUP, MOVI/MVNI, shift-by-immediate (SHL/SSHR/USHR), across-lanes (ADDV/S/U MAXV/MINV), permute (ZIP/UZP/TRN), EXT, TBL/TBX — per-lane with Q width select. New module files `simd.ts` (dispatcher), `simd-neon.ts`, `simd-crypto.ts`, `simd-fp.ts`; `executeSimdFp`/`executeSimdLoadStore` wired into `CpuEngine`. **Capability boundary moved**: integer + NEON + crypto-ext + scalar FP now emulated; residual gap is the **long/widening + saturating NEON variants** (SQADD, SADDL, …), declared honestly in `nemu_capabilities` (`isa: aarch64-integer+neon+crypto+fp`).
- **fix(native-memory)**: cleared MemoryScanner pointer-scan dead code (empty `if` + stale TODO), replaced a `pointer→'uint64'` `as Parameters<…>` cast (unreachable + invalid type) with the precise `'hex' | 'string'` reachable set, and hoisted the hardcoded `0x7FFF_FFFF_0000` user-space VA ceiling into `USERSPACE_MAX_ADDRESS` (shared across MemoryScanner/PointerChainEngine/NativeMemoryManager).

### 2026-05-30 — native-emulator: demo-grade → executes real `.so`
- **feat(native-emulator)**: lifted the ARM64 emulator from MVP (hand-built bytecode only) to running real Android `.so`. **(1)** integer ISA completed — MOVK/N, ADRP/ADR, logical-immediate (`DecodeBitMasks`), ADC/SBC, AND/ORR/EOR/BIC family, MADD/MSUB/SMULH/UMULH/UDIV/SDIV, variable shifts, UBFM/SBFM/BFM (+ all aliases), CSEL/CSINC/CSINV/CSNEG, CCMP/CCMN, TBZ/TBNZ, sub-word/sign-extended/register-offset/literal loads, REV/RBIT/CLZ, HINT-as-NOP, `MRS TPIDR_EL0` (stack-protector prologues), exclusive LDXR/STXR (single-threaded). **(2)** ELF relocations + PT_DYNAMIC symbol resolution (stripped `.so` works), bionic libc auto-wired via R_AARCH64_JUMP_SLOT/GLOB_DAT. **(3)** JNI table expanded (fields/exceptions/refs/string/object-array) + `nemu_setup_java_field` tool (**14 → 15 `nemu_*` tools**). **(4)** bionic str/mem extension; Android syscalls incl. getrandom/openat/fstat/exit_group. A probe over 15 real arm64 `.so` (FFmpeg/WebRTC/JNI) maps + relocates all 15 and runs most integer functions to return; residual unsupported opcodes are all NEON/FP. **Capability boundary declared honestly**: integer ISA only — NEON/SIMD/FP and AES/SHA crypto-extension paths not yet emulated.

### 2026-05-29 — Merge jadx-search into binary-instrument
- **refactor(binary-instrument)**: absorbed the single-tool `jadx-search` domain — `jadx_search_code` now lives in binary-instrument (alongside `jadx_decompile` and the other jadx/apk tools it already depends on). Removed the standalone domain (depKey/manifest/context field). Domain count 41 → 40; tool count unchanged (the tool moved, not removed). Module layer `@modules/jadx-search` (the search engine) is unchanged.

### 2026-05-29 — native-emulator Domain (L5 domain wiring)
- **feat(native-emulator)**: new domain exposing the in-process ARM64 emulator as MCP tools (14 `nemu_*` tools) — load `.so` / extract from APK → register mock Java methods → call exported / `Java_*` JNI functions → instruction trace. Concurrency-safe `SessionManager` (per-session isolated emulator + idle TTL), `dispose()` wired into graceful shutdown. Self-built AArch64 interpreter, no external deps; `libapp.so` (Dart AOT) routes to the Dart layer.

### 2026-05-27 — Version 0.3.2
- **fix(security)**: apply SSRF authorization policy to ICMP probe and traceroute (GHSA-c5r6-m4mr-8q5j, CWE-918)

### 2026-05-25 — Dart Inspector Domain
- **feat(dart-inspector)**: new domain for Flutter libapp.so string extraction

### 2026-05-16 — Version 0.3.1 Release
- **feat(browser)**: codegen recording, frame listing, iframe targeting for human input
- **feat(sourcemap)**: coverage summary and position lookup tools
- **feat(graphql)**: schema enumeration via suggestion errors with introspection fallback
- **feat(analysis)**: AST match, control-flow deflat, string-array decode tools
- **feat(network)**: DNS probes, CNAME chain, bulk resolve, latency stats, intercept actions (continue/abort/fulfill)
- **feat(stealth)**: expanded detection to 15 checks with Playwright/stack/permission leak tests
- **feat(detector)**: ObfuscationClassifier with deobfuscation strategy hints
- **feat(server)**: track tool call success/failure and result in event bus
- **fix(browser)**: JSDOM concurrent session limit to prevent memory exhaustion
- **fix(ci)**: relaxed branch coverage threshold for runner variance
- **docs**: updated tool count to 402, Chinese translations, VitePress reference pages
- **test**: expanded page-data and codegen coverage

### 2026-05-02 — Stats Update
- **Source stats**: 858 source files (~155K lines), 786 test files (~216K test lines)
- **Domain CLAUDE.md**: 36 domain-level CLAUDE.md files (added missing `boringssl-inspector`)

### 2026-04-21 — Version 0.3.1
- **New domain**: `proxy` — HTTP proxy with CA export, request interception, ADB device proxy setup
- **Domain count**: 36 total (up from 34, plus `native-bridge` and `netproto` inline domains)
- **Module growth**: 27 sub-modules (up from 17) — new: adb, binary-instrument, boringssl-inspector, extension-registry, mojo-ipc, protocol-analysis, skia-capture, syscall-hook, v8-inspector, worker
- **Source stats**: 858 source files (~155K lines), 786 test files
- **Native layer**: 43 files (~10K lines, up from ~6.2K) — added Linux memory provider
- **Server infra**: 555 files in `src/server/`, 16 sub-directories, `MCPServer.prompts.ts` added
- **Module CLAUDE.md**: 36 domain-level CLAUDE.md files (including all 36 domains)

### 2026-04-07 — Version 0.3.0
- **New domain**: `v8-inspector` — V8 heap profiling, bytecode extraction, JIT inspection
- **New domain**: `boringssl-inspector` — TLS key extraction, cert pinning bypass, handshake parsing
- **New domain**: `skia-capture` — Skia GPU backend detection, scene tree extraction
- **New domain**: `binary-instrument` — Frida/Unidbg/Ghidra/IDA/JADX integration
- **New domain**: `adb-bridge` — Android device management, WebView debugging, APK analysis
- **New domain**: `mojo-ipc` — Chromium Mojo IPC monitoring and decoding
- **New domain**: `syscall-hook` — ETW/strace/dtrace syscall monitoring
- **New domain**: `protocol-analysis` — Protocol pattern definition, state machine inference
- **New domain**: `extension-registry` — Plugin registry, webhook C2, BLE HID, Serial bridge
- **New domain**: `cross-domain` — Cross-domain evidence correlation, workflow orchestration
- **Domains updated**: 34 total (up from 25)
- **Tools updated**: 431+ tools (up from 341)
- **File stats updated**: 549 source files

### 2026-04-06 — Version 0.2.6
- **New domain**: `canvas` — Canvas engine fingerprinting, scene tree dumping, object picking for game reversing (Laya/Pixi/Phaser/Cocos/Unity)
- **New domain**: `shared-state-board` — Shared state board for cross-domain coordination
- **Domains updated**: 24 total (up from 23)
- **Tools updated**: 337+ tools (up from 327+)
- **File stats updated**: 549 source files

---

## Quick Navigation

| Layer | Path | Purpose |
|-------|------|---------|
| Entry | `src/index.ts` | CLI bootstrap, signal handling, graceful shutdown |
| Server | `src/server/MCPServer.ts` | God-class split — core orchestrator |
| Registry | `src/server/registry/` | Runtime domain discovery & tool registration ([CLAUDE.md](src/server/registry/CLAUDE.md)) |
| Search | `src/server/search/` | Multi-signal tool search engine ([CLAUDE.md](src/server/search/CLAUDE.md)) |
| Domains | `src/server/domains/*/manifest.ts` | 37 domain manifests (tool definitions + handlers) |
| Modules | `src/modules/` | Business logic (27 sub-modules) |
| Native | `src/native/` | FFI via koffi (Win32/Darwin memory, PE analysis) |
| Utils | `src/utils/` | Shared utilities (cache, workers, config, serialization) |
| Types | `src/types/` | Shared type definitions |
| Tests | `tests/` | 751 test files, vitest v4.x |
| E2E | `tests/e2e/` | End-to-end tests (separate config) |
| Docs | `docs/` | VitePress documentation (zh + en) |
| Workflows | `workflows/` | Extension mount point (workflows installed via registry) |
| SDK | `packages/extension-sdk/` | Extension SDK for plugins/workflows |

---

## Architecture Overview

```mermaid
graph TB
    CLI["src/index.ts<br/>CLI Entry"]
    MCP["MCPServer<br/>(split: .tools, .search, .domain,<br/>.transport, .context, .resources)"]
    REG["Registry<br/>discovery.ts → contracts.ts"]
    BUS["EventBus"]
    ROUTER["ToolRouter<br/>.intent / .probe / .policy / .renderer"]
    SEARCH["ToolSearchEngine<br/>BM25 + Trigram + Embedding + Affinity"]
    ACT["ActivationController<br/>AutoPruner / PredictiveBooster"]
    GUARD["ToolCallContextGuard"]

    subgraph Domains["38 Domain Manifests"]
        D_BROWSER["browser"]
        D_DEBUG["debugger"]
        D_NET["network"]
        D_HOOK["hooks"]
        D_ANALYSIS["core/analysis"]
        D_ENCODE["encoding"]
        D_GRAPH["graphql"]
        D_STREAM["streaming"]
        D_WASM["wasm"]
        D_PROC["process"]
        D_MEM["memory"]
        D_PLAT["platform"]
        D_ANTI["antidebug"]
        D_TRANS["transform"]
        D_SMAP["sourcemap"]
        D_WF["workflow"]
        D_TRACE["trace"]
        D_EVID["evidence"]
        D_INSTR["instrumentation"]
        D_COORD["coordination"]
        D_MAINT["maintenance"]
        D_MACRO["macro"]
        D_SAND["sandbox"]
        D_CANVAS["canvas"]
        D_STATE["shared-state-board"]
        D_V8["v8-inspector"]
        D_BORING["boringssl-inspector"]
        D_SKIA["skia-capture"]
        D_BIN["binary-instrument"]
        D_ADB["adb-bridge"]
        D_MOJO["mojo-ipc"]
        D_SYSCALL["syscall-hook"]
        D_PROTO["protocol-analysis"]
        D_EXT["extension-registry"]
        D_CROSS["cross-domain"]
        D_PROXY["proxy"]
        D_DART["dart-inspector"]
    end

    subgraph Modules["Business Logic Modules (27)"]
        M_BROWSER["browser/"]
        M_COLLECT["collector/"]
        M_DEBUG["debugger/"]
        M_DEOBF["deobfuscator/"]
        M_HOOK["hook/"]
        M_MONITOR["monitor/"]
        M_PROCESS["process/"]
        M_CRYPTO["crypto/"]
        M_ANALYZE["analyzer/"]
        M_CAPTCHA["captcha/"]
        M_STEALTH["stealth/"]
        M_EMULAT["emulator/"]
        M_SYMBOL["symbolic/"]
        M_TRACE["trace/"]
        M_ADB["adb/"]
        M_BININST["binary-instrument/"]
        M_BORING["boringssl-inspector/"]
        M_EXTREG["extension-registry/"]
        M_MOJO["mojo-ipc/"]
        M_PROTO["protocol-analysis/"]
        M_SKIA["skia-capture/"]
        M_SYSCALL["syscall-hook/"]
        M_V8["v8-inspector/"]
        M_WORKER["worker/"]
        M_DETECT["detector/"]
        M_EXTERNAL["external/"]
        M_SECURITY["security/"]
    end

    subgraph Native["Native FFI (koffi)"]
        N_MEM["MemoryScanner/Controller"]
        N_PE["PEAnalyzer"]
        N_HW["HardwareBreakpoint"]
        N_WIN["Win32API/Debug"]
        N_DARWIN["DarwinAPI"]
    end

    CLI --> MCP
    MCP --> REG
    MCP --> BUS
    MCP --> ROUTER
    MCP --> SEARCH
    MCP --> ACT
    MCP --> GUARD
    REG -->|discoverDomainManifests| Domains
    Domains -->|ensure() factory| Modules
    Modules --> Native
```

---

## Core Architectural Patterns

### 1. Runtime Domain Discovery
```
src/server/registry/discovery.ts
  → scans src/server/domains/*/manifest.ts
  → validates DomainManifest contract (kind, version, domain, depKey, profiles, registrations, ensure)
  → builds tool groups, domain map, handler map
```
**Add a new domain**: Create `src/server/domains/<name>/manifest.ts` exporting a `DomainManifest`. No manual imports needed.

### 2. Lazy Proxy Pattern
```
MCPServer.domain.ts → createDomainProxy(ctx, domain, label, factory)
  → Proxy intercepts property access
  → first access triggers ensure(ctx) factory
  → supports sync and async factories
  → instance cached in domainInstanceMap
```

### 3. Domain Manifest Contract (`src/server/registry/contracts.ts`)
```typescript
interface DomainManifest {
  kind: 'domain-manifest';
  version: 1;
  domain: string;           // e.g. 'browser'
  depKey: string;            // e.g. 'browserHandlers'
  profiles: ToolProfileId[]; // 'search' | 'workflow' | 'full'
  registrations: ToolRegistration[];
  ensure: (ctx: MCPServerContext) => T | Promise<T>;
  workflowRule?: { patterns, priority, tools, hint };
  prerequisites?: Record<string, Array<{condition, fix}>>;
  toolDependencies?: Array<{from, to, relation, weight}>;
}
```

### 4. MCPServer God-Class Split
Split into focused modules — all attached to `MCPServer` via composition:
| File | Responsibility |
|------|---------------|
| `MCPServer.ts` | Core class, domain instance map, lifecycle |
| `MCPServer.context.ts` | `MCPServerContext` interface (sub-interfaces: ServerCore, ToolRegistryState, ActivationState, TransportState, ExtensionState, DomainInstances, ServerMethods) |
| `MCPServer.domain.ts` | `createDomainProxy()`, `resolveEnabledDomains()` |
| `MCPServer.transport.ts` | stdio + HTTP transport setup |
| `MCPServer.tools.ts` | Tool registration |
| `MCPServer.search.ts` | Search meta-tools |
| `MCPServer.resources.ts` | MCP resource registration |
| `MCPServer.activation.ttl.ts` | Domain TTL management |
| `MCPServer.schema.ts` | Schema generation |
| `MCPServer.registration.ts` | Tool resolution for registration |
| `MCPServer.prompts.ts` | MCP prompt registration |

### 5. parseArgs Utility (`src/server/domains/shared/parse-args.ts`)
Type-safe arg extraction replacing `as` assertions:
- `argString(args, key)` / `argString(args, key, fallback)` — non-throwing
- `argStringRequired(args, key)` — throws if missing (use only in try-catch)
- `argNumber`, `argBool`, `argEnum`, `argStringArray`, `argObject`
- **argEnum error format**: `Invalid ${key}: "${v}". Expected one of: ...`

---

## 31 Domains

| # | Domain | Profile Tier | Manifest Path |
|---|--------|-------------|---------------|
| 1 | `analysis` (core) | workflow, full | `domains/analysis/manifest.ts` |
| 2 | `browser` | workflow, full | `domains/browser/manifest.ts` |
| 3 | `canvas` | full | `domains/canvas/manifest.ts` |
| 4 | `coordination` | full | `domains/coordination/manifest.ts` |
| 5 | `debugger` | workflow, full | `domains/debugger/manifest.ts` |
| 6 | `encoding` | workflow, full | `domains/encoding/manifest.ts` |
| 7 | `graphql` | workflow, full | `domains/graphql/manifest.ts` |
| 8 | `instrumentation` | workflow, full | `domains/instrumentation/manifest.ts` |
| 9 | `maintenance` | search, workflow, full | `domains/maintenance/manifest.ts` |
| 10 | `memory` | workflow, full | `domains/memory/manifest.ts` |
| 11 | `network` | workflow, full | `domains/network/manifest.ts` |
| 12 | `platform` | full | `domains/platform/manifest.ts` |
| 13 | `process` | full | `domains/process/manifest.ts` |
| 14 | `sourcemap` | workflow, full | `domains/sourcemap/manifest.ts` |
| 15 | `streaming` | workflow, full | `domains/streaming/manifest.ts` |
| 16 | `trace` | workflow, full | `domains/trace/manifest.ts` |
| 17 | `transform` | workflow, full | `domains/transform/manifest.ts` |
| 18 | `wasm` | full | `domains/wasm/manifest.ts` |
| 19 | `workflow` | workflow, full | `domains/workflow/manifest.ts` |
| 20 | `v8-inspector` | full | `domains/v8-inspector/manifest.ts` |
| 21 | `boringssl-inspector` | full | `domains/boringssl-inspector/manifest.ts` |
| 22 | `binary-instrument` | full | `domains/binary-instrument/manifest.ts` |
| 23 | `adb-bridge` | full | `domains/adb-bridge/manifest.ts` |
| 24 | `mojo-ipc` | full | `domains/mojo-ipc/manifest.ts` |
| 25 | `syscall-hook` | full | `domains/syscall-hook/manifest.ts` |
| 26 | `protocol-analysis` | full | `domains/protocol-analysis/manifest.ts` |
| 27 | `extension-registry` | full | `domains/extension-registry/manifest.ts` |
| 28 | `cross-domain` | full | `domains/cross-domain/manifest.ts` |
| 29 | `proxy` | full | `domains/proxy/manifest.ts` |
| 30 | `dart-inspector` | full | `domains/dart-inspector/manifest.ts` |
| 31 | `native-emulator` | full | `domains/native-emulator/manifest.ts` |

Plus: `native-bridge` (inline in `domains/native-bridge/index.ts`, no manifest — IDA/Ghidra bridge)
Plus: `netproto` (inline, no manifest — network protocol utilities)

**Merged domains** (no longer standalone — tools absorbed via `secondaryDepKeys`):
- `sandbox` → `maintenance` (1 tool)
- `skia-capture` → `canvas` (3 tools)
- `shared-state-board` → `coordination` (3 tools)
- `macro` → `workflow` (2 tools)
- `binary-secrets` → `binary-instrument` (1 tool)
- `apk-packer` → `binary-instrument` (3 tools)
- `antidebug` → `debugger` (2 tools)
- `hooks` → `instrumentation` (2 tools)
- `evidence` → `instrumentation` (3 tools)

---

## Build & Dev

```bash
# Install
pnpm install

# Dev (tsx watch)
pnpm dev

# Build (tsc + tsc-alias + copy native scripts + generate entry re-exports)
pnpm build

# Full quality check
pnpm check    # = metadata:check + lint + format:check + typecheck + test

# Test
pnpm test                    # unit tests (vitest, pool: forks)
pnpm test:e2e                # E2E tests (requires browser)
pnpm test:coverage           # with v8 coverage

# Lint & Format
pnpm lint                    # oxlint
pnpm format                  # oxfmt

# Docs
pnpm docs:dev                # VitePress dev server
pnpm docs:build              # Build docs
```

---

## TypeScript Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| `target` | ES2023 | |
| `module` | ESNext | |
| `moduleResolution` | bundler | |
| `strict` | true | |
| `noUncheckedIndexedAccess` | true | Record/array indexing returns `T \| undefined` |
| `verbatimModuleSyntax` | true | Must use `import type` for type-only imports |
| `noUnusedLocals` | true | |
| `noUnusedParameters` | true | |
| `noImplicitReturns` | true | |
| `isolatedModules` | true | |

### Path Aliases
| Alias | Maps To |
|-------|---------|
| `@src/*` | `src/*` |
| `@modules/*` | `src/modules/*` |
| `@server/*` | `src/server/*` |
| `@utils/*` | `src/utils/*` |
| `@native/*` | `src/native/*` |
| `@internal-types/*` | `src/types/*` |
| `@errors/*` | `src/errors/*` |
| `@services/*` | `src/services/*` |
| `@tests/*` | `tests/*` |
| `@extension-sdk/*` | `packages/extension-sdk/src/*` |

---

## Testing

- **Framework**: Vitest 4.x, pool: forks
- **Files**: 609+ test files in `tests/`
- **Coverage thresholds**: lines 95%, functions 95%, branches 85%, statements 95%
- **Setup**: `tests/setup.ts` — initializes registry, mocks PageController evaluate wrappers
- **E2E**: Separate config at `tests/e2e/vitest.e2e.config.ts`
  - Only runs when `E2E_TARGET_URL` env var is set
  - Target: `https://vmoranv.github.io/jshookmcp/`
  - `perToolTimeout: 60000ms`
- **Coverage exclusions**: types, index barrels, manifests, definition-only files, pure re-export handlers

### Test Naming Conventions
| Pattern | Purpose |
|---------|---------|
| `*.test.ts` | Standard unit tests |
| `*.coverage.test.ts` | Coverage expansion tests (added 2026-04-01) |
| `*.additional.test.ts` | Edge case / supplementary tests |
| `*.extended.test.ts` | Extended scenario tests |

### Known Skip Categories
- Dynamic `import('node:fs')` cannot be mocked with `vi.mock`
- `@babel/traverse` visitor hoisting conflicts
- Vitest microtask timing edge cases

---

## Key Conventions

### Code Style
1. **No `as` assertions** — use `parseArgs` utilities instead
2. **No `satisfies`** on objects needing string indexing (removes index signature)
3. **Re-export chains flattened** — `handlers.ts` re-exports directly from implementation
4. **`import type`** required for type-only imports (`verbatimModuleSyntax`)

### Persistent Injection Pattern
All injection tools (fetch/XHR/SSE/scriptMonitor/functionTracer/propertyWatcher) support `persistent: true` via:
- CDP: `Page.addScriptToEvaluateOnNewDocument`
- Playwright: `page.evaluateOnNewDocument()`

### Environment Variables
Runtime-tunable via `src/constants.ts` — every constant reads from env with fallback:
```typescript
const SHUTDOWN_TIMEOUT_MS = int('SHUTDOWN_TIMEOUT_MS', 10_000);
```

### Error Handling
- `ToolError` (`src/errors/ToolError.ts`) — standard tool error
- `PrerequisiteError` (`src/errors/PrerequisiteError.ts`) — missing prerequisites
- `asErrorResponse()` — wraps errors for MCP response format

---

## Extension System

### Plugin SDK (`packages/extension-sdk/`)
- Entry: `packages/extension-sdk/src/index.ts`
- Exports: plugin builder, workflow builder, bridge utilities
- Build: separate TSC in `packages/extension-sdk/`

### Extension Manager (`src/server/extensions/ExtensionManager.ts`)
Split sub-modules:
| Sub-module | Responsibility |
|-----------|---------------|
| `ExtensionManager.roots.ts` | Path resolution |
| `ExtensionManager.version.ts` | Semver compatibility |
| `ExtensionManager.integrity.ts` | Digest allowlist, env guards |
| `ExtensionManager.guards.ts` | Type guards |
| `ExtensionManager.discovery.ts` | File scanning |
| `ExtensionManager.lifecycle.ts` | Cleanup, config, list building |

### Workflow Engine (`src/server/workflows/`)
- `WorkflowEngine.ts` — Execution engine
- `WorkflowContract.ts` — Contract definitions
- `workflows/` (root) — Extension mount point (empty; workflows installed from external repos via registry)

---

## Tool Search Engine (`src/server/search/`)

Multi-signal search pipeline:
```
QueryNormalizer → SynonymExpander → BM25Scorer + TrigramIndex
    → EmbeddingEngine → IntentBoost → AffinityGraph
    → FeedbackTracker → ToolSearchEngineImpl (orchestrator)
```

---

## Activation System (`src/server/activation/`)

- `ActivationController` — Manages dynamic tool activation/deactivation
- `AutoPruner` — Auto-expires unused tools
- `PredictiveBooster` — Pre-activates tools based on patterns
- `CompoundConditionEngine` — Evaluates activation conditions
- Profile tiers: `search` ⊂ `workflow` ⊂ `full`

---

## Native FFI Layer (`src/native/`)

Cross-platform memory operations via [koffi](https://koffi.dev/):
| Module | Purpose |
|--------|---------|
| `NativeMemoryManager` | Memory read/write/scan orchestrator |
| `MemoryScanner` + `MemoryScanSession` | Pattern scanning with comparators |
| `MemoryController` | Memory region management |
| `HeapAnalyzer` | Heap inspection |
| `HardwareBreakpoint` | Hardware breakpoints (Win32) |
| `PEAnalyzer` | PE file analysis |
| `PointerChainEngine` | Pointer chain resolution |
| `StructureAnalyzer` | Memory structure analysis |
| `CodeInjector` | Code injection |
| `Speedhack` | Time manipulation |
| `AntiCheatDetector` | Anti-cheat detection |
| `Win32API` / `Win32Debug` | Windows API wrappers |
| `platform/darwin/DarwinAPI` | macOS API wrappers |

---

## File Statistics

| Category | Count |
|----------|-------|
| Source files (`src/**/*.ts`) | 858 |
| Source lines | ~155,000 |
| Test files (`tests/**/*.test.ts`) | 786 |
| Test lines | ~216,000 |
| Domain manifests | 38 (+2 inline: `native-bridge`, `netproto`) |
| Business logic modules | 27 |
| Native FFI files | 43 (~10,000 lines) |
| Pre-built workflows | 0 (moved to external repos) |
| Build scripts | 12 |
| Doc pages (md) | ~80 |

---

## Module-Level CLAUDE.md Files

- [`src/server/CLAUDE.md`](src/server/CLAUDE.md) — Server infrastructure
- [`src/modules/CLAUDE.md`](src/modules/CLAUDE.md) — Business logic modules (27 sub-modules)
- [`src/native/CLAUDE.md`](src/native/CLAUDE.md) — Native FFI layer
- [`src/utils/CLAUDE.md`](src/utils/CLAUDE.md) — Shared utilities (cache, workers, config, serialization)
- [`tests/CLAUDE.md`](tests/CLAUDE.md) — Test organization, mock strategies, coverage

### Domain-Level CLAUDE.md Files
- [`src/server/domains/browser/CLAUDE.md`](src/server/domains/browser/CLAUDE.md) — Browser domain (~7,300 lines)
- [`src/server/domains/network/CLAUDE.md`](src/server/domains/network/CLAUDE.md) — Network domain (~3,100 lines)
- [`src/server/domains/debugger/CLAUDE.md`](src/server/domains/debugger/CLAUDE.md) — Debugger domain (~2,600 lines)
- [`src/server/domains/process/CLAUDE.md`](src/server/domains/process/CLAUDE.md) — Process domain (~2,200 lines)
- [`src/server/domains/canvas/CLAUDE.md`](src/server/domains/canvas/CLAUDE.md) — Canvas domain
- [`src/server/domains/graphql/CLAUDE.md`](src/server/domains/graphql/CLAUDE.md) — GraphQL domain
- [`src/server/domains/hooks/CLAUDE.md`](src/server/domains/hooks/CLAUDE.md) — Hooks domain
- [`src/server/domains/encoding/CLAUDE.md`](src/server/domains/encoding/CLAUDE.md) — Encoding domain
- [`src/server/domains/memory/CLAUDE.md`](src/server/domains/memory/CLAUDE.md) — Memory domain
- [`src/server/domains/streaming/CLAUDE.md`](src/server/domains/streaming/CLAUDE.md) — Streaming domain
- [`src/server/domains/transform/CLAUDE.md`](src/server/domains/transform/CLAUDE.md) — Transform domain
- [`src/server/domains/wasm/CLAUDE.md`](src/server/domains/wasm/CLAUDE.md) — WASM domain
- [`src/server/domains/antidebug/CLAUDE.md`](src/server/domains/antidebug/CLAUDE.md) — Anti-debug domain
- [`src/server/domains/sourcemap/CLAUDE.md`](src/server/domains/sourcemap/CLAUDE.md) — Sourcemap domain
- [`src/server/domains/platform/CLAUDE.md`](src/server/domains/platform/CLAUDE.md) — Platform domain
- [`src/server/domains/workflow/CLAUDE.md`](src/server/domains/workflow/CLAUDE.md) — Workflow domain
- [`src/server/domains/maintenance/CLAUDE.md`](src/server/domains/maintenance/CLAUDE.md) — Maintenance domain
- [`src/server/domains/trace/CLAUDE.md`](src/server/domains/trace/CLAUDE.md) — Trace domain
- [`src/server/domains/analysis/CLAUDE.md`](src/server/domains/analysis/CLAUDE.md) — Analysis domain
- [`src/server/domains/v8-inspector/CLAUDE.md`](src/server/domains/v8-inspector/CLAUDE.md) — V8 Inspector domain
- [`src/server/domains/skia-capture/CLAUDE.md`](src/server/domains/skia-capture/CLAUDE.md) — Skia Capture domain
- [`src/server/domains/binary-instrument/CLAUDE.md`](src/server/domains/binary-instrument/CLAUDE.md) — Binary Instrument domain
- [`src/server/domains/mojo-ipc/CLAUDE.md`](src/server/domains/mojo-ipc/CLAUDE.md) — Mojo IPC domain
- [`src/server/domains/syscall-hook/CLAUDE.md`](src/server/domains/syscall-hook/CLAUDE.md) — Syscall Hook domain
- [`src/server/domains/extension-registry/CLAUDE.md`](src/server/domains/extension-registry/CLAUDE.md) — Extension Registry domain
- [`src/server/domains/shared-state-board/CLAUDE.md`](src/server/domains/shared-state-board/CLAUDE.md) — Shared State Board domain
- [`src/server/domains/cross-domain/CLAUDE.md`](src/server/domains/cross-domain/CLAUDE.md) — Cross-domain correlation
- [`src/server/domains/protocol-analysis/CLAUDE.md`](src/server/domains/protocol-analysis/CLAUDE.md) — Protocol Analysis domain
- [`src/server/domains/adb-bridge/CLAUDE.md`](src/server/domains/adb-bridge/CLAUDE.md) — ADB Bridge domain
- [`src/server/domains/boringssl-inspector/CLAUDE.md`](src/server/domains/boringssl-inspector/CLAUDE.md) — BoringSSL Inspector domain
- [`src/server/domains/dart-inspector/CLAUDE.md`](src/server/domains/dart-inspector/CLAUDE.md) — Dart Inspector domain (Flutter libapp.so string extraction)
- [`src/server/domains/native-emulator/CLAUDE.md`](src/server/domains/native-emulator/CLAUDE.md) — Native Emulator domain (in-process ARM64 .so emulation, JNI, session pool)

---

## .context Project Context

> Project uses `.context/` for development decision context.

- Coding conventions: `.context/prefs/coding-style.md`
- Workflow rules: `.context/prefs/workflow.md`
- Decision history: `.context/history/commits.md`

**Rule**: Read prefs/ before modifying code, log decisions per workflow.md.
