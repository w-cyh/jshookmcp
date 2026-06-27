# C1 Z3 集成 — Phase 2 多视角分析

> ⚠️ **降级说明**：外部模型不可用（Codex `cloud config bundle` 超时退出 1；Gemini `403 Forbidden` on `cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`）。按策略铁律降级为 Claude 单模型，但**从两个独立视角**（后端建模 + 工具链/工程）分别给出分析，最后综合。质量略低于双模型交叉验证，但覆盖两个维度的核心问题。

---

## 视角 A：后端建模（ROP + 符号执行）

### A1. z3-solver 集成可行性

| 项 | 结论 | 依据 |
|----|------|------|
| Node 22 SharedArrayBuffer | ✅ 可用 | Node 22 默认支持 `SharedArrayBuffer`，无需 `--experimental-shared-array-buffer`（v22 起 GA）。本项目 `node --version` = v22.22.2 |
| MCP server 进程 | ✅ 可用 | MCP server 是普通 Node 进程，非浏览器，无 COOP/COEP header 需求 |
| 非 thread-safe | ⚠️ 需串行化 | 官方文档："Z3-solver is not thread safe... only one long-running function can run at a time"。MCP server 可能并发处理 tool call → **必须用 promise 队列串行所有 `solver.check()`** |
| lazy init | ✅ 必须 | 首次 `init()` 加载 WASM（~50-200ms），不能阻塞 server 启动。单例 + getter 模式 |
| 超时 | ⚠️ 必须 | `solver.check()` 可能跑很久（复杂约束）。需 `solver.set('timeout', N)` + 外层 `Promise.race` timeout |
| fail-soft 降级 | ✅ 必须 | init 失败 / 超时 → 降级到现有 greedy（exploit）和正则 simpleSMTSolver（analysis），返回 `solverUsed: 'z3'\|'fallback'` |

**关键风险**：WASM 在 `tsdown` 打包后能否正确加载。z3-solver 的 WASM 文件是包内资源，`init()` 内部用 `import.meta.url` 定位。tsdown `format: 'esm'` + 不 bundle z3-solver（加入 `deps.neverBundle`）→ 保留 `import.meta.url` 原语义，应该可行。**但需实测验证**（参考 quickjs-emscripten 已在 neverBundle 列表且工作正常）。

### A2. exploit-dev ROP 建模

**核心建模**：把 ROP 链构建建模为 **bounded model checking**。

```
状态变量:
  reg[rax, rbx, rcx, rdx, rsi, rdi, r8-r15] = BitVec(64)  // x64
  stack[i] = BitVec(64)  // 栈槽（用户控制的注入数据）
  pc = Int  // gadget 序号

gadget 转移语义（来自 GadgetEffects）:
  pop reg; ret  →  reg' = stack[top]; pc' = stack[top+1]
  mov dst, src; ret →  dst' = src; pc' = stack[top]
  xchg r1, r2; ret →  r1', r2' = swap(r1, r2)

goal 约束（execve on x64）:
  And(rax == 59, rdi == &cmd, rsi == 0, rdx == 0, pc == syscall_gadget_addr)
```

**关键决策：用 bounded model checking（BMC）而非纯 CSP**

- "最短 gadget 序列" 是 NP-hard，但 **BMC 把链长度固定为 K，K=1..N 递增求解** 是标准做法（angr、SAGE 都这么做）
- 对每个 K，用 Z3 `Solver` 加约束：初始状态 + K 个 gadget 转移 + goal，判 SAT
- 第一个 SAT 的 K 就是最短链
- K 上界设 8-10（ROP 链极少超过 10 个 gadget），避免 Z3 跑飞

**Z3 vs greedy 关系：双 solver 并存 + 用户选择**

| 方案 | 优点 | 缺点 |
|------|------|------|
| Z3 主 + greedy fallback | 求解能力强 | Z3 init 失败时所有调用降级，但用户不知 |
| **并存 + `solver` 参数**（推荐） | 用户显式选；`solver='auto'` 时 Z3 优先，失败降级 | API 多一个参数 |
| 纯 Z3 | 最干净 | Z3 不可用就完全失效 |

推荐**并存 + `solver` 参数**：`exploit_build_rop_chain({..., solver: 'auto'|'z3'|'greedy'})`，默认 `auto`。这保留现有 greedy 作对照基线，符合 handoff 教训"先读源码再信报告，agent 结论不可盲从"——有 fallback 才敢上 Z3。

**输出格式不变**：Z3 model → 把每个 symbolic 栈槽的求解值填回 `placeholders[].suggestedValue`，复用现有 `assembleChain` 逻辑。

### A3. analysis 符号执行集成

**Constraint 字符串 → Z3 AST 转换**

现有 `Constraint.expression` 是字符串如 `"x > 10"`、`"!(x > 10)"`、`"x === 0"`。两个转法：

| 选项 | 实现 | 覆盖度 | 工期 |
|------|------|--------|------|
| **有限 DSL parser**（推荐 MVP） | 手写递归下降 parser，支持 `< > <= >= == != && \|\| ! + - * /` + 数字/标识符 | ~90% 真实 opaque predicate | 1-2 天 |
| @babel/parser AST → Z3 | 复用项目已有 babel，traverse BinaryExpression/LogicalExpression/UnaryExpression 转 Z3 | 100% JS 表达式 | 3-4 天 |

**推荐有限 DSL**：现有 `simpleSMTSolver` 的正则只处理 `x > N` / `x < N`，DSL parser 已是巨大升级，且 opaque predicate 99% 是简单比较。babel 方案留作 P2。

**SAT 时求 model 的价值**（inverting opaque predicates）

```
pathConstraints = [x > 10, x < 20]  // 路径条件
Z3 check → sat
Z3 model → { x: 15 }  // 触发该路径的具体输入
→ 返回给用户: "此路径可达，触发输入 x=15"
```

这是 analysis 域的核心升级：从"能否到达"升级到"如何到达"。对反混淆 opaque predicate 直接有用——给出生成真/假分支的具体输入。

**UNSAT 时**：`path.isFeasible = false`（死代码，可安全删除）。当前 `checkPathFeasibility` 只检测 `expr` 和 `!(expr)` 字面重复，Z3 能判任意矛盾。

### A4. 新增工具 API 设计

**推荐：1 个通用工具 + ROP builder 内嵌（不新增 verify 工具）**

| 工具 | 必要性 | 评分贡献 |
|------|--------|---------|
| `exploit_solve_constraints`（通用 SMT） | 必要 — 让 LLM 能直接调 Z3 | exploit 9.5→9.7 |
| `exploit_verify_rop_chain` | 可选 — 被 `exploit_build_rop_chain(solver='z3')` 覆盖 | 边际收益低 |

**`exploit_solve_constraints` inputSchema**（推荐选项 C：JS 表达式数组）

```jsonc
{
  "constraints": ["x > 10", "x < 20", "x != 15"],  // JS 风格表达式数组（合取）
  "variables": [{ "name": "x", "type": "int", "bits": 32 }],  // 声明变量
  "timeout": 5000,  // ms
  "getModel": true  // SAT 时返回 model
}
// 返回: { sat: true, model: { x: 11 }, solverUsed: "z3", timeMs: 42 }
```

**为什么 JS 表达式而非 SMT-LIB**：LLM 生成 JS 表达式远比 SMT-LIB v2 `(declare-fun x () (_ BitVec 32)) (assert (and (> x 10) (< x 20)))` 可靠（SMT-LIB 语法极易错）。DSL parser 复用 A3 的，一举两得。

### A5. 风险与工期

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| WASM 打包后加载失败 | 中 | 高 | 加 `deps.neverBundle: ['z3-solver']`；写 smoke test 验证打包后 init |
| Z3 求解超时挂起 | 中 | 中 | `solver.set('timeout', N)` + `Promise.race` 外层 timeout + 降级 |
| 并发 check 报错 | 高 | 中 | promise 队列串行化（单例 mutex） |
| DSL parser 边界 bug | 中 | 低 | TDD 覆盖所有操作符 + fuzz 测试 |
| ROP BMC K 上界不够 | 低 | 中 | 默认 K=8，暴露 `maxGadgets` 参数让用户调 |

**工期拆解**（handoff 说 2-3 周，拆 4 个里程碑）：

| 里程碑 | 工期 | 交付 |
|--------|------|------|
| **M1: Z3 基础设施** | 2-3 天 | `src/modules/z3/Z3Solver.ts` 单例 + lazy init + mutex + timeout + fail-soft；TDD smoke test |
| **M2: analysis 集成** | 2-3 天 | DSL parser + `SymbolicExecutor.solveConstraints` 用 Z3；扩展测试 |
| **M3: exploit-dev 集成** | 3-4 天 | `RopBuilder` BMC 建模 + `solver` 参数 + greedy fallback；扩展测试 |
| **M4: 新工具 + 文档** | 2 天 | `exploit_solve_constraints` 工具 + manifest 注册 + CLAUDE.md 更新 |
| **总计** | 9-12 天 | 可压缩到 1.5-2 周（并行 M2/M3） |

---

## 视角 B：工具链 / 工程

### B1. WASM + ESM + tsdown 打包

**z3-solver 导入方式**

```ts
// Node 环境（本项目）
import { init } from 'z3-solver/node';  // 显式 node 入口，避免 bundler 选错
const { Context, Solver, Int, BitVec } = await init();
```

官方 README 说"bundler and node should choose good version automatically"，但**显式 `/node` 更稳妥**（避免 tsdown 解析歧义）。

**tsdown 配置**：加 `z3-solver` 到 `deps.neverBundle`（参考已有的 `quickjs-emscripten`、`@alexaltea/capstone-js`——等等，capstone 不在列表里，查一下）。

实际上 `@alexaltea/capstone-js` 不在 neverBundle，说明它已被正确处理或 inline。z3-solver 因为有 `.wasm` 资源文件 + worker spawn（`z3-built.js`），**必须** neverBundle，否则 worker 脚本路径会断。

**pnpm 安装位置**：root `package.json` 的 `dependencies`（非 optional，因为 exploit-dev 是核心域）。z3-solver 纯 JS+WASM，无 native 编译，不像 better-sqlite3 需要 optional。

### B2. 工具 schema 设计

**exploit-dev 用裸 JSON Schema**（definitions.ts 风格，非 tool-builder）——保持与现有 11 个 exploit 工具一致。

**analysis 用 tool-builder**（definitions.ts 用 `tool()` 链式）——保持与现有 13 个 core 工具一致。

`exploit_solve_constraints` 归 exploit-dev 域（语义上是 exploit 工具，SMT 求解服务于 ROP）。

**progress reporting**：Z3 求解可能 5-30 秒，但 exploit-dev manifest **没有** bindWithProgress（只有 analysis 有）。判断：**不加 progress**，原因：
1. exploit-dev 现有工具（find_gadgets 可能跑几秒）都没 progress
2. timeout 默认 5s，用户体感可接受
3. 加 progress 要改 manifest 结构，超出本次范围

### B3. 测试策略

**vitest forks pool + WASM**

| 测试层 | 策略 |
|--------|------|
| **纯逻辑**（DSL parser、constraint→Z3 AST、ROP 约束建模） | ✅ 纯函数，无 WASM 依赖，正常 TDD。mock Z3 返回 |
| **Z3 集成**（真实 init + check） | ⚠️ 每个 fork 独立 init（WASM 不跨 fork 共享）。但 init 是幂等的，fork 内首次调用自动 init。设 `Z3_TEST_SKIP` env 跳过集成测试（CI 无 WASM 时） |
| **超时/降级** | mock init 抛错，验证降级到 greedy/正则 |

**参考已有测试模式**：
- `tests/modules/symbolic/SymbolicExecutor.test.ts` — 现有正则 solver 测试，Z3 版要兼容其断言
- `tests/server/domains/exploit-dev/exploit-dev.test.ts` — 18 个测试覆盖 7 工具，Z3 版加 `solver` 参数测试

**TDD 节奏**（每个里程碑先写测试）：
1. M1: `tests/modules/z3/Z3Solver.test.ts` — init 成功、init 失败降级、mutex 串行、timeout
2. M2: 扩展 `SymbolicExecutor.test.ts` — DSL parser、Z3 SAT/UNSAT、model 提取
3. M3: 扩展 `exploit-dev.test.ts` — `solver='z3'` 参数、BMC 求解、fallback
4. M4: `exploit_solve_constraints.test.ts` — 端到端

### B4. 域 manifest 集成

**exploit-dev manifest**（`defineMethodRegistrations` 风格）：
```ts
entries: [
  // ... 现有 12 个
  { tool: 'exploit_solve_constraints', method: 'handleSolveConstraints' },
],
```
+ `definitions.ts` 加工具定义（裸 JSON Schema）

**prerequisites**：
```ts
exploit_solve_constraints: [
  { condition: 'Z3 WASM must be initialized', fix: 'Ensure Node supports SharedArrayBuffer (Node 22+)' },
],
```

### B5. 失败降级与可观测

**降级透明度**：返回 `solverUsed: 'z3' | 'greedy' | 'regex'` + `warnings: string[]`（warnings 含降级原因）。**不静默**——用户需要知道求解器可信度。

**诊断工具**：**不加** `exploit_z3_status`。原因：
1. 增加工具数（gate 494→495 已 +1，再加就 496）
2. Z3 状态可从每次调用的 `solverUsed` 字段推断
3. 诊断需求低频，不值得占一个工具槽

---

## 候选方案对比

### 方案 1：保守集成（推荐 MVP）

| 维度 | 内容 |
|------|------|
| Z3 模块 | `src/modules/z3/Z3Solver.ts` 单例 + lazy init + mutex + timeout + fail-soft |
| exploit-dev | `RopBuilder` 加 `solver: 'auto'\|'z3'\|'greedy'` 参数；Z3 用 BMC（K≤8）；greedy 保留作 fallback |
| analysis | DSL parser（有限算子）+ `solveConstraints` 用 Z3；正则 `simpleSMTSolver` 保留作 fallback |
| 新增工具 | 1 个：`exploit_solve_constraints`（JS 表达式数组输入） |
| 测试 | 4 个测试文件扩展/新增，TDD |
| 工具数 | 494 → 495 |
| 工期 | 9-12 天 |
| 评分 | exploit 9.5→9.7, analysis 8.0→8.4 |
| 风险 | 低 — 有 fallback 兜底，Z3 不可用不影响现有功能 |

### 方案 2：激进集成

| 维度 | 内容 |
|------|------|
| Z3 模块 | 同方案 1 |
| exploit-dev | 重写 `solveConstraints` 为纯 Z3（greedy 仅作 Z3 init 失败 fallback）；BMC K≤12 |
| analysis | @babel/parser 转 Z3 AST（完整 JS 表达式）；`solveConstraints` 纯 Z3 |
| 新增工具 | 2 个：`exploit_solve_constraints` + `exploit_verify_rop_chain` |
| 测试 | 6 个测试文件 |
| 工具数 | 494 → 496 |
| 工期 | 16-20 天 |
| 评分 | exploit 9.5→9.8, analysis 8.0→8.5 |
| 风险 | 中-高 — babel→Z3 转换复杂；纯 Z3 无 greedy 时若 Z3 挂了 ROP builder 全瘫 |

### 推荐

**方案 1（保守）**。理由：
1. handoff 教训 #1："7 Builder 并行写代码，只有 2/7 走了完整 TDD"——保守方案 TDD 友好（纯函数多）
2. handoff 教训 #2："先读源码再信报告"——有 greedy fallback 才敢上 Z3，能交叉验证
3. 评分 9.7/8.4 已接近目标 9.8/8.5，方案 2 边际收益不抵风险增量
4. 工期 9-12 天可压缩到 1.5 周，符合 handoff "2-3 周" 上限内
5. 留 P2 升级空间（DSL→babel、BMC K 提升、加 verify 工具）

**方案 1 可在后续迭代升到方案 2**（加 babel parser + verify 工具），方案 2 难回退。
