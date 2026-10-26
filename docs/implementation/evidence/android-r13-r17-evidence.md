# Android 原生容器 + 版本更新管线 · R13–R17 证据（android-update / task-2）

生成时间：2026-10-26（UTC 13:52 之后）
仓库：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
基线 HEAD：`bc368b7b8ac6217b1a31ef78cf74c5d0e7ebaa9c`（本轮**未** git commit/checkout/stash）
审查来源：`~/.codex/visualizations/2026/10/26/01a1783f-c94d-7a12-a544-96abdd9b04c3/readonly-audit/REVIEW.md` R13–R17 + `apk-dexdump.txt`

环境：macOS；Node v22.22.3；bun 1.3.14；javac 17.0.18（Homebrew openjdk@17）；
Android SDK `~/.android-sdk`（build-tools 34.0.0：aapt2/apksigner/zipalign/d8/dexdump；platforms/android-34/android.jar）。
**无 adb / 无真机 / 无模拟器 / 无 Docker**；发布 keystore 存在但口令不可得。

---

## 0. 结论总览

| 审查项 | 源码修复 | 可复现验证 | 本轮状态 |
|---|---|---|---|
| R13 WebView 线程约束 | ✅ 桥线程不再调用任何 WebView API，受信 URL 由 WebViewClient 在 UI 线程缓存 | ✅ DEX 证据：旧交付 APK `WebView.getUrl` 直接调用 1 处 → 新源码编译产物 **0 处** | 源码+编译级 FIXED；**无真机日志**（无 adb），运行期未验收 |
| R14 交付 APK 未含最新修复 | ✅ 强校验链 + 构建期 DEX/Manifest 断言 + `--verify-apk` 回归守卫 | ✅ 旧 v1.0.2 APK 在守卫下 16 项断言失败（证明其确实陈旧）；新源码编译产物全过 | **交付级 BLOCKED**：无 KEYSTORE_PASS，无法产出签名 v1.0.3 APK；旧包仍为当前 release 实物，必须视为陈旧 |
| R15 覆盖更新/拍照链路 | ✅ Manifest 权限、canRequestPackageInstalls 授权续跑、ACTION_CHOOSER、DownloadManager 终态/进度/取消/重试、FileProvider 收紧、安装前四项强校验 | ✅ aapt2/d8 编译 + DEX/Manifest 断言 | 源码+编译级 FIXED；**真机首次授权/失败返回/旧包覆盖保数据未验收**（无设备） |
| R16 失败/缓存结果被当“最新” | ✅ versionCheck 真状态机 + nonce 网络新鲜度证明 + 30 分钟真实节流 + SW 版本接口网络直通/禁缓存回退 | ✅ 状态机 harness 25/25；SW 行为 harness 10/10；tsc 0 error | 源码+逻辑级 FIXED；真实浏览器 E2E 未在本任务内复跑（test-harness 任务负责） |
| R17 自动检查/动作/保护不统一 | ✅ 原生整数 versionCode、桥异常→unrecognized、浏览器只做 Web 更新、applyWebUpdate 等待可观测接管、canActivate 保护、官方地址复制回退 | ✅ harness 覆盖（见 §6） | 源码+逻辑级 FIXED；自动触发器与 AppContext 接线由 Lead 完成并已落位（见 §7），真机/浏览器验收待联动 |
| F08（原生文件交互） | ✅ FileProvider 只读固定安装包、相机/相册选择器、DownloadListener 拦截未校验 APK 裸下载 | ✅ 编译+断言 | 源码级 FIXED；设备验收缺 |
| F09（签名保护） | ✅ 构建脚本无口令即失败、keystore 缺失即失败、证书指纹严格匹配、签名后 APK 再复核；**未生成任何新密钥、未降级 debug 签名** | ✅ 无口令运行 exit=1（证据日志） | 源码级 FIXED；正式签名产物 BLOCKED（口令不可得） |

> 交付/签名阻塞为**环境凭证阻塞**：`release/kaogong-release.keystore` 存在但口令未知。按约束未生成新 key、未伪造签名包。

---

## 1. R13 · AndroidBridge 线程约束

**问题**：JavaScriptInterface 方法（`getAppInfo`/`installApk`）在 WebView 私有后台线程执行，旧实现先调 `isTrustedOrigin()` → `WebView.getUrl()`，targetSdk 34 下必然 `RuntimeException: A WebView method was called on thread 'JavaBridge'...`。

**修复**（`android/app/src/main/java/com/ruyne/kaogong/MainActivity.java`）：

- 新增 `volatile String cachedPageUrl` / `volatile boolean cachedPageTrusted`；
  **唯一写入口** `updateTrustedPageState(String url)`（L278）只由 `WebViewClient` 的
  `onPageStarted` / `onPageFinished` / `doUpdateVisitedHistory`（均在 UI 线程）调用；
- `KaogongBridge`（L530）内所有 `@JavascriptInterface` 方法**只读 volatile 缓存**，不调用
  `WebView.getUrl()/getSettings()/getTitle()` 等任何受线程约束 API；
- 需要 UI 线程的动作（下载、安装、授权页、Toast、`evaluateJavascript` 事件回传）全部 `uiHandler.post/runOnUiThread`；
- 桥协议升级 `BRIDGE_PROTOCOL = 2`：`getAppInfo()` 返回 `bridgeProtocol/available/trusted/reason/versionCode/
  versionName/packageName/certSha256/certFingerprint/installPermission/state`，供 Web 端区分“新桥 / 旧桥 / 桥异常”；
- 非受信页面导航由 `shouldOverrideUrlLoading` 拦截并转系统浏览器，受信页面才具备桥接能力。

**证据**（`docs/implementation/evidence/android-r13-r17-dex-evidence.log`）：

```
OLD delivered APK  release/apk/kaogong-potato-v1.0.2.apk : WebView.getUrl direct-call count = 1   ← 违规存在
NEW compiled APK   android/build/verify/...1.0.3...apk  : WebView.getUrl direct-call count = 0   ← 已消除
```

说明：新 DEX 中仍存在 `WebResourceRequest.getUrl()`（`shouldOverrideUrlLoading` 内），它运行在 UI 线程、
属于合法用法，与 `WebView.getUrl()` 不同。

**未验证**：无 adb/真机，未采集运行期 logcat 证明桥调用不再抛异常；该结论目前为源码 + DEX 级。

---

## 2. R14 · 当前待交付 APK 没有携带最新源码修复

**修复**：

1. **源码强校验链**（MainActivity.java）：
   - `resolveAndValidateDownloadUrl`（L364）：相对地址补全官方 origin；scheme/host/port 精确校验；
     禁止 userinfo、协议相对地址、反斜杠/控制字符、非默认端口（仅本机开发地址例外）；
   - `normalizeInstallRequest`：SHA-256 格式、包名、versionCode 递增（> 已安装且与元数据一致）、证书指纹预校验；
   - `verifyDownloadedApk`（L1165）安装前逐项校验：文件大小（元数据提供时）→ 文件 SHA-256 →
     `PackageManager.getPackageArchiveInfo` 解析出的 packageName / versionCode（必须递增）/ 签名证书 SHA-256
     （必须等于当前已安装应用证书；元数据声明指纹时还须一致）→ 复制进私有 cache + 复制后二次哈希（TOCTOU）；
   - 失败路径全部删除不可信文件并回传可读原因（`verification_failed`）。

2. **构建管线防“陈旧包”**（`scripts/build-apk.sh` 重写）：
   - 新增 `verify_apk_contents()`（L160）：对任意 APK 断言 Manifest 包名/versionCode/versionName/minSdk/targetSdk/
     `REQUEST_INSTALL_PACKAGES`/非 debuggable，以及 DEX 必须包含 `installApkVerified`、`bridgeProtocol`、
     `getPackageArchiveInfo`、`verified-kaogong-update.apk`、`getInstallPermissionStatus`、`canRequestPackageInstalls`、
     `download_progress`、`installer_launched` 等符号，且**不得**包含 `WebView.getUrl` 直接调用；
   - 构建产物自检 + 签名后正式 APK 二次复核；
   - 新增 `--verify-apk <path>` 回归守卫：可直接对既有交付包执行上述断言（下轮再出现“新旧源码不一致”会直接失败）；
   - 版本号唯一来源 `android/app/build.gradle`（versionCode 4 / versionName 1.0.3），脚本解析，不写死。

**证据**：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `./scripts/build-apk.sh --unsigned-verify` | 0 | aapt2+javac+d8 编译成功；Manifest/DEX 断言全部通过；产物 `android/build/verify/kaogong-potato-v1.0.3-UNSIGNED-NOT-FOR-DISTRIBUTION.apk`（sha256 `50cd19c1ffcff3750317b4c12d3868104b0707c62133ef00a611602806d130dd`，286912 bytes，signed=false） |
| `./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk` | **1** | **16 项断言失败**：旧交付包缺少 REQUEST_INSTALL_PACKAGES、`installApkVerified`、`bridgeProtocol` 等全部新校验能力，且仍含 `WebView.getUrl` 直接调用与旧固定下载路径 → 证明 R14 的“陈旧交付包”问题真实存在且守卫有效 |
| `./scripts/build-apk.sh`（无 KEYSTORE_PASS） | **1** | F09 安全拦截：不生成新密钥、不降级 debug 签名 |

签名阻塞说明：口令不可得，**未产出也不可能产出** `release/apk/kaogong-potato-v1.0.3.apk`。
`release/apk/kaogong-potato-v1.0.2.apk` 仍是当前仓库里的历史实物，**不得**作为“含全部最新安全修复”的交付物。
口令恢复后执行 `KEYSTORE_PASS=... ./scripts/build-apk.sh` 即可签名并自动完成“签名后断言 + `.sha256`”；
随后需由 Lead 更新服务端元数据：`apkVersion=1.0.3`、`apkVersionCode=4`、实际 sha256/字节数。

---

## 3. R15 · 覆盖更新与拍照流程

**Manifest**（`android/app/src/main/AndroidManifest.xml`）：
- 新增 `android.permission.REQUEST_INSTALL_PACKAGES`；
- 新增 `<queries>`：`IMAGE_CAPTURE` / `VIEW + application/vnd.android.package-archive` / `GET_CONTENT + image/*`
  （Android 11+ 包可见性，保证相机与安装器可解析性判断可靠）。

**MainActivity.java**：
- 安装授权：`openInstallPermissionSettings()`（L698）→ `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES`（带 package URI），
  `onActivityResult(INSTALL_PERMISSION_RESULTCODE)` 授权返回后自动续跑（下载前/安装前两处检查 `canRequestPackageInstalls`）；
  拒绝时回传 `install_permission_denied`；
- 拍照/相册：`openImageSourceChooser`（L409）使用 `Intent.createChooser(fileChooserParams.createIntent(), ...)` +
  `EXTRA_INITIAL_INTENTS` 相机项 + `ClipData` 权限传递；`RESULT_CANCELED` 真实回传 `null`；相机临时文件失败/取消清理，
  过期临时文件定时清理；
- 下载：`startVerifiedDownload`（L844）每次使用唯一目标文件名、先清理旧残留；`DownloadManager` 轮询真实进度
  （`download_progress`，600ms）；`handleDownloadFinished`（L996）**先查询 DownloadManager 最终状态与失败原因**
  再决定校验/失败（不只看广播）；失败原因映射为可读中文（空间不足/HTTP/重定向/存储等）+ 前端可重试；
  支持 `cancelApkDownload` 取消；
- `DownloadListener` 拦截页面内 APK 裸下载，引导到应用内强校验入口；
- FileProvider（`KaogongFileProvider.java`）：只允许系统安装器读取固定名 `verified-kaogong-update.apk`，APK 永远只读，
  拒绝路径穿越、拒绝外部写句柄、删除接口不向外部开放 APK；
- 安装器调起后回传 `installer_launched`，明确提示“不会清除 IndexedDB 学情、账号缓存”。

**未验证（诚实声明）**：无真机/模拟器，以下仍缺设备级证据：首次系统授权弹窗、授权页返回续跑的真实行为、
系统安装器失败返回、旧包覆盖安装后数据保留、相机/相册各 OEM 选择器表现、下载中杀进程恢复。

---

## 4. R16 · 失败/缓存结果被当成“最新”

**`src/utils/versionCheck.ts`（重写）**：
- 真状态机：`checking / latest / update_available / offline / failed / unrecognized`；
- **网络新鲜度证明**：`GET /version.json?nonce=<一次性随机值>&_t=...`（`cache:'no-store'` + AbortController 10s 超时）；
  响应 JSON 必须回显**同一** nonce 才用于比较；缺失/不一致 → `failed ERROR_STALE_RESPONSE`，`cacheState='stale-fallback'`；
- 失败分类：HTTP 非 2xx → `HTTP_<code>` failed；网络异常 → `offline/NETWORK_ERROR`；超时 → `TIMEOUT`；
  非法 JSON → `INVALID_JSON`；字段非法 → `INVALID_REMOTE_METADATA`；**以上一律不产生 `latest`**；
- 30 分钟真实节流：以上一次“网络新鲜核验成功”时间为准（`lastVerifiedAt` 持久化 localStorage），
  节流命中返回上次结果并标记 `fromCache:true`（绝不重复声称“本次最新”），`manual:true` 绕过；并发调用共享 in-flight Promise 去重；
- 兼容导出 `performUpdateCheck` / `CheckUpdateResult` / `CURRENT_WEB_VERSION` / `CURRENT_WEB_BUILD` 保持不变（tsc 已验证旧调用方继续编译）。

**`public/sw.js`**：
- `/version.json` 与 `/api/version` 改为**网络直通、永不缓存、绝不缓存回退**；失败返回 503 JSON（`ok:false`）
  → 页面进入 failed/offline，不可能把旧 version.json 当“最新”；
- 从预缓存列表移除 `/version.json`；`CACHE_NAME` 升级 `kaogong-shell-v2-...` 清理历史缓存；
- 防御性过滤 `SAFE_PRECACHE_RESOURCES`：即使构建期脚本（`vite.config.ts` L29）误把 `/version.json` 注入预缓存，
  install 前也会剔除（**建议 Lead 同步删除 vite.config.ts L29 根因**）。

**证据**：状态机 harness 25/25 通过、SW 行为 harness 10/10 通过（见 §6 与 `docs/implementation/evidence/android-r13-r17-versioncheck-harness.log`、`...-sw-harness.log`）。
服务端 nonce 回显已由 server-contracts 落位（`server/app.ts` `/version.json`、`/api/version` 回显 `?nonce=` + `servedAt`）。

---

## 5. R17 · 自动检查 / Web 与 APK 动作 / 保护统一

**`versionCheck.ts`**：
- 原生环境：以桥协议 2 读取 `getAppInfo()`，用**整数 versionCode** 比较；校验 `apkPackageName`、`apkCertFingerprint`、
  `apkSha256`、`apkDownloadUrl`、`apkVersionCode` 完整性；缺 SHA-256/地址 → `failed`（禁止不安全下载）；
- 桥存在但抛异常 / JSON 非法 / 页面不受信 / 版本号为空 → `unrecognized`（`BRIDGE_CALL_FAILED` / `BRIDGE_UNTRUSTED_PAGE`…），
  **绝不回退成浏览器 Web 判断**；
- 浏览器/纯 Web：只比较 Web 构建号（`compareBuildNumbers`），只走 Service Worker Web 热更新，**绝不**在网页更新场景下载 APK；
- 旧容器/无桥：`unrecognized` + 展示官方安装包绝对地址 + `copyOfficialApkUrl()` 复制路径；
  `window.open` 仅“尝试唤起系统浏览器”，文案不承诺成功（`browserAttempted` 二次说明）；
- `applyWebUpdate()`：可观测激活后才返回成功 —— 先挂 `controllerchange` 监听 → `registration.update()` →
  等待 `registration.waiting` 出现并 `SKIP_WAITING`（或已 installing 收敛）→ 等 `controllerchange`（12s 超时）；
  未观测到接管则 `ok:false`，明确“不提示更新成功”；**全程不清理 IndexedDB / 账号缓存 / 业务数据**；
- `startNativeApkInstall(remote, {canActivate})`：支持 App 层保护（计时器/写事务/待同步/冲突）；
  versionCode 未递增、包名/证书不一致、SHA-256 缺失、离线、桥不可用等均明确失败并给出官方地址回退路径；
  旧协议桥（v1.0.2 容器）调用失败时明确返回 `BRIDGE_CALL_FAILED` 而不是伪装成功；
- `markUpdateBannerDismissed` / `isUpdateBannerDismissed` 提供按版本持久化“稍后提醒”能力。

**新组件 `src/components/views/UpdateModal.tsx`**（Lead 接线用，自包含）：
- 受控/非受控两用；失败/离线/旧容器/浏览器 Web 更新/原生 APK 更新分支齐全；
  原生分支含下载进度条、取消、校验中、安装器已调起、权限引导、失败重试、复制官方地址；
  Web 分支等待 SW 接管后才提示成功并自动刷新；任何失败都不显示“当前已是最新”；
- 提供“稍后提醒我（该版本不再自动弹出）”持久化关闭按钮；
- 展示 nonce 新鲜度证明状态与网络核验时间。

**`src/components/views/DownloadApkModal.tsx`**（更新）：删除硬编码 1.0.2/旧 v1.0.1 文案与写死哈希，
改为实时 `checkAppUpdate({manual:true})` 获取元数据（带新鲜度校验），展示 SHA-256/证书指纹/官方地址并支持复制；
原生容器走应用内强校验安装，旧容器/浏览器给出官方地址复制路径。

**App 层接线（Lead 已完成的部分，只读确认）**：`src/context/AppContext.tsx` 已 import `checkAppUpdate`/`applyWebUpdate`
并在启动（认证后）、focus、visibility、online、30 分钟 interval 处调用 `checkForUpdate(false)`；in-flight/节流由本模块统一保证。
`applyUpdate()` 已传入 timer `canActivate` guard。**建议 Lead 继续补**：横幅 dismissed 持久化判断、applyUpdate 成功后 reload、
以及 install 路径的“写事务/待同步/冲突”更完整 guard（见交付消息）。

---

## 6. 验证命令与退出码汇总

| # | 命令 | 退出码 | 关键结果 |
|---|---|---|---|
| 1 | `bash -n scripts/build-apk.sh` | 0 | 脚本语法通过 |
| 2 | `node --check public/sw.js` | 0 | SW 语法通过 |
| 3 | `./scripts/build-apk.sh --unsigned-verify` | 0 | aapt2 link + javac + d8 + zipalign + 断言全过；产物 sha256 `50cd19c1…30dd`，286912B，signed=false |
| 4 | `./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk` | **1（预期）** | 16 项断言失败：旧交付 APK 不含新强校验能力（R14 证据） |
| 5 | `./scripts/build-apk.sh`（无 KEYSTORE_PASS） | **1（预期，F09）** | 安全拦截，不生成新密钥/不降级 debug 签名 → 签名 BLOCKED |
| 6 | `~/.android-sdk/build-tools/34.0.0/dexdump -d` 对比旧/新 APK | 0 | 旧 `WebView.getUrl`=1 → 新=0；新 DEX 含 `installApkVerified/getPackageArchiveInfo/canRequestPackageInstalls/...` |
| 7 | `npx tsc --noEmit`（client） | 0 | 0 error（含新 UpdateModal/DownloadApkModal/versionCheck 与旧 SettingsView 兼容导出） |
| 8 | `npx tsc --project tsconfig.server.json --noEmit` | 0 | 0 error（只读确认，未改 server） |
| 9 | `node --import tsx docs/implementation/evidence/android-update-versioncheck-harness.mts` | 0 | **25 passed / 0 failed**（R16/R17 状态机、nonce、节流、dedup、原生比较、桥异常、guard、权限、SW 应用失败路径） |
| 10 | `node --import tsx docs/implementation/evidence/android-update-sw-harness.mts` | 0 | **10 passed / 0 failed**（version 接口网络直通、不查缓存、不写缓存、503 降级、预缓存防御性剔除） |

证据日志（同目录）：
- `android-r13-r17-unsigned-build.log` / `android-r13-r17-dex-evidence.log` / `android-r13-r17-verify-old-apk.log`
- `android-r13-r17-signing-blocked.log` / `android-r13-r17-bash-n.log`
- `android-r13-r17-typecheck.log` / `android-r13-r17-versioncheck-harness.log` / `android-r13-r17-sw-harness.log`
- 可复现 harness：`android-update-versioncheck-harness.mts`、`android-update-sw-harness.mts`（运行需 `REPO_ROOT=<repo>`）

---

## 7. 本轮改动文件（android-update 写作用域内）

| 文件 | 类型 | 说明 |
|---|---|---|
| `android/app/src/main/java/com/ruyne/kaogong/MainActivity.java` | 重写 | R13/R14/R15 全部原生修复（1770 行） |
| `android/app/src/main/java/com/ruyne/kaogong/KaogongFileProvider.java` | 重写 | 收紧 APK 只读/固定名称、路径穿越防御、写入白名单 |
| `android/app/src/main/AndroidManifest.xml` | 修改 | `REQUEST_INSTALL_PACKAGES` + `<queries>` |
| `android/app/build.gradle` | 修改 | versionCode 4 / versionName 1.0.3 |
| `android/README.md` | 修改 | 构建三模式（签名/无签名编译校验/既有 APK 复核）与安全说明 |
| `scripts/build-apk.sh` | 重写 | 版本单一来源解析、三模式、Manifest/DEX 断言、签名严格校验（F09）、跨平台 size 读取、keytool/java 解析 |
| `public/sw.js` | 修改 | R16：`/version.json`+`/api/version` 网络直通禁缓存、预缓存剔除、缓存版本升级 |
| `src/utils/versionCheck.ts` | 重写 | R16/R17 状态机、nonce 新鲜度、30 分钟持久节流、SW apply、原生桥/安装、官方地址回退、兼容导出 |
| `src/components/views/UpdateModal.tsx` | **新增** | 统一更新弹窗（Lead 在 SettingsView 接线） |
| `src/components/views/DownloadApkModal.tsx` | 重写 | 去硬编码、实时元数据核验、复制官方地址/哈希、原生安全更新入口 |
| `docs/implementation/evidence/android-*` | 新增 | 本证据文件 + 日志 + harness |
| `android/build/verify/*` | 构建产物（不入库） | 无签名编译校验 APK + verify.txt（不可分发） |

> 未编辑：`src/components/views/SettingsView.tsx`、`src/context/AppContext.tsx`、`src/utils/db.ts`、`src/utils/syncClient.ts`、
> `src/types/index.ts`、`server/**`、`data/**`、`vite.config.ts`（Lead 负责）。

---

## 8. 剩余阻塞与未验证事项（诚实清单）

1. **签名/APK 交付 BLOCKED（环境凭证）**：keystore 口令不可得；未生成新密钥、未产出/伪造签名 APK。
   `release/apk/kaogong-potato-v1.0.3.apk` 需口令恢复后由 `KEYSTORE_PASS=... ./scripts/build-apk.sh` 生成；
   在此之前 `release/apk/kaogong-potato-v1.0.2.apk` 必须视为陈旧包（`--verify-apk` 已证明 16 项断言失败）。
2. **服务端版本元数据待 Lead 更新**：签名前 `apkVersion`/`apkVersionCode`/`apkSha256`/`apkSizeBytes` 不能伪造；
   当前服务端仍为 1.0.2/code3；客户端新 APK 源码为 code4，签名发布后需同步元数据，客户端即会按 4>3 提示更新。
3. **无真机/模拟器/adb**：R13 运行期不再抛异常、R15 授权续跑/安装成功/旧包覆盖保数据/相机 OEM 行为均未做设备级验收。
4. **真实浏览器 E2E 未在本任务复跑**：R16 的真实 SW 缓存/重连场景由 test-harness 任务与 Lead 的 verify-screens 验收补齐；
   本任务用 Node 模拟 SW 与浏览器对象验证逻辑（25+10 项），证据边界见 §6。
5. **vite.config.ts L29 仍会把 `/version.json` 注入 SW 预缓存**（Lead 文件）：sw.js 已防御性剔除，但建议删除根因；
   同时 `public/version.json` 为静态文件（无 nonce 能力），仅 production nginx 反代到 Express 时才能通过新鲜度校验；
   纯静态/`vite preview` 环境会诚实显示“核验失败”，不会误报“已是最新”。
6. **AppContext/App.tsx 集成建议未全部落地**（Lead 文件）：横幅 dismissed 持久化、applyUpdate 后 reload、
   install 路径完整 guard（写事务/待同步/冲突）。
7. 未运行 `npm test` / `bun scripts/verify-screens.ts`（属其他队友任务与 Lead 最终验收；本次仅运行与本任务相关的编译/断言/harness 与全量 tsc）。
