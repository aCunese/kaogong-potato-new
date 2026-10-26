# 考公工作台 · Android WebView 宿主工程

本工程为考公工作台在 Android 移动端的轻量原生 WebView 封装外壳。

## 架构与规范特性

1. **安全基线**：
   - 严禁忽略 SSL 证书错误（遇证书异常直接 `handler.cancel()` 并提示用户，杜绝中间人劫持风险）；
   - 生产环境启用 `MIXED_CONTENT_NEVER_ALLOW`，杜绝 HTTP 明文资源混合加载；
   - 禁用未授权本地文件协议穿透，保证 IndexedDB 存储域与线上同源隔离。

2. **离线优先**：
   - 支持 Service Worker 离线 App Shell 预缓存；
   - 断网或冷启动时，WebView 自动加载本地缓存与 IndexedDB 离线学习进度。

3. **原生交互打通**：
   - 拦截物理返回键，优先透传给 Web 端 `window.handleBack()`（自动按层级关闭多层 Modal 弹窗或返回上级子页）；
   - 首页两秒内连按两次返回键安全退出应用；
   - 接入系统 `WebChromeClient.onShowFileChooser`，支持错题照片拍摄与相册选取。

## 构建说明

### 1. 生产服务端地址配置
修改 `app/src/main/res/values/strings.xml` 中的 `cloud_url` 为你的实际部署 HTTPS 域名：
```xml
<string name="cloud_url">https://your-domain.com</string>
```

### 2. 编译 Release APK
在当前目录下使用 Gradle 编译：
```bash
# 调试版本
./gradlew assembleDebug

# 生产发布包 (输出至 app/build/outputs/apk/release/)
./gradlew assembleRelease
```
