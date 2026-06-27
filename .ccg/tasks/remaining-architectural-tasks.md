# 剩余架构级任务 - Chat 对齐方案

**Created**: 2026-06-18
**Status**: Planning

---

## 剩余任务（3 项）

### P1 #9: Solid.js 状态提取

**当前状态**: `framework-state.ts` 中 Solid.js 提取返回 `_note` 占位符（无 devtools 时）

**问题**:
- 当前逻辑依赖 `solid-devtools` 扩展暴露的全局对象（`window.__SOLID_DEVTOOLS_GLOBAL__`）
- 无扩展时，只返回 hydration markers 提示

**架构改动需求**:
- 需要遍历 Solid 内部信号图（Signal Graph）
- Solid.js 内部 API 未公开，需要：
  1. 通过页面脚本注入访问 Solid 运行时
  2. 遍历组件树和 reactive signals
  3. 提取 signal values、computed dependencies

**实施方案**:
1. **研究 Solid.js 内部结构**
   - 阅读 Solid.js 源码中的信号系统实现
   - 确定如何访问组件实例和 signal graph
   
2. **页面脚本注入**
   - 在 `framework-state.ts` 的 `extractSolid()` 中注入遍历脚本
   - 访问 Solid 的内部 API（可能需要使用非公开 API）
   
3. **数据序列化**
   - Signal values 可能包含循环引用
   - 需要使用 `safeSerialize` 处理

**预估工作量**: 4-6 小时（需要研究 Solid 源码）

**优先级**: 中（Solid.js 使用量较小，可延后）

---

### P1 #13: Camoufox 真实启动

**当前状态**: `browser_launch(driver='camoufox')` 只返回消息，未真实启动

**问题**:
- `CamoufoxBrowserManager.launch()` 存在但未被调用
- `CodeCollector` 架构假设只有 Chrome/Puppeteer
- 需要重构 browser 启动流程以支持多 driver

**架构改动需求**:
1. **CodeCollector 多 driver 支持**
   - 当前 `CodeCollector.launch()` 硬编码 Puppeteer/CDP
   - 需要抽象 driver 接口，支持 Puppeteer + Camoufox
   
2. **BrowserModeManager 集成**
   - `BrowserModeManager` 已支持 Camoufox
   - 需要在 `browser-control.ts` 中调用它而非直接调用 `collector.launch()`

3. **Session 管理统一**
   - Camoufox 返回的 page 对象需要适配 `CodeCollector` 的接口
   - CDP 功能在 Firefox 中受限（需要 fallback 到 Playwright events）

**实施方案**:
1. **重构 CodeCollector 启动逻辑**
   ```typescript
   // CodeCollector.ts
   async launch(options: LaunchOptions) {
     if (options.driver === 'camoufox') {
       return this.launchCamoufox(options);
     }
     return this.launchChrome(options);
   }
   
   private async launchCamoufox(options) {
     const manager = new CamoufoxBrowserManager(options);
     this.browser = await manager.launch();
     this.page = await this.browser.newPage();
     // 适配 CDP session（Camoufox 通过 Playwright bridge）
   }
   ```

2. **更新 browser-control.ts**
   ```typescript
   if (driver === 'camoufox') {
     await this.deps.collector.launch({
       driver: 'camoufox',
       headless,
       fingerprint,
       // ... other camoufox options
     });
     return R.ok().merge({ driver: 'camoufox', launched: true });
   }
   ```

3. **测试 CDP fallback**
   - Firefox 的 CDP 实现不完整
   - 需要测试 `network_enable`, `console_monitor` 等工具的 Playwright fallback

**预估工作量**: 6-8 小时（需要重构 CodeCollector 架构）

**优先级**: 高（Camoufox 是核心反检测功能）

**建议时机**: 单独 PR，涉及核心架构改动

---

### P3 #22-23: debugger 类型守卫统一

**当前状态**: `xhr-breakpoint.ts`, `blackbox-handlers.ts`, `watch-expressions.ts` 使用类型守卫检查 `ensureAdvancedFeatures` 方法

**问题**:
- `DebuggerManager` 类有 `ensureAdvancedFeatures()` 方法
- 但类型定义（shared/modules 导出）未包含此方法
- 测试期望在方法不存在时有 graceful fallback

**为什么简单修复失败**:
- 直接调用 `ensureAdvancedFeatures()` 导致 3 个测试失败 → 6 个失败
- 测试期望："当 advanced features 不支持时，仍能返回部分结果"
- 实际行为：直接调用抛异常，没有 fallback

**架构改动需求**:
1. **在类型定义中声明可选方法**
   ```typescript
   // shared/modules/index.ts
   export class DebuggerManager {
     ensureAdvancedFeatures?(): Promise<void>; // 标记为可选
   }
   ```

2. **修改测试 mock**
   - 当前测试 mock 的 `DebuggerManager` 没有实现 `ensureAdvancedFeatures`
   - 需要在测试中添加 mock 实现

3. **保留 graceful fallback**
   - 使用可选链：`await this.deps.debuggerManager.ensureAdvancedFeatures?.()`
   - 或保留类型守卫，但简化逻辑

**实施方案**:
1. **选项 A：可选链（推荐）**
   ```typescript
   // 简洁，TypeScript 原生支持
   await this.deps.debuggerManager.ensureAdvancedFeatures?.();
   const xhrManager = this.deps.debuggerManager.getXHRManager();
   ```

2. **选项 B：更新测试 mock**
   ```typescript
   // 测试中添加
   const mockDebuggerManager = {
     ensureAdvancedFeatures: vi.fn().mockResolvedValue(undefined),
     getXHRManager: vi.fn().mockReturnValue(mockXHRManager),
   };
   ```

**预估工作量**: 2-3 小时（需要修复测试）

**优先级**: 低（技术债，不影响功能）

---

## Chat 对齐建议

### 策略 1: 单独对话处理（推荐）

每个任务开一个新对话，聚焦架构设计：

**P1 #13 Camoufox（优先）**:
```
需求：实现 Camoufox 浏览器真实启动

当前：browser_launch(driver='camoufox') 只返回消息

架构约束：
- CodeCollector 假设 Puppeteer/Chrome
- CamoufoxBrowserManager 已实现但未集成
- Firefox CDP 功能受限

目标：重构 CodeCollector 支持多 driver，集成 CamoufoxBrowserManager

请设计重构方案并实施。
```

**P1 #9 Solid.js（延后）**:
```
需求：提取 Solid.js 组件状态（无 devtools 时）

当前：只返回 hydration markers 提示

架构约束：
- Solid 内部 API 未公开
- 需要遍历 signal graph
- 可能需要非公开 API

目标：研究 Solid 内部结构，实现信号图遍历

请先调研 Solid.js 源码，再设计方案。
```

**P3 #22-23 debugger（可选）**:
```
需求：简化 debugger handlers 类型守卫

当前：使用复杂类型守卫检查 ensureAdvancedFeatures

问题：测试期望 graceful fallback

目标：使用可选链或更新测试 mock

请选择最简方案并实施。
```

### 策略 2: 在当前对话继续（适合快速推进）

如果你想在当前对话继续，我可以：
1. **立即处理 P3 #22-23**（最简单，2-3 小时）
2. **然后处理 P1 #13 Camoufox**（需要重构，6-8 小时）
3. **最后处理 P1 #9 Solid.js**（需要研究，4-6 小时）

---

## 推荐行动

1. ✅ **当前对话**：已完成 P0-P3 可快速完成的 23 项
2. 🔄 **单独对话处理 P1 #13 Camoufox**（最重要，架构级改动）
3. 📝 **记录 P1 #9 和 P3 #22-23 到 backlog**（技术债/增强）

---

## Metadata

- **Total remaining**: 3 tasks
- **Architectural changes**: 2 (Camoufox, Solid.js)
- **Technical debt**: 1 (debugger type guards)
- **Recommended next**: P1 #13 Camoufox in separate chat
