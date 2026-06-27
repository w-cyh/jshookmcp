# 军工级标准审计 — 全域工具验证研究

## 研究范围

36 个域，451 个工具。按技术簇分组：

| 簇 | 域 | 工具数 |
|---|---|---|
| 内存/进程操控 | memory(30), process(21) | 51 |
| 二进制分析 | binary-instrument(32), native-emulator(21), exploit-dev(7), boringssl-inspector | ~60 |
| 浏览器自动化 | browser(60+), webgpu(6) | ~66 |
| 网络/协议 | network(33), syscall-hook(7), protocol-analysis(16), proxy(8) | ~64 |
| JavaScript逆向 | analysis(23), v8-inspector(9), sourcemap(6) | ~38 |
| 调试/追踪 | debugger, trace(9), instrumentation(10) | ~19 |
| 平台/系统 | platform(14), native-bridge(4), adb-bridge(12) | ~30 |
| 其他 | 剩余16个域 | ~123 |
| **总计** | **36 域** | **~451** |

## 军工级标准定义

需搜索验证的标准维度：
1. **学术/工业界参照系**：Cheat Engine, x64dbg, Frida, IDA Pro, Ghidra, Volatility3, pe-sieve, ReClass.NET, Unidbg, Ettercap, Wireshark, RenderDoc 等工具的等效能力
2. **安全研究前沿**：NDSS/Usenix Security/CCS/Black Hat/DEF CON 最新论文
3. **检测对抗能力**：anti-debug, anti-cheat, inline-hook 检测覆盖度 vs pe-sieve/PhD7/Paranoid
4. **精度标准**：误报率/漏报率基准、符号执行完整性、内存扫描算法
5. **工程化标准**：输入验证、审计日志、平台兼容性、可观测性

## 输出格式

每个域输出：
- ✅ 达标项 (met): 具体能力 + 参照标准
- ⚠️ 差距项 (gap): 缺少什么 + 优先级
- 🔴 缺失项 (missing): 完全缺失的能力
- 🔬 前沿对比: 最新论文/工具引入的新标准
