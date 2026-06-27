# 全域军工级标准审计 — 执行计划

## 并行研究组分配

| 组 | Agent | 负责域 | 工具数 |
|---|---|---|---|
| A | claude-backend | memory(30), process(21), exploit-dev(7) | 58 |
| B | claude-backend | binary-instrument(32), native-emulator(21) | 53 |
| C | claude-backend | analysis(23), v8-inspector(9), sourcemap(6) | 38 |
| D | claude-backend | network(33), syscall-hook(7), protocol-analysis(16), proxy(8) | 64 |
| E | claude-backend | browser(60+), webgpu(6) | 66 |
| F | claude-backend | platform(14), native-bridge(4), adb-bridge(12), dart-inspector(12) | 42 |
| G | claude-backend | debugger, trace(9), instrumentation(10), canvas(4) | 23+ |
| H | claude-backend | remaining 16 domains | ~97 |

每组任务：
1. 读取对应域的 CLAUDE.md + definitions.ts + manifest.ts + handlers.impl.ts (前100行)
2. WebSearch 前沿论文/工具标准
3. 输出结构化审计结果
