# Process Hollowing 检测工具 — 实施计划

## 需求摘要

实现 `process_detect_hollowing` 工具，检测目标进程是否被镂空（恶意软件卸载合法进程的原始代码并注入恶意代码）。支持可选的自动恢复模式（`autoRestore: boolean`，默认 `false`）。

**目标评分提升**：process 域 6.5 → 7.5/10

---

## 技术方案

### 选定方案：代码段哈希对比 + PE 头快速预筛选

**检测流程**：
1. **预筛选**：枚举主模块 → 获取磁盘路径 → 快速检查 PE 头基本字段
2. **深度检测**：遍历关键段（`.text`, `.data`, `.rdata`）→ 读取内存/磁盘内容 → 逐字节或哈希对比
3. **置信度计算**：`confidence = (匹配字节数 / 总字节数) * 100`
4. **可选恢复**：`autoRestore: true` 时，从磁盘重新映射原始段到目标进程

**优势**：
- ✅ 精确度高（代码段完整性检查）
- ✅ 可扩展（可添加更多段或启发式检测）
- ✅ 遵循现有架构模式（PEAnalyzer, MemoryController）

**替代方案（不采用）**：
- ❌ 仅 PE 头检查：误报率高（合法的内存布局优化也会触发）
- ❌ 关键指令模式匹配：易绕过

---

## 实施步骤

### Step 1: 扩展 `src/native/PEAnalyzer.ts` [新增方法]

**新增方法**：`compareMemoryWithDisk(pid: number, moduleBase: string, diskPath: string)`

```typescript
async compareMemoryWithDisk(
  pid: number,
  moduleBase: string,
  diskPath: string
): Promise<{
  isMatch: boolean;
  confidence: number;
  differences: Array<{
    sectionName: string;
    offsetStart: number;
    offsetEnd: number;
    memoryHash: string;
    diskHash: string;
  }>;
}> {
  // 1. 解析内存 PE 头
  const memoryPE = await this.parseHeaders(pid, moduleBase);
  
  // 2. 读取磁盘 PE 文件
  const diskBuffer = await fs.readFile(diskPath);
  const diskPE = this.parsePEFromBuffer(diskBuffer);
  
  // 3. 对比关键段（.text, .data, .rdata）
  const differences = [];
  for (const section of memoryPE.sections) {
    if (!['.text', '.data', '.rdata'].includes(section.name)) continue;
    
    const memoryBytes = ReadProcessMemory(hProcess, moduleBase + section.virtualAddress, section.virtualSize);
    const diskBytes = diskBuffer.slice(section.pointerToRawData, section.pointerToRawData + section.sizeOfRawData);
    
    const memoryHash = crypto.createHash('sha256').update(memoryBytes).digest('hex');
    const diskHash = crypto.createHash('sha256').update(diskBytes).digest('hex');
    
    if (memoryHash !== diskHash) {
      differences.push({...});
    }
  }
  
  // 4. 计算置信度
  const confidence = differences.length === 0 ? 100 : Math.max(0, 100 - differences.length * 20);
  
  return { isMatch: differences.length === 0, confidence, differences };
}
```

**辅助方法**：`parsePEFromBuffer(buffer: Buffer)` — 从 Buffer 解析 PE 头（用于磁盘文件）

**预计新增**：~150 行

---

### Step 2: 新增 `src/server/domains/process/handlers/hollowing-detection.ts` [新文件]

**Handler 实现**：

```typescript
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { PEAnalyzer } from '@native/PEAnalyzer';
import { MemoryController } from '@native/MemoryController';
import { EnumProcessModules, GetModuleFileNameEx } from '@native/Win32API';

export class HollowingDetectionHandlers {
  private peAnalyzer = new PEAnalyzer();
  private memoryController = new MemoryController();
  
  handleDetectHollowing = handleSafe(async (args: Record<string, unknown>) => {
    const pid = argNumber(args, 'pid', { required: true, positive: true });
    const autoRestore = argBool(args, 'autoRestore', false);
    const includeMemoryDump = argBool(args, 'includeMemoryDump', false);
    
    // 1. 枚举主模块
    const modules = EnumProcessModules(pid);
    if (modules.length === 0) {
      return { isHollowed: false, confidence: 0, error: 'No modules found' };
    }
    
    const mainModule = modules[0];
    const diskPath = GetModuleFileNameEx(pid, mainModule.lpBaseOfDll);
    
    // 2. 深度检测
    const comparisonResult = await this.peAnalyzer.compareMemoryWithDisk(
      pid,
      mainModule.lpBaseOfDll.toString(16),
      diskPath
    );
    
    const isHollowed = !comparisonResult.isMatch;
    
    // 3. 可选恢复
    let restored = false;
    if (autoRestore && isHollowed) {
      restored = await this.restoreFromDisk(pid, mainModule.lpBaseOfDll, diskPath, comparisonResult.differences);
    }
    
    return {
      isHollowed,
      confidence: comparisonResult.confidence,
      modulePath: diskPath,
      moduleBase: `0x${mainModule.lpBaseOfDll.toString(16)}`,
      differences: comparisonResult.differences,
      restored,
      warning: autoRestore ? 'HIGH RISK: Memory restoration attempted' : undefined,
    };
  });
  
  private async restoreFromDisk(
    pid: number,
    moduleBase: bigint,
    diskPath: string,
    differences: Array<any>
  ): Promise<boolean> {
    // 从磁盘重新读取原始段并写回进程内存
    // 使用 MemoryController.writeValue + VirtualProtectEx
    // ...
    return true; // 成功恢复
  }
}
```

**预计新增**：~200 行

---

### Step 3: 更新 `src/server/domains/process/definitions.ts` [新增工具定义]

```typescript
tool('process_detect_hollowing', (t) =>
  t
    .desc(
      'Detect process hollowing (malware technique that unmaps original process image and injects malicious code). ' +
      'Compares process memory sections with on-disk PE file. ' +
      'WARNING: autoRestore=true is HIGH RISK and may crash the target process.'
    )
    .number('pid', 'Process ID to check for hollowing')
    .bool('autoRestore', 'Attempt to restore original code from disk (HIGH RISK, default: false)')
    .bool('includeMemoryDump', 'Include memory dump in result for forensics (default: false)')
    .required('pid'),
),
```

**预计变更**：+10 行

---

### Step 4: 更新 `src/server/domains/process/manifest.ts` [注册工具]

```typescript
// 添加到 WIN32_ONLY_TOOLS
const WIN32_ONLY_TOOLS = new Set(['check_debug_port', 'process_enum_threads', 'process_detect_hollowing']);

// 添加到 registrations
{ tool: 'process_detect_hollowing', method: 'handleDetectHollowing' },
```

**预计变更**：+2 行

---

### Step 5: 更新 `src/server/domains/process/handlers.ts` [导出 handler]

```typescript
export { HollowingDetectionHandlers } from './handlers/hollowing-detection';
```

在 `ProcessToolHandlers` 类中组合：

```typescript
private hollowingHandlers = new HollowingDetectionHandlers();

handleDetectHollowing = this.hollowingHandlers.handleDetectHollowing;
```

**预计变更**：+3 行

---

### Step 6: 新增 `tests/server/domains/process/hollowing-detection.test.ts` [新文件]

**测试场景**：
1. ✅ 正常进程（无镂空）→ `isHollowed: false, confidence: 100`
2. ✅ Mock 镂空进程（内存/磁盘哈希不匹配）→ `isHollowed: true, confidence: <100`
3. ✅ 权限不足 → 返回错误
4. ✅ `autoRestore: true` → 验证恢复流程调用（mock）

**预计新增**：~150 行

---

### Step 7: 更新 `src/server/domains/process/CLAUDE.md` [文档]

添加新工具说明：

```markdown
- process_detect_hollowing — Detect process hollowing (Win32 only)
  - autoRestore: bool (HIGH RISK)
```

**预计变更**：+2 行

---

## 影响范围

### 新增文件 (2 个)
- `src/server/domains/process/handlers/hollowing-detection.ts` (~200 行)
- `tests/server/domains/process/hollowing-detection.test.ts` (~150 行)

### 修改文件 (5 个)
- `src/native/PEAnalyzer.ts` (+150 行) — `compareMemoryWithDisk`, `parsePEFromBuffer`
- `src/server/domains/process/definitions.ts` (+10 行) — 工具定义
- `src/server/domains/process/manifest.ts` (+2 行) — 注册
- `src/server/domains/process/handlers.ts` (+3 行) — 导出
- `src/server/domains/process/CLAUDE.md` (+2 行) — 文档

**总计**：~517 行新增代码

---

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| `autoRestore` 导致进程崩溃 | 高 | 默认 `false`，工具描述标注 "HIGH RISK"，恢复前备份内存 |
| 读取内存失败（权限不足） | 中 | 捕获异常，返回结构化错误 |
| 磁盘文件被删除/移动 | 中 | 捕获文件不存在异常 |
| 误报（合法的内存优化） | 低 | 使用哈希对比提高准确性，提供 `confidence` 分数 |

---

## 验收标准

1. ✅ 工具能正确检测被镂空的进程
2. ✅ 返回结构化结果：`{ isHollowed, confidence, evidence, restored? }`
3. ✅ `autoRestore: true` 时能尝试恢复（记录成功/失败）
4. ✅ TypeScript 零错误：`npx tsc --noEmit`
5. ✅ 测试通过：至少 4 个场景覆盖
6. ✅ 工具数正确：`pnpm metadata:check` 显示 452 tools（451 → 452）
7. ✅ 文档更新：CLAUDE.md 添加新工具说明

---

## 预估时间

- PEAnalyzer 扩展：2h
- Handler 实现：2h
- 测试编写：1.5h
- 集成 + 验证：0.5h
- **总计**：6h（在 4-8h 预估范围内）
