# M0 结果 — GO/NO-GO 评估

> 阶段：A 方案地基验证（进程内 ARM64 仿真）
> 日期：2026-05-29
> 方式：TDD（红→实现→绿）+ 性能量化
> **2026-05-29 更新：因 GPL 合规问题，弃用 vendored unicorn.js，改为纯自研零依赖 ARM64 解释器。**

## 判定：**GO** ✅（自研路线）

进程内 ARM64 仿真可行。**最终实现为纯自研解释器**，零运行时依赖、许可证完全干净。

## 路线转向记录

| 阶段 | 实现 | 结果 | 弃用原因 |
|------|------|------|---------|
| 初版 | vendored unicorn.js (WASM) | 5/5 绿，加载 105ms / 内存 6.6MB | **GPL-2.0 与本项目 AGPL-3.0 不兼容** |
| **最终** | **自研 ARM64 解释器** | **5/5 绿，测试执行 4ms** | — |

自研版优势：① 许可证干净（ISA 不受版权保护）② 无 3MB WASM 加载 ③ 寄存器用 BigInt 真 64 位（无 unicorn.js i64-via-number 精度坑）④ 完全可控的内存/指令/instrumentation hook。

## 自研实现要点

- 寄存器文件：x0..x30 用 `bigint[]`，XZR（编码 31）读 0 写丢弃；sp/pc 独立
- 内存：多区域 `Uint8Array`，越界访问抛错
- 解码策略：**目标驱动增量** —— 只实现实际遇到的指令类，未实现 opcode 抛出 hex（`Unsupported ARM64 opcode 0x...`），每条新指令配一个 TDD 测试
- 已实现指令：MOVZ（move wide immediate）、ADD（shifted register，含 LSL/LSR/ASR）
- 执行模型：M0 仅线性执行（无分支/访存/syscall），带 100 万步 runaway guard

## TDD 闭环

- 测试：`tests/modules/native-emulator/CpuEngine.test.ts`，5 用例（加载/add/mov 立即数/实例隔离/未知寄存器报错）
- 实现：`src/modules/native-emulator/CpuEngine.ts`（纯自研，零依赖）
- 结果：**5/5 绿**，测试执行 4ms
- 质量门禁：typecheck 零报错、oxlint exit=0

## ⚠️ 自研路线的真实代价（取代原 GPL 风险）

GPL 合规问题已通过自研根除。但代价转移到工程量：

1. **L0 从"白嫖 unicorn"变成"XL 自建"** —— ARM64 是大指令集，完整实现工程量极大。
2. **缓解策略：目标驱动增量** —— 不实现完整 ISA，只实现目标 .so 实际用到的指令（签名/加密函数通常只用几十种）。遇到未实现 opcode 即报错待补，契合 TDD。
3. **保真度风险** —— 自研解释器的指令语义正确性需大量测试保障，复杂指令（NEON/浮点/条件标志）实现成本高。
4. **后续里程碑不变** —— M1 ELF loader、M2 libc、M3 syscall、M4 JNI 桥的工作量不受 L0 自研影响（它们本就要自建）。

## 下一步（M1）

ELF loader + 内存管理：解析 ELF64、PT_LOAD 段映射、ARM64 重定位、.dynsym/.dynstr 符号表。
L0 自研解释器会随 M1+ 实际加载的 .so 持续补充指令（增量 TDD）。
