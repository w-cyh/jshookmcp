# World-Class ARM64 Emulator — Phase 1.1: FP Exception Handling

**目标**: 实现完整 IEEE754 异常处理，超越所有开源实现  
**TDD 策略**: 先写测试，红→绿→重构  
**验证标准**: 对齐 ARM Architecture Reference Manual + IEEE754-2008  

---

## 实现范围

### 1. FPCR (Floating-Point Control Register)
```
FPCR[31:27] — reserved
FPCR[26]    — AHP (Alternative Half-Precision)
FPCR[25]    — DN  (Default NaN mode)
FPCR[24]    — FZ  (Flush-to-Zero)
FPCR[23:22] — RMode (Rounding Mode): 00=RN, 01=RP, 10=RM, 11=RZ
FPCR[21:20] — Stride (deprecated, RAZ/WI)
FPCR[19]    — FZ16 (Flush-to-Zero for Half-Precision)
FPCR[18:16] — Len (deprecated, RAZ/WI)
FPCR[15]    — IDE (Input Denormal Exception trap enable)
FPCR[12]    — IXE (Inexact Exception trap enable)
FPCR[11]    — UFE (Underflow Exception trap enable)
FPCR[10]    — OFE (Overflow Exception trap enable)
FPCR[9]     — DZE (Divide by Zero Exception trap enable)
FPCR[8]     — IOE (Invalid Operation Exception trap enable)
```

### 2. FPSR (Floating-Point Status Register)
```
FPSR[31:28] — N, Z, C, V (condition flags)
FPSR[27]    — QC (cumulative saturation flag)
FPSR[7]     — IDC (Input Denormal cumulative)
FPSR[4]     — IXC (Inexact cumulative)
FPSR[3]     — UFC (Underflow cumulative)
FPSR[2]     — OFC (Overflow cumulative)
FPSR[1]     — DZC (Divide by Zero cumulative)
FPSR[0]     — IOC (Invalid Operation cumulative)
```

### 3. 异常检测

| 异常类型 | 触发条件 | 默认结果 |
|---------|---------|---------|
| **IOC** (Invalid Operation) | • NaN 参与运算<br>• ±∞ - ±∞<br>• 0 × ±∞<br>• ±∞ / ±∞<br>• 0 / 0<br>• sqrt(负数)<br>• 无效类型转换 | 返回 qNaN |
| **DZC** (Divide by Zero) | 非零数 / ±0 | ±∞ (符号继承被除数) |
| **OFC** (Overflow) | 结果绝对值 > max_normal | ±∞ (RN/RP/RM mode)<br>±max_normal (RZ mode) |
| **UFC** (Underflow) | 结果绝对值 < min_normal 且不精确 | ±0 (FZ=1)<br>denormal (FZ=0) |
| **IXC** (Inexact) | 结果需舍入 | 舍入结果 |
| **IDC** (Input Denormal) | 输入是 denormal 且 FZ=1 | flush to ±0 |

---

## TDD 测试用例（先写这些）

```typescript
// tests/modules/native-emulator/fp-exceptions.test.ts

describe('FP Exception Handling', () => {
  describe('IOC - Invalid Operation', () => {
    it('should set IOC for 0/0', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0); // default mode
      const result = engine.fdiv(0.0, 0.0);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1); // IOC bit
    });

    it('should set IOC for Inf - Inf', () => {
      const engine = new CpuEngine();
      const result = engine.fsub(Infinity, Infinity);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for sqrt(-1)', () => {
      const engine = new CpuEngine();
      const result = engine.fsqrt(-1.0);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for 0 * Inf', () => {
      const engine = new CpuEngine();
      const result = engine.fmul(0.0, Infinity);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });
  });

  describe('DZC - Divide by Zero', () => {
    it('should set DZC for 1.0/0.0 → +Inf', () => {
      const engine = new CpuEngine();
      const result = engine.fdiv(1.0, 0.0);
      expect(result).toBe(Infinity);
      expect(engine.getFPSR() & 0x2).toBe(2); // DZC bit
    });

    it('should set DZC for -1.0/0.0 → -Inf', () => {
      const engine = new CpuEngine();
      const result = engine.fdiv(-1.0, 0.0);
      expect(result).toBe(-Infinity);
      expect(engine.getFPSR() & 0x2).toBe(2);
    });

    it('should preserve sign for 1.0/-0.0 → -Inf', () => {
      const engine = new CpuEngine();
      const result = engine.fdiv(1.0, -0.0);
      expect(result).toBe(-Infinity);
      expect(1/result).toBeLessThan(0); // sign check
    });
  });

  describe('OFC - Overflow', () => {
    it('should set OFC for max_float * 2', () => {
      const engine = new CpuEngine();
      const MAX_FLOAT = 3.4028235e38;
      const result = engine.fmul32(MAX_FLOAT, 2.0);
      expect(result).toBe(Infinity);
      expect(engine.getFPSR() & 0x4).toBe(4); // OFC bit
    });

    it('should respect rounding mode RZ (toward zero)', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x00C00000); // RMode=11 (RZ)
      const MAX_FLOAT = 3.4028235e38;
      const result = engine.fmul32(MAX_FLOAT, 2.0);
      expect(result).toBe(MAX_FLOAT); // saturate to max, not Inf
      expect(engine.getFPSR() & 0x4).toBe(4); // still OFC
    });
  });

  describe('UFC - Underflow', () => {
    it('should set UFC for denormal result (FZ=0)', () => {
      const engine = new CpuEngine();
      const MIN_NORMAL = 1.1754943508222875e-38; // float32
      const result = engine.fmul32(MIN_NORMAL, 0.5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(MIN_NORMAL);
      expect(engine.getFPSR() & 0x8).toBe(8); // UFC bit
    });

    it('should flush to zero when FZ=1', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x01000000); // FZ=1
      const MIN_NORMAL = 1.1754943508222875e-38;
      const result = engine.fmul32(MIN_NORMAL, 0.5);
      expect(result).toBe(0);
      expect(engine.getFPSR() & 0x8).toBe(8); // still UFC
    });
  });

  describe('IXC - Inexact', () => {
    it('should set IXC for 1.0/3.0 (non-representable)', () => {
      const engine = new CpuEngine();
      const result = engine.fdiv(1.0, 3.0);
      expect(result).toBeCloseTo(0.3333333333333333);
      expect(engine.getFPSR() & 0x10).toBe(16); // IXC bit
    });

    it('should NOT set IXC for 1.0/2.0 (exact)', () => {
      const engine = new CpuEngine();
      const result = engine.fdiv(1.0, 2.0);
      expect(result).toBe(0.5);
      expect(engine.getFPSR() & 0x10).toBe(0);
    });
  });

  describe('Rounding Modes', () => {
    it('RN (Round to Nearest, ties to even)', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x00000000); // RMode=00 (RN)
      expect(engine.roundTiesToEven(2.5)).toBe(2); // even
      expect(engine.roundTiesToEven(3.5)).toBe(4); // even
      expect(engine.roundTiesToEven(2.4)).toBe(2);
      expect(engine.roundTiesToEven(2.6)).toBe(3);
    });

    it('RP (Round toward +Infinity)', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x00400000); // RMode=01 (RP)
      expect(engine.roundTowardPlusInf(2.1)).toBe(3);
      expect(engine.roundTowardPlusInf(-2.1)).toBe(-2);
    });

    it('RM (Round toward -Infinity)', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x00800000); // RMode=10 (RM)
      expect(engine.roundTowardMinusInf(2.1)).toBe(2);
      expect(engine.roundTowardMinusInf(-2.1)).toBe(-3);
    });

    it('RZ (Round toward Zero)', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x00C00000); // RMode=11 (RZ)
      expect(engine.roundTowardZero(2.9)).toBe(2);
      expect(engine.roundTowardZero(-2.9)).toBe(-2);
    });
  });

  describe('Cumulative Flags', () => {
    it('should accumulate multiple exceptions', () => {
      const engine = new CpuEngine();
      engine.fdiv(0, 0);    // IOC
      engine.fdiv(1, 0);    // DZC
      const fpsr = engine.getFPSR();
      expect(fpsr & 0x1).toBe(1); // IOC
      expect(fpsr & 0x2).toBe(2); // DZC
    });

    it('should clear FPSR on write', () => {
      const engine = new CpuEngine();
      engine.fdiv(0, 0);
      expect(engine.getFPSR() & 0x1).toBe(1);
      engine.setFPSR(0);
      expect(engine.getFPSR()).toBe(0);
    });
  });

  describe('Exception Trap (optional, default disabled)', () => {
    it('should NOT trap by default', () => {
      const engine = new CpuEngine();
      expect(() => engine.fdiv(0, 0)).not.toThrow();
    });

    it('should trap when IOE=1 (if implemented)', () => {
      const engine = new CpuEngine();
      engine.setFPCR(0x00000100); // IOE=1
      // Note: ARM toolchain doesn't support traps on AArch64
      // This is a "超越业界" feature
      expect(() => engine.fdiv(0, 0)).toThrow('FP Invalid Operation');
    });
  });
});
```

---

## 实现结构

### 新文件
```
src/modules/native-emulator/fp/
├── FpExceptions.ts          — 异常检测和 flag 设置
├── FpRounding.ts            — 四种舍入模式
├── FpConstants.ts           — float32/float64 边界常量
└── FpOperations.ts          — 包装 JS 原生操作 + 异常检测
```

### 修改文件
```
src/modules/native-emulator/
├── CpuEngine.ts             — 添加 fpcr/fpsr 字段，暴露 get/set
└── simd-fp.ts               — 所有 FP 操作改调 FpOperations
```

---

## 性能要求

**零开销原则**：
- 异常检测**只在操作后执行**（不预检）
- 使用位运算设置 flags（避免函数调用）
- 舍入模式用查表而非分支
- 默认模式（RN + 不陷入）走快速路径

**Benchmark 目标**：
- 异常检测开销 < 5% (vs 当前纯 JS 操作)
- 热路径（整数运算）不受影响

---

## Subagent 任务分配

我将启动 **3 个并行 subagent**，TDD 模式全速执行：

### Agent 1: 测试先行 [M]
**任务**: 编写完整测试套件（上面 40+ 用例）  
**交付**: `tests/modules/native-emulator/fp-exceptions.test.ts`

### Agent 2: 核心实现 [L]
**任务**: 实现 FpExceptions/FpRounding/FpOperations  
**交付**: `src/modules/native-emulator/fp/*.ts` 4 个文件

### Agent 3: 集成和验证 [M]
**任务**: 修改 CpuEngine/simd-fp，跑通测试，性能回归  
**交付**: 修改后的文件 + benchmark 报告

---

## 验证标准（世界第一要求）

✅ **功能完整性**
- [ ] 所有 5 种异常类型正确检测
- [ ] 4 种舍入模式符合 IEEE754-2008
- [ ] Cumulative flags 正确累积
- [ ] 可选陷入模式（超越 ARM 工具链限制）

✅ **正确性验证**
- [ ] 40+ TDD 测试全绿
- [ ] 对齐 ARM ARM (ARM Architecture Reference Manual)
- [ ] 与真实 ARM64 硬件行为一致（边界情况）

✅ **性能保证**
- [ ] 异常检测开销 < 5%
- [ ] 整数运算路径零影响
- [ ] Benchmark 数据证明

✅ **文档质量**
- [ ] 每个异常类型有详细注释
- [ ] 舍入模式有代码示例
- [ ] 与 IEEE754 标准的映射表

---

准备启动 3 个 subagent，你确认吗？

启动后我会监控进度，最终合并所有产出并验证。预计 **30-45 分钟**完成 Phase 1.1。
