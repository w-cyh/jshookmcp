# EXTENSION BUILD SPEC — `@jshookmcpextension/android-root-lab`

> **状态**: 构建规格（DRAFT v1）· **不提交进仓库**（位于 gitignore 的 `.ccg/`）
> **驱动来源**: 云班课逆向会话痛点 `D--cumhub-reverse-yunbanke/7d1bc231-….jsonl`（39 错误 / 22 人类发言）
> **实证基线**: 真机 `c3c3ff6b` = 22127RK46C socrates · **Magisk v30700 root · Android 13 / SDK 33 · arm64-v8a · SELinux Enforcing**
> **重要**: 经 git 历史核查，handoff 所述高权限 root 工具（root shell / iptables / `/proc/mem` dd / magisk CA）**从未落盘到 git**——无现成代码可移植。本规格的命令序列以**上述真机实证**为权威源。

---

## 0. 一句话

把"需要 root 才能跑、对无 root 用户是噪音、且具破坏性"的安卓高权限能力，从 jshookmcp **core 公共面**移出，做成**显式安装 + opt-in 激活**的独立扩展包，让默认 agent 看不到也选不到，但专业逆向场景一键启用即可**全量覆盖** jsonl 会话里尝试过的任务。

---

## 1. 为什么是扩展，不是 core

| 理由 | 证据（来自 jsonl） |
|------|------|
| 偏置 agent 去试 `su`/Magisk/iptables/系统 CA/`proc/mem`，在无 root 设备上必败 | 无 root 设备会让这些工具 100% 失败 |
| 具破坏性 / 安全敏感 | CA 注入、iptables 改流量、`/data/adb/modules` 写入 |
| 需要比普通 ADB 强得多的显式前置条件 | 需 rooted + 可用 `su` + 授权设备 |
| 设备/ROM/root 管理器强相关 | Magisk vs KernelSU vs 系统 remount 路径各异 |

**core 应保留的非 root 安卓工作流**（已在 core，验证可用）：
`adb_device_list` → `adb_package_summary` → `adb_apk_pull` → `apk_static_triage` → `jadx_decompile_apk` → `jadx_search_code` → `adb_logcat_query` → `adb_app_cold_start_trace` → `proxy_setup_adb_device`（+ 手动装 CA 提示）。

---

## 2. 真实痛点 → 扩展能力覆盖映射

jsonl 会话里**失败或手搓**的每一步，对应一个扩展工具：

| jsonl 痛点（证据） | 根因 | 扩展工具 |
|------|------|----------|
| `adb push/pull /data/...` 全失败，被 Git Bash 改写成 `C:/Program Files/Git/data/...`（E10-15,E23,E33,E34） | MSYS 路径转换 + agent 回退到 Bash（因无 root MCP 工具） | **全工具**统一 `execFile('adb',args)` + 子进程 `MSYS_NO_PATHCONV=1`（见 §4.6） |
| root 文件拉取全靠手搓 `su -c cp` staging（E9,E13,E23,E28,E33） | core 无 root 文件工具 | `android_root_file_pull` |
| frida-server 推不上→frida attach 失败→frida-dexdump 失败（E14-15,E21-22,E29-32） | 同 MSYS 篡改级联 | `android_root_file_push` + `android_root_frida_server`（可选） |
| `/proc/PID/mem` grep `I/O error`（E35），后改 `dd` 成功挖出**活 JWT/stoken/appkey**（Z5,Z7） | grep 不能 seek pseudo-file | `android_root_memory_dump_region`（dd+map 偏移） |
| 梆梆 4 层壳 DEX 脱不出（frida-dexdump 失败） | 加固 | `android_root_dex_artifact_collect`（oat/vdex/cdex + mem 兜底） |
| 系统 CA 装不上（E13 `mkdir /data/adb/modules` Permission denied，因没 su） | 需 su + magisk 模块 | `android_root_ca_install`（magisk_module） |
| 去广告需按 UID 改流量（H6） | 无 iptables 工具 | `android_root_network_policy` |
| tcpdump 抓包语法别扭（E37） | 手搓 | `android_root_capture`（可选，封装 tcpdump） |
| `pidof`/`grep` 非零退出被当致命错（E3,E5,E8,E18,E24） | **core 已修**（`adb_shell` allowNonZero=true） | `android_root_shell` 沿用同契约 |

**全量覆盖结论**：10 个工具 + MSYS 修复 + allowNonZero 契约 = jsonl 会话所有受阻步骤均可由扩展一键完成。

---

## 3. 架构与交付

- **包名**: `@jshookmcpextension/android-root-lab` · **MCP 域前缀**: `android_root_lab`（工具名 `android_root_*`）
- **形态**: 独立 npm 包 / 独立仓库（沿用模板 `https://github.com/vmoranv/jshook_plugin_template`），**不进 jshookmcp 主仓**。
- **加载**: 用户 `export MCP_PLUGIN_ROOTS=<ext-dir>` → 客户端 `reload_extensions` → 工具注册。
- **构建**: `manifest.ts`（fluent builder 运行时声明）→ 编译 `dist/manifest.js`；`meta.yaml`（对外元数据）。
- **SDK**: `@jshookmcp/extension-sdk` 的 `createExtension(id,ver)`，链式 `.tool() / .allowCommand() / .allowTool() / .configDefault() / .onValidate()`。

### manifest.ts 骨架
```ts
import { createExtension, jsonResponse, errorResponse } from '@jshookmcp/extension-sdk/plugin';

export default createExtension('io.github.vmoranv.android-root-lab', '0.1.0')
  .compatibleCore('>=0.3.0')
  .profile('full')
  .allowCommand(['adb'])                 // 仅允许派生 adb
  .configDefault('defaultSerial', '')
  .onValidate(async (ctx) => {           // 启动前置：env gate + adb 存在
    const enabled = process.env.JSHOOK_ANDROID_ROOT_LAB_ENABLE === '1';
    return { valid: enabled, errors: enabled ? [] : ['Set JSHOOK_ANDROID_ROOT_LAB_ENABLE=1 to enable root-lab tools'] };
  })
  .tool('android_root_capabilities', '...', { /*schema*/ }, handlerCaps)
  .tool('android_root_shell', '...', { /*schema*/ }, handlerShell)
  // … 其余工具
  ;
```

### meta.yaml
```yaml
name: Android Root Lab
description: Opt-in high-privilege Android RE toolkit (root shell, /proc mem dump, magisk CA, iptables). NOT default Android workflow.
author: vmoranv
source_repo: https://github.com/vmoranv/jshookmcp-ext-android-root-lab
```

---

## 4. 全局守卫（MUST）

### 4.1 env 总闸
所有工具仅在 `JSHOOK_ANDROID_ROOT_LAB_ENABLE=1` 时可用（`onValidate` 拦截）。未设置 → 扩展加载但工具校验失败、不注册。

### 4.2 变更前只读能力探测
任何变更性操作（push/CA/iptables/cleanup）执行前，handler 内部先跑 `android_root_capabilities` 等价探测，确认 `su` 可用 + 目标可写；否则返回结构化 `unavailable` + `fix` 提示，不盲目执行。

### 4.3 逐工具 confirm 布尔
| 工具 | 必需 confirm |
|------|------|
| `android_root_file_push` | `confirmOverwrite: true` |
| `android_root_file_pull`（受限路径 `/data/data /proc /system /vendor /data/adb`） | `confirmRestrictedPath: true` |
| `android_root_ca_install` | `confirmRebootMayBeRequired: true` |
| `android_root_network_policy`（非 dry-run） | `confirmApply: true` |
| `android_root_cleanup` | `confirmCleanup: true` |
缺失 confirm → handler 直接拒绝并回显将要执行的命令（dry-run 式）。

### 4.4 destructiveHint
`file_push` / `ca_install` / `network_policy` / `cleanup` 在工具描述标注 `destructiveHint: true`（改设备状态）。

### 4.5 prerequisites（manifest 声明）
rooted 设备 · 可用 `su` · 用户自有/授权测试设备 · CA/系统变更带重启警告。

### 4.6 ⚠️ MSYS 铁律（#1 现实失败根因，已真机实证）
**device 绝对路径（`/data/...`、`/proc/...`）绝不可经 Git Bash/MSYS。** 两条防线：
1. **handler 用 `execFile('adb', argsArray)`**，不拼 shell 字符串——Windows 上直接 `CreateProcess`，无 MSYS 转换，**天然免疫**（core 的 `execAdb` 已如此）。
2. **若任何子进程经 shell**，注入 `env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }`。
> 实证：`MSYS_NO_PATHCONV=1 adb push package.json /data/local/tmp/x` ✅ 成功（旧会话此处被篡改成 `C:/Program Files/Git/data/...` 而失败）。

---

## 5. 真机实证证据（c3c3ff6b，本规格命令的来源）

| 能力 | 实证命令 | 结果 |
|------|---------|------|
| root | `adb shell su -c id` | `uid=0(root) context=u:r:magisk:s0` ✅ |
| 环境 | `getprop ro.build.version.sdk/release`; `getenforce` | SDK33 / 13 / **Enforcing** ✅ |
| root 管理器 | `su -c "ls -d /data/adb/{magisk,modules}"`; `su -c "magisk -V"` | Magisk `30700` ✅ |
| MSYS 修复 | `MSYS_NO_PATHCONV=1 adb push <f> /data/local/tmp/x` + `pull` | 往返字节一致 ✅ |
| root 文件 staging | `su -c "cp /data/system/packages.list /data/local/tmp/pl.txt && chmod 644 …"` + `adb pull` | 414 行/58KB ✅ |
| /proc maps | `su -c "grep 'dalvik-main space' /proc/$PID/maps"` | `12c00000-52c00000 rw-p`（1GB region）✅ |
| **/proc mem dd** | `su -c "dd if=/proc/$PID/mem bs=4096 skip=$((start/4096)) count=64"` | 256KB，含 `Ljava/lang/Class` 等 13 个活类描述符 ✅ |

---

## 6. 工具规格（完整集 · 10 工具）

> 约定：`schema` 即 SDK `.tool(name,desc,schema,handler)` 的 properties map（builder 自动包 `{type:'object',properties}`）。每条给出**已验证命令序列**或**待真机验证的设计命令**。

### 6.1 `android_root_capabilities`（只读探测）
- **服务 jsonl 任务**: 全流程前置门禁。
- **schema**: `{ serial?: {type:'string'} }`
- **守卫**: 只读，无 confirm。
- **handler（已验证序列）**:
  ```
  adb -s <serial> shell id
  adb -s <serial> shell su -c id                         # uid=0 => rooted
  adb -s <serial> shell getprop ro.build.version.sdk / .release / ro.product.cpu.abi
  adb -s <serial> shell getenforce                       # Enforcing/Permissive
  adb -s <serial> shell su -c "ls -d /data/adb/magisk /data/adb/modules /data/adb/ksu 2>/dev/null"
  adb -s <serial> shell su -c "magisk -V 2>/dev/null"
  adb -s <serial> shell ls -ld /data/local/tmp           # 可写 staging
  ```
- **返回**: `{ adb, serial, rooted, suContext, sdk, release, abi, selinux, rootManager: 'magisk'|'ksu'|'unknown', magiskVersion, stagingWritable }`

### 6.2 `android_root_shell`（root shell）
- **服务**: 一切 root 命令基座（替代旧会话满屏 `adb shell "su -c '...'"`）。
- **schema**: `{ serial:{type:'string'}, command:{type:'string'}, allowNonZero?:{type:'boolean',default:true}, timeoutMs?:{type:'number'} }`
- **守卫**: 无 confirm（只读语义居多），但 `command` 原样透传需 env 闸已开。
- **契约**（与 core `adb_shell` 一致，解 E3/E5/E8）: **始终**返回 `{success, exitCode, stdout, stderr}`，`allowNonZero` 默认 true → 非零不抛错。
- **handler**: `execFile('adb',['-s',serial,'shell','su','-c',command])`，捕获 `err.code` 为 exitCode。
- **注意**: device 端命令含 `/data` 路径时，因走 execFile argv 直传、不经 shell，免 MSYS。

### 6.3 `android_root_file_pull`（root 拉取，staging）
- **服务**: 解 E9/E13/E23/E28/E33（拉 `/data/data`、`/data/app` vdex 等）。
- **schema**: `{ serial, remotePath, localPath, confirmRestrictedPath?:{type:'boolean'} }`
- **守卫**: `remotePath` 命中 `/data/data|/proc|/system|/vendor|/data/adb` → 需 `confirmRestrictedPath:true`。
- **handler（已验证序列）**:
  ```
  STAGE=/data/local/tmp/.rootpull_<rand>
  adb -s S shell su -c "cp -a '<remotePath>' '$STAGE' && chmod 644 '$STAGE' && chown shell:shell '$STAGE' 2>/dev/null; ls -l '$STAGE'"
  adb -s S pull "$STAGE" "<localPath>"        # execFile, 免 MSYS
  adb -s S shell su -c "rm -f '$STAGE'"        # 清理 staging
  ```
- **返回**: `{success, remotePath, localPath, size, stagedVia}`

### 6.4 `android_root_file_push`（root 推送，破坏性）
- **服务**: 推 frida-server / 脚本到设备（解 E14/E15）。
- **schema**: `{ serial, localPath, remotePath, mode?:{type:'string'}, confirmOverwrite?:{type:'boolean'} }`
- **守卫**: `destructiveHint:true`；目标已存在 → 需 `confirmOverwrite:true`；`mode` 须匹配 `^[0-7]{3,4}$`。
- **handler**: `adb push localPath /data/local/tmp/stage` → `su -c "cp stage <remotePath> && chmod <mode> <remotePath>"`（直推系统路径常因 SELinux 失败，故经 staging + su cp）。

### 6.5 `android_root_process_maps`（/proc/PID/maps）
- **服务**: 为 `memory_dump_region` 提供偏移；定位 DEX/dalvik 区域。
- **schema**: `{ serial, pid?:{type:'number'}, packageName?:{type:'string'}, filter?:{type:'string'} }`（pid 或 packageName 二选一）
- **守卫**: 只读。
- **handler（已验证）**:
  ```
  PID = pid ?? (adb shell pidof <packageName>)
  adb -s S shell su -c "cat /proc/$PID/maps"        # 解析 start-end perms ... pathname
  ```
- **返回**: `{pid, regions:[{start,end,perms,offset,pathname,sizeBytes}], totalRegions}`；标注 `[anon:dalvik-main space]`、`/data/app/...base.apk`、`.so` 等。

### 6.6 `android_root_memory_dump_region`（/proc/PID/mem dd · 实验性但已验证）
- **服务**: **皇冠工具**——dump 活进程内存挖明文密钥/JWT/stoken（解 Z5/Z7，绕过梆梆 4 层壳）。
- **schema**: `{ serial, pid|packageName, startHex:{type:'string'}, sizeBytes:{type:'number'}, outputPath?:{type:'string'}, grepPattern?:{type:'string'} }`
- **守卫**: 只读语义（读内存不改设备）；但大 region 可能很大，强制 `sizeBytes` 上限（默认 ≤ 16MB/次，分块）。
- **handler（已验证 — 必须 dd，禁 grep）**:
  ```
  SKIP=$((0x<startHex> / 4096)); CNT=$((sizeBytes/4096))
  su -c "dd if=/proc/$PID/mem bs=4096 skip=$SKIP count=$CNT 2>/dev/null > /data/local/tmp/.memdump"
  # 可选 on-device 预筛: su -c "grep -a -o -E '<grepPattern>' /data/local/tmp/.memdump"
  adb pull /data/local/tmp/.memdump <outputPath>; su -c "rm -f /data/local/tmp/.memdump"
  ```
- **失败诊断**（必须诚实返回，handoff 要求）: SELinux denial / ptrace 限制 / region 不可读 / 进程退出 → 返回 `{success:false, reason, hint:'try android_root_process_maps to pick a rw-p anon region; /proc/mem needs su+correct offset; grep cannot seek, only dd works'}`。
- **实证**: SDK33 + Enforcing + Magisk 上 dd 读 dalvik-main space 成功（13×`Ljava/`）。

### 6.7 `android_root_dex_artifact_collect`（脱壳产物收集）
- **服务**: 梆梆/加固脱壳，**安全路径优先，内存兜底**（解 frida-dexdump 失败 + E33 vdex 111MB）。
- **schema**: `{ serial, packageName, outputDir, includeMemoryFallback?:{type:'boolean',default:false} }`
- **handler 顺序**（先安全后激进）:
  1. `pm path <pkg>` → 拉 base/split APK（core `adb_apk_pull` 已能）
  2. oat 目录: `/data/app/<...>/oat/arm64/base.{odex,vdex,art}` → root pull（vdex 含 DEX）
  3. app code cache: `/data/data/<pkg>/.cache`、`/data/data/<pkg>/app_*` → root pull
  4. `/data/dalvik-cache/arm64/` 相关条目
  5. `includeMemoryFallback` 时才 → `process_maps` 找 dalvik region → `memory_dump_region` dd + cdex/dex magic 扫描
- **返回**: `{collected:[{type:'apk'|'vdex'|'odex'|'cache'|'memdex', path, size}], dexCandidates}`

### 6.8 `android_root_ca_install`（系统 CA · 破坏性 · 待真机验证）
- **服务**: HTTPS MITM 解密（core 只能装用户 CA，多数 app 不信任）。
- **schema**: `{ serial, caPemPath, mode:{enum:['magisk_module','system_remount']}, confirmRebootMayBeRequired:{type:'boolean'} }`
- **守卫**: `destructiveHint:true`；需 `confirmRebootMayBeRequired:true`；执行前 `capabilities` 确认 root 管理器；**不被 core proxy 文档推荐**。
- **handler 设计**（magisk_module，解 E13 的 Permission denied = 当时没 su）:
  ```
  HASH=$(openssl x509 -inform PEM -subject_hash_old -in <caPemPath> -noout)   # 本机算
  MOD=/data/adb/modules/jshook-trust-user-certs
  su -c "mkdir -p $MOD/system/etc/security/cacerts"
  # push CA → staging → su cp 到 $MOD/system/etc/security/cacerts/$HASH.0, chmod 644, chcon u:object_r:system_file:s0
  写 $MOD/module.prop (id/name/version)
  # 提示：重启或 magisk 挂载后生效
  ```
- **system_remount 模式**（A/B 设备多不可用）: `mount -o rw,remount /` → cp 到 `/system/etc/security/cacerts/$HASH.0` → 提示需重启。标注高风险。
- **待办**: 真机走 confirm 闸验证 magisk 模块挂载后 app 是否信任。

### 6.9 `android_root_network_policy`（iptables UID 策略 · 破坏性 · 待真机验证）
- **服务**: 按 app UID 丢弃/重定向流量（去广告 H6、定向抓包）。
- **schema**: `{ serial, packageName, action:{enum:['drop','redirect','clear']}, redirectPort?:{type:'number'}, dryRun?:{type:'boolean',default:true}, confirmApply?:{type:'boolean'} }`
- **守卫**: `destructiveHint:true`；**默认 dryRun** 返回将执行的精确命令；真正 apply 需 `dryRun:false` + `confirmApply:true`；**记录创建的规则 spec 供 cleanup**。
- **handler 设计**:
  ```
  UID=$(adb shell dumpsys package <pkg> | grep userId=)   # 取 app uid
  drop:     su -c "iptables -I OUTPUT -m owner --uid-owner $UID -j DROP"
  redirect: su -c "iptables -t nat -I OUTPUT -m owner --uid-owner $UID -p tcp -j DNAT --to 127.0.0.1:<port>"
  clear:    按记录的 rule spec 逐条 -D 删除
  ```
- **返回**: `{action, uid, rulesApplied:[...spec], dryRun}`；spec 入扩展运行时状态供 `cleanup`。

### 6.10 `android_root_cleanup`（清理 · 破坏性）
- **服务**: 复原扩展所有设备侧变更。
- **schema**: `{ serial, scope?:{enum:['staging','iptables','proxy','ca_module','all']}, confirmCleanup:{type:'boolean'} }`
- **handler**: 删 `/data/local/tmp/.rootpull_* .memdump .stage`；按记录删 iptables 规则；`settings delete global http_proxy`；删 magisk CA 模块目录。

### （可选）`android_root_frida_server` / `android_root_capture`
- frida-server: push（解 E14/E15）+ `su -c "chmod 755 && ./frida-server &"` + 端口转发；与 core binary-instrument frida 工具衔接。
- capture: 封装 `su -c "timeout N tcpdump -i any -s0 -w /data/local/tmp/cap.pcap"` + pull（解 E37 语法别扭）。

---

## 7. 能力矩阵（探测态 → 工具降级）

| 探测态 | capabilities | shell | file_pull/push | proc_maps/mem | ca_install/network |
|--------|------|------|------|------|------|
| 无 adb | `unavailable` + fix | ❌ | ❌ | ❌ | ❌ |
| adb 有/无设备 | 列空 | ❌ | ❌ | ❌ | ❌ |
| 有设备/无 su | rooted=false | ❌(回退提示用 core 非 root 工具) | core `adb_file_pull` | ❌ | ❌ |
| su 可用(Magisk) | 全绿 | ✅ | ✅ | ✅ | ✅(带 confirm) |
| SELinux Enforcing | 标注 | ✅ | ✅ | ✅(dd 实证可读) | CA 需 chcon；部分 denial 诚实回报 |

---

## 8. 测试矩阵

| 类别 | 用例 |
|------|------|
| 单元(mock execFile) | 每工具命令拼装正确（argv 数组、无 shell 拼接） |
| 能力矩阵 | no adb / no device / no su / su ok / SELinux enforcing 五态分支 |
| destructive 守卫 | 缺 `confirmOverwrite/confirmRestrictedPath/confirmRebootMayBeRequired/confirmApply/confirmCleanup` → 拒绝 + 回显命令 |
| **MSYS 回归** | mock：device 路径参数原样到达 execFile（未被改写）；shell 分支注入 `MSYS_NO_PATHCONV=1` |
| dd 偏移 | `startHex`→`skip=start/4096`、`count=size/4096` 计算正确；禁用 grep 路径 |
| dry-run | `network_policy` 默认 dryRun 只回显不执行 |
| env 闸 | 未设 `JSHOOK_ANDROID_ROOT_LAB_ENABLE=1` → `onValidate` 失败、工具不注册 |

---

## 9. 实现注意

- **一律 `execFile('adb', argsArray)`**，绝不 shell 字符串拼接（core `execAdb` 模式）。
- **`su -c '<device-cmd>'`**：device 端命令作为单参数传入，内部单引号转义谨慎；含 `$PID` 等先在 device 端 sh 求值（用 staged .sh 脚本更稳，见 §5 实证）。
- **MSYS**：execFile 天然免疫；任何 shell 子进程注入 `MSYS_NO_PATHCONV=1 / MSYS2_ARG_CONV_EXCL=*`。
- **SDK 助手**：复用 `@jshookmcp/extension-sdk` 的 `checkExternalCommand/runProcess` 做 adb 探测与超时封装；响应用 `jsonResponse/errorResponse`。
- **不导入 core 内部 handler**：低层共享逻辑直接落在扩展包内（handoff 要求）。

---

## 10. workflow 触发（避免误激活）

仅在显式词触发：`root lab` / `Magisk` / `system CA install` / `iptables UID policy` / `dump /proc/PID/mem` / `脱壳` / `内存挖密钥`。
**不**在 `apk analyze` / `pull apk` / `logcat` / `startup trace` 等普通词触发。

---

## 11. 范围外 follow-up（本任务不做，仅记录）

- **P1 `jadx_search_code` 需 `decompileDir`**（jsonl E4 报错 `expected string, received undefined`）：建议默认复用上次 `jadx_decompile` 输出目录。属 binary-instrument core，另开任务。
- **P2 可发现性**：jsonl 中 agent 一直外抓 python/frida（H5/H13 用户两次点破），没用 jshook 自带 nemu/binary-instrument/memory 工具。建议 search 域加 workflow hint / 工具路由，另开任务。
- **core 步骤 3**：完整 `pnpm check`（含 full test ~775 文件）仍待跑，作为 worktree 可提交前的最终门禁。

---

## 附：源材料指针
- 痛点蒸馏: `.ccg/_scratch/painpoints.md`
- worktree 既有改造 diff: `.ccg/_scratch/removed-root-code.diff`（注：仅 execAdb 重构/allowNonZero/proxy execFile 改造，**不含** root 工具实现）
- 探针脚本: `.ccg/_scratch/mem_probe.sh`
- handoff 原文: `.ccg/handoff-gX6s4f.md`
