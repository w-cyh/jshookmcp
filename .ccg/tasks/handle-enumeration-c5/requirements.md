# C5: 句柄枚举工具 — 需求文档

## 目标

实现 `process_enum_handles` 工具，通过 `NtQuerySystemInformation(SystemExtendedHandleInformation)` 枚举指定进程的打开句柄，解析句柄类型和名称，识别安全风险句柄（lsass.exe 句柄、高权限 Token、可继承 Section 等），process 域评分从 7.5 → 8.0。

## 预期结果

### 工具 schema

```
process_enum_handles(
  pid: number (required)          — 目标进程 PID
  filterType?: string             — 按类型过滤：Process/Thread/Token/File/Key/Section/Mutant/Event/Semaphore
  includeNames?: boolean (默认true) — 是否查询句柄名称（较慢）
  securityOnly?: boolean (默认false)— 仅返回安全风险句柄
)
```

### 返回结构

```typescript
{
  success: boolean,
  pid: number,
  totalHandles: number,           // 该进程总句柄数
  filteredHandles: number,        // 返回的句柄数
  typeSummary: Record<string, number>, // { Process: 3, Thread: 12, File: 45, ... }
  handles: Array<{
    handleValue: number,          // 句柄值
    typeName: string,             // Process/Thread/Token/File...
    objectName: string,           // 句柄名称（\Device\... 路径或空）
    grantedAccess: string,        // 0x1F0FFF 格式
    grantedAccessDecoded: string[], // ["PROCESS_ALL_ACCESS", "PROCESS_VM_READ"]
    handleAttributes: number,     // OBJ_INHERIT 等
    inheritable: boolean,
    securityRisk?: string,        // "HIGH_ACCESS_TO_LSA" / "TOKEN_DUPLICATE_IMPERSONATE" 等
  }>,
  securityFindings: Array<{
    severity: 'critical' | 'high' | 'medium',
    handleValue: number,
    riskType: string,
    description: string,
  }>,
}
```

### 安全检测能力

1. **高权限进程句柄** — 检测非 System 进程持有 lsass.exe/winlogon.exe 的 PROCESS_ALL_ACCESS
2. **危险 Token 句柄** — TOKEN_DUPLICATE + TOKEN_IMPERSONATE 组合（提权路径）
3. **可继承敏感句柄** — OBJ_INHERIT 标记的 Process/Token/Key 句柄
4. **Section 句柄** — 指向未映射可执行文件的 Section（进程空心化指标）
5. **访问掩码解码** — 将 grantedAccess 按对象类型解码为命名权限列表

## 边界范围

### 包含

- 新建 `src/native/HandleEnumerator.ts` — koffi FFI 绑定 + Buffer 解析
- 新建 `src/server/domains/process/handlers/handle-enumeration.ts` — handler
- 修改 `src/server/domains/process/definitions.ts` — 添加工具 schema
- 修改 `src/server/domains/process/manifest.ts` — 注册工具 + Win32-only guard
- 新建 `tests/server/domains/process/handle-enumeration.test.ts` — TDD 测试

### 不包含

- Z3 约束求解器（C1，工期 2-3 周）
- APC 注入检测（C6，Tier 2）
- Worker thread 超时机制（v1 简单跳过已知挂起类型：File/EtwRegistration/IoCompletionReserve）
- Linux/macOS 实现（Win32-only，manifest guard）

## 约束条件

1. **Win32-only** — 依赖 ntdll.dll NtQuerySystemInformation，非 Windows 返回 `success: false, error: "Win32 only"`
2. **需管理员权限** — SystemExtendedHandleInformation (0x40) 需 SeDebugPrivilege，无权限时报告 `error: "Requires elevated privileges"`
3. **NtQueryObject 挂起风险** — ObjectNameInformation 对 NamedPipe/Console 句柄可无限阻塞。策略：先查类型，已知挂起类型跳过名称查询
4. **句柄数可达 10 万+** — 大缓冲区分配 + 过滤裁剪返回集（默认上限 500 条，securityOnly 或 filterType 无上限）
5. **ObjectTypeIndex 每次启动不同** — 必须运行时构建 type index → type name 映射缓存
6. **koffi FFI 模式** — 遵循现有 Win32API.ts / DirectNtApi.ts 的 lazy-load + Buffer parse 模式
7. **PROCESS_DUP_HANDLE** — 源进程需此权限才能 DuplicateHandle，整体验证逻辑需优雅降级

## 验收标准

1. TDD：先写测试（parse buffer mock + security analysis mock + 底层 Win32 mock）
2. 全量测试 `pnpm test` 无新增失败
3. `npx tsc --noEmit` 零错误
4. `metadata:check` 工具数 451 → 452
5. securityOnly=true 时返回句柄全部含 securityRisk 字段
6. 非 Windows 平台返回 `success: false, error: "Win32 only"`

## 需求评分

| 维度 | 得分 | 说明 |
|------|------|------|
| 目标明确性 | 3/3 | 工具 schema + 安全检测能力 + 返回结构明确 |
| 预期结果 | 3/3 | 有具体返回格式、过滤逻辑、边界约束 |
| 边界范围 | 2/2 | 包含/不包含/每个文件路径 |
| 约束条件 | 1.5/2 | 管理员权限 + 挂起风险有策略，但 SeDebugPrivilege 调整需实测 |
| **总分** | **9.5/10** | — |
