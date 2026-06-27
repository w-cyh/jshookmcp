# L0 优化结果 — 底层性能优化（autonomous 模式）

> 日期：2026-05-29 | 方式：benchmark 驱动，profile 定位瓶颈，无悔优化

## 成果：5.3x 加速

| 阶段 | ns/指令 | 指令/秒 | 关键改动 |
|------|---------|---------|---------|
| baseline | 72.84 | 13.73M | （初始自研解释器） |
| #6 取指/控制流 | 45.87 | 21.80M | PC 改 number（去 BigInt churn）+ 取指缓存代码区域（去每步 findRegion 线性扫描） |
| #7 解码/掩码 | **13.79** | **72.51M** | 内联位提取（去 field() 调用）+ `BigInt.asUintN` 替代 `& MASK64` + ADD 无移位快路径 |

## 数据驱动的关键发现

微基准（/tmp profile）分离出真实瓶颈，**推翻了直觉**：
- 瓶颈不在指令解码（field 调用），而在 **BigInt 64 位掩码运算**
- `(a + b) & MASK64` = 41ns/op；纯加法仅 20.66ns；`BigInt.asUintN(64,...)` = 26ns
- → asUintN 比 `& MASK64` 更快，是无悔替换

## 守住的设计原则

- **寄存器值保留 BigInt**：64 位算术语义必需，不为性能牺牲精度（不退回 number）
- **PC/SP 改 number**：它们是地址（< 2^53），无精度损失，纯收益
- **正确性优先**：每轮优化后 benchmark 内置 x0 校验 + 5 功能测试全绿，杜绝"优化破坏语义"

## 产物
- `scripts/native-emulator-bench.ts` — 可复现吞吐 benchmark（best-of-8，含语义校验）
- benchmark 可作为后续里程碑的回归基线
