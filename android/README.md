# 考公工作台 · Android WebView 宿主工程

本工程为考公工作台在 Android 移动端的轻量原生 WebView 封装外壳（包名 `com.ruyne.kaogong`）。

当前源码版本：`versionCode 4` / `versionName "1.0.3"`（版本号唯一来源：`android/app/build.gradle`）。

## 架构与规范特性

1. **安全基线**：
   - 严格 SSL 校验（遇证书异常直接 `handler.cancel()` 并提示用户，杜绝中间人劫持风险）；
   - 生产环境启用 `MIXED_CONTENT_NEVER_ALLOW`，杜绝 HTTP 明文资源混合加载；
   - 禁用未授权本地文件协议穿透，保证 IndexedDB 存储域与线上同源隔离；
   - 只信任与 `res/values/strings.xml#cloud_url` **精确同源**（scheme + host + port）的页面与下载地址，
     拒绝前缀/后缀匹配、协议相对地址、userinfo 与非常规端口（开发本机地址除外）；
   - `KaogongFileProvider` 只允许系统安装器读取固定名称的“已校验安装包”，APK 永远只读、禁止外部写句柄。

2. **离线优先**：
   - 支持 Service Worker 离线 App Shell 预缓存；
   - 断网或冷启动时，WebView 自动加载本地缓存与 IndexedDB 离线学习进度。

3. **原生交互打通**：
   - 拦截物理返回键，优先透传给 Web 端 `window.handleBack()`；
   - 首页两秒内连按两次返回键安全退出应用；
   - 接入系统 `WebChromeClient.onShowFileChooser`，相机 + 相册通过 `ACTION_CHOOSER` 统一选择面板，
     支持单选/多选/取消真实回传；
   - `AndroidBridge` 桥接协议 v2：`getAppInfo()` / `getInstallPermissionStatus()` /
     `requestInstallPermission()` / `installApkVerified(requestJson)` / `installApk(url, sha256)`（旧兼容）/
     `cancelApkDownload()`。桥方法运行在 WebView 私有后台线程，**绝不调用 WebView API**，
     受信页面状态由 `WebViewClient` 在 UI 线程缓存。

4. **应用内安全更新（覆盖升级）**：
   - 下载源必须为官方 HTTPS 同源地址；要求完整 SHA-256 元数据；
   - 下载经 `DownloadManager`（真实进度 / 失败原因 / 取消 / 重试），完成后先查询最终状态；
   - 安装前逐项校验：文件 SHA-256、文件大小、APK `packageName`、`versionCode`（必须递增且与元数据一致）、
     签名证书 SHA-256（必须与当前已安装应用一致）；校验通过后复制到私有 cache 并二次哈希（TOCTOU 防御）；
   - Android 8.0+ 通过 `REQUEST_INSTALL_PACKAGES` + `canRequestPackageInstalls()` 检查“安装未知应用”授权，
     未授权时跳转系统授权页，授权返回后自动续跑；
   - 全部失败路径可读提示并删除不可信文件，不会静默降级。

## 构建说明

### 1. 生产服务端地址配置
修改 `app/src/main/res/values/strings.xml` 中的 `cloud_url` 为你的实际部署 HTTPS 域名：
```xml
<string name="cloud_url">https://work.ruyne.space</string>
```
> 该地址同时是原生桥接与安装包下载的受信来源（精确同源校验）。

### 2. 构建（仓库根目录执行 `scripts/build-apk.sh`）

```bash
# A. 正式签名发布包（需要发布密钥库口令；分发唯一入口）
KEYSTORE_PASS='<你的密钥库口令>' ./scripts/build-apk.sh
#    产物: release/apk/kaogong-potato-v<versionName>.apk + .sha256
#    前置: release/kaogong-release.keystore 存在且证书指纹与脚本内预期一致；
#          禁止静默生成新密钥、禁止降级 debug 签名（F09 约束）。

# B. 编译校验模式（无签名口令时验证 Java/资源/DEX/Manifest，不产生分发包）
./scripts/build-apk.sh --unsigned-verify
#    产物: android/build/verify/kaogong-potato-v<versionName>-UNSIGNED-NOT-FOR-DISTRIBUTION.apk
#          以及同名 .verify.txt（sha256/大小/签名状态清单）

# C. 既有 APK 复核（R14 回归守卫：交付包必须携带最新源码的强校验能力）
./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk
#    旧的无强校验 APK 会在此模式下失败（预期），防止把旧包当成最新交付物。
```

脚本按 `aapt2 compile/link → javac → d8 → zip → zipalign → 内容断言 → apksigner` 执行，
其中“内容断言”会强制检查：Manifest 的 `REQUEST_INSTALL_PACKAGES`、versionCode/versionName、
DEX 中必须存在 `installApkVerified` / `getPackageArchiveInfo` 校验链 / `verified-kaogong-update.apk` 等符号，
并且 DEX 中不得存在 `WebView.getUrl` 直接调用（R13 线程约束回归守卫）。

### 3. Gradle 构建（可选，需本机完整 Android Gradle 环境）
```bash
./gradlew assembleRelease
```
> 注意：当前仓库以 `scripts/build-apk.sh` 作为可复现构建入口；Gradle 方式仅在具备 Android Gradle
> 插件缓存的环境中使用，签名参数通过 `RELEASE_STORE_FILE/RELEASE_STORE_PASSWORD/RELEASE_KEY_ALIAS/
> RELEASE_KEY_PASSWORD` 环境变量提供。
