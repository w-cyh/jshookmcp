# Phase 1.2: NEON Widening/Saturating 完整实现

**目标**: 补全所有 NEON 长尾指令，消除"诚实边界"  
**并行执行**: 3 个 subagent（测试 + widening + saturating）

---

## Widening 指令范围（Agent 5）

### 加减法扩展
- SADDL/UADDL, SADDL2/UADDL2 — 窄+窄→宽
- SADDW/UADDW, SADDW2/UADDW2 — 宽+窄→宽
- SSUBL/USUBL, SSUBL2/USUBL2 — 窄-窄→宽
- SSUBW/USUBW, SSUBW2/USUBW2 — 宽-窄→宽
- ADDHN/RADDHN, ADDHN2/RADDHN2 — 宽+宽→窄（高半部）
- SUBHN/RSUBHN, SUBHN2/RSUBHN2 — 宽-宽→窄（高半部）

### 乘法扩展
- SMULL/UMULL, SMULL2/UMULL2 — 窄×窄→宽
- SMLAL/UMLAL, SMLAL2/UMLAL2 — 宽+窄×窄
- SMLSL/UMLSL, SMLSL2/UMLSL2 — 宽-窄×窄
- SQDMULL/SQDMULL2 — 饱和倍乘扩展
- SQDMLAL/SQDMLAL2 — 饱和倍乘累加
- SQDMLSL/SQDMLSL2 — 饱和倍乘累减

### 其他扩展
- SADDLP/UADDLP — 成对加法扩展
- SADALP/UADALP — 累积成对加法扩展
- SXTL/UXTL, SXTL2/UXTL2 — 符号/零扩展（实际是 SSHLL/USHLL #0）
- SSHLL/USHLL, SSHLL2/USHLL2 — 左移扩展

**预计**: ~30 条指令，~600 行代码

---

## Saturating 指令范围（Agent 6）

### 算术饱和
- SQADD/UQADD — 饱和加法
- SQSUB/UQSUB — 饱和减法
- SUQADD/USQADD — 无符号饱和加有符号/有符号饱和加无符号

### 移位饱和
- SQSHL/UQSHL — 饱和左移（寄存器）
- SQSHL/UQSHL (imm) — 饱和左移（立即数）
- SQRSHL/UQRSHL — 饱和舍入左移
- SQSHLU — 无符号饱和左移有符号
- SQSHRN/UQSHRN, SQSHRN2/UQSHRN2 — 饱和右移窄化
- SQRSHRN/UQRSHRN, SQRSHRN2/UQRSHRN2 — 饱和舍入右移窄化
- SQSHRUN/SQSHRUN2 — 无符号饱和右移窄化有符号
- SQRSHRUN/SQRSHRUN2 — 无符号饱和舍入右移窄化有符号

### 乘法饱和
- SQDMULH/SQRDMULH — 饱和倍乘高位/舍入
- SQDMULL/SQDMULL2 — 饱和倍乘扩展（也在 widening）
- SQDMLAL/SQDMLAL2 — 饱和倍乘累加（也在 widening）
- SQDMLSL/SQDMLSL2 — 饱和倍乘累减（也在 widening）

### 窄化饱和
- SQXTN/UQXTN, SQXTN2/UQXTN2 — 饱和窄化
- SQXTUN/SQXTUN2 — 无符号饱和窄化有符号

### 其他饱和
- SQABS — 饱和绝对值
- SQNEG — 饱和取负

**预计**: ~25 条指令，~500 行代码

---

## LD2/LD3/LD4 De-interleave（Agent 4）

### Load de-interleave
- LD2 {Vt.T, Vt2.T}, [Xn] — 2 路交错
- LD3 {Vt.T, Vt2.T, Vt3.T}, [Xn] — 3 路交错
- LD4 {Vt.T, Vt2.T, Vt3.T, Vt4.T}, [Xn] — 4 路交错
- LD2/3/4 post-index 和 register offset

### Store interleave
- ST2/ST3/ST4 对应版本

### Single-structure
- LD1/ST1 {Vt.T}[lane], [Xn] — 单 lane 加载
- LD2/ST2 {Vt.T, Vt2.T}[lane], [Xn] — 双 lane 交错
- LD3/ST3/LD4/ST4 对应版本

**预计**: ~15 条指令，~400 行代码

---

## TDD 测试用例（Agent 4）

### Widening 测试（20+）
```typescript
describe('NEON Widening Instructions', () => {
  it('SADDL: 8→16 signed add long', () => {
    // [1,2,3,4,5,6,7,8] + [10,20,30,40,50,60,70,80] 
    // → [11,22,33,44,55,66,77,88] (16-bit)
  });
  
  it('SADDL overflow preserves sign', () => {
    // [127, 127] + [1, 1] → [128, 128] (不饱和)
  });
  
  it('SMULL: 16×16→32', () => {
    // [100, -100] × [200, 200] → [20000, -20000]
  });
  
  it('SXTL: sign extension 8→16', () => {
    // [255, 1] → [-1, 1] (符号扩展)
  });
  
  // ... 20+ 更多
});
```

### Saturating 测试（20+）
```typescript
describe('NEON Saturating Instructions', () => {
  it('SQADD: saturate on overflow', () => {
    // 127 + 1 → 127 (int8), 设置 QC flag
  });
  
  it('SQSUB: saturate on underflow', () => {
    // -128 - 1 → -128 (int8), 设置 QC flag
  });
  
  it('SQSHL: saturate shift left', () => {
    // 64 << 2 → 127 (int8 max)
  });
  
  it('SQXTN: saturate narrowing 16→8', () => {
    // [256, -129] → [127, -128]
  });
  
  // ... 20+ 更多
});
```

### LD2/3/4 测试（15+）
```typescript
describe('NEON De-interleave Load/Store', () => {
  it('LD2 de-interleaves 2 vectors', () => {
    // mem: [a0,b0,a1,b1,a2,b2,a3,b3]
    // → va: [a0,a1,a2,a3], vb: [b0,b1,b2,b3]
  });
  
  it('ST2 interleaves 2 vectors', () => {
    // va: [1,2,3,4], vb: [10,20,30,40]
    // → mem: [1,10,2,20,3,30,4,40]
  });
  
  it('LD3 handles 3-way interleave', () => {
    // RGB pixel data test
  });
  
  // ... 15+ 更多
});
```

---

## 编码规则

### Widening/Saturating 通用模式
```
AdvSIMD three different / two-reg misc / scalar
bits[31] = 0 (vector) / 1 (scalar)
bits[30] = Q (size)
bits[29] = U (unsigned)
bits[28:24] = 01110 (AdvSIMD)
bits[23:22] = size
bits[21:10] = opcode
bits[9:5] = Rn
bits[4:0] = Rd
```

### LD2/3/4 编码
```
bits[31] = 0
bits[30] = Q
bits[29:23] = 0001100
bits[22] = L (load/store)
bits[21] = 0
bits[20:16] = Rm (post-index)
bits[15:12] = opcode (0000=LD4, 0100=LD3, 1000=LD2, etc.)
bits[11:10] = size
bits[9:5] = Rn
bits[4:0] = Rt
```

---

## 性能要求

- 解码开销 < 10 ns/指令
- 内存访问（LD2/3/4）使用批量 API
- 饱和检测用位运算（避免分支）
- QC flag 设置只在实际饱和时执行
