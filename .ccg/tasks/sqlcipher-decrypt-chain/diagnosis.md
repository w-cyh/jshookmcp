# SQLCipher 解密链路 — 深度诊断结论

## 调用链
`sqlite3_open_v2` (thunk 0x186f14 → 0x186658) → `BL` PLT (0x496f10) → `sqlite3_initialize` (0x161cf4)

## 卡点
`sqlite3_initialize` 顺序执行 ~60 条指令到 `0x161e04`：
```
0x161dfc: ADRP x8, 0x4f4000
0x161e00: LDR  x8, [x8, #0xf08]   ; x8 = *(0x4f4f08)
0x161e04: BLR  x8                  ; 间接调用，无前置判空
```

## 根因（六重实证）
| 证据 | 结论 |
|------|------|
| `.init_array` 有 2 构造器，但 loadElf 从不执行 | **已修复**（ElfLoader.initializers + CpuEngine.runInitializers） |
| 2 个构造器实跑 11/9 条，不写 GlobalConfig | 构造器是 C++ thunk，与 SQLite init 无关 |
| slot `0x4f4f08` 在 PT_LOAD#3 (va=0x4f4bc0, filesz=0x5300) | FILE-BACKED (.data)，非 .bss |
| slot 磁盘值 = 0 | 静态初值就是 0 |
| ±0x40 内 0 个重定位 | 不靠 RELATIVE/GLOB_DAT 填充 |
| 运行时 0 次写入该地址 | initialize 走到 BLR 前没填它 |
| BLR x8 = 0 → 撞 RETURN_SENTINEL(0) | run loop 误判"返回"，open 提前结束 |

## 性质判断
slot `0x4f4f08` = `sqlite3GlobalConfig` 结构里的一个函数指针字段（很可能是内存分配器方法表 `.m.xInit` 或 mutex `.mutex.xMutexInit`）。

## 排查记录（已逐一排除）
| 假设 | 验证方法 | 结论 |
|------|---------|------|
| RELA 解析有 bug 漏了该 slot | 直接扫原始 DT_RELA 表(19560)+DT_JMPREL(305) | 解析 100% 完整(19865=19865)，slot 确实不在表里 |
| DT_RELR 紧凑重定位漏解析 | 查 dynamic tags | 无 DT_RELR |
| DT_ANDROID_RELA packed 重定位漏解析 | 查 dynamic tags | 无（误读，实际是 DT_RELACOUNT 0x6ffffff9） |
| .init_array 构造器填充该 slot | 单步 2 个构造器 | 否，构造器是 11/9 条的 C++ thunk，不写 GlobalConfig |
| open 路径 vs 直接 initialize 行为不同 | 并排 trace 66 条 | 完全相同——都在 BLR 0 假返回 |

## 剩余不确定性
slot `0x4f4f08` 在真机上的值未知。两种可能：
- **(A)** 真机上非 0，由某段我们没执行的初始化代码填充（如 SQLCipher 特有的 provider 注册、或 SQLite 内联的静态结构 memcpy 经一条我们译码错误的指令）→ 仿真器缺口
- **(B)** 真机上也是 0，但真机控制流在到达此 BLR 前就走别的分支（即我们某条 CBZ/CBNZ/条件判断的标志位算错，导致控制流走偏）→ 仿真器指令语义 bug

无 aarch64 真机/qemu 对照，无法纯静态区分 A/B。需要的下一步是**用 qemu-user 或真机 dlopen 跑同一 .so 取 0x4f4f08 真值**做对照，或**逐条核对 0x161cf4-0x161e04 这 66 条指令的译码正确性**（特别是设置 NZCV 标志的指令）。

---

## ✅ 根因确证：STUR 指令实现 bug（2026-05-30 续）

继续逐指令核对后，**假设 (A) 确证，且根因是单个指令 bug，非 OS 层缺失**。

链路：`sqlite3_initialize` 内联了 `sqlite3MutexInit`（mutex.c:230）。当 `xMutexAlloc==0` 时，它把默认 mutex 方法表（noop 实现 `0x19586c`=`MOV w0,wzr;RET`，**已在 .text，无需任何 OS 层**）通过一串 **CSEL + STUR** 拷进 `sqlite3GlobalConfig.mutex`。拷完 `0x4f4f08`=`xMutexInit` 应=noop 函数地址，`BLR` 正常。

**但 `STUR Xt,[Xn,#imm9]`（unscaled offset store）在 CpuEngine 里是坏的**：`execLoadStore` line 1453 `const addr = idx === 0b11 ? base + imm9 : base` 把 unscaled(idx=00) 错当 post-index 语义（访问 base、不加 imm9）。所有 `STUR/LDUR x,[xn,#非0]` 都访问错误地址 `base`，store 静默丢失。→ mutex 表没拷进去 → `xMutexInit`=0 → `BLR 0` 假返回。

**最小复现**（`scripts/verify-stur.ts`）：`STUR x1,[x2,#16]` 后内存 = 0（应=写入值），`STUR xzr,[x2,#24]` 没清零。修复前 BROKEN，修复后 WORKS。

**修复**：line 1447-1460，正确区分三种 idx——
- `idx=00` unscaled：addr=`base+imm9`，无回写
- `idx=01` post-index：addr=`base`，回写 `base+imm9`
- `idx=11` pre-index：addr=`base+imm9`，回写

**影响面**：unscaled load/store 是极常见指令，此 bug 影响**所有** `.so` 的执行正确性，远不止 sqlcipher。修复后 open_v2 从 89→136 条指令、initialize 从 BLR-NULL 崩溃→113 条 ran-to-return、0 个 NULL 间接调用。

**范围更正**：之前判断"需要 L-XL SQLite OS 抽象层"是**错的**——noop mutex 表本就在 .so 里，根本不需要实现 OS 层，只是 STUR bug 让拷贝失效。

**SQLCipher 完整链路现状**：mutex 初始化已通，但 db handle 仍 NULL（open 走到更深处，涉及 mem 分配/VFS 等后续路径，可能还有同类指令或集成缺口待查）。STUR 修复 + .init_array 是本轮两个确定成果。



真机上它由 SQLite 的**内存子系统默认初始化**填充——这条路径在编译期静态聚合初始化器 `sqlite3GlobalConfig = {..., {sqlite3MemMalloc, ...}, ...}` 里，函数指针经 **RELATIVE 重定位**填真实地址。

**但本 `.so` 的该字段磁盘=0 且无重定位** → 说明这个 SQLCipher build 把内存方法表的初始化**推迟到运行时**（`sqlcipher_init_memmethods` 符号存在），由一个我们没触发的初始化函数填充。

## 候选缺口
1. `sqlcipher_init_memmethods` / `sqlcipher_openssl_setup` 未被调用 → 内存/crypto provider 方法表为空
2. SQLite `sqlite3_initialize` 期望 host 提供的某个 hook（Android 的 `sqlite3_os_init` 走 unix VFS，依赖 `mmap`/`open` syscall + pthread mutex stub）

## 次生设计问题
`RETURN_SENTINEL = 0` 导致 `BLR`/`BR` 到真实地址 0（NULL 函数指针调用，真机上是 SIGSEGV）被误判为正常返回。诊断期应让 BLR/BR 到 0 抛"NULL indirect call"而非静默停机，否则这类缺口会伪装成"ran to return"。
