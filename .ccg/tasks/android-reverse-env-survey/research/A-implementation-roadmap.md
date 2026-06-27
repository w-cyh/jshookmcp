# A 方案：进程内自建 Android Native 仿真 — 实现路线图

> 方向锁定（2026-05-29）：用户两次确认走 A 自建仿真，接受"仿真≠真机"的保真度上限。
> 目标本身即"造一个进程内 native 仿真引擎"，不依赖外部 JVM/Unidbg JAR、不 shell out。
> "原生安卓"在此语境 = 仿真层忠实模拟 Android runtime（bionic + linker + JNI），非连真机。

## 技术栈决策

| 项 | 选型 | 理由 |
|----|------|------|
| CPU 引擎 | **unicorn.js**（Emscripten WASM，~19MB） | Node 里唯一现成 ARM/ARM64 仿真引擎；项目已有 WASM 先例（quickjs-emscripten、EmbeddingEngine worker），技术栈不排斥 |
| 加载方式 | Worker 线程隔离 + 懒加载 | 参照 `src/server/search/EmbeddingWorker.ts` 模式，避免 19MB 阻塞主线程；JS↔WASM 边界开销集中管理 |
| 不采用 | 原生 N-API（自编译 unicorn C 库） | 官方无 first-party JS binding，跨平台自维护构建成本不可接受 |
| 区别于现状 | 不依赖 `UNIDBG_JAR` / JVM | 现有 `UnidbgRunner` 是 JVM 子进程封装；A 是纯进程内 |

## 架构分层（自底向上）

```
L8 域接入层      manifest + 工具定义 + 激活规则（照搬 binary-instrument）
L7 可观测层      指令/内存 trace、寄存器快照、断点
L6 JNI 桥 ★★★   JavaVM/JNIEnv 结构体 + ~230 函数指针 + JNI_OnLoad + Java_* 调用约定 + 类型 marshalling
L5 syscall 层    SVC 指令拦截 + Android syscall 表（openat/mmap2/clock_gettime…）
L4 libc/bionic   导入符号桩：malloc/free/memcpy/memset/strlen/strcpy/__stack_chk…
L3 动态链接      依赖库加载、PLT/GOT、符号解析
L2 ELF loader    解析 .so、段映射、重定位（R_AARCH64_* / R_ARM_*）、符号表
L1 内存管理      mmap/munmap 风格虚拟内存、堆、栈
L0 CPU 引擎      unicorn.js 封装：寄存器读写、内存映射、hook 注册
```

★★★ = "原生安卓"的核心难点。L4/L5/L6 三层共同构成"Android runtime 忠实度"，是 A 与"在 Linux 上跑 ELF"的本质区别。

## 分阶段路线图

### M0 — 地基验证 PoC（S-M）★ GO/NO-GO 关卡
- **目标**：集成 unicorn.js，进程内跑一段裸 ARM64 机器码，读写寄存器/内存，验证可用性与吞吐。
- **产出**：`modules/native-emulator/CpuEngine.ts` + 一个跑 `add x0,x0,x1` 的测试。
- **风险**：unicorn.js 疑似 ~2020 后弃维；若当前 Node 22 加载失败/性能不可接受 → **整个 A 需重评估**。
- **必须先做**：在 L1-L6 任何投入前，先用 ~1 周验证地基是否成立。

### M1 — 内存 + ELF loader（L）
- mmap 虚拟内存空间；解析 ELF64、PT_LOAD 段映射、ARM64 重定位、.dynsym/.dynstr。
- **产出**：能把一个无外部依赖的 .so 加载进仿真内存，解析出导出符号表。

### M2 — 动态链接 + bionic libc 桩（L）
- 导入符号解析、PLT/GOT 回填；用 JS 实现关键 libc 函数桩并 hook 到导入表。
- **产出**：能调用一个纯计算型导出函数（如字符串哈希/简单加密），返回正确结果。

### M3 — syscall 层（M-L）
- 拦截 SVC #0；实现 Android/ARM64 syscall 子集（openat/read/mmap2/munmap/gettimeofday/clock_gettime/getpid…）。
- **产出**：能跑依赖少量 syscall 的函数（如读 /proc、取时间种子）。

### M4 — JNI 桥（XL）★ 最难，"原生安卓"内核
- JNIEnv/JavaVM 结构体内存布局；~230 个 JNIEnv 函数指针表；`JNI_OnLoad` 调用；`Java_*` 调用约定；jstring/jbyteArray/jobject marshalling；FindClass/GetMethodID/CallObjectMethod 的 mock 反射。
- **产出**：能调用真实 app 的签名/加密 JNI 函数（如 `Java_com_x_Security_sign`），拿到与真机一致的输出。
- **风险**：JNI mock 全走 JS 回调，叠加 WASM 边界，频繁穿越性能损耗；复杂样本保真度存疑。

### M5 — 域接入 + 渐进式披露（S）
- 新建 `domains/native-emulator/manifest.ts`：`profiles: ['full']`、`workflowRule`、`prerequisites`、boost rule（`emu:session_started → 激活`）。
- **产出**：AI 可按需激活的 MCP 工具，渐进式披露与可选激活"免费"继承现有 ActivationController 体系。

### M6 — 可观测性（M）
- 指令 trace、内存读写 trace、寄存器快照、断点（unicorn.js hook 能力）。
- **产出**：AI 辅助调试能力，对标 Unidbg 的 console debugger / instruction trace。

## 关键决策点（实现前需拍板）

1. **工具命名策略**：
   - (a) 新增 `nemu_*` 工具族（与现有 `unidbg_*` 并存，语义清晰）
   - (b) 把进程内仿真作为现有 `unidbg_launch/call/trace` 的可选后端（`backend: 'inprocess' | 'jvm'`），AI 接口不变、渐进增强
   - 倾向 (b)：复用已被 AI 认知的工具名，降低暴露面。

2. **首阶段范围**：强烈建议 **只先做 M0**，作为 go/no-go。地基不稳，后面全是空中楼阁。

3. **架构优先 ARM64**：ARM32 重定位/调用约定后置，避免双轨拖慢 M1-M4。

## 与现有资产的关系
- **可复用**：WASM worker 加载模式（search/EmbeddingWorker.ts）、域接入套路（binary-instrument）、激活体系（ActivationController，零成本）。
- **不可复用**：`modules/emulator/`（BrowserAPI 仿真，无关）、`modules/symbolic/`（JSVMP，是 JS VM 非 ARM）、`src/native/`（本机内存 FFI，非仿真）。
- **结论**：L0-L6 基本从零起，是数千行级 XL 实现。
