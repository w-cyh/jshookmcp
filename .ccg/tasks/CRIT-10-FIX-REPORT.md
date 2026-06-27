# CRIT-10 Fix Report: Memory Domain Win32-only Platform Guards

## Issue Summary
**CRIT-10**: Memory domain handlers had non-null assertions (`!`) on Win32-only engines (HardwareBreakpoint, Speedhack, HeapAnalyzer, PEAnalyzer, AntiCheatDetector). If platform detection failed or was bypassed, these would throw `TypeError: Cannot read property 'X' of null` at runtime instead of returning user-friendly errors.

## Root Cause
- `HookHandlers` (4 methods) used `this.bpEngine!` on null engine
- `IntegrityHandlers` (11 methods) used `this.speedhackEngine!`, `this.heapAnalyzer!`, `this.peAnalyzer!`, `this.antiCheatDetector!` on null engines
- Platform filtering in `manifest.ts` correctly excluded Win32-only tools from registration on non-Win32 platforms, BUT if tools were called directly (bypass/bug), the handlers would crash

## Solution Applied

### 1. Removed All Non-Null Assertions
**Files Modified:**
- `src/server/domains/memory/handlers/hooks.ts`
- `src/server/domains/memory/handlers/integrity.ts`

**Changes:**
- Removed `!` operator from all Win32-only engine accesses
- Added runtime null checks at the start of each handler method
- Throw clear error messages before attempting to use null engines

### 2. Added Runtime Platform Guards
Each Win32-only handler now checks if the required engine is available:

```typescript
if (!this.bpEngine) {
  throw new Error(
    'Hardware breakpoint tools (memory_breakpoint) are only supported on Windows. ' +
    'This tool requires Win32 debug register APIs.'
  );
}
```

**Error Messages:**
- **Hardware Breakpoint**: "Hardware breakpoint tools (memory_breakpoint) are only supported on Windows. This tool requires Win32 debug register APIs."
- **Speedhack**: "Speedhack tools (memory_speedhack) are only supported on Windows. This tool requires Win32 timer manipulation APIs."
- **Heap Analysis**: "Heap analysis tools (memory_heap_*) are only supported on Windows. This tool requires Win32 Toolhelp32 heap enumeration APIs."
- **PE Analysis**: "PE analysis tools (memory_pe_*) are only supported on Windows. This tool requires Win32 PE format introspection."
- **Inline Hook**: "Inline hook detection (memory_inline_hook_detect) is only supported on Windows. This tool requires Win32 PE format introspection."
- **Anti-Cheat**: "Anti-cheat detection tools (memory_anticheat_*, memory_guard_pages, memory_integrity_check) are only supported on Windows. These tools require Win32 process introspection APIs."

### 3. TDD Test Coverage
**New Test File:** `tests/server/domains/memory/platform-guard.test.ts`

**Coverage (17 tests, all passing):**
- 4 Hardware Breakpoint tools (set, remove, list, trace)
- 2 Speedhack tools (apply, set)
- 3 Heap Analysis tools (enumerate, stats, anomalies)
- 3 PE Analysis tools (headers, imports/exports, inline hook detect)
- 3 Anti-Cheat tools (detect, guard pages, integrity check)
- 2 Error message quality tests (mentions tool name, no TypeError)

**Test Approach:**
- Directly instantiate `MemoryScanHandlers` with null Win32-only engines
- Call each Win32-only tool
- Verify response has `success: false` and clear error message
- Confirm no `TypeError` is thrown

## Handlers Modified

### HookHandlers (4 methods)
1. `handleBreakpointSet()`
2. `handleBreakpointRemove()`
3. `handleBreakpointList()`
4. `handleBreakpointTrace()`

### IntegrityHandlers (11 methods)
1. `handleSpeedhackApply()`
2. `handleSpeedhackSet()`
3. `handleHeapEnumerate()`
4. `handleHeapStats()`
5. `handleHeapAnomalies()`
6. `handlePEHeaders()`
7. `handlePEImportsExports()`
8. `handleInlineHookDetect()`
9. `handleAntiCheatDetect()`
10. `handleGuardPages()`
11. `handleIntegrityCheck()`

## Test Results

### Platform Guard Tests
```
✓ tests/server/domains/memory/platform-guard.test.ts (17 tests) - ALL PASS
  ✓ Hardware Breakpoint Tools (4 tests)
  ✓ Speedhack Tools (2 tests)
  ✓ Heap Analysis Tools (3 tests)
  ✓ PE Analysis Tools (3 tests)
  ✓ Anti-Cheat Detection Tools (3 tests)
  ✓ Error Message Quality (2 tests)
```

### All Memory Domain Tests
```
✓ 12 test files (158 tests) - ALL PASS
  - No regressions in existing memory domain functionality
  - Win32 platform continues to work normally
  - Non-Win32 platforms now return clear errors instead of crashing
```

## Verification

### Before Fix (Simulated)
```typescript
// Non-Win32 platform calling Win32-only tool
await handlers.handleBreakpointSet({ pid: 1234, address: '0x400000', access: 'write' });
// Result: TypeError: Cannot read property 'setBreakpoint' of null
```

### After Fix
```typescript
// Non-Win32 platform calling Win32-only tool
await handlers.handleBreakpointSet({ pid: 1234, address: '0x400000', access: 'write' });
// Result: { 
//   success: false, 
//   error: "Hardware breakpoint tools (memory_breakpoint) are only supported on Windows. This tool requires Win32 debug register APIs.",
//   message: "..." 
// }
```

## Impact Assessment

### Risk: LOW ✅
- Changes are defensive guards that only trigger on error paths
- Win32 platform behavior unchanged (engines are non-null)
- Non-Win32 platforms already filtered out these tools at registration
- Runtime checks are a safety net for edge cases (bypass, platform detection bug, future refactoring)

### Coverage: COMPLETE ✅
- All 15 Win32-only tools now have runtime guards
- All guards tested with 17 test cases
- No non-null assertions remain in memory domain handlers

### Error Quality: IMPROVED ✅
- Users see clear, actionable error messages
- Error messages mention tool name and platform requirement
- No cryptic `TypeError` crashes

## Files Changed

### Implementation (2 files)
1. `src/server/domains/memory/handlers/hooks.ts` - 4 methods fixed
2. `src/server/domains/memory/handlers/integrity.ts` - 11 methods fixed

### Tests (1 file)
1. `tests/server/domains/memory/platform-guard.test.ts` - 17 new tests

## Compliance Checklist

- ✅ All platform checks execute at runtime (not compile-time constants)
- ✅ Error messages clearly state "only supported on Windows"
- ✅ No impact on Win32 platform normal functionality
- ✅ TDD flow followed (test → fail → implement → pass)
- ✅ Full memory domain test suite passes (158 tests)
- ✅ No non-null assertions remain on nullable Win32-only engines

## Conclusion

CRIT-10 is **RESOLVED**. All Win32-only memory tools now have runtime platform guards that return clear error messages instead of crashing with `TypeError` when called on non-Win32 platforms. The fix is defensive, low-risk, and fully tested.
