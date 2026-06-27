# Phase D 实施计划 — ARMv8 SHA256/SHA1 + PMULL crypto 硬件指令

> 承接 `HANDOFF-SIMD-CRYPTO.md`。Phase A/B/C（V 寄存器文件 + SIMD load/store + AES）已完成，13 测试绿。
> 本计划覆盖 Phase D：SHA256 主线 + PMULL + SHA1（可选）。

## 需求

**目标**：在自建 ARM64 解释器中实现 ARMv8 crypto-extension 的 SHA/PMULL 硬件指令，bit-exact 对齐 NIST FIPS-180-4 官方测试向量，让走 SHA256/HMAC/GCM 的真实加密 `.so` 热路径能端到端仿真。

**约束**：
- bit-exact，非近似、非占位（用户隐含严格标准）
- 禁 `as` 断言，禁 heredoc 写多行（用 Write/Edit + scripts/ 验证脚本）
- 不破坏 `executeSimdFp` 的 `true=消费/false=透传 throw` 约定（缺口保持可见可测）
- 不碰工作树里预存的无关合并改动（docs/binary-instrument/jadx-search 等）

**范围**（文件）：
- 改 `src/modules/native-emulator/simd-crypto.ts` — 新增 SHA/PMULL 纯函数
- 改 `src/modules/native-emulator/simd.ts` — `executeSimdFp` 加解码分支
- 新增 `tests/modules/native-emulator/simd-crypto-sha.test.ts` — 原语级 + 指令级双层
- 临时 `scripts/_verify_sha256.mjs`（验证算法后即删）

**验收标准**：`npx tsc --noEmit` 干净；新测试全绿；FIPS-180-4 `"abc"` → `ba7816bf…f20015ad` 单块 bit-exact（原语级 + 指令级双重证明）。

## 方案

延续 Phase C 已验证的套路：**先用官方向量验证算法本身，再落纯函数，再接解码器，再写双层测试**。

关键技术点（来自 ARM ARM C7.2 伪码，无本机 aarch64 工具链，靠手算 + FIPS 向量兜底）：

**SHA256 三寄存器组**（`(insn & 0xFFE08C00) === 0x5E000000`，opcode=`(insn>>12)&7`）：
- `SHA256H`（opcode=0b100, 0x5E004000）：4 轮压缩，更新 {a,b,c,d}
- `SHA256H2`（opcode=0b101, 0x5E005000）：配对，更新 {e,f,g,h}（Qn = SHA256H 前的旧 abcd）
- `SHA256SU1`（opcode=0b110, 0x5E006000）：消息调度 W[t] 第二步
- SHA256H/H2 用 ARM 伪码 `SHAchoose/SHAmajority/SHAhashSIGMA0/SIGMA1`（ROR 2/13/22 与 6/11/25）

**SHA256 两寄存器组**：
- `SHA256SU0`（0x5E282800）：消息调度第一步（sigma0，ROR 7/18 + LSR 3）

**PMULL/PMULL2**（`0x0E20E000` / `0x4E20E000`，size=00 或 11）：
- carry-less GF(2)[x] 多项式乘，非普通乘法，必须手写 64×64→128 无进位乘
- PMULL 取低 64 位，PMULL2 取高 64 位

**SHA1（可选，优先级低）**：SHA1C/P/M（同三寄存器组 opcode 0/1/2）、SHA1H（两寄存器组 rol30）、SHA1SU0/SU1。现代库多用 SHA256，按需决定是否本轮做。

正确性证明策略：SHA256H/H2/SU0/SU1 单条语义靠 ARM 伪码实现，但**最终用"composed 完整单块 → FIPS abc 摘要 bit-exact"**反证每条语义正确（与 Phase C 用完整 10 轮 AES 反证 AESE/AESMC 一致）。

## 步骤

1. **scripts/_verify_sha256.mjs** — 用纯 JS 实现 SHA256H/H2/SU0/SU1 伪码，组装成完整单块压缩，断言 `"abc"` → FIPS 摘要 bit-exact。**先证算法，再落生产代码。**
2. **simd-crypto.ts** — 落 `sha256h/sha256h2/sha256su0/sha256su1` 纯函数（输入输出 16 字节小端 V 寄存器序，返回类型显式标 `Uint8Array<ArrayBuffer>`）。
3. **simd-crypto.ts** — 落 `pmull(a, b)` carry-less 64×64→128 纯函数。
4. **simd.ts** — `executeSimdFp` 加 SHA256 三寄存器组 + 两寄存器组 + PMULL 解码分支（放在 AES 分支后，保持 false 透传约定）。
5. **tests/.../simd-crypto-sha.test.ts** — 原语级（FIPS abc 单块）+ 指令级（构造指令字 → 跑 executeSimdFp → 对齐摘要）双层。PMULL 用小例子 `H·X mod P` 手算或 NIST GCM GHASH 中间值验证。
6.（可选）SHA1 同套路，按是否需要决定。
7. **验证**：`npx tsc --noEmit -p tsconfig.json` + `npx vitest run tests/modules/native-emulator/ --reporter=dot`，全绿后删 `_verify_sha256.mjs`。

## 影响范围

- **修改**：`simd-crypto.ts`（+SHA/PMULL 纯函数）、`simd.ts`（+解码分支）
- **新增**：`tests/modules/native-emulator/simd-crypto-sha.test.ts`、临时 `scripts/_verify_sha256.mjs`（用完删）
- **测试**：现有 13 测试不受影响；新增 SHA/PMULL 测试预计 6-10 个
- **commit 隔离**：只 `git add` native-emulator SIMD 线文件（见 HANDOFF §6），绝不 `git add -A`

## 范围决策（请审批时选择）

- **A. 仅 SHA256 + PMULL**（推荐）：覆盖现代加密库主流热路径，范围聚焦
- **B. SHA256 + PMULL + SHA1 全做**：覆盖更全，但 SHA1 现代库少用，多 ~3-4 个函数 + 测试
