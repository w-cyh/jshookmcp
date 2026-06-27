# Phase 1.1 性能优化：降低 FP 异常开销到 < 5%

**目标**: 从当前 838% 降低到 < 5%  
**策略**: 快速路径 + 延迟检测 + 位运算优化  
**并行执行**: 3 个 subagent（分析 + 实现 + 验证）

---

## 当前性能瓶颈分析

### Baseline（纯 JS）
```javascript
const result = a + b;  // ~1.57 ms / 1M ops
```

### 当前实现（838% 开销）
```javascript
const result = a + b;
const flags = {
  ioc: detectInvalidOperation(result, 'add', a, b),  // 函数调用
  // ... 其他检查
};
this.checkAndSetFlags(result, flags);  // 另一个函数调用
```

### 瓶颈识别
1. **函数调用开销**：每次操作 2-3 次函数调用
2. **不必要检查**：默认 FPCR=0 时多数检测无效
3. **分支预测失败**：NaN/Inf 检查分支
4. **FPSR 更新**：每次都读写

---

## 优化策略

### 策略 1: 快速路径（预计减少 90% 开销）

**检测默认配置**：
```typescript
class FpContext {
  private fpcr = 0;
  private fpsr = 0;
  private fastPath = true;  // FPCR=0 时启用
  
  setFPCR(value: number): void {
    this.fpcr = value;
    this.fastPath = (value === 0);  // 只在纯默认时启用
  }
  
  fadd(a: number, b: number): number {
    const result = a + b;
    
    if (this.fastPath) {
      // 快速路径：只检查 NaN（最常见异常）
      if (Number.isNaN(result)) {
        this.fpsr |= 1;  // IOC，位运算直接设置
      }
      return result;
    }
    
    // 完整路径：调用现有逻辑
    return this.faddSlow(a, b);
  }
}
```

### 策略 2: 内联检测（预计减少 50% 开销）

**消除函数调用**：
```typescript
fadd(a: number, b: number): number {
  const result = a + b;
  
  if (this.fastPath) {
    // 内联 IOC 检测
    if (Number.isNaN(result)) this.fpsr |= 1;
    return result;
  }
  
  // 完整检测内联
  let flags = 0;
  if (Number.isNaN(result)) flags |= 1;  // IOC
  // ... 其他检测内联
  if (flags) {
    this.fpsr |= flags;
    if (this.fpcr & 0x1F00) this.checkTraps(flags);  // 只在有 trap 时调用
  }
  return result;
}
```

### 策略 3: SIMD 批量检测（预计减少 30% 开销）

**向量化异常检测**：
```typescript
// 4 个操作批量检测
faddx4(a: Float64Array, b: Float64Array, result: Float64Array): void {
  let anyNaN = false;
  for (let i = 0; i < 4; i++) {
    result[i] = a[i] + b[i];
    anyNaN ||= Number.isNaN(result[i]);
  }
  if (anyNaN) this.fpsr |= 1;  // 只设置一次
}
```

### 策略 4: 延迟标志更新（预计减少 20% 开销）

**批量提交**：
```typescript
class FpContext {
  private pendingFlags = 0;  // 待提交的 flags
  
  fadd(a: number, b: number): number {
    const result = a + b;
    if (Number.isNaN(result)) this.pendingFlags |= 1;
    return result;
  }
  
  getFPSR(): number {
    this.fpsr |= this.pendingFlags;  // 读取时才提交
    this.pendingFlags = 0;
    return this.fpsr;
  }
}
```

---

## 优化路线图

### Phase A: 快速路径（Agent 7）
- 实现 `fastPath` 检测
- 内联 NaN 检测
- Benchmark: 预计 838% → ~80%

### Phase B: 内联优化（Agent 8）
- 消除所有慢路径函数调用
- 使用位运算直接操作 FPSR
- Benchmark: 预计 80% → ~15%

### Phase C: 极致优化（Agent 9）
- SIMD 批量检测
- 延迟标志更新
- JIT 友好代码结构
- Benchmark: 预计 15% → **< 5%**

---

## 测试要求

每个优化阶段必须：
1. ✅ 所有 53 个 FP 异常测试仍然通过
2. ✅ 性能 benchmark 显示改进
3. ✅ 回归测试（609 个 native-emulator 测试）
4. ✅ 边界情况不变（NaN/Inf/±0 处理）

---

## 性能目标

| 优化阶段 | 目标开销 | ADD (ns) | DIV (ns) |
|---------|---------|---------|---------|
| **当前** | 838% | 13 | 33 |
| Phase A | ~80% | 3 | 8 |
| Phase B | ~15% | 2 | 5 |
| **Phase C** | **< 5%** | **< 1.5** | **< 3** |

---

## 兼容性保证

优化**不能**改变：
- 异常检测正确性
- FPSR 累积行为
- 陷入触发时机
- 舍入模式语义

所有优化都是**性能层面的等价变换**。
