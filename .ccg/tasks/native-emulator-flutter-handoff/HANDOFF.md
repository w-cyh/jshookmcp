# HANDOFF — native-emulator + Flutter 逆向方向

> 写于 2026-05-29。给新开上下文的对接文档。**先读这份，再读项目记忆 `native-emulator-android-a-plan.md` 和 `.ccg/tasks/android-reverse-env-survey/research/A-implementation-roadmap.md`。**

---

## 0. 第一句话怎么开（建议直接对新上下文说）

> 读 `D:\coding\reverse\jshookmcp\.ccg\tasks\native-emulator-flutter-handoff\HANDOFF.md` 和项目记忆 `native-emulator-android-a-plan.md`，然后跑 `pnpm test tests/modules/native-emulator/` 确认 46 测试绿，再继续。

---

## 1. 这个项目在干什么

jshookmcp（TypeScript MCP 服务器，AGPL-3.0）。用户在 `src/modules/native-emulator/` 自建一个**纯依赖、进程内的 ARM64 仿真器**，用于安卓 native 逆向（仿真执行 .so 的签名/加密函数），不连真机、不依赖 JVM/Frida。

**主线是 Flutter 逆向。** 用户 2026-05-29 确认三条线全要：
1. 还原 `libapp.so` 里的 **Dart 算法**
2. 还原 **native/JNI 下沉**的算法
3. **脱壳 / 加固对抗**

定位：做一个**通用 Flutter 逆向工具链**，不限定 app 类型。

---

## 2. 已落盘且测试绿（已核实，可信）

`src/modules/native-emulator/`，`tests/modules/native-emulator/` **11 文件 46 测试全绿**。

| 文件 | 行数 | 内容 |
|------|------|------|
| `CpuEngine.ts` | ~710 | 纯自研 ARM64 解释器 |
| `ElfLoader.ts` | ~171 | ELF64 加载 + 段映射 + .dynsym |
| `bionic.ts` | ~76 | libc 桩 `installBionicStubs(engine, addrs)` |
| `syscalls.ts` | ~122 | SVC 默认表 `installAndroidSyscalls(engine, opts)` |
| `jni.ts` | ~455 | `JniEnvironment`：JNIEnv/JavaVM + 函数表 + 对象表 + 反射 mock |

**已实现 ARM64 指令**：MOVZ、ADD(imm/shifted)、SUB(imm/shifted)、SUBS/CMP(imm/shifted，设NZCV)、ORR(含MOV别名)、EOR、LDR/STR(unsigned+pre/post-index，8/16/32/64位)、LDRB/STRB、STP/LDP、B、BL、BR、BLR、RET、CBZ/CBNZ、B.cond、SVC。
- 寄存器 BigInt 真 64 位；XZR(编码31)读0写丢弃；PC/SP 用 number；NZCV 已实现
- 解码策略：**目标驱动增量** —— 遇未实现 opcode 抛 `Unsupported ARM64 opcode 0x...`，按需补，每条新指令配 TDD

**里程碑验证**：L4.2 有个 51 指令真实 XOR 签名函数端到端跑通（栈帧序言/尾声 + 5 次 JNI 调用 + CBZ 循环），证明 JNI marshalling 闭环正确。

---

## 3. ⚠️ 唯一的半成品：L4.3

`registerJavaMethod` / `jniCallMethod` / Call*Method 绑定 / `JavaMethodImpl` 类型**已落盘在 `jni.ts`（行 143/368/201-206/440）+ typecheck 过**，但**没有专属测试文件**。

反射回调闭环在一个**已删除的临时脚本**里验证过：native 调 `FindClass("Config")` → `GetStaticMethodID("getMagic","()I")` → `CallStaticIntMethod` 回调到 JS 注册的 `() => 41n` → native +1 → 返回 42。✅ 逻辑正确，只差固化成 `tests/modules/native-emulator/jni-reflection.test.ts`。

**新上下文第一件事**：补这个测试。汇编序列见下方第 6 节。

---

## 4. ⚠️ Flutter 技术真相（别再走弯路）

| 目标文件 | 是什么 | native-emulator 能否处理 |
|----------|--------|--------------------------|
| `libapp.so` | **Dart AOT 机器码** | ❌ 需 Dart runtime 语义，当前不支持 |
| 加固壳 / 第三方加密 `.so` | 标准 ARM64 + JNI | ✅ L0-L4 对口 |
| MethodChannel 下沉的 native 算法 | 标准 JNI | ✅ L4 对口 |

**Dart AOT 调用约定**（libapp.so 直接执行需要，当前缺）：
- x15 = THR (Thread)，x27 = PP (ObjectPool)，x26 = NULL，x28 = HEAP base
- 对象是 tagged pointer（低位 tag 区分 Smi/堆对象）
- 函数通过 ObjectPool 间接调用，字符串/常量在 pool 里
- 有 VM snapshot + isolate snapshot 数据段
- 对标工具：**blutter**（最强，Dart AOT → C++ 伪码）、reFlutter（重打包 hook）、Doldrums（老）

现有 `dart-inspector` 域（`src/server/domains/dart-inspector/`）只做**静态字符串提取**（URL/路径/类名/crypto 关键词），无结构解析、无执行。

---

## 5. 三条线的下一步（建议优先级）

**P0 — L4.3 固化**：写 `jni-reflection.test.ts`，把反射回调闭环测试落地。半小时的事，先清账。

**P1 — native/JNI 线接入域（L5+L7）**：
- 新建 `src/server/domains/native-emulator/manifest.ts`，抄 `src/server/domains/binary-instrument/manifest.ts` 套路
- `profiles: ['full']`，工具名 `nemu_*`（如 `nemu_load_so` / `nemu_call_symbol` / `nemu_call_jni`）
- 封装 `NativeEmulator` 门面类（loadLibrary/callSymbol/callJni/setupJavaWorld 一站式）
- 让 AI 可按需激活。这条线让已有的 L0-L4 **真正可用**。

**P2 — Dart AOT 线（XL 新方向）**：
- 复用 L0-L3 CPU 地基，加 Dart 调用约定（THR/PP/null/tagged ptr/ObjectPool 解析）
- 先做 snapshot 解析（识别 Flutter 版本 → 匹配 Dart 版本结构偏移），再考虑执行
- 这是 libapp.so 直接逆向的核心，但难度最高，建议和用户确认投入

**P3 — 脱壳线**：native-emulator 跑加固 .so 的解密 stub，或仿真到 dump 出真实 libapp.so

**L6 可观测**（横切，任何时候可加）：CpuEngine.run() 加可选 hook 点（指令 trace/寄存器快照/断点），用 `size > 0` 守卫保证无 hook 时零开销（参照现有 hostFns 模式）。

---

## 6. L4.3 测试的汇编序列（已验证过，直接用）

native `getValue(env, thiz)`：调 `Config.getMagic()` 返回值 +1。寄存器 x19=env x20=clazz x21=methodID。

```
stp x29,x30,[sp,#-32]!   0xA9BE7BFD（注：imm 按 stpPre 编码器算）
stp x19,x20,[sp,#16]
mov x19,x0                       ; x19 = env
mov x0,x19 ; movz x1,#0x4000     ; "Config" 字符串地址
<callJni FindClass=6>            ; ldr x8,[x19]; ldr x9,[x8,#6*8]; blr x9
mov x20,x0                       ; clazz
mov x0,x19; mov x1,x20; movz x2,#0x4100; movz x3,#0x4200  ; "getMagic","()I"
<callJni GetStaticMethodID=113>
mov x21,x0                       ; methodID
mov x0,x19; mov x1,x20; mov x2,x21
<callJni CallStaticIntMethod=119>
add x0,x0,#1                     ; result + 1
ldp x19,x20,[sp,#16] ; ldp x29,x30,[sp],#32 ; ret
```

JS 侧：`jni.registerJavaMethod('Config','getMagic','()I',()=>41n)`，写字符串到 0x4000/0x4100/0x4200，设 sp=0x7fff0000 + 映射栈，x0=env x30=0，`engine.start(CODE,0)`，断言 x0===42。

callJni 宏 = `ldr x8,[x19]; ldr x9,[x8,#idx*8]; blr x9`（x19=env）。编码器见下节。

---

## 7. 🛠 操作铁律（血泪教训）

- **绝不用 `cat > file << 'EOF'` heredoc** 写多行内容 —— 本环境反复解析损坏，浪费大量轮次。写文件一律用 **Write 工具**，改文件用 **Edit 工具**。
- 验证 ARM64 编码：Write 一个 `scripts/_tmp_*.mjs`，用已知字节反推位域确认，再 `node` 跑。例：`str x30,[sp,#-16]!` = `0xF81F0FFE`，`stp x29,x30,[sp,#-16]!` = `0xA9BF7BFD`，`svc #0` = `0xD4000001`，`blr x9` = `0xD63F0120`。
- 跨 CpuEngine 验证执行：Write 一个 `scripts/_tmp_*.mts`，`npx tsx` 跑。**import 用相对路径 `../src/modules/...`**，别用 `/d/...`（会被解析成 `C:\d\`）。跑完删掉临时脚本。
- 质量门禁三连：`pnpm test tests/modules/native-emulator/` + `npx tsc --noEmit -p tsconfig.json 2>&1 | grep native-emulator`（无输出=过）+ `npx oxlint src/modules/native-emulator/ tests/modules/native-emulator/`。
- benchmark：`npx tsx scripts/native-emulator-bench.ts`。**本机基线 ~17 ns/指令**（不是记忆里别处写的 13.8，那是上会话机器态）。判回归要同进程对照，不用跨会话绝对值。

## 8. 常用 ARM64 编码器（TS，复制即用）

```ts
const le=(w:number)=>[w&0xff,(w>>>8)&0xff,(w>>>16)&0xff,(w>>>24)&0xff];
const movz=(rd:number,imm:number,hw=0)=>(0xD2800000|(hw<<21)|((imm&0xffff)<<5)|rd)>>>0;
const movReg=(rd:number,rm:number)=>(0xAA000000|(rm<<16)|(31<<5)|rd)>>>0; // orr rd,xzr,rm
const ldrOff=(rt:number,rn:number,byteOff:number)=>(0xF9400000|((byteOff/8)<<10)|(rn<<5)|rt)>>>0;
const strOff=(rt:number,rn:number,byteOff:number)=>(0xF9000000|((byteOff/8)<<10)|(rn<<5)|rt)>>>0;
const blr=(rn:number)=>(0xD63F0000|(rn<<5))>>>0;
const addi=(rd:number,rn:number,imm:number)=>(0x91000000|((imm&0xfff)<<10)|(rn<<5)|rd)>>>0;
const subi=(rd:number,rn:number,imm:number)=>(0xD1000000|((imm&0xfff)<<10)|(rn<<5)|rd)>>>0;
const cbz=(rt:number,byteOff:number)=>(0xB4000000|(((byteOff/4)&0x7ffff)<<5)|rt)>>>0;
const bImm=(byteOff:number)=>(0x14000000|((byteOff/4)&0x03ffffff))>>>0;
const stpPre=(rt:number,rt2:number,rn:number,imm:number)=>(0xA9800000|(((imm/8)&0x7f)<<15)|(rt2<<10)|(rn<<5)|rt)>>>0;
const ldpPost=(rt:number,rt2:number,rn:number,imm:number)=>(0xA8C00000|(((imm/8)&0x7f)<<15)|(rt2<<10)|(rn<<5)|rt)>>>0;
const stpOff=(rt:number,rt2:number,rn:number,imm:number)=>(0xA9000000|(((imm/8)&0x7f)<<15)|(rt2<<10)|(rn<<5)|rt)>>>0;
const ldpOff=(rt:number,rt2:number,rn:number,imm:number)=>(0xA9400000|(((imm/8)&0x7f)<<15)|(rt2<<10)|(rn<<5)|rt)>>>0;
const ret=()=>0xD65F03C0;
const eor=(rd:number,rn:number,rm:number)=>(0x4A000000|(rm<<16)|(rn<<5)|rd)>>>0;
const ldrb=(rt:number,rn:number,imm=0)=>(0x39400000|((imm&0xfff)<<10)|(rn<<5)|rt)>>>0;
const strb=(rt:number,rn:number,imm=0)=>(0x39000000|((imm&0xfff)<<10)|(rn<<5)|rt)>>>0;
```

## 9. JNI 函数表索引（已验证，Oracle 稳定 ABI，4个reserved槽后 GetVersion@4）

GetVersion 4, FindClass 6, NewObject 28, GetObjectClass 31, GetMethodID 33, CallObjectMethod 34, CallBooleanMethod 37, CallIntMethod 49, CallVoidMethod 61, GetStaticMethodID 113, CallStaticObjectMethod 114, CallStaticIntMethod 119, NewStringUTF 167, GetStringUTFChars 169, GetArrayLength 171, NewByteArray 176, GetByteArrayElements 184, ReleaseByteArrayElements 187, GetByteArrayRegion 208, SetByteArrayRegion 209, RegisterNatives 215, GetJavaVM 219。每槽 8 字节，byte offset = idx*8。

AArch64 syscall 号（asm-generic）：openat 56, close 57, read 63, write 64, clock_gettime 113, gettimeofday 169, getpid 172, mmap 222。x8=号，x0-x5=参数，x0=返回。

## 10. 待决策（新上下文应问用户）

P2 Dart AOT 是 XL 投入。建议先和用户确认：是优先把 native/JNI 线接入域跑通（P1，快速见效），还是直接啃 Dart AOT（P2，难但是 libapp.so 主目标）。我倾向 P0→P1 先让现有成果可用，P2 单独立项。
