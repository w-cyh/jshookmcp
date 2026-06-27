# Handoff: native-emulator heavy-dependency extension loader

**From**: verify-nemu-luoys-apk session (2026-06-14)
**To**: next agent
**Status**: core ISA green; 2 real bugs fixed; FFmpeg-class libs blocked on cross-library linking — out of core scope by design.

---

## Why this handoff exists

A real-world APK (env var `NEMU_INTEGRATION_APK`) was used to probe every arm64-v8a
`.so`. Result after this session's ISA fixes:

| lib | load | first plain-export call | failure mode |
|-----|------|------------------------|-------------|
| libsqlite3.so | ✅ | ✅ `sqlite3_libversion_number()` = 3052000 (real version) | — |
| libijksdl.so | ✅ | ✅ returns | — |
| libijkplayer.so | ✅ | ✅ returns | — |
| libmmkv.so | ✅ | ✅ returns | — |
| libijkffmpeg.so | ✅ | ❌ unmapped 0x80800003ac3 | **115 unresolved imports** (cross-lib) |
| libffmpeg_remux.so | ✅ | ❌ NULL indirect call | **68 unresolved imports** (cross-lib) |
| libimage_processing_util_jni.so | ✅ | n/a (JNI-only) | — |
| libsurface_util_jni.so | ✅ | n/a (JNI-only) | — |
| libapp.so / libflutter.so | skip | skip | Dart AOT, out of scope |

The two FFmpeg-family failures are **not ISA bugs**. They are single-library
loads where the `.so` was linked against sibling libraries (libijkffmpeg depends
on the FFmpeg internals it ships, plus its own re-exported symbols). With no
cross-library resolution, those GOT slots stay 0 → first indirect call through
them is a NULL jump. This is the expected gap; core must not grow a dependency
walker. Route it to an extension.

---

## What was actually fixed in core (do NOT redo)

Two real ISA bugs surfaced by sqlite3.so execution, both TDD-regression-tested:

1. **32-bit MADD/MSUB operand truncation** (`CpuEngine.ts` ~L1342)
   - Bug: used full 64-bit GPR operands, only truncated the result. Dirty high
     bits of Rn leaked into the low-32 product.
   - Fix: when `sf=0`, mask Rn/Rm/Ra to 32 bits *before* the multiply.
   - Test: `CpuEngine.extended-isa.test.ts` "32-bit MSUB truncates operands".

2. **UBFM LSR field alias** (`CpuEngine.ts` ~L920, bitfield block)
   - Bug: rotate-then-full-mask kept the `(src << (width-r))` high bits when
     `imms == width-1` (the LSR alias). `LSR x9,x9,#36` of `0x73` returned
     `0x730000000` instead of `0`.
   - Fix: split wrapping (`imms<r`) vs non-wrapping branches per ARM C4.1.6.
   - Test: same file, covered by the existing LSR/UBFM cases + the sqlite path.

Also done this session (prior commits):
- `nemu_trace` captures SIMD/FP vector registers (`vN/qN/dN/sN/hN/bN`) via
  `TraceEvent.vector()` — the AES/SHA/PMULL/scalar-FP hot path is now observable.
- De-hardcoded: `.lychee.toml` local paths, vendor-specific APK test path →
  `NEMU_INTEGRATION_APK` env var with structural-only assertions.

---

## The gap to close: cross-library dependency resolution

### Current single-library model

`CpuEngine.loadElf(bytes, bionic)` (CpuEngine.ts ~L229):
1. maps PT_LOAD segments
2. `applyRelocations` resolves each `R_AARCH64_JUMP_SLOT/GLOB_DAT/ABS64`:
   - own export symbol → its vaddr
   - bionic libc name (malloc/memcpy/...) → host stub
   - **else → unresolved, GOT slot left as `symbolValue` (0)**
3. runs `.init_array` constructors

Step 2's "else" branch is where FFmpeg dies. `libijkffmpeg` imports symbols that
live in *itself but under a different relocation that wasn't seen as an export*,
or in a sibling `.so` that was never loaded. The diagnostic surface already
exists: `nemu_inspect_imports` lists every unresolved import with its GOT offset
and relocation type — the extension should consume exactly that.

### Extension scope (do NOT add to core)

The extension is a **dependency provisioner**, not a full dynamic linker. It
should:

1. Accept the target `.so` + its `unresolvedImports` list (from `nemu_inspect_imports`).
2. For each unresolved symbol, decide a resolution source:
   - **a sibling .so in the same APK** (e.g. libijkplayer↔libijkffmpeg): load it
     into the *same* session and bind its export. This needs a multi-library
     session API (see "API gap" below).
   - **a JS host stub** for trivial shims (logging, no-op mutex already covered
     by bionic; this is for FFmpeg-specific glue like `av_log`).
   - **fail loudly** otherwise — never silently zero the slot.
3. Hand the resolved symbol→address map back to the engine so `applyRelocations`
   can patch the GOT.

### API gap the extension needs from core

Today `loadLibrary(bytes)` is single-library: a second call on the same
`NativeEmulator` instance overwrites `this.symbols` and re-runs relocations
against the *new* image's regions (see `CpuEngine.loadElf` resets
`this.symbols = elf.exportedSymbols()` at ~L239). To support cross-library
linking, core needs ONE of:

- **(preferred) `loadLibraryWithDeps(bytes, deps: Uint8Array[])`**: load the
  target plus sibling `.so` images, merge their export maps, then relocate.
  Minimal core change; the extension just supplies the byte arrays.
- **`registerExternalSymbol(name, address)`**: let the extension pre-resolve
  symbols (after loading deps itself via a separate session and reading their
  exports) before the target's `applyRelocations` runs. More flexible, more
  rope.

Recommend option 1: a 3rd param to `loadElf` / a new `NativeEmulator.loadLibraryChain`
that takes `{ primary: bytes, deps: bytes[] }`. The extension layer (this handoff)
builds the `deps[]` from `nemu_extract_apk_libs` + `nemu_inspect_imports`
heuristics, core does the actual multi-image relocation.

---

## Concrete next-agent steps

1. **Core API** — add multi-library load to `NativeEmulator`/`CpuEngine`:
   - `loadLibraryChain({ primary, deps })` that maps all images, merges
     `symbols` (union, first-writer wins), then relocates the primary against
     the merged symbol set + bionic.
   - New tool `nemu_load_library_chain` in `definitions.ts` / `handlers.impl.ts`
     exposing it (so an extension or the AI can drive it directly).
   - TDD: build a tiny `.so` pair where libA calls a function exported by libB;
     assert the cross-call returns before adding the API (red), then green.

2. **Extension** — under `plugins/` (see `packages/extension-sdk`), a
   `native-emulator-deps` provider that:
   - reads `nemu_inspect_imports` output for the target `.so`,
   - maps each unresolved symbol to a sibling `.so` in the same APK (by
     re-running `nemu_extract_apk_libs` + `nemu_inspect_imports` on each and
     matching export names),
   - assembles `{ primary, deps }` and calls `nemu_load_library_chain`.
   - logs the still-unresolved tail (so a human can decide whether to stub).

3. **Validate on the FFmpeg pair** — with the extension + chain loader,
   `libijkffmpeg.so` + `libffmpeg_remux.so` should lose the NULL indirect
   calls. Target: at least one plain export in each returns without faulting
   (don't assert specific algorithm output — FFmpeg internals are out of
   reverse-scope; "loads + links + runs an export" is the bar).

4. **Don't chase sqlite3_initialize deeper without a golden vector.** Its
   current fault (0x19001a0040000900) is inside the runtime-init path
   (mutex/global-config subsystem) and needs a memory-subsystem model decision,
   not another ISA hunt. If pursued, instrument `__errno` / `pthread_mutex_*`
   / `mmap` backings first; the ISA is not the blocker there.

---

## Files to touch

| file | change |
|------|--------|
| `src/modules/native-emulator/NativeEmulator.ts` | `loadLibraryChain({primary, deps})` |
| `src/modules/native-emulator/CpuEngine.ts` | multi-image `loadElf` (merge symbol maps, relocate primary against union) |
| `src/server/domains/native-emulator/definitions.ts` | `nemu_load_library_chain` tool def |
| `src/server/domains/native-emulator/handlers.impl.ts` | handler + chain input parsing |
| `tests/modules/native-emulator/CpuEngine.chain.test.ts` (new) | TDD cross-library call |
| `plugins/native-emulator-deps/` (new, via extension-sdk) | the provisioner extension |

## Verification bar (next agent must hit)

- New chain test: libA→libB cross-call returns the expected value (TDD).
- Re-probe the APK: `libijkffmpeg` + `libffmpeg_remux` plain exports run without
  NULL indirect call / unmapped access.
- Existing 366 tests stay green; `nemu_trace` SIMD capture still works.
- No committed vendor APK or hardcoded path — keep the `NEMU_INTEGRATION_APK`
  env-var contract.
