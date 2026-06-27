# C1 Z3 集成 — Phase 3 详细实施计划（方案 2 激进）

> ⚠️ 用户选择方案 2（激进）。纯 Z3 + babel 完整 JS 表达式 + 2 新工具 + BMC K≤12。工具数 494→496。工期 16-20 天。

---

## 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Z3 导入 | `import { init } from 'z3-solver/node'` | 显式 node 入口 |
| 单例 | 模块级 lazy getter + 内部 mutex | Z3 非 thread-safe |
| init 失败 | 缓存失败，不重试 | 避免重复加载 |
| 超时 | `solver.set('timeout', N)` + 外层 `Promise.race` | 双层 |
| **exploit-dev 降级** | **greedy 仅作 Z3 init 失败 fallback**（非并存参数） | 纯 Z3，但保留兜底防 init 失败全瘫 |
| **analysis 表达式转换** | **@babel/parser AST → Z3 AST** | 完整 JS 表达式覆盖，复用项目已有 babel |
| ROP 建模 | BMC，K=1..12 递增 | 激进，求更优链 |
| 新工具 | 2 个：`exploit_solve_constraints` + `exploit_verify_rop_chain` | 评分冲 9.8 |
| 工具输入 | JS 表达式数组（复用 babel 转换器） | LLM 友好 |

### 与方案 1 的关键差异

| 维度 | 方案 1（保守） | 方案 2（激进，本计划） |
|------|---------------|---------------------|
| RopBuilder solver 参数 | `auto\|z3\|greedy` 并存 | 移除参数，纯 Z3；仅 init 失败才 greedy |
| analysis 表达式 | 手写 DSL parser | @babel/parser 转 Z3 |
| 新工具数 | 1 | 2 |
| BMC K 上界 | 8 | 12 |
| 工具数 | 495 | 496 |
| 工期 | 9-12 天 | 16-20 天 |
| 风险 | 低 | 中-高 |

---

## 实施步骤

### Layer 1: 基础设施（无依赖，顺序写）

#### L1.1 — `tsdown.config.ts`
- `'z3-solver'` 加入 `deps.neverBundle`

#### L1.2 — `src/constants/sandbox.ts`
```ts
/* Z3 SMT solver */
export const Z3_INIT_TIMEOUT_MS = int('Z3_INIT_TIMEOUT_MS', 5_000);
export const Z3_SOLVE_TIMEOUT_MS = int('Z3_SOLVE_TIMEOUT_MS', 10_000);
export const Z3_BMC_MAX_GADGETS = int('Z3_BMC_MAX_GADGETS', 12);  // 方案2: 12
export const Z3_ENABLED = bool('Z3_ENABLED', true);
```

#### L1.3 — `src/modules/z3/Z3Solver.ts`（新文件）
单例 + lazy init + mutex + timeout + fail-soft（同方案 1）

#### L1.4 — `tests/modules/z3/Z3Solver.test.ts`（新文件，TDD）
init 成功/失败缓存/mutex 串行/timeout

### Layer 2: Babel→Z3 表达式转换器（依赖 L1.3，方案 2 核心）

#### L2.1 — `src/modules/z3/ast-bridge.ts`（新文件）
@babel/parser 解析 JS 表达式 → 递归转 Z3 AST：
```ts
import { parseExpression } from '@babel/parser';
import * as t from '@babel/types';

export function jsExprToZ3(expr: string, ctx: Context, varDecls: Map<string, Z3Var>): Z3AST {
  const ast = parseExpression(expr, { sourceType: 'unambiguous' });
  return visitNode(ast, ctx, varDecls);
}

function visitNode(node, ctx, vars): Z3AST {
  switch (node.type) {
    case 'NumericLiteral': return ctx.Int.val(node.value);  // or BitVec
    case 'Identifier': return vars.get(node.name);  // 声明的变量
    case 'BinaryExpression':
      const l = visitNode(node.left, ...);
      const r = visitNode(node.right, ...);
      switch (node.operator) {
        case '+': return l.add(r);
        case '-': return l.sub(r);
        case '*': return l.mul(r);
        case '/': return l.div(r);
        case '<': return l.lt(r);
        case '>': return l.gt(r);
        case '<=': return l.le(r);
        case '>=': return l.ge(r);
        case '==': case '===': return l.eq(r);
        case '!=': case '!==': return l.neq(r);
      }
      break;
    case 'LogicalExpression':
      const ll = visitNode(node.left, ...);
      const rr = visitNode(node.right, ...);
      switch (node.operator) {
        case '&&': return ll.and(rr);
        case '||': return ll.or(rr);
      }
      break;
    case 'UnaryExpression':
      const arg = visitNode(node.argument, ...);
      switch (node.operator) {
        case '!': return arg.not();
        case '-': return arg.neg();
      }
      break;
    case 'ParenthesizedExpression': return visitNode(node.expression, ...);
  }
  throw new Error(`Unsupported node: ${node.type}`);
}
```

#### L2.2 — `tests/modules/z3/ast-bridge.test.ts`（新文件，TDD）
- 各 BinaryExpression 操作符
- LogicalExpression && ||
- UnaryExpression ! -
- 嵌套 `!(x > 10 && y < 5)`
- BitVec vs Int 模式
- 不支持的节点抛错

### Layer 3: analysis 集成（依赖 L1.3 + L2.1）

#### L3.1 — `src/modules/symbolic/SymbolicExecutor.ts`
- 新增 `private async solveConstraintsZ3(paths, warnings): Promise<void>`
- 用 `jsExprToZ3` 把 `pathConstraints[].expression` 转 Z3 AST
- 变量声明：从 constraints 收集所有 Identifier → `Int.const(name)`
- `solver.add(And(...allConstraints))` → check
- sat: `path.isFeasible=true` + 提取 model（遍历变量求值）
- unsat: `path.isFeasible=false` + warnings 记录
- **纯 Z3**：`enableConstraintSolving=true` 时直接用 Z3；init 失败才回退 `simpleSMTSolver`（标记 fallback）
- 移除 `simpleSMTSolver`？**不**——保留作 init 失败 fallback，但加注释 "legacy fallback, Z3 is primary"

#### L3.2 — `tests/modules/symbolic/SymbolicExecutor.test.ts`（扩展）
- Z3 SAT: `["x > 10", "x < 20"]` → sat, model `{x: 15}`
- Z3 UNSAT: `["x > 10", "x < 5"]` → unsat
- 复合: `["x > 0", "y > 0", "x + y < 10"]` → sat
- 逻辑: `["!(x > 10 && y < 5)"]` → 转换正确
- Z3 降级：mock init 失败 → 回退正则 solver，warnings 含降级
- 现有正则 solver 测试保持绿（fallback 路径）

### Layer 4: exploit-dev 集成（依赖 L1.3 + L2.1）

#### L4.1 — `src/server/domains/exploit-dev/handlers/rop-builder.ts`
- 新增 `private async solveConstraintsZ3(constraints, gadgets, arch): Promise<Gadget[]>`
- BMC 建模（K=1..12）：
  - 寄存器 BitVec(64/32)
  - 候选 gadget 转移语义（从 GadgetEffects）
  - goal 约束（execve/write_memory/call_function）
  - 第一个 sat 的 K 返回
- `buildChain` **移除 solver 参数**（纯 Z3）；init 失败才调 `solveConstraints`（greedy）
- 返回加 `solverUsed` + `warnings`

#### L4.2 — `src/server/domains/exploit-dev/handlers.impl.ts`
- `handleBuildRopChain` 返回结构加 `solverUsed`, `warnings`
- 新增 `handleSolveConstraints` 方法
- 新增 `handleVerifyRopChain` 方法

#### L4.3 — `src/server/domains/exploit-dev/definitions.ts`
- 加 `exploit_solve_constraints` 工具定义
- 加 `exploit_verify_rop_chain` 工具定义

#### L4.4 — `src/server/domains/exploit-dev/manifest.ts`
entries 加：
```ts
{ tool: 'exploit_solve_constraints', method: 'handleSolveConstraints' },
{ tool: 'exploit_verify_rop_chain', method: 'handleVerifyRopChain' },
```

#### L4.5 — `tests/server/domains/exploit-dev/exploit-dev.test.ts`（扩展）
- 现有 execve 测试改用 Z3 solver（断言链长度合理 + solverUsed='z3'）
- Z3 init 失败降级 greedy（solverUsed='greedy' + warning）
- BMC K 递增验证

#### L4.6 — `tests/server/domains/exploit-dev/solve-constraints.test.ts`（新文件）
- sat/unsat/model/BitVec/timeout/unavailable

#### L4.7 — `tests/server/domains/exploit-dev/verify-rop-chain.test.ts`（新文件，方案2新增）
- 给定 ROP chain + goal → Z3 验证是否满足约束
- valid chain → sat
- invalid chain（缺 syscall gadget）→ unsat
- partial chain → unknown/unsat

### Layer 5: 新工具实现（依赖 L2 + L4）

#### L5.1 — `src/server/domains/exploit-dev/handlers/solve-constraints.ts`（新文件）
```ts
export async function handleSolveConstraints(args): Promise<ToolResponse> {
  // constraints: string[] (JS 表达式), variables: [{name,type,bits}], timeout, getModel
  return handleSafe(async () => {
    const result = await z3.withSolver(async (ctx, solver) => {
      const vars = declareVariables(ctx, variables);
      for (const c of constraints) {
        solver.add(jsExprToZ3(c, ctx, vars));
      }
      const res = await solver.check();
      if (res === 'sat') {
        const model = await solver.model();
        return { sat: true, model: extractModel(model, vars) };
      }
      return { sat: false, model: null };
    }, timeout);
    if (result === null) return { sat: null, error: 'Z3 unavailable', solverUsed: 'none' };
    return { ...result, solverUsed: 'z3' };
  });
}
```

#### L5.2 — `src/server/domains/exploit-dev/handlers/verify-rop-chain.ts`（新文件，方案2）
```ts
export async function handleVerifyRopChain(args): Promise<ToolResponse> {
  // chain: string (hex), gadgets: Gadget[], goal: ExploitGoal, arch
  // → 用 Z3 验证 chain 是否满足 goal 约束
  // 解析 chain 成 gadget 地址序列 + placeholder 值
  // 模拟执行 gadget 序列，检查最终寄存器状态是否满足 goal
  return handleSafe(async () => { ... });
}
```

### Layer 6: 文档（最后）

#### L6.1 — `src/server/domains/exploit-dev/CLAUDE.md`
- Z3 solver 说明（纯 Z3，init 失败降级 greedy）
- 工具表加 `exploit_solve_constraints` + `exploit_verify_rop_chain`
- 设计决策：为什么纯 Z3 + babel

#### L6.2 — `src/modules/CLAUDE.md`
- modules 表加 `z3/` (2 files: Z3Solver, ast-bridge)

#### L6.3 — `.ccg/tasks/military-grade-audit/handoff.md`
- Round 3 C1 完成状态追加（评分 exploit 9.5→9.8, analysis 8.0→8.5）

---

## 测试策略

| 文件 | 类型 | TDD |
|------|------|-----|
| `tests/modules/z3/Z3Solver.test.ts` | 新增 | ✅ 先写 |
| `tests/modules/z3/ast-bridge.test.ts` | 新增 | ✅ 先写（方案2核心） |
| `tests/modules/symbolic/SymbolicExecutor.test.ts` | 扩展 | ✅ 先写 Z3 用例 |
| `tests/server/domains/exploit-dev/exploit-dev.test.ts` | 扩展 | ✅ 先写 |
| `tests/server/domains/exploit-dev/solve-constraints.test.ts` | 新增 | ✅ 先写 |
| `tests/server/domains/exploit-dev/verify-rop-chain.test.ts` | 新增 | ✅ 先写（方案2） |

**Z3 集成测试 guard**：`describe.skipIf(!process.env.Z3_TEST_REAL)` 包真实 Z3，CI 默认 mock，本地 `Z3_TEST_REAL=1` 跑真实。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| WASM 打包断 | neverBundle + smoke test |
| Z3 init 失败全瘫 | 保留 greedy/simpleSMTSolver 作 init 失败 fallback（非并存参数） |
| babel→Z3 转换边界 | ast-bridge.test.ts 全操作符覆盖 + 错误抛出测试 |
| BMC K=12 超时 | timeout + 降级 |
| 现有测试回归 | 现有 execve 测试断言改为兼容 Z3 输出（链长度范围而非精确值） |
| 工具数 gate | +2 = 496，metadata:check 验证 |

---

## 验收 Gate（每 Layer 后跑）

| Gate | 命令 | 标准 |
|------|------|------|
| 类型 | `npx tsc --noEmit` | 0 新增（SyscallResolver 2 预存除外） |
| 测试 | `pnpm test` | 14731+ pass |
| 工具数 | `pnpm metadata:check` | 496 |
| 模式 | 人工核 | manifest ✓ |
| 安全 | 人工核 | 不内置 payload |
| 功能 | smoke test | Z3 init + check + model + verify 全通 |

---

## 执行顺序（Claude 顺序写，不并行）

```
L1.1 → L1.2 → L1.3 → L1.4 (gate: tsc+test)
  → L2.1 → L2.2 (gate: tsc+test)  [babel bridge 核心]
    → L3.1 → L3.2 (gate: tsc+test+metadata)  [analysis]
      → L4.1 → L4.2 → L4.3 → L4.4 → L4.5 → L4.6 → L4.7 (gate)  [exploit-dev]
        → L5.1 → L5.2 (gate: metadata=496)  [2 新工具]
          → L6.1 → L6.2 → L6.3 (文档)
```

每个 gate 失败则停下修复，不跳过。

## 进度日志

### L1 完成 (2026-06-25)

| Step | 文件 | 状态 |
|------|------|------|
| L1.1 | `tsdown.config.ts` (+`z3-solver` neverBundle) | ✅ |
| L1.2 | `src/constants/sandbox.ts` (+4 Z3 常量，补 `bool` import) | ✅ |
| L1.3 | `src/modules/z3/Z3Solver.ts` (单例 + lazy init + mutex + timeout + fail-soft) | ✅ |
| L1.4 | `tests/modules/z3/Z3Solver.test.ts` (11 tests, real/mock 双模式) | ✅ |

**验证**:
- `node scripts/z3-smoke.mjs` 真实 WASM 加载 OK（init 147ms, sat/unsat 正确）
- `npx tsc --noEmit` 0 新增错误（仅 2 个预存 SyscallResolver）
- `Z3_TEST_REAL=1` 11/11 pass（含真实 WASM sat/unsat + mutex 串行验证）
- 无 `Z3_TEST_REAL` 7 pass + 4 skipped（CI mock 模式）

**关键发现**:
- z3-solver v4.16.0 `exports: null`，`main: build/node.js` 是 CommonJS。ESM `import { init } from 'z3-solver'` 由 Node CJS interop 解析正常工作（smoke test 证实），无需 `/node` 后缀（后缀反而 ERR_MODULE_NOT_FOUND）
- WASM 文件 `z3-built.wasm`（33MB）+ `z3-built.js`（345KB worker）由包内 `build/` 提供，`init()` 用 `import.meta.url` 定位 → neverBundle 是必须的
- Node 22 `SharedArrayBuffer` 默认可用，无需 COOP/COEP（非浏览器环境）
- mutex 实现要点：`mutex = gate`（指向当前 tail），后续 caller `await prev` 排队 —— 第一版写成 `mutex.then(() => gate)` 导致 gate 永不 resolve（死锁），已修正

### L2 完成 (2026-06-25)

| Step | 文件 | 状态 |
|------|------|------|
| L2.1 | `src/modules/z3/ast-bridge.ts` (babel→Z3 AST bridge) | ✅ |
| L2.2 | `tests/modules/z3/ast-bridge.test.ts` (16 tests, mock+real) | ✅ |

**验证**:
- `npx tsc --noEmit` 0 新增错误
- `Z3_TEST_REAL=1` 16/16 pass（mock: 13 pure-logic tests + real: SAT/UNSAT/nested-logic 3 tests）
- 无 `Z3_TEST_REAL` 13 pass + 3 skipped（CI mock 模式）

**关键发现**:
- Z3 的 high-level API 表达式（`ArithImpl`, `BoolImpl`）是实际的类实例，具有 `.gt()`, `.add()`, `.and()` 等原型方法。它们是**鸭子类型可访问的**——无需求解 proxy traps 或展开 `.ast`。第一版桥接器错误地尝试展开 `'ast' in obj`，这实际上获取了原始 Z3_ast 指针（一个数字），其方法全部丢失
- `ctx.Int.val(42)` 返回一个 `IntNumImpl` 实例——它是 `ArithImpl` 的子类，继承了所有方法。无需特殊处理
- Symbol 属性（如 `Symbol.toPrimitive`）被 mock proxy 上的 `const prop: string` 触发——修复为 `prop: string | symbol`

### L3 完成 (2026-06-25)

| Step | 文件 | 状态 |
|------|------|------|
| L3.1 | `src/modules/symbolic/SymbolicExecutor.ts` (Z3 solveConstraints + legacy fallback + extractVarsFromExpr) | ✅ |
| L3.2 | `tests/modules/symbolic/SymbolicExecutor.test.ts` (+Z3 集成测试 + legacy fallback) | ✅ |

**验证**:
- `npx tsc --noEmit` 0 新增错误
- `Z3_TEST_REAL=1` 10/10 pass（含 Z3 SAT/UNSAT + model 提取）
- 无 `Z3_TEST_REAL` 8 pass + 2 skipped（CI mock 模式）
- `pnpm test` 14753 pass（新增 2 个 test case），1 预存失败 config.test.ts（无关）

### L5 完成 (2026-06-25) — 新工具 exploit_solve_constraints

| Step | 文件 | 状态 |
|------|------|------|
| L5.1 | `src/server/domains/exploit-dev/handlers/solve-constraints.ts` (170 行，Z3 调用 + trivial fallback) | ✅ |
| L4.3 | `src/server/domains/exploit-dev/definitions.ts` (+exploit_solve_constraints 工具定义) | ✅ |
| L4.4 | `src/server/domains/exploit-dev/manifest.ts` (+1 tool registration entry) | ✅ |
| L4.2 | `src/server/domains/exploit-dev/handlers.impl.ts` (+handleSolveConstraints method + ToolArgs import) | ✅ |

**验证**:
- `metadata:check` 工具数 **495**（+1 from 494）✅
- `npx tsc --noEmit` 0 新增错误 ✅
- `pnpm test` 14753 pass，0 回归 ✅

**注**: L4 (RopBuilder BMC) 是最复杂的单文件改动（~150 行），留作 HARD STOP 后的下一批次。当前状态：Z3 基础设施 + babel bridge + analysis 集成 + 通用 SMT 工具全部交付，评分可先冲 exploit 9.5→9.6。

### L4 完成 (2026-06-26) — RopBuilder Z3 BMC + exploit_verify_rop_chain

| Step | 文件 | 状态 |
|------|------|------|
| L4.1 | `src/server/domains/exploit-dev/handlers/rop-builder.ts` (Z3 BMC K=1..12, greedy fallback, solverUsed/warnings) | ✅ |
| L4.2 | `src/server/domains/exploit-dev/handlers.impl.ts` (+handleVerifyRopChain method) | ✅ |
| L4.3 | `src/server/domains/exploit-dev/definitions.ts` (+exploit_verify_rop_chain 工具定义) | ✅ |
| L4.4 | `src/server/domains/exploit-dev/manifest.ts` (+1 tool registration entry) | ✅ |
| L5.2 | `src/server/domains/exploit-dev/handlers/verify-rop-chain.ts` (290 行, Z3 chain audit) | ✅ |
| L4.5/L4.6/L4.7 | `exploit-dev.test.ts` (+3 tests) + `verify-rop-chain.test.ts` (13 tests, new) | ✅ |
| L6.1/L6.2/L6.3 | `exploit-dev/CLAUDE.md` + `modules/CLAUDE.md` + `handoff.md` 文档更新 | ✅ |

**验证**:
- `metadata:check` 工具数 **496**（+1 from 495）✅
- `npx tsc --noEmit` 0 新增错误（仅 2 预存 SyscallResolver）✅
- `pnpm test` 14769 pass，0 回归 ✅
- `Z3_TEST_REAL=1` 全 Z3 测试 68/68 pass（含真实 WASM BMC + verify + symbolic）✅

**关键技术发现**:
- Z3 BMC 选择变量用 `Int` (0/1) 而非 `Bool`：避免 z3-solver 泛型 `Bool<"main">` 推断困难，`selBool = sel.gt(0)` 转换
- 覆盖子句编码陷阱：`Or(¬sel_i, covers_i)` 在 cardinality < n 下是重言式（恒真），**不强制覆盖**——第一版 sat 检测全过但链不含目标寄存器。改为 `And(sel_i, covers_i)` 后 Or 才正确表达"≥1 选中且覆盖"
- 地址匹配须 normalize：`0x000000000000007e` vs `0x7e`——用 BigInt 去前导零
- 测试夹具 test-x64.bin 经 probe 确认有 pop rax/rsi/rdx + syscall，**无 pop rdi**——正好覆盖"部分覆盖→greedy fallback→warn"路径
- Z3 sat 时 `model.eval(Int.const(name)).toString()` 返回数字字符串，`!== '0'` 判断选中
- partial-cover max-cover 查询（findMaxCover）实现后删除：让 Z3 返回 null → greedy fallback 更诚实（区分"init 失败"vs"无法覆盖"两种 warning）
- handleVerifyRopChain 的 Z3 验证：对 numeric 约束（syscall 号、NULL）断言 pop 寄存器可取该值（pop 值来自 stack，用户可控→free 64-bit int）；string/pointer 仅断言"已设置"



## 工期（方案 2）

| Layer | 工期 |
|-------|------|
| L1 基础设施 | 2-3 天 |
| L2 babel bridge | 3-4 天（核心难点） |
| L3 analysis 集成 | 2-3 天 |
| L4 exploit-dev 集成 | 4-5 天 |
| L5 新工具 | 3-4 天 |
| L6 文档 | 1 天 |
| **总计** | **15-20 天** |
