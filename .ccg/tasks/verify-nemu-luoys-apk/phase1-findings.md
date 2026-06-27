# Phase 1 收集结果

## 测试环境
- APK: luoys-6.10.apk (21.8MB)
- 提取 10 个 arm64-v8a .so 文件
- 测试 3 个库：libsqlite3.so, libmmkv.so, libsurface_util_jni.so

## 测试结果

### ✅ libsqlite3.so (1490.8 KB)
- 加载: **成功**
- 未解析导入: 67 个
- 导出符号: 322 个
- 问题: 没有找到 `sqlite3_initialize` / `sqlite3_libversion` 符号
  - 可能是符号名 mangling 或版本后缀问题

### ❌ libmmkv.so (574.5 KB) — **主要缺口**
- 加载: **失败**
- 错误: `Unmapped memory access at 0x-8 (len 8)`
- 分析: 
  - 负偏移 -8 (0xFFFFFFF8) 表示相对基址的回退访问
  - 发生在构造函数/重定位阶段（loadElf 内部）
  - 可能原因：
    1. GOT/PLT 基址计算错误（base - 8 越界到未映射区域）
    2. 未处理的重定位类型（R_AARCH64_TLSDESC?）
    3. .init_array 构造函数访问了 TLS/GOT 之前的 guard slot

### ⚠️  libsurface_util_jni.so (4.7 KB)
- 加载: 成功
- Trace: 失败（符号解析返回 undefined）
- 问题: 最小的 JNI lib，但符号表可能为空或 stripped

## 下一步

启动 Phase 2 双模型并行诊断，重点分析：
1. libmmkv.so 的负偏移内存访问根因
2. ElfLoader 重定位代码审查
3. CpuEngine 构造函数执行路径
