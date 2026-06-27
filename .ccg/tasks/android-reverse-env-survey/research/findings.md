# 安卓逆向能力 × 动态调试环境依赖 — 代码库事实勘察

> 主体为对 jshookmcp 自身源码的事实勘察（非外部方案对比）。外部模型无代码库访问权，
> 且 memory 记录 Codex 在本项目 Windows 沙箱不可用，故未调用外部模型——直接读源码取证。

## 勘察的源码证据

| 域 | 关键文件 | 事实 |
|----|---------|------|
| adb-bridge | handlers.impl.ts:24 `execAdb` | 真实 `execFile(adb, ...)` 执行 devices/pull/dumpsys/forward |
| adb-bridge | handlers.impl.ts:79 `resolveAdb` | `probeCommand('adb')`，缺失抛 PREREQUISITE |
| adb-bridge | definitions.ts:8 `adb_shell` | serial 参数注释 "device serial **or emulator id**" → 模拟器可用 |
| binary-instrument | FridaSession.ts:298-308 `buildTargetArgs` | **只生成 `-p`/`-f`/`-n`，无 `-U`/`-R`/`-H`** → 仅本地进程 |
| binary-instrument | FridaSession.ts:271-296 `runFridaCommand` | 每次 `frida -q -e script` 一次性执行，非持久 attach 会话 |
| binary-instrument | frida-handlers.ts:29-31 | 若传 legacy `pid` → `invokeLegacyPlugin('plugin_frida_bridge')` |
| binary-instrument | UnidbgRunner.ts:76 | JVM 子进程模拟 ARM/ARM64 so，需 JDK17+ 与 UNIDBG_JAR |
| binary-instrument | capability-handlers.ts | 探测 frida/ghidra/jadx/apktool/unidbg CLI 可用性 |
| dart-inspector | (CLAUDE.md) | 纯 host 文件解析 libapp.so，无 browser/CDP/native 依赖 |
| boringssl | frida-tools.ts + CLAUDE.md | `tls_cert_pin_bypass_frida` delegates 到 binary-instrument Frida（同受本地限制） |
| boringssl | (CLAUDE.md) | `tls_cert_pin_bypass`(非frida) 走 CDP/interception → 针对浏览器 |
| syscall-hook | definitions.ts:4 | backend = etw/strace/dtrace + eBPF → 监控**运行 server 的主机**，与安卓设备无关 |
| native | (CLAUDE.md) | koffi 仅 Win32/Darwin/Linux 本机内存，无 Android/ARM/远程设备痕迹 |

## 三层能力分类（按环境依赖）

### L1 纯静态（零设备/零 VM，只要有文件）
- dart-inspector 全 7 工具（libapp.so 字符串/Smi/ObjectPool/header/版本指纹/符号反混淆/package）
- binary-instrument 静态：ghidra_*/ida_decompile/jadx_decompile/apktool_decode/apk_manifest_dump/apk_native_libs_list（需对应 CLI 在 PATH）
- boringssl 报文解析：tls_parse_handshake/tls_cipher_suites/tls_parse_certificate

### L2 本地仿真（需运行时，不需设备）
- **unidbg_launch/call/trace/emulate** — JVM 跑 ARM so，需 JDK17+ 与 UNIDBG_JAR。
  这是"绕开真机做动态分析（算法还原）"的主打能力。

### L3 真机/设备交互（需环境）
- **adb-bridge 全 6 工具** — 需 ① adb 在 PATH ② 连接的安卓设备**或模拟器**（标准 adb，AVD/夜神/雷电/Genymotion 皆可）。WebView 调试额外需 app `debuggable=true`。
- **Frida（binary-instrument + boringssl frida bypass）** — ⚠️ 内置实现写死本地进程，**无法连安卓设备 frida-server**。对安卓 app 做 Frida hook 须依赖外部 `plugin_frida_bridge` 插件（legacy 路径）。
- syscall-hook — 监控**本机** PC 进程，非安卓。

## 核心结论
用户直觉"安卓逆向需 VM 动态调试"对了一半：
1. 静态分析占大头，**完全不需要设备/VM**。
2. 动态执行两条路：**Unidbg 仿真（无需设备）** 与 **adb 真机/模拟器（需设备）**。
3. **Frida 动态 hook 是最大短板** — 当前代码无法直接 hook 安卓设备，是功能缺口而非"需要 VM"。
