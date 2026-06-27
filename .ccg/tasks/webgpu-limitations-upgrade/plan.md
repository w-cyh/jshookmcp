## WebGPU Limitations Upgrade Plan

### 需求
升级 WebGPU 域的 4 项已知限制（不含 SPIR-V）：
1. 实现可恢复的 GPUQueue/GPUDevice hook
2. 实现结构化的 render/compute/copy command capture
3. 实现真实的 GPU buffer/texture 内存追踪
4. 增强 WGSL 解析器，提取 uniforms/attributes/structs

### 方案
单模块内改造，集中在 `src/modules/webgpu/CDPIntegration.ts` + `src/server/domains/webgpu/handlers/*` + `types.ts`，不引入外部依赖。

### 步骤
1. `src/server/domains/webgpu/types.ts` — 扩展 ShaderMetadata、GPUCommand、GPUMemoryAllocation 类型
2. `src/modules/webgpu/CDPIntegration.ts` — 重写 hook 注入/卸载逻辑；实现 command encoder 拦截；实现 WeakRef allocation 池
3. `src/server/domains/webgpu/handlers/command-capture.ts` — 调用新的 inject/uninstall/get trace
4. `src/server/domains/webgpu/handlers/memory-layout.ts` — 使用新的 getGPUMemoryStats
5. `src/server/domains/webgpu/handlers/shader-compile.ts` — 增强 WGSL 元数据提取
6. `src/server/domains/webgpu/handlers/shader-disassemble.ts` — 增强 AST
7. `tests/server/domains/webgpu/webgpu-capture-commands.test.ts` — 更新断言
8. `tests/server/domains/webgpu/webgpu-memory-layout.test.ts` — 更新断言
9. `tests/server/domains/webgpu/webgpu-shader-compile.test.ts` — 新增 uniform/attribute/struct 断言
10. `tests/server/domains/webgpu/webgpu-shader-disassemble.test.ts` — 新增 AST 结构断言
11. `src/server/domains/webgpu/CLAUDE.md` — 更新限制说明

### 执行模式
Claude 自己写（精细控制，逐步实施）
