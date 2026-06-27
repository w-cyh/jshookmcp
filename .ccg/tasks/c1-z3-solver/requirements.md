# C1 Z3 约束求解器集成 — 需求增强

## 需求完整性评分：8.0/10

| 维度 | 得分 | 说明 |
|------|------|------|
| 目标明确性 | 3/3 | handoff + requirements 明确：Z3 集成进 exploit-dev + analysis 两域 |
| 预期结果 | 2.5/3 | 评分目标明确（exploit 9.5→9.8, analysis 8.0→8.5），但具体工具 API 形态需设计 |
| 边界范围 | 1.5/2 | 范围清晰，但"2-3周"工期需拆解为可交付里程碑 |
| 约束条件 | 1/2 | z3-solver 的 SharedArrayBuffer 约束是硬限制，需验证 |

---

## 1. 目标

将 **Z3 SMT 求解器**（`z3-solver` npm v4.16.0，WASM 自带）集成进两个域，替换当前的伪求解逻辑：

### 1.1 exploit-dev 域（当前评分 9.5 → 目标 9.8）

**现状问题**：`RopBuilder.solveConstraints()`（`rop-builder.ts:154-191`）是 **greedy heuristic**：
- 逐个约束找 `pop reg; ret` gadget，无法处理寄存器间依赖
- 无法优化 gadget 序列长度
- CLAUDE.md 已诚实声明："Simplified greedy solver; complex chains with register dependencies may require manual gadget selection or Z3 integration"

**Z3 目标**：把 ROP 链构建建模为**约束满足问题**：
- 每个 register = `BitVec(64)`（x64）或 `BitVec(32)`（x86）
- 每个 gadget = 状态转移约束（`reg' == gadget.effects`）
- goal = 最终寄存器状态满足 syscall ABI（execve: rax=59, rdi=&cmd, rsi=0, rdx=0）
- 求解器找出**最短 gadget 序列**满足约束

### 1.2 analysis 域（当前评分 8.0 → 目标 8.5）

**现状问题**：`SymbolicExecutor.simpleSMTSolver()`（`SymbolicExecutor.ts:389-411`）是**正则匹配**：
```ts
// 只能检测 "x > 10" 和 "x < 10" 这种字面量矛盾
const pattern1 = /(\w+)\s*>\s*(\d+)/;
const pattern2 = /(\w+)\s*<\s*(\d+)/;
```
几乎无法处理任何真实路径约束。`checkPathFeasibility()`（:301）只检测 `expr` 和 `!(expr)` 字面重复。

**Z3 目标**：
- 把 `pathConstraints`（`{type, expression, description}`）转成真 SMT 公式
- 用 Z3 判 SAT/UNSAT → 标记 `isFeasible`
- SAT 时求 model → 返回触发该路径的具体输入（inverting opaque predicates）

---

## 2. 范围

### 2.1 In-Scope（必做）

1. **新增模块** `src/modules/z3/Z3Solver.ts` — Z3 单例封装（lazy init、WASM 加载、超时控制）
2. **exploit-dev**：`RopBuilder` 集成 Z3 solver（保留 greedy 作 fallback）
3. **analysis**：`SymbolicExecutor.solveConstraints()` 用 Z3 替换正则 solver
4. **新增工具**（至少 1 个，可选 2 个）：
   - `exploit_solve_constraints` — 通用 SMT 约束求解（给 Z3 公式，返回 sat/unsat/model）
   - 可选 `exploit_verify_rop_chain` — 用 Z3 验证已有 ROP 链是否满足 goal 约束
5. **测试**：TDD 先行，每个集成点都要有红绿测试
6. **常量**：`src/constants/sandbox.ts` 加 Z3 超时/开关常量

### 2.2 Out-of-Scope（不做）

- ❌ 不重写 `SymbolicExecutor` 的路径探索（worklist 算法保留）
- ❌ 不做 JSVMP 符号执行的 Z3 集成（`JSVMPSymbolicExecutor` 留待后续）
- ❌ 不引入 Z3 以外的 SMT solver（boolector/cvc5）
- ❌ 不做架构降级（保持 domain manifest 模式）

### 2.3 验收标准

| 维度 | 标准 |
|------|------|
| 工具数 gate | `metadata:check` 维持正确（当前 494 + 新增 = 预期 495~496） |
| 测试 gate | `pnpm test` 14731+ pass，新增测试全绿 |
| 类型 gate | `npx tsc --noEmit` 零新增错误（SyscallResolver 2 预存除外） |
| 模式 gate | 遵循 domain manifest 模式 |
| 安全 gate | exploit 工具仍由用户提供 payload，不内置攻击代码 |
| 功能 gate | Z3 真实求解：① 可判 `x>10 ∧ x<5` 为 UNSAT ② 可求 execve 约束的 model ③ 超时降级到 greedy |

---

## 3. 关键技术约束

### 3.1 z3-solver npm 包特性（firecrawl 调研）

| 特性 | 值 | 影响 |
|------|-----|------|
| 版本 | 4.16.0 | 稳定，4 个月前发布 |
| 分发 | WASM 自带 | ✅ 不需系统装 Z3，跨平台 |
| Node 导入 | `z3-solver/node` | 本项目 ESM，需验证 import 方式 |
| **硬约束** | 需 `SharedArrayBuffer` | Node ≥ 22 默认支持；需验证本项目 Node 版本 |
| 线程模型 | async API 非 thread-safe，全局单例 | 同一时刻只能一个 `solver.check()` 运行，其余排队 |
| 长运行 API | `solver_check`、`optimize_check` 等 | 必须 async + 超时包装 |

### 3.2 本项目适配风险

1. **`SharedArrayBuffer` 可用性**：MCP server 进程环境需验证。若不可用 → 整个 Z3 模块 init 失败 → 必须 fail-soft 降级到现有 greedy/正则 solver
2. **全局单例 + 非 thread-safe**：MCP server 可能并发处理多个 tool call → Z3 调用需用 mutex/promise 队列串行化
3. **WASM 初始化延迟**：首次 `init()` 可能 50-200ms → 必须 lazy init（首次用到才加载），不能在 server 启动时阻塞
4. **打包**：本项目用 tsdown 打包，WASM 文件需确认能正确随包发布（类似 `@alexaltea/capstone-js` 的处理方式）

---

## 4. 待澄清问题（Phase 2 双模型构思时确认）

1. **新增工具数量**：1 个通用 `exploit_solve_constraints` 够不够达到评分目标？还是需要 2 个（通用 + ROP 验证）？
2. **exploit-dev 的 Z3 集成深度**：
   - 浅集成：`RopBuilder` 增加 `solver='z3'|'greedy'` 参数，Z3 失败降级 greedy
   - 深集成：重写 `solveConstraints` 为纯 Z3，greedy 仅作 Z3 init 失败 fallback
3. **analysis 的 constraint 表达式语言**：当前 `expression` 是字符串（如 `"x > 10"`）。Z3 集成需要写一个 **字符串→SMT 公式** 的 parser。范围多大？（仅支持 `< > <= >= == != && || !` + 数字字面量？还是完整 JS 表达式？）
4. **是否暴露 `exploit_solve_constraints` 给用户直接写 SMT-LIB v2 公式**？还是只接受高层 `constraints: [{var, op, value}]` 结构化输入？
