# Implementation Status · 考公工作台（土豆新版）

> 本文件为进度快照；验证明细与证据索引见 [FINAL-VERIFICATION.md](./FINAL-VERIFICATION.md)。任何“已完成”仅在列出的验证范围内成立。

## 1. 基线与环境

- 仓库：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
- 分支：`codex/prod-release-m1-m4`；基线 `bc368b7`；本轮提交 `f24ae56`→`91b07e5`→`d085d94`→docs 提交
- 发布身份（`release.json`）：Web `1.0.3` / build `20261027.01`；Android `1.0.3` / `versionCode 4`；包名 `com.ruyne.kaogong`
- 生产目标：`https://work.ruyne.space`（本轮未部署）

## 2. 架构与约束（未变）

React 18 + Vite、Express 5、SQLite WAL、IndexedDB v3、Android Java WebView；手动计划/学习记录/错题照片/学情统计定位；无题库/判题/播放器/AI；无新增生产依赖。

## 3. 完成情况（按验证状态）

| 领域 | 状态 | 证据 |
|---|---|---|
| 数据一致性/同步收敛（R01/R02/R05/R12、F01–F05） | ✅ 已验证 | sync-core 14/14、business E2E |
| 跨标签页互斥与稳定幂等（R03） | ✅ 已验证 | sync-core 双标签页测试 |
| 账号隔离/迟到响应/退出标记（R04/R11、F02） | ✅ 已验证 | auth-epoch 14/14 |
| 照片/头像真实云同步（R06、F07/F12 部分） | ✅ 已验证 | business E2E 第二设备读取真实照片字节；服务端 17/17 |
| 清理缓存/恢复点/还原（R07/R08、F06） | ✅ 已验证 | business E2E + sync-core |
| 登录初始化/旧空库选择/游客迁移（R09/R10、F03） | ✅ 已验证 | auth-epoch R09/R10 + business E2E A3 |
| 服务端校验/配额/保留（R18、F12） | ✅ 已验证 | `npm run test:server` 17/17 |
| 更新检查真实状态/节流（R16/R17、F08 部分） | ✅ 逻辑+E2E 验证（503/节流/失败态） | business E2E H；versionCheck/SW harness |
| Android 线程桥接/安装强校验/来源授权（R13/R15） | 🟡 已实现+编译/DEX 断言；**真机未验** | android evidence；无 adb |
| Android 正式签名包（R14、F09） | ⛔ **阻塞**：缺 keystore 口令；未伪造 | `apk-artifact-review.md` |
| 备份/恢复真实演练（F10/F11） | ✅ 本地真实演练；🟡 Docker/Restic 未验收 | backup-restore 13/13 + NOT_VERIFIED |
| 测试隔离（旧 verify-screens 写真实 DB） | ✅ 已修复并验证 | test-isolation 163/163、data/ 指纹一致 |

## 4. 自动化验证数字（本轮实跑）

- `npm test`：**136/136 通过**（116 单测 + 17 接口 + 3 灾备），exit 0
- 类型检查：client/server 均 exit 0；`npm run build` exit 0
- 隔离全量：`bun scripts/run-isolated-audit.ts` → **163/163**（156 视觉 + 7 真实业务），exit 0
- 业务 E2E：`bun scripts/business-e2e-audit.ts` → **38/38**，exit 0（含 16 张真实截图）
- 身份/初始化：`bun scripts/auth-epoch-audit.ts` → **14/14**，exit 0
- 备份/恢复：`bun scripts/backup-restore-audit.ts` → **13/13**，exit 0
- APK：`--unsigned-verify` exit 0；旧 v1.0.2 `--verify-apk` exit 1（16/16 断言失败，预期）

## 5. 产物

- Web 构建：`dist/`（`npm run build`，SW 缓存名与预缓存清单由 `release.json` 注入；`/version.json` 不预缓存）
- Android 未签名验证包：`android/build/verify/kaogong-potato-v1.0.3-UNSIGNED-NOT-FOR-DISTRIBUTION.apk`（不可分发）
- 历史分发包：`release/apk/kaogong-potato-v1.0.2.apk`（versionCode 3，**不包含最新修复**，服务端已停止分发）
- 证据：`docs/implementation/evidence/`（日志/结果/APK 复核/真实截图）
- 交接：`docs/implementation/HANDOVER.md`；权威报告：`docs/implementation/FINAL-VERIFICATION.md`

## 6. 未完成/未验收（不得宣称完成）

1. Android 正式签名 APK（缺口令）与真机验收（无设备）：新装/覆盖升级/来源授权/相机相册/取消/返回键/安全区/logcat。
2. Docker 容器重建与卷持久化、宿主 UID；Restic 远程快照与异地隔离恢复。
3. 生产部署、Nginx/证书上线、生产数据迁移与历史清理、远程推送/合并。
4. 真实旧 SW 页面升级到新资源的浏览器级复跑；F11 8 周保留端到端演练。
5. preview-only 旧组件（SyncModal/BackupModal/StatesPreview）尚未删除（非用户入口）。
