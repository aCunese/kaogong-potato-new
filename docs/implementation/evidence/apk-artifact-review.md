# APK 产物复核（本轮实际结果）

复核时间：2026-10-26（Asia/Tokyo）；源码版本：`codex/prod-release-m1-m4` @ `bc368b7` + 本轮未提交修复（见 FINAL-VERIFICATION.md）。
工具：`~/.android-sdk/build-tools/34.0.0/{aapt2,apksigner}`（本机 PATH 未包含，显式调用）。

## 1. 实际公开分发的历史包（旧包，仍保留为历史产物）

| 字段 | v1.0.1 | v1.0.2（此前交付物） |
|---|---|---|
| 文件 | `release/apk/kaogong-potato-v1.0.1.apk` | `release/apk/kaogong-potato-v1.0.2.apk` |
| packageName | `com.ruyne.kaogong` | `com.ruyne.kaogong` |
| versionName / versionCode | 1.0.1 / 2 | 1.0.2 / 3 |
| min/target SDK | 24 / 34 | 24 / 34 |
| 大小 | 94,715 B | 280,974 B |
| signer SHA-256 | `857582efd92083cc75e5c5a0c20db326252cbf80e71123234b6bf59dcd1736c1` | 同左（与 v1.0.1 证书一致） |
| apksigner verify | 通过 | 通过 |
| 源码内容 | 旧 | **不包含本轮 Java 修复** |

**R14 结论（实测）**：执行 `./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk` 返回 **exit 1**，输出 **16/16 项断言失败**，例如：

```
❌ 校验失败事件回传（R14）  (DEX 缺少字面量: verification_failed)
❌ 下载真实进度事件（R15）  (DEX 缺少字面量: download_progress)
❌ 系统安装器已调起事件（R15）  (DEX 缺少字面量: installer_launched)
❌ R13 回归：DEX 仍存在 WebView.getUrl 直接调用（JavascriptInterface 线程违规风险）
❌ 旧版固定文件残留路径已移除  (DEX 仍包含禁止字面量: kaogong-potato-update.apk)
```

→ 现有 v1.0.2 包**不得**作为“包含最新修复”的安装包分发；服务端 `release.json` 已置 `apkReleased=false` 且 `/api/download/apk` 返回 `404 APK_NOT_RELEASED`，不再回退分发旧包。

## 2. 本轮新源码的编译验证产物（未签名，不可分发）

| 字段 | 值 |
|---|---|
| 文件 | `android/build/verify/kaogong-potato-v1.0.3-UNSIGNED-NOT-FOR-DISTRIBUTION.apk` |
| packageName | `com.ruyne.kaogong` |
| versionName / versionCode | **1.0.3 / 4**（`android/app/build.gradle` 单一来源） |
| min/target SDK | 24 / 34 |
| 大小 | 286,912 B |
| SHA-256 | `50cd19c1ffcff3750317b4c12d3868104b0707c62133ef00a611602806d130dd` |
| 签名 | **无（unsigned，明确标注 NOT FOR DISTRIBUTION）** |
| Manifest 额外权限 | `android.permission.REQUEST_INSTALL_PACKAGES` 已包含 |
| 编译链 | aapt2 compile/link → javac(17) → d8 → zip → zipalign，全部 exit 0 |
| 内容断言 | `./scripts/build-apk.sh --unsigned-verify` exit 0（Host 精确校验、SHA-256、packageName/versionCode/签名证书校验、线程安全桥接、ACTION_CHOOSER、DownloadManager 状态等断言通过） |

## 3. 正式签名包：**阻塞（环境缺少密钥口令）**

- `release/kaogong-release.keystore` 存在，但本会话**没有** `KEYSTORE_PASS`，`scripts/build-apk.sh` 在缺少口令时 exit 1（F09：拒绝静默生成新 key / debug 降级）。
- **没有**生成任何替代密钥，**没有**伪造签名包，**没有**用 debug 签名冒充正式包。
- 因此：`release/apk/kaogong-potato-v1.0.3.apk` 尚不存在；`release.json` 中 `apkSha256=""`、`apkSizeBytes=0`、`apkReleased=false`，`/api/download/apk` 明确返回 `APK_NOT_RELEASED`。
- 解除阻塞步骤（需要用户提供）：`KEYSTORE_PASS='<原口令>' ./scripts/build-apk.sh` → 生成 `release/apk/kaogong-potato-v1.0.3.apk`（原证书 `85:75:82:…:C1` 连续）→ 回填 `release.json` 的 `apkSha256/apkSizeBytes/apkReleased:true` → 重跑 `npm test` 与 `--verify-apk` 断言。

## 4. 真机 / 模拟器验收

本机无 `adb`、无 Android 设备/模拟器：新装、覆盖升级保留数据、来源授权同意/拒绝、相机与相册取消、下载失败重试、安装取消、返回键与安全区等**未做设备级验收**。复验方法：连接设备后 `adb install -r release/apk/kaogong-potato-v1.0.3.apk`，按 R13–R17 清单逐项验证 logcat 无 wrong-thread 异常。
