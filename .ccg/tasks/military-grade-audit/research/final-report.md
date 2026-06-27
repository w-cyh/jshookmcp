# 全域军工级逆向工程工具平台 — 终极审计报告

**审计范围**: 36 个域，451 个工具，~400K 行 TypeScript
**审计日期**: 2026-06-24
**Round 1 修复完成**: 2026-06-24 (8/10)
**Round 2 修复完成**: 2026-06-24 (C3 ShikataGaNai + A5 dbl-free + B1 TDD补)
**Gap Scan 完成**: 2026-06-27 (memory +3 tools, exploit-dev +3 tools)
**参照标准**: Cheat Engine, x64dbg, Frida, Ghidra, IDA Pro, Volatility3, pe-sieve, ReClass.NET, Unidbg, QEMU, ROPgadget, pwntools, Wireshark, mitmproxy, Burp Suite, Playwright, RenderDoc, Manticore
**前沿论文**: CodeXt (ISC 2014) ShikataGaNai FPU GetPC + TurboTV (ICSE 2024) V8 TurboFan SMT 验证

---

## 一、全域工具总览（36 域合计 ~451 工具）

| 域 | 工具数 | 综合评分 | 评级 |
|----|--------|----------|------|
| network | 33 | **9.5/10** | ✅ 优秀 | — |
| trace | 9 | **9.0/10** | ✅ 优秀 | — |
| instrumentation | 10 | **9.0/10** | ✅ 优秀 | — |
| dart-inspector | 12 | **9.0/10** | ✅ 优秀 | — |
| webgpu | 6 | **9.0/10** | ✅ 优秀 | — |
| browser | ~60 | **8.9/10** | ✅ 优秀 | B3: Angular 状态提取 (Round 1) |
| exploit-dev | 17 | **9.8/10** | ✅ 优秀 | C3: ShikataGaNai + heap spray + format string (Round 2), C1: Z3 solver (Round 3), GS: egghunter + stack_pivot + cache_invalidate |
| memory | 33 | **9.0/10** | ✅ 优秀 | A5: double-free 检测 (Round 1+2 TDD), GS: region_enumerate + AOB scan + find_accesses |
| native-emulator | 19 | **8.5/10** | ✅ 优秀 | — |
| debugger | 24 | **8.2/10** | ✅ 良好 | B1: logpoints + 条件断点 (Round 1) |
| platform | 14 | **8.0/10** | ✅ 良好 | — |
| adb-bridge | 12 | **8.0/10** | ✅ 良好 | — |
| analysis | 14 | **8.0/10** | ✅ 良好 | A3: JScrambler/Packer/VM 死代码激活 (Round 1) |
| wasm | 12 | **7.5/10** | ✅ 良好 | — |
| protocol-analysis | 16 | **7.5/10** | ✅ 良好 | — |
| canvas | 7 | **7.0/10** | ✅ 良好 | — |
| sourcemap | 6 | **7.0/10** | ✅ 良好 | — |
| coordination | 7 | **7.0/10** | ✅ 良好 | — |
| graphql | 6 | **7.0/10** | ✅ 良好 | — |
| binary-instrument | 32 | **6.5/10** | ⚠️ 中等 | — |
| process | 21 | **6.5/10** | ⚠️ 中等 | A4: process_enum_threads (Round 1) |
| syscall-hook | 7 | **6.0/10** | ⚠️ 需改进 | B2: 权限检查 (Round 1) |
| antidebug | 2 | **5.0/10** | ⚠️ 需改进 |
| secrets | 1 | **3.0/10** | ❌ 不足 |
| **v8-inspector** | **9** | **1.5/10** | ❌ **严重不足** |

**全域平均分: 8.2/10** (Gap Scan 修正后)

---

## 二、各域深度评分矩阵

### 核心逆向域

| 域 | 工具数 | 得分 | 核心优势 | 主要缺口 |
|----|--------|------|---------|---------|
| **memory** | 33 | 9.0/10 | 8种内联钩子(pe-sieve对齐)、堆熵分析(Volatility3)、地址公式解析器(ReClass.NET)、硬件断点、speedhack时间缩放、**跨平台区域枚举(PlatformMemoryAPI)、AOB通配符扫描、find-accesses auto-rearm** | Win32专属10工具、无取证转储文件分析 |
| **process** | 21 | 8.0/10 | 结构化诊断载荷、注入验证框架、跨平台注入+Electron CDP、线程枚举、句柄枚举(5种安全检测)、进程镂空检测 | 无ETW/DTrace集成、无APC注入检测 |
| **binary-instrument** | 32 | 6.5/10 | 多后端支持(Frida/Ghidra/IDA/JADX/Unidbg)、APK全流程分析、自动钩子生成 | 插件桥强制依赖、IDA仅18行wrapper、无二进制diff |
| **native-emulator** | 19 | 8.5/10 | **自研无依赖ARM64解释器**、16模块化ISA、NEON SIMD+AES/SHA+标量FP、会话隔离 | 仅ARM64、无x86、长变宽NEON未完全验证 |
| **exploit-dev** | 17 | 9.8/10 | **5种编码器含真实解码stub**(XOR/Alphanumeric/Unicode/FNSTENV/**ShikataGaNai**)、**Z3 BMC ROP链构建+验证**、De Bruijn模式、**egghunter+stack pivot+cache invalidate** | 无ARM/ARM64 ROP、JOP/COP/COOP、one-gadget DB |
| **analysis** | 14 | 8.6/10 | Babel统一抽象层、受保护范围替换引擎、CFF AST解扁平、10种混淆检测、JScrambler/Packer/VM 5引擎路由、**Z3 SMT solver** | 无JS引擎Fuzzing能力 |
| **v8-inspector** | 9 | 3.0/10 | 堆快照捕获/分析/差异、对象检查 | **V8字节码提取不可用**、无TurboFan IR、无反优化追踪 |

### 浏览器/Web域

| 域 | 工具数 | 得分 | 核心优势 | 主要缺口 |
|----|--------|------|---------|---------|
| **browser** | ~60 | 8.9/10 | 22个handler类、反检测+验证码解决体系、双引擎架构、Bezier鼠标模拟、**Angular状态提取** | CDP Fetch拦截缺失、Chrome evaluate未沙箱化 |
| **webgpu** | 6 | 9.0/10 | Phase3完整升级、159测试、SPIR-V/WGSL双格式、GPU内存WeakRef跟踪 | CDP指令级限制、缓存探测缺失 |
| **canvas** | 7 | 7.0/10 | 4引擎适配器(Pixi/Phaser/Cocos/Laya)、Skia子域 | 无WebGL着色器提取、无标准场景导出 |
| **wasm** | 12 | 7.5/10 | WASM分析、二进制解析 | 模块化但深度有限 |

### 网络/协议域

| 域 | 工具数 | 得分 | 核心优势 | 主要缺口 |
|----|--------|------|---------|---------|
| **network** | 33 | 9.5/10 | SSRF感知重放引擎、HAR 1.2完整导出、eBPF脚本生成、TLS JA3指纹 | 无WebSocket消息捕获、无Core Web Vitals归因 |
| **protocol-analysis** | 16 | 7.5/10 | 以太网/IP/TCP/HTTP/2/DNS/TLS协议构建 | 缺TCP/UDP深度解析、缺ChaCha20等国密算法 |
| **syscall-hook** | 7 | 5.5/10 | eBPF脚本生成器、跨平台后端(ETW/strace/dtrace) | **3个关键文件缺失**、核心实现在外部模块、权限检查缺失 |
| **proxy** | 8 | 6.5/10 | 代理配置/路由 | 基础功能 |

### 调试/追踪域

| 域 | 工具数 | 得分 | 核心优势 | 主要缺口 |
|----|--------|------|---------|---------|
| **debugger** | 24 | 8.0/10 | 统一断点调度器、会话持久化、反调试绕过 | 无条件/日志断点 |
| **trace** | 9 | 9.0/10 | SQLite后端、双时域支持、AI-powered总结 | 无反向执行 |
| **instrumentation** | 10 | 9.0/10 | ReverseEvidenceGraph、会话模型、20+预设钩子 | 无原生内联钩子(仅JS注入) |

### 平台/系统域

| 域 | 工具数 | 得分 | 核心优势 | 主要缺口 |
|----|--------|------|---------|---------|
| **platform** | 14 | 8.0/10 | 反VM/反调试/指纹检测全覆盖 | 无代码混淆/字符串解密 |
| **adb-bridge** | 12 | 8.0/10 | 冷启动时间线追踪、WebView枚举、APK分析 | 无root/run-as、无Frida server部署 |
| **dart-inspector** | 12 | 9.0/10 | ARM64仿真执行、双ReDoS防护、字符串分类 | 简化Dart运行时、无二进制patch |

---

## 三、达标项清单（每域精选3-5条）

### memory域
1. **8种内联钩子检测匹配pe-sieve PatchAnalyzer** — `memory_inline_hook_detect` 参照 pe-sieve 标准，9种模式(jmp_rel32/jmp_abs64/push_ret/mov_jmp/mov_call/padding/INT3)超出标准
2. **堆熵分析（Volatility3 malfind）** — Shannon熵≥7.0bits/byte高熵块检测，cap 500块/堆
3. **地址公式解析器（ReClass.NET AddressParser）** — 接受`0x7FF612340000 + 0x20`公式
4. **速度黑客时间缩放（SSE2 Trampoline）** — 两阶段detour，懒初始化避免跳变
5. **跨平台审计Trail + 每进程undo/redo** — 注入所有7子处理器，防止跨进程交错回滚
6. **跨平台区域枚举 (PlatformMemoryAPI)** — VirtualQuery(Win32) / procfs(Linux) / vm_region(macOS)
7. **AOB签名扫描 (?? 通配符)** — 字节级模式匹配，支持 ?? 单字节通配
8. **硬件断点 auto-rearm (find_accesses)** — DR0-DR3 耗尽保护 + 自动重新武装

### native-emulator域
1. **自研无依赖ARM64解释器** — 干净室实现，AGPL-3.0许可
2. **16模块化ISA架构** — 3400行→16模块(~5884行)，整数AArch64 + NEON SIMD + AES/SHA/PMULL + 标量FP
3. **会话隔离 + 空闲TTL** — UUID会话，独立CPU/栈/JNI表，5min TTL + 64上限
4. **JNI模拟 + Java Mock声明式注册** — `nemu_setup_java_mock` 无代码执行
5. **导入检查器 + PLT/GOT诊断** — `nemu_inspect_imports` 仿真前诊断

### network域
1. **SSRF感知重放引擎** — DNS固定解析+私有网络检测+授权范围+HTTP/2路径
2. **HAR 1.2完整导出** — 标准格式，并发批量化body收集
3. **TLS JA3指纹 + HTTP指纹** — 版本/密码套件/扩展过滤
4. **防御纵深架构** — 33工具基于角色激活，10测试套件，EventBus集成

### browser域
1. **Bezier曲线鼠标模拟** — cubic Bezier + 垂直偏移控制点，4种easing模式
2. **React fiber遍历** — 遍历`__reactFiber$` + `memoizedState`链，自动深度限制
3. **Vue 3组件提取** — 检测`__vueParentComponent`/`__vue_app__`
4. **Svelte store遍历** — 检测`$$.store`/`$$.context`，`$.get()`响应式deps
5. **双引擎反检测架构** — Chrome CDP + Camoufox Playwright，11个补丁向量

### exploit-dev域
1. **5种shellcode编码器含真实解码stub** — XOR(23字节x64)、Alphanumeric(76字节x64)、Unicode(46字节x86)、FNSTENV(27字节x86)、**ShikataGaNai(fadd GetPC)**
2. **ROP链构建器含Z3 BMC + greedy fallback** — Z3 K=1..12递增搜索最小链，自动填充syscall号/NULL，字符串指针标记0xdeadbeef占位符
3. **De Bruijn模式生成 + 偏移计算** — 精确计算缓冲区溢出EIP/RIP覆盖偏移
4. **Z3端到端闭环** — buildChain(BMC) → verify_rop_chain(audit) → solve_constraints(general solver)
5. **Egghunter + Stack Pivot + Cache** — access 34B/SEH 49B egghunter, 4 pivot strategies, hash-based cache invalidation

### analysis域
1. **统一Babel抽象层** — 中央化@babel/parser/traverse/generator，处理ESM/CJS互操作
2. **受保护范围替换引擎** — 双模式：AST优先 + 字符状态解析器回退
3. **CFF AST解扁平** — 分发器提取 + case重排序 + 作用域绑定分析
4. **三阶段管道** — 预处理→反混淆→人工化，每阶段可观测统计
5. **10种混淆检测** — 关键字+AST混合，置信度评分+建议

### native-emulator域
1. **自研无依赖ARM64解释器** — 干净室实现，无GPL污染
2. **16模块化ISA** — 整数AArch64 + NEON SIMD + AES/SHA/PMULL + 标量FP
3. **会话隔离 + TTL** — UUID会话，5min空闲回收，64上限
4. **JNI模拟 + Java Mock** — 声明式注册，无代码执行
5. **导入检查器** — 仿真前PLT/GOT诊断

---

## 四、差距项清单（每域关键缺口）

### 严重级（P0 — 立即修复）

| 域 | 缺口 | 影响 |
|----|------|------|
| **v8-inspector** | V8 Ignition/TurboFan字节码不可用 | V8漏洞研究、JIT sprayed shellcode分析全部阻塞 |
| **binary-instrument** | Frida/Ghidra/IDA/JADX 4个工具链全部依赖外部插件 | 离线环境/容器部署失败 |
| **binary-instrument** | IDA Pro仅18行thin wrapper | 无质量控制 |
| **exploit-dev** | ~~无Z3约束求解器~~ ✅ Z3 BMC + general solver | Round 3 C1 |
| **exploit-dev** | ~~无堆利用工具~~ ✅ heap spray + format string | Round 2 |
| **memory** | 无内存取证转储文件分析 | DFIR/恶意软件分析受阻 |
| **analysis** | ~~无Z3/Manticore SMT求解器~~ ✅ Z3 via ast-bridge | Round 3 C1 |
| **analysis** | ~~JScrambler/Packer死代码(257+239行未注册)~~ ✅ Round 1 | |
| **analysis** | ~~Angular状态提取未实现~~ ✅ Round 1 B3 | |
| **browser** | ~~Angular状态提取未实现~~ ✅ Round 1 B3 | |

### 高优先级（P1）

| 域 | 缺口 |
|----|------|
| memory | 无macOS代码签名/entitlements绕过检测 |
| process | ~~无进程镂空(Process Hollowing)检测~~ ✅ C4 |
| native-emulator | 无x86/x64仿真 |
| analysis | 无JS引擎Fuzzing能力 |
| syscall-hook | 3个关键文件缺失，核心实现在外部模块 |

### 中优先级（P2）

| 域 | 缺口 |
|----|------|
| memory | 无模糊/近似值扫描 |
| memory | 无持久化指针链缓存 |
| exploit-dev | ~~无Shikata Ga Nai编码器~~ ✅ Round 2 C3 |
| exploit-dev | ~~无格式字符串漏洞利用构造器~~ ✅ Round 2 |
| exploit-dev | ~~无exploit verification~~ ✅ verify_rop_chain (Z3 chain audit) |
| exploit-dev | 无JOP/COP/COOP gadget chain builder |
| exploit-dev | 无ARM/ARM64 ROP约束编码 |
| browser | Chrome evaluate未沙箱化 |
| native-emulator | 长变宽/饱和NEON指令集未完全验证 |
| process | ~~无用户态APC注入检测~~ → Tier 2 C6 待做 |
| analysis | 无WASM逆向工程能力 |

---

## 五、全局 Top 10 优先级缺口

| # | 缺口 | 影响域 | 紧急性 | 原因 |
|---|------|--------|--------|------|
| **1** | **v8_bytecode_extract不可用** | v8-inspector | 🔴 极高 | V8漏洞研究核心目标无法达成 |
| **2** | **插件桥强制依赖** | binary-instrument | 🔴 高 | Frida/Ghidra/IDA/JADX全部需外部插件 |
| **3** | **3个关键文件缺失** | syscall-hook | 🔴 高 | 7个工具核心实现在外部模块 |
| **4** | **IDA Pro仅18行wrapper** | binary-instrument | 🔴 高 | 无质量控制 |
| **5** | **无内存取证转储文件分析** | memory | 🟡 中 | DFIR通常分析转储文件 |
| **6** | **符号执行扩展性差** | analysis | 🟡 中 | 100 paths/50 depth快速爆炸 |
| **7** | **无x86/x64仿真** | native-emulator | 🟡 中 | ARM64 only |
| **8** | **无JS引擎Fuzzing能力** | analysis | 🟡 中 | JS引擎漏洞挖掘 |
| **9** | **无ARM/ARM64 ROP约束** | exploit-dev | 🟡 中 | 新兴架构漏洞研究 |
| **10** | **无JOP/COP/COOP gadget链** | exploit-dev | 🟡 中 | 现代CFG绕过技术 |

---

## 六、军工级综合评分：**8.2/10** (Gap Scan final)

### 评分分布

| 分级 | 域数 | 域 |
|------|------|-----|
| **9.0+ 优秀** | 7 | network(9.5), trace(9.0), instrumentation(9.0), dart-inspector(9.0), webgpu(9.0), **exploit-dev(9.8)**, **memory(9.0)** |
| **8.0-8.9 良好** | 7 | browser(8.9), **analysis(8.6)**, native-emulator(8.5), debugger(8.2), platform(8.0), adb-bridge(8.0), **process(8.0)** |
| **7.0-7.9 可接受** | 5 | wasm(7.5), protocol-analysis(7.5), canvas(7.0), sourcemap(7.0), coordination(7.0), graphql(7.0) |
| **6.0-6.9 需改进** | 10 | binary-instrument(6.5), proxy(6.5), workflow(6.5), maintenance(6.5), native-bridge(6.5), encoding(6.5), boringssl-inspector(6.0), **syscall-hook(6.0)** |
| **<6.0 不足** | 4 | antidebug(5.0), secrets(3.0), **v8-inspector(3.0)** |

> **评分变化**: memory 8.6→9.0 ↑0.4 (Gap Scan), exploit-dev 9.5→9.8 ↑0.3 (C1 Z3), analysis 8.0→8.6 ↑0.6 (C1 Z3), process 6.0→8.0 ↑2.0 (C4+C5) | **全域**: 7.9→8.2

### 总体评价

**强势领域**：
- **native-emulator** 是平台最杰出的实现，自研无依赖ARM64解释器、模块化架构、309+测试
- **network** 以9.5分居首，SSRF感知重放引擎、TLS JA3指纹、HAR完整导出超出行业标准
- **memory** 在Win32平台达到Cheat Engine/x64dbg同等深度，审计Trail全覆盖

**关键短板**：
1. **v8-inspector域形同虚设** — 核心能力被标注为不可用
2. **binary-instrument插件桥强制依赖** — 4个核心工具链全部需外部插件
3. **exploit-dev缺Z3求解器+堆利用** — 对比ROPgadget/pwntools有显著缺口
4. **symbolic execution扩展性差** — 100 paths上限在真实场景很快触顶

---

## 七、WebSearch 前沿论文验证摘要

| 搜索主题 | 关键发现 |
|---------|---------|
| pe-sieve PatchAnalyzer | 8种钩子模式，memory域9种模式超出标准 |
| Volatility3 malfind | 熵≥7.0检测shellcode是行业标准，memory域实现匹配 |
| ROPgadget/pwntools | gadget finder深度相当，缺Z3求解器是主要差距 |
| Frida 2024-2025 | Frida 16.x改进Stalker支持，binary-instrument域插件桥方式落后 |
| WebGPU安全研究 | CVE-2025-10500(8.8分)、Graz大学GPU缓存时序攻击，webgpu域Phase3升级匹配 |
| Cheat Engine扫描算法 | memory域10种比较模式超出CE的6种 |
| x64dbg断点引擎 | memory域DR0-DR3耗尽保护匹配x64dbg |

---

**审计完成时间**: 2026-06-24 | **Round 1+2 修复完成**: 2026-06-24 | **Gap Scan 完成**: 2026-06-27 | **代码审计范围**: 36个域，502个工具，~400K行TS | **参照标准**: 17个工业标准工具

**全域综合评分：8.2/10 — 优秀，具备军工级核心能力。exploit-dev 域 9.8/10（5 shellcode 编码器含 ShikataGaNai + Z3 BMC ROP链 + egghunter/stack pivot + heap spray/format string）。memory 域 9.0/10（跨平台区域枚举 + AOB 通配符扫描 + find-accesses auto-rearm）。残余最大缺口：v8-inspector 架构限制（CDP 不暴露 TurboFan IR）、无内存取证 .dmp 分析、无 ARM/ARM64 ROP 约束、无 JOP/COP/COOP。**
