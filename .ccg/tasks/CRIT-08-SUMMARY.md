# CRIT-08 Fix: HAR Export HTTP Protocol Version Support

## Summary
Successfully fixed HAR export to correctly capture and represent HTTP/1.0, HTTP/1.1, HTTP/2, and HTTP/3 protocol versions instead of hardcoding HTTP/1.1 for all traffic.

## Changes Made

### 1. Core Implementation (3 files modified)
- **`src/server/domains/network/har.ts`** (+40 lines)
  - Added `normalizeProtocol()` function with comprehensive protocol mapping
  - Added `protocol?: string` to `RawRequest` and `RawResponse` interfaces
  - Updated `buildHar()` to use `normalizeProtocol()` for both request and response

- **`src/modules/monitor/NetworkMonitor.types.ts`** (+1 line)
  - Added `protocol?: string` to `NetworkResponse` interface

- **`src/modules/monitor/NetworkMonitor.impl.ts`** (+2 lines)
  - Added `protocol?: string` to `CDPResponseReceivedPayload.response` interface
  - Updated response capture to include protocol from CDP events

### 2. Test Coverage (3 new test files, 45 new tests)
- **`tests/server/domains/network/har-protocol.test.ts`** (11 tests)
  - HTTP/1.0 and HTTP/1.1 traffic
  - HTTP/2 (h2, h2c) traffic
  - HTTP/3 (h3, http/2+quic) traffic
  - Mixed protocol traffic
  - Fallback behavior
  - Protocol upgrade scenarios

- **`tests/server/domains/network/har-normalize-protocol.test.ts`** (31 tests)
  - All protocol variants with case insensitivity
  - Edge cases and future-proofing
  - Real CDP protocol values

- **`tests/server/domains/network/har-protocol-integration.test.ts`** (3 tests)
  - Real-world multi-protocol traffic simulation
  - Protocol upgrade (ALT-SVC) scenarios
  - Chrome DevTools import compatibility

### 3. Documentation (1 file created)
- **`.ccg/tasks/CRIT-08-fix-report.md`**
  - Comprehensive protocol mapping table
  - Implementation details
  - References to HAR 1.2 spec and CDP documentation

## Protocol Mapping

| CDP Protocol | HAR Format | Use Case |
|-------------|------------|----------|
| `http/1.0` | `HTTP/1.0` | Legacy HTTP/1.0 |
| `http/1.1` | `HTTP/1.1` | Standard HTTP/1.1 |
| `h2` | `HTTP/2` | HTTP/2 over TLS |
| `h2c` | `HTTP/2` | HTTP/2 cleartext |
| `h3` | `HTTP/3` | HTTP/3 over QUIC |
| `http/2+quic/*` | `HTTP/3` | Early QUIC drafts |
| `undefined`/empty | `HTTP/1.1` | Fallback default |
| `http/X.Y` | `HTTP/X.Y` | Future HTTP versions |

## Test Results

### TDD Process ✓
1. **Red Phase**: 7/11 tests failed initially (as expected)
2. **Green Phase**: All 45 new tests pass after implementation
3. **Regression Phase**: All 820 network domain tests pass

### Test Summary
```
HAR Protocol Tests:          11/11 passed ✓
HAR Normalize Protocol:      31/31 passed ✓
HAR Integration Tests:        3/3 passed ✓
Existing HAR Tests:          32/32 passed ✓
───────────────────────────────────────────
Total HAR Tests:             77/77 passed ✓
Network Domain Tests:       820/820 passed ✓
Metadata Check:             469 tools ✓
```

## Technical Details

### Data Flow
```
CDP Network.requestWillBeSent → NetworkMonitor.enable()
  ├─ Captures request.protocol
  └─ Stores in NetworkRequest.httpVersion

CDP Network.responseReceived → NetworkMonitor (responseReceived listener)
  ├─ Captures response.protocol
  └─ Stores in NetworkResponse.protocol

network_export_har tool → buildHar()
  ├─ Reads protocol from requests/responses
  ├─ Calls normalizeProtocol() for each
  └─ Outputs HAR 1.2 with correct httpVersion

HAR File → Chrome DevTools / Wireshark / Fiddler
```

### Key Design Decisions

1. **Fallback to HTTP/1.1**: When protocol is undefined or unknown, default to HTTP/1.1 for backward compatibility

2. **Case Insensitive**: Normalize all protocol strings to lowercase before comparison

3. **Future-Proof**: Preserve `http/X.Y` pattern for future HTTP versions (e.g., HTTP/4.0)

4. **Protocol Mismatch Support**: Request and response can have different protocols (e.g., ALT-SVC upgrades)

5. **QUIC Variants**: Map all `http/2+quic/*` variants to HTTP/3

## HAR 1.2 Compliance ✓
- Field name: `httpVersion` (string)
- Format: Human-readable version (e.g., "HTTP/2")
- Reference: [HAR 1.2 Spec](https://w3c.github.io/web-performance/specs/HAR/Overview.html)

## CDP Integration ✓
- Reads from `Network.requestWillBeSent.request.httpVersion`
- Reads from `Network.responseReceived.response.protocol`
- Reference: [CDP Network Domain](https://chromedevtools.github.io/devtools-protocol/1-3/Network/)

## Backward Compatibility ✓
- Existing HAR files remain valid
- Missing protocol field falls back to HTTP/1.1
- Unknown protocols fall back to HTTP/1.1
- All 820 existing network tests pass without modification

## Future Work
1. Protocol statistics in `network_get_stats` tool
2. Protocol filtering in `network_get_requests` tool
3. HTTP/4 support when IANA registers the identifier

## References
- [HAR 1.2 Specification](https://w3c.github.io/web-performance/specs/HAR/Overview.html)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/1-3/Network/)
- [RFC 7540 - HTTP/2](https://datatracker.ietf.org/doc/html/rfc7540)
- [RFC 9113 - HTTP/2 (updated)](https://httpwg.org/specs/rfc9113)
- [IANA ALPN Protocol IDs](https://www.iana.org/assignments/tls-extensiontype-values/)
- [Chrome DevTools Protocol Field View](https://ma.ttias.be/view-http-spdy-http2-protocol-google-chrome/)
- [Stack Overflow: Chrome DevTools h2 vs h3](https://stackoverflow.com/questions/59016710/)

## Files Modified
```
src/server/domains/network/har.ts                                    (+40 lines)
src/modules/monitor/NetworkMonitor.types.ts                           (+1 line)
src/modules/monitor/NetworkMonitor.impl.ts                            (+2 lines)
tests/server/domains/network/har-protocol.test.ts                     (NEW, 11 tests)
tests/server/domains/network/har-normalize-protocol.test.ts           (NEW, 31 tests)
tests/server/domains/network/har-protocol-integration.test.ts         (NEW, 3 tests)
.ccg/tasks/CRIT-08-fix-report.md                                      (NEW, documentation)
```

## Verification Checklist
- [x] TDD Red phase: Tests fail before implementation
- [x] TDD Green phase: Tests pass after implementation
- [x] No regressions: All 820 network tests pass
- [x] Metadata check: Tool count stable at 469
- [x] HAR 1.2 compliance verified
- [x] CDP integration verified
- [x] Protocol mapping table complete
- [x] Integration tests cover real-world scenarios
- [x] Edge cases handled (undefined, empty, unknown)
- [x] Future-proofing for HTTP/4+
- [x] Documentation complete

## Status: ✅ COMPLETE

All tests pass, no regressions detected, implementation follows TDD methodology, and comprehensive test coverage (45 new tests) ensures correct behavior for all HTTP protocol versions.
