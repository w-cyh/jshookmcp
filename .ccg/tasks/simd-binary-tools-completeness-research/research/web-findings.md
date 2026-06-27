# Web Search Findings — SIMD/Binary Tools Industry Standards

## 1. ARM Floating Point Standards

### IEEE 754 Compliance
- ARM's floating-point environment implements IEEE 754-1985 standard
- Hardware support provides accuracy comparable to x86 for all standard mathematical operations
- ARM pseudocode uses infinite precision (`real` type) to ensure conformance
- **Limitation**: ARM Compiler toolchain does NOT support floating-point exception trapping for AArch64

### Emulation Libraries
- SEGGER and qfplib-m3 provide software emulation libraries for systems without hardware FP
- Libraries optimized for either code size or execution speed
- Assembly-optimized versions available for ARM targets

**Sources:**
- [ARM IEEE 754 implementation choices](https://developer.arm.com/docs/ddi0360/e/vfp-programmers-model/compliance-with-the-ieee-754-standard/ieee-754-standard-implementation-choices)
- [ARM Floating-Point Support User Guide](https://developer.arm.com/docs/100073/0601/floating-point-support/about-floating-point-support)

---

## 2. Industry Binary Emulation Tools

### QEMU
- **ARM64 crypto support**: FEAT_AES (AESD, AESE instructions) fully supported
- **SHA256**: Can be implemented using NEON instructions (40-50% speedup for blocks >256 bytes)
- **Implementation strategy**: Uses internal crypto logic to emulate instruction pipeline, NOT external libraries
- **Performance**: 2-5x overhead for binary instrumentation (AFL++ qemuafl mode)

**Sources:**
- [QEMU A-profile CPU architecture support](https://www.qemu.org/docs/master/system/arm/emulation.html)
- [QEMU crypto code consolidation](https://www.berrange.com/posts/2016/03/31/improving-qemu-security-part-1-crypto-code-consolidation/)
- [ARM AArch64cryptolib](https://github.com/ARM-software/AArch64cryptolib)

### Unicorn Engine
- **Architecture support**: ARM, AArch64, M68K, Mips, Sparc, PowerPC, RiscV, S390x, TriCore, X86
- **Key advantage**: Fine-grained instrumentation with customized handlers for CPU execution and memory access
- **Limitation**: No explicit documentation found on NEON crypto extension completeness
- **Use case**: Preferred for dynamic instrumentation over QEMU (which lacks native instrumentation hooks)

**Sources:**
- [Unicorn Engine GitHub](https://github.com/unicorn-engine/unicorn)
- [Unicorn vs QEMU](https://www.unicorn-engine.org/docs/beyond_qemu.html)

### Unidbg
- Java-based Android native library emulator
- Supports ARM32 and ARM64
- Designed specifically for Android reverse engineering workflows
- **Not found**: Specific SIMD/crypto extension coverage documentation

**Sources:**
- [unidbg GitHub](https://github.com/zhkl0228/unidbg)
- [AndroidNativeEmu](https://github.com/crazyxw/AndroidNativeEmu)

---

## 3. NEON SIMD Implementation Landscape

### ARM Official Guidance
- **NEON availability**: Standard on ARMv8-A (both AArch32 and AArch64)
- **Vector width**: Fixed 128-bit (vs x86's 256/512-bit AVX/AVX2)
- **Scalable extensions**: SVE/SME (up to 2048 bits) for HPC workloads
- **Saturating instructions**: Documented by ARM, clamp overflow to min/max instead of wrapping

**Sources:**
- [ARM NEON Programmer's Guide](https://developer.arm.com/architectures/instruction-sets/simd-isas/neon/neon-programmers-guide-for-armv8-a/introducing-neon-for-armv8-a/single-page)
- [Saturating Advanced SIMD instructions](https://developer.arm.com/docs/100069/0600/advanced-simd-and-floating-point-programming/saturating-advanced-simd-instructions)

### Community Implementations
- **neon_sim**: C++ implementation of ARM NEON intrinsics (partial, not production-grade)
- **Windows on ARM Prism**: Recently added AVX/AVX2 emulation for x64 apps (cross-architecture focus)
- **Gap**: No complete open-source NEON emulator found targeting 100% instruction coverage

**Sources:**
- [neon_sim GitHub](https://github.com/zchrissirhcz/neon_sim)
- [Windows on Arm Prism Emulator AVX support](https://windowsforum.com/threads/windows-on-arm-prism-emulator-now-emulates-avx-and-avx2-for-x64-apps.385854/)

---

## 4. Android Reverse Engineering Tooling

### Frida
- **Strength**: Function-level dynamic instrumentation, no APK modification required
- **Limitation**: Lacks instruction-level granularity (critical for obfuscated code)
- **Common pairing**: Frida + QBDI (QBDI provides instruction-level introspection)
- **SIMD support**: Can detect SIMD availability but doesn't provide deep instruction analysis

**Sources:**
- [Frida Android Guide](https://can-ozkan.medium.com/dynamic-instrumentation-on-android-with-frida-a-practical-guide-878f492144ff)
- [Frida + QBDI combination](https://blog.quarkslab.com/why-are-frida-and-qbdi-a-great-blend-on-android.html)
- [Detecting SIMD on ARM Android](https://gendignoux.com/blog/2022/11/09/rust-simd-detect-arm-android.html)

### QBDI (QuarksLab Dynamic Binary Instrumentation)
- **Instruction coverage**: Thumb, Thumb2, tested against Epona/O-LLVM/Arxan obfuscators
- **Android support**: Native library analysis with instruction-level tracing
- **Complements Frida**: Fills the instruction-granularity gap

**Sources:**
- [Android Native Library Analysis with QBDI](https://blog.quarkslab.com/android-native-library-analysis-with-qbdi.html)

---

## 5. Crypto Implementation Patterns in Android

### AES/SHA Usage
- **JNI + NDK**: Common pattern for performance-critical crypto (avoid Java overhead)
- **Hardware acceleration**: ARMv8 crypto extensions (AES, SHA1, SHA256, PMULL) widely used in production libraries
- **Real-world examples**: 
  - `libsqlcipher.so` (AES-256 SQLite encryption)
  - Android's BoringSSL (TLS stack)
  - RootBeer (`libtoolChecker.so`) detection libraries

**Sources:**
- [android-aes-jni](https://github.com/panxw/android-aes-jni)
- [AES on Android Kotlin + C++](https://github.com/Mercandj/aes-android)
- [Qiling Android Library Emulation](https://kos0ng.gitbook.io/notes/research/2023/emulating-android-native-library-using-qiling-part-1)

---

## 6. Gap Analysis: What Research DIDN'T Find

### Missing Information
1. **No comprehensive NEON instruction frequency analysis** for mobile reverse engineering workloads
2. **No public benchmarks** comparing saturating/widening NEON usage in production Android apps
3. **Unicorn Engine NEON completeness**: No explicit documentation on supported vs unsupported NEON variants
4. **Unidbg crypto coverage**: No detailed specification of which crypto extensions are implemented
5. **Industry emulator roadmaps**: No 2025-2026 SIMD/crypto feature plans found for major emulators

### What This Means
- Most emulators document *architecture support* (ARM64: yes/no) but not *feature completeness* (which NEON variants)
- Crypto extension support is binary (present/absent) without granularity on specific instruction subsets
- Real-world coverage is best validated through empirical testing (probing with actual libraries)
