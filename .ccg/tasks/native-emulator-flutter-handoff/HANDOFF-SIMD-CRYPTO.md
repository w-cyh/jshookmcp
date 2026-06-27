# HANDOFF — native-emulator SIMD/FP/Crypto 实现（Phase C 完成，D–G 待续）

> 写于 2026-05-30。承接 `HANDOFF.md`（整数 ISA 那一轮）。本文档只覆盖**新开的 SIMD/FP/crypto 硬件指令实现**这条线。
> **先读这份，再读项目记忆 `native-emulator-android-a-plan.md` 和根 `CLAUDE.md` 的 native-emulator changelog。**

---

## 0. 第一句话怎么开（建议直接对新上下文说）

> 读 `D:\coding\reverse\jshookmcp\.ccg\tasks\native-emulator-flutter-handoff\HANDOFF-SIMD-CRYPTO.md`，然后跑
> `npx vitest run tests/modules/native-emulator/simd-crypto-aes.test.ts tests/modules/native-emulator/simd-loadstore.test.ts --reporter=dot`
> 确认 13 测试绿，再继续 Phase D（SHA1/SHA256 + PMULL）。

---

## 1. 为什么有这条线（关键背景，别重蹈覆辙）

上一轮把整数 ISA 补全后，在 capabilities / CLAUDE.md 里**诚实声明了**"NEON/SIMD/FP 与 AES/SHA crypto-extension 未实现"。
**用户对此强烈不满**，原话：「诚实声明 NEON/SIMD/FP 与 AES/SHA crypto-extension 未实现你他妈未实现倒是实现啊」。

→ 意图非常明确：**不要再用"声明未实现"当挡箭牌，要真正把它实现出来。** 主线是 Flutter 逆向，native 下沉的签名/加密算法（AES/SHA/HMAC）几乎都走 ARMv8 crypto-extension 硬件指令，不实现这些就没法仿真真实加密 `.so` 的热路径。

**正确性标准（用户隐含但严格）**：bit-exact 对齐官方测试向量（AES → FIPS-197；SHA → NIST FIPS-180-4），**不是近似、不是占位**。

**范围诚实边界（允许保留）**：不是要实现全部数千条 NEON 变体。目标是"加密/签名 `.so` 热路径端到端 bit-exact 跑通"——crypto 全做、load/store 全做、标量 FP 核心做、NEON 整数按探针命中补。剩余长尾仍可诚实记录，但能力描述要从"NEON 完全未实现"变成"NEON/crypto 已实现 + 覆盖清单 + 探针数据"。

---

## 2. 七阶段计划与当前进度

| Phase | 内容 | 状态 |
|-------|------|------|
| A | V 寄存器文件（32×128bit）+ `simd.ts` 基础设施 + `SimdContext` 接口 | ✅ 完成（已落盘，未单独 commit） |
| B | SIMD load/store（LDR/STR/LDP/STP/literal of B/H/S/D/Q） | ✅ 完成，9 测试绿 |
| C | AES crypto（AESE/AESD/AESMC/AESIMC，FIPS-197 验证） | ✅ **刚完成，4 测试绿（含完整 10 轮加密 bit-exact）** |
| D | SHA1/SHA256 hash 指令 + PMULL（GHASH/GCM），NIST 向量验证 | ⬜ 待做（下一步） |
| E | 标量 FP（IEEE754）：FMOV/FADD/FSUB/FMUL/FDIV/FNEG/FABS/FSQRT、FCVT、SCVTF/UCVTF/FCVTZS/FCVTZU、FCMP/FCMPE、FCSEL | ⬜ 待做 |
| F | NEON 整数 SIMD 核心子集（探针命中驱动）：ADD/SUB/MUL/AND/ORR/EOR/NOT/BIC、MOVI/MVNI、DUP、EXT、REV64/32/16、USHR/SSHR/SHL、CNT、ADDV、TBL/TBX、CMEQ/CMGT、UZP/ZIP/TRN 等 | ⬜ 待做 |
| G | 探针复跑 + 文档诚实更新（capabilities/CLAUDE.md/definitions/metadata:sync），全套 vitest+tsc+oxlint 绿，commit | ⬜ 待做 |

TaskCreate 里对应 #9–#15（#9/#10 completed，#11 刚 in_progress→可标 completed，#12–#15 pending）。

---

## 3. 已落盘且验证通过（可信）

### 新文件
| 文件 | 内容 |
|------|------|
| `src/modules/native-emulator/simd.ts` | SIMD/FP 分派器。两个入口：`executeSimdLoadStore`（load/store 组 V=1）、`executeSimdFp`（DP 组 bits[28:25]=x111）。定义 `SimdContext` 窄接口（结构化类型，CpuEngine 用私有访问器满足，零名义依赖）。 |
| `src/modules/native-emulator/simd-crypto.ts` | crypto 原语，独立验证。已实现 AES：`aese/aesd/aesmc/aesimc`，含 FIPS-197 标准 S-box / 逆 S-box、`gfmul`、`shiftRows/invShiftRows`（列主序）、`mixColumns/invMixColumns`。**SHA/PMULL 的注释占位已在文件头写好，但函数体未写**。 |
| `tests/modules/native-emulator/simd-loadstore.test.ts` | 9 测试：LDR/STR Q/D/S/B、寄存器偏移、LDP/STP、literal。全绿。 |
| `tests/modules/native-emulator/simd-crypto-aes.test.ts` | 4 测试：原语级 AES-128 全流程 → FIPS-197 密文 bit-exact；AESD/AESIMC 往返；指令级 AESE+AESMC；指令级完整 10 轮。全绿。 |

### 改动的文件
| 文件 | 改动 |
|------|------|
| `src/modules/native-emulator/CpuEngine.ts` | 加 `vreg: Uint8Array[32]` + `vview: DataView[]` 字段；公共 `readVReg/writeVReg`；私有 `vGet128/vSet128/vGetLane/vSetLane/simdContext()`；`execute()` 派发加 `(op0 & 0b0111)===0b0111 → executeSimdFp`；`execLoadStore()` 开头加 `(insn>>>26)&1===1 → executeSimdLoadStore`。 |

### 验证结果（2026-05-30 实测）
- `npx tsc --noEmit -p tsconfig.json` → **干净，零错误**
- AES + load/store 共 **13 测试全绿**
- FIPS-197 已知答案：key `2b7e1516…`、明文 `3243f6a8…` → 密文 `3925841d02dc09fbdc118597196a0b32` bit-exact（原语级 + 指令级双重证明）

---

## 4. 关键技术决策（避免下一位踩坑）

1. **AES 指令解码掩码**：`(insn & 0xfffe0c00) === 0x4e280800`，opcode 在 bits[16:12]（AESE=0b00100/AESD=0b00101/AESMC=0b00110/AESIMC=0b00111）。已用 node 核验固定位是 [31:17]+[11:10]，与非 AES SIMD 指令不碰撞。
2. **ARM AESE 指令顺序**：AESE = AddRoundKey(XOR Vn) → ShiftRows → SubBytes（注意是先 XOR 再 Shift 再 Sub，和教科书"SubBytes 在前"不同）。一个完整轮 = AESE + AESMC；最后一轮省 MixColumns，最终 AddRoundKey 是普通 EOR。
3. **AES state 列主序**：byte i → (row i%4, col i/4)；ShiftRows 行 r 左转 r；MixColumns 是 GF(2^8) 多项式 0x11b 矩阵乘。
4. **TS 类型陷阱（已解决）**：`Uint8Array.from(...)` 实际产 `Uint8Array<ArrayBuffer>`，但裸 `Uint8Array` 标注默认 `ArrayBufferLike`，赋值给 `let state` 会冲突。**解法**：simd-crypto 导出函数返回类型显式标 `Uint8Array<ArrayBuffer>`（更诚实）；测试 `xor` helper 同样标。**项目禁止 `as` 断言**，别用 `as` 绕。
5. **`noUncheckedIndexedAccess`**：复合赋值 `s[i] ^= x` 会因左侧 `number|undefined` 报错，改成 `s[i] = (s[i] ?? 0) ^ x`。
6. **simd.ts 入口约定**：两个 execute 函数返回 `true` 表示消费了指令，`false` 让 CpuEngine 走它原本诚实的 "Unsupported opcode" throw —— 缺口保持可见可测，和整数核一致。**别破坏这个约定**。

---

## 5. 下一步：Phase D（SHA + PMULL）怎么做

### SHA256（FIPS-180-4）
ARMv8 SHA256 指令：`SHA256H`/`SHA256H2`（主压缩，配对使用，更新两个 V 寄存器的工作变量 a–h）、`SHA256SU0`/`SHA256SU1`（消息调度 W[16..63]）。
- 编码：SHA256H = `0x5E004000 | (Rm<<16)|(Rn<<5)|Rd`，SHA256H2 = `0x5E005000|…`，SU0 = `0x5E282800|(Rn<<5)|Rd`，SU1 = `0x5E006000|(Rm<<16)|(Rn<<5)|Rd`。**务必汇编核验**（本机无 aarch64 工具链，靠 ARM ARM C7.2 伪码 + 手算）。
- 验证向量：FIPS-180-4 的 `"abc"` → `ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad`。SHA256 单块就够，先做单块 known-answer。
- 实现放 `simd-crypto.ts` 的 `sha256h/sha256h2/sha256su0/sha256su1`，纯函数，再在 `executeSimdFp` 加解码分支。

### SHA1（可选，FIPS-180-4）
SHA1C/P/M（选择/奇偶/多数轮）、SHA1H（rol30）、SHA1SU0/SU1。优先级低于 SHA256（现代加密库多用 SHA256），按探针命中决定做不做。

### PMULL/PMULL2（GHASH/GCM）
**carry-less GF(2)[x] 多项式乘**，不是普通乘法，必须手写：64×64→128 位无进位乘。AES-GCM 的 `.so` 会用。编码 `0x0E20E000`（PMULL）/`0x4E20E000`（PMULL2），size=00（8→16）或 size=11（64→128，需 crypto-ext）。验证用 NIST GCM test vector 的 GHASH 中间值，或自己拿 `H·X mod P` 小例子手算。

### 套路（和 Phase C 一致）
1. 先写 `scripts/_verify_shaXXX.mjs` 用官方向量验证算法本身 bit-exact（**写到 scripts/，node 跑，别用 heredoc**）；
2. 落 `simd-crypto.ts` 纯函数；
3. `executeSimdFp` 加解码分支；
4. 写 `tests/modules/native-emulator/simd-crypto-sha.test.ts`（原语级 + 指令级双层，仿 AES 测试结构）；
5. tsc + vitest 绿。

---

## 6. ⚠️ 铁律（这个环境/项目特有，违反会出事）

- **绝不用 heredoc（`cat <<EOF`）写多行文件**——本环境反复损坏。写文件用 Write 工具，改用 Edit，验证脚本 Write 到 `scripts/` 再 `node`/`npx tsx` 跑。
- **禁止 `as` 类型断言**——用 parseArgs 工具或显式类型标注。
- **Subagent spawn 在本环境失效**（秒返回 400，tokens=0）——全程主 agent 串行做，别浪费轮次 spawn。
- **绝不 `git push --no-verify`**——hook 失败就修根因。
- **commit 隔离**：工作树有**预存的、与本线无关的** jadx-search→binary-instrument 合并改动（`docs/`、`src/server/domains/binary-instrument/*`、`src/server/domains/jadx-search/*` 删除、`README*` 等）。**commit native-emulator SIMD 工作时只 `git add` 这些文件**：
  - `src/modules/native-emulator/simd.ts`
  - `src/modules/native-emulator/simd-crypto.ts`
  - `src/modules/native-emulator/CpuEngine.ts`
  - `tests/modules/native-emulator/simd-loadstore.test.ts`
  - `tests/modules/native-emulator/simd-crypto-aes.test.ts`
  - （Phase D 起再加 simd-crypto-sha.test.ts 等）
  - **不要 `git add -A` / `git add .`**，会把无关合并工作扫进去。
- **可删的临时文件**：`scripts/_verify_aes.mjs`（已完成使命，AES 验证已固化进测试）。Phase D 的 `_verify_sha*.mjs` 同理用完即删。
- **CLAUDE.md 文件在本仓被 gitignore**——改 changelog 不会进 commit，但仍要改（本地 source of truth）。

---

## 7. 探针（Phase G 用，实证缺口收敛）

`scripts/native-emulator-probe.ts`（上一轮已建）扫 `.tmp_mcp_artifacts/jadx-apk-test/resources/lib/arm64-v8a/*.so`（15 个真实 arm64 库，FFmpeg/WebRTC/JNI），逐个 load→relocate→call/trace，汇总仍 throw 的 opcode 直方图。
- 上一轮结论：15 库全映射+重定位，多数整数函数 ran-to-return，**残余未实现全是 NEON/FP**（如 `0xfc1e0fe8`、`0x3dc31900` 等）——这正是本线要吃掉的。
- Phase G：复跑探针，对比"实现 crypto/FP/NEON 后残余 opcode 直方图"的收敛，把数据写进 capabilities 和 CLAUDE.md，**用真实数据替代"声明未实现"**。
- `.so` 不入库、探针不入 CI。

---

## 8. 当前 git 工作树快照（2026-05-30）

native-emulator SIMD 线的未跟踪/改动文件（应进 commit 的）：
```
 M src/modules/native-emulator/CpuEngine.ts
?? src/modules/native-emulator/simd.ts
?? src/modules/native-emulator/simd-crypto.ts
?? tests/modules/native-emulator/simd-crypto-aes.test.ts
?? tests/modules/native-emulator/simd-loadstore.test.ts
?? scripts/_verify_aes.mjs   ← 删掉，别 commit
```
其余 M/D（docs、binary-instrument、jadx-search、README）都是**预存的无关合并工作，不要碰**。

Phase C 尚未单独 commit。下一位可选择：先把 A+B+C 一起 commit（一个绿灯基线），再开 Phase D；或继续做完 D 再一起 commit。建议**先 commit A+B+C 作为回滚点**（计划 Phase 0 精神）。
