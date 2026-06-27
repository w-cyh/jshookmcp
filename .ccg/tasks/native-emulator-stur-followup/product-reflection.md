# native-emulator 产品级反思：暴露的问题 + agent 调用可靠性

> 写于 2026-05-30，基于 STUR 修复后的全库基线重测实证数据。
> 数据源：`.ccg/tasks/native-emulator-stur-followup/baseline-{before,after}.json`

用户问：**"jshookmcp 暴露出来的问题都是啥，正常 agent 框架调用 tool 能行吗？"**

下面 4 个问题按严重度排序，每个都有本会话/上会话的实证支撑，不是空谈。

---

## 问题 1（最严重）：RETURN_SENTINEL=0 让失败信号系统性不可靠

### 缺陷机理（代码坐实）
- `RETURN_SENTINEL = 0`（CpuEngine.ts:40）——callSymbol 在 LR 放哨兵值 0，PC 到 0 即停机当作"返回"。
- run loop：`while (this.pc !== stopAt)`（CpuEngine.ts:523），`stopAt=0`。
- BLR Rn（CpuEngine.ts:861-867）：`this.pc = target`，**无 NULL 检查**。当 `target=0`（调用未初始化的函数指针），PC 立即 = 0，满足停机条件。

于是：**一次 NULL 函数指针调用（真机必 SIGSEGV）被静默当成"函数正常返回"。** RET 到哨兵 0（合法返回）和 BLR 到 0（崩溃）在 run loop 里无法区分。

### 量化证据
全库 15 个 .so、340 次盲调：
- **suspiciousReturns = 108**（"返回"了但最后一条指令不是 RET → 极可能是 BLR/BR 到 0）
- ranToRet = 107（最后一条是 RET 的可信返回）

**超过一半的"成功返回"是假的。** 检测方法：instruction hook 记录最后执行的指令，若 callSymbol 正常返回但 `isRet(lastInsn)===false`，就是假返回。

### 这正是 STUR bug 藏了 20+ 轮的原因
上会话语义压测 sqlite3_open_v2 时，它"跑 89 条指令正常返回"——看起来成功。实则 mutex 表因 STUR 写丢变 NULL，`BLR xMutexInit`=`BLR 0` 撞哨兵假装返回。**假返回信号把一个内存写入 bug 伪装成了"ran-to-return"。**

### 对 agent 的隐患（直接回答用户的问题）
任何 agent workflow 调 `nemu_call_symbol` 拿到"成功返回 x0=某值"，在缺乏合法输入时有 **>50% 概率**这个"成功"是脱轨后撞 NULL 的假信号。agent 无从分辨。**"工具返回成功" ≠ "语义正确"** 在这里是量化事实，不是理论担忧。下游任何基于 native-emulator 输出做判断的自动化都可能被假信号误导。

### 建议修复（精确方案，未擅自改——属研究范围外）
run loop 区分两种到达 pc=0：
- **RET 把 LR(=哨兵 0)写进 PC** → 合法返回，照常停机。
- **BLR/BR 把寄存器值(恰好=0)写进 PC** → 抛 `NULL indirect call (likely uninitialized function pointer at <caller pc>)`，而非静默停机。

实现要点：在 BLR/BR 分支里，若 `target===0` 直接抛错（带 caller PC）；RET 分支不受影响（它本就该到哨兵）。我的基线脚本已用 `isRet(lastInsn)` 在外部验证了这个区分可行——真正修复应内化进 CpuEngine。代价极小（BLR/BR 分支加一个 `if`），收益是失败信号从"系统性不可靠"变"可信"。

---

## 问题 2：盲调 opcode 直方图不是有效的能力度量

### 实证
记忆里的"FFmpeg 94 个未实现 opcode"是盲调 `[0,0,0,0]` 统计出来的。本会话重测发现：
- STUR 修复**前后基线完全一致**（所有指标 delta=0，已用 git worktree 验证 worktree 确是旧版）。
- 改进的三分类显示：340 次盲调里真实 opcode 缺口只有 **1 个**（FMOV scalar），其余是 21 个 data-like 噪音（零字/小整数/ASCII 字符串）+ 103 个 other（unmapped/steplimit）。

### 为什么失明
盲调用全 0 参数，函数极早脱轨（解引用 NULL / 走偏分支）。PC 一旦走进数据区，"撞到的 opcode"是随机数据字节，跟 ISA 实现完整度无关。STUR 修复对盲调基线无感，正因为盲调根本走不到 STUR 写入正确性会影响结果的深度。

### 教训
- opcode 直方图只能发现"撞未实现 opcode"，发现不了深层执行 bug（内存写丢、控制流走偏、假返回）。
- 有效度量必须是**语义级压测**：编排真实调用链 + 合法参数 + 校验 API 契约（bionic 调用次数、返回值符合契约、无 NULL 间接调用）。
- "94"这个数字本身误导了之前所有结论，应当从能力评估里彻底剔除。

---

## 问题 3：盲调脱轨率高（other=103/340 ≈ 30%）暴露输入构造缺失

340 次里 103 次以 unmapped-memory / step-limit 告终（既非 opcode 缺口也非返回）。这说明绝大多数导出符号**没有合法输入就跑不到有意义的深度**。

对 agent 的含义：`nemu_call_symbol` 对"给定符号名 + 瞎填参数"的用法基本无效。要真正逆向一个 native 函数，agent 必须先理解它的签名（JNI 函数有 JNIEnv*/jobject/具体 jtype 参数）并构造合法输入——这是高门槛，当前工具没有任何辅助（没有签名推断、没有参数模板）。

**建议**：给 nemu 工具加"可疑返回"启发式告警，在工具响应里直接标注——例如 `{returned: true, suspicious: true, reason: "ended on BLR/BR not RET; possible NULL indirect call"}`、或 `hostCalls: 0`（0 次 bionic 调用却"成功"很可疑）、或返回值=入参指针。让 agent 不必自己侦测假信号。

---

## 问题 4：SQLCipher 仍未跑通，可能还藏同类 bug

上会话 STUR 修复后，sqlite3_open_v2 从 89→136 条指令（mutex init 通了），但 **db handle 仍 NULL**——后续内存分配/VFS 路径待查。这不是 OS 层缺失，是更多同类执行细节（可能还有未发现的指令语义 bug）。STUR 的教训是：在假返回信号被修复前，"跑通"判断都不可全信。

---

## 总回答：正常 agent 框架调用 tool 能行吗？

**分两面：**

**工具机制层面：能。** load/extract/call/trace/JNI mock 这套 MCP 工具链是通的——15/15 真实 .so 全部映射+重定位成功，会话隔离、并发安全、graceful shutdown 都到位。作为"AI 可激活的进程内 ARM64 仿真器"，接口设计是合格的。

**仿真保真+信号可靠层面：当前不能盲信。** 两个结构性问题：
1. **失败信号不可靠**（问题 1）——>50% 假返回率，agent 拿到"成功"无法确认语义正确。
2. **缺有效自检**（问题 3）——没有签名辅助、没有可疑返回告警，agent 容易拿瞎填参数的脱轨结果当真。

**对 agent workflow 的建议**：
- 短期：任何依赖 nemu 输出的自动判断都应交叉验证（看 trace 最后是否 RET、bionic 调用次数、返回值契约），别只看"成功"。
- 应做：修问题 1 的 NULL 间接调用检测（小改动，大幅提升信号可信度）+ 加问题 3 的可疑返回启发式告警。
- 方法论：用语义级压测替代盲调 opcode 直方图作为能力评估手段。

一句话：**jshookmcp 的 native-emulator 作为"给人用的逆向辅助"可用（人能看 trace 自己判断），但作为"给 agent 自动调用、信其返回值"的工具，必须先修复失败信号的可靠性。**
