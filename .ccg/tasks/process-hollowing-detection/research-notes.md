# Process Hollowing 技术研究笔记

## 攻击流程

1. **CreateProcess** — 以 SUSPENDED 状态启动合法进程（如 svchost.exe）
2. **NtUnmapViewOfSection** — 卸载主模块的内存映像（释放原始代码段）
3. **VirtualAllocEx / NtAllocateVirtualMemory** — 在目标进程分配新内存
4. **WriteProcessMemory** — 写入恶意 PE 文件（包括头和所有段）
5. **SetThreadContext** — 修改入口点指向恶意代码
6. **ResumeThread** — 恢复执行

## 检测方法

### 方法 1: PE 头完整性检查
- 读取进程主模块基址的 PE 头
- 对比内存中的 PE 签名、时间戳、段数量等与磁盘文件
- 优点：快速
- 缺点：可能误报（合法的内存布局优化）

### 方法 2: 代码段哈希对比（推荐）
- 读取 `.text` 段内存内容
- 从磁盘读取同一段的原始内容
- 计算哈希（SHA-256）并对比
- 优点：精确
- 缺点：需要读取大量内存

### 方法 3: 关键指令模式匹配
- 检查入口点附近的指令序列
- 对比预期的启动代码模式
- 优点：低开销
- 缺点：易绕过

## 实施建议

**推荐：方法 2（代码段哈希对比）+ 方法 1（PE 头快速预筛选）**

### 实施步骤

1. **预筛选**：
   - 枚举进程模块（EnumProcessModules）
   - 获取主模块路径（GetModuleFileNameEx）
   - 快速检查 PE 头基本字段（machine, numberOfSections, timeDateStamp）

2. **深度检测**：
   - 遍历所有段（特别是 `.text`, `.data`, `.rdata`）
   - 读取内存段内容（ReadProcessMemory）
   - 读取磁盘文件对应段
   - 逐字节对比或哈希对比
   - 计算置信度：`confidence = (匹配字节数 / 总字节数) * 100`

3. **恢复模式**（autoRestore: true）：
   - 从磁盘重新读取原始段
   - VirtualProtectEx 修改页保护（PAGE_EXECUTE_READWRITE）
   - WriteProcessMemory 写回原始内容
   - 恢复原保护属性

## 参考资料

- [Process Hollowing - ATT&CK T1055.012](https://attack.mitre.org/techniques/T1055/012/)
- [Detecting Process Hollowing - SANS](https://www.sans.org/reading-room/whitepapers/malicious/detecting-preventing-process-hollowing-39452)
- pe-sieve: https://github.com/hasherezade/pe-sieve（开源工具，可参考算法）

## 代码草图

```typescript
async detectHollowing(pid: number): Promise<HollowingDetectionResult> {
  // 1. 获取主模块信息
  const modules = await EnumProcessModules(pid);
  const mainModule = modules[0]; // 主模块通常是第一个
  const diskPath = await GetModuleFileNameEx(pid, mainModule.base);
  
  // 2. 解析内存 PE 头
  const memoryPE = await this.peAnalyzer.parseHeaders(pid, mainModule.base);
  
  // 3. 解析磁盘 PE 文件
  const diskBuffer = await fs.readFile(diskPath);
  const diskPE = parsePEFromBuffer(diskBuffer);
  
  // 4. 对比关键字段
  if (memoryPE.fileHeader.timeDateStamp !== diskPE.fileHeader.timeDateStamp) {
    // 可疑：时间戳不匹配
  }
  
  // 5. 对比代码段
  const textSection = memoryPE.sections.find(s => s.name === '.text');
  if (textSection) {
    const memoryBytes = await ReadProcessMemory(pid, textSection.virtualAddress, textSection.virtualSize);
    const diskBytes = diskBuffer.slice(textSection.pointerToRawData, textSection.pointerToRawData + textSection.sizeOfRawData);
    
    const memoryHash = crypto.createHash('sha256').update(memoryBytes).digest('hex');
    const diskHash = crypto.createHash('sha256').update(diskBytes).digest('hex');
    
    if (memoryHash !== diskHash) {
      return { isHollowed: true, confidence: 95, evidence: {...} };
    }
  }
  
  return { isHollowed: false, confidence: 100 };
}
```

## 风险评估

| 操作 | 风险等级 | 说明 |
|------|---------|------|
| 读取进程内存 | 低 | 只读操作，不影响进程状态 |
| 对比磁盘文件 | 低 | 本地文件访问 |
| autoRestore: false | 低 | 只检测，无副作用 |
| autoRestore: true | **高** | 写入进程内存，可能导致进程崩溃 |

**autoRestore 风险缓解措施**：
- 默认 false
- 工具描述中标注 "HIGH RISK - May crash target process"
- 恢复前备份原内存内容（用于回滚）
- 恢复后验证 PE 头完整性
