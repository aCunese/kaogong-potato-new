# 最终验证报告 · 考公工作台（土豆新版）

日期：2026-10-27（Asia/Tokyo）
仓库：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
分支：`codex/prod-release-m1-m4`；基线 HEAD：`bc368b7b8ac6217b1a31ef78cf74c5d0e7ebaa9c`
本轮提交：`f24ae56`（核心修复与产物）→ `91b07e5`（隔离测试/证据）→ `d085d94`（身份/初始化/游客迁移回归）→ `本文件所在提交`（交接与报告）
发布身份（统一来源 `release.json`）：Web `1.0.3` / build `20261027.01`；Android `1.0.3` / `versionCode 4`（**未签名，阻塞**）。

> 结论：**数据一致性、同步/代际/账号隔离、照片头像云同步、恢复点/缓存/登录初始化、更新与 SW、测试隔离已落地并有真实运行证据；Android 正式签名包因缺少原 keystore 口令而阻塞；真机、Docker、Restic、生产部署未验收（环境/授权原因）。**

---

## 1. 环境与测试隔离（先决条件）

- 所有本轮验证均在**临时 `DATA_DIR` + 随机独立端口 + 独立浏览器 context**中运行，邀请码通过 `DATA_DIR=<tmp> node --import tsx server/cli.ts create-invite` 生成；已删除对真实 `data/potato.db` 的 `sqlite3` 写入。
- 隔离证明：真实 `data/` 11 个文件聚合 SHA-256 `5dc94c686471743760008e966176afa11ee8d3d12b9d08a2b36324c1d962bc6b` 运行前后一致；`data/potato.db` 仍为 98,304 B / mtime `Oct 26 15:21:15` / sha256 `c123fa19…5c900e`。
- 证据：`docs/implementation/evidence/test-isolation-baseline.log`、`…-results.json`、`…-isolation.json`、`…-baseline.md`。

## 2. 验证命令与结果（本轮实跑，均保存完整日志）

| 命令 | 结果 | 证据 |
|---|---|---|
| `npm test` | **EXIT 0**：单测 116（9 文件）+ 接口 17 + 灾备 3 = **136/136 通过** | `evidence/final-npm-test.log` |
| `tsc --noEmit` / `tsc -p tsconfig.server.json --noEmit` | **EXIT 0 / EXIT 0** | `final-typecheck-client.log`、`final-typecheck-server.log` |
| `npm run build` | **EXIT 0**（类型检查 + Vite 生产构建；SW 缓存名/预缓存清单由 `release.json` 注入） | `final-build.log` |
| `bun scripts/run-isolated-audit.ts` | **EXIT 0，163/163 通过**（156 视觉矩阵 = 50 屏×3 视口 + 7 条真实隔离服务器业务链路） | `test-isolation-baseline-results.json` |
| `bun scripts/business-e2e-audit.ts` | **EXIT 0，38/38 通过**（注册、跨设备删除/初始化选择、照片+头像上传与第二设备字节读取、真实 SW 离线冷启动/重连补传、真实冲突+裁决、缓存保护、重置/恢复、更新 503 诚实性与节流、三视口真实截图） | `business-e2e-results.json`、`business-e2e-server.log`、`screens/` |
| `bun scripts/auth-epoch-audit.ts` | **EXIT 0，14/14 通过**（R09 加载失败阻断与重试、R04 迟到响应、R11 退出标记、R10 游客迁移全量） | `auth-epoch-results.json` |
| `bun scripts/backup-restore-audit.ts` | **EXIT 0，13/13 通过**：`backup.sh`→tar.gz→全新目录 `restore.sh`→启动服务→工作区/照片字节/SQLite integrity/代际轮换/重启持久化 | `backup-restore-results.json` |
| `./scripts/build-apk.sh --unsigned-verify` | **EXIT 0**（aapt2/javac/d8/zipalign + Manifest/DEX 内容断言） | `android-r13-r17-unsigned-build.log` |
| `./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk` | **EXIT 1（预期）**：16/16 断言失败，证明旧 v1.0.2 包不含最新 Java 修复 | `apk-artifact-review.md` |
| `./scripts/build-apk.sh`（无 `KEYSTORE_PASS`） | **EXIT 1（预期，F09 fail-closed）**：拒绝静默生成新 key / debug 降级 | `android-r13-r17-signing-blocked.log` |

竞态/边界场景的模块级证据（真实 IndexedDB + Web Locks + 受控 HTTP）：`tests/sync-core-regressions.test.ts` 14/14（R01/R02/R03/R05/R06/R07/R08/R12）。

## 3. R01–R18 逐项状态

| 项 | 状态 | 修复要点 | 证据 |
|---|---|---|---|
| R01 同 revision 新代际恢复 | **已验证** | 代际优先于 revision 比较；拉取时把新代际快照原子写入本地并更新基线；后续编辑基于新内容 | sync-core `R01`；business E2E A3/跨设备 |
| R02 隔离后二次同步 | **已验证** | quarantined/in-flight/旧代际任务都计入“未解决本地修改”；冲突记录持久化，普通同步/focus/online/重开不再当作无修改 | sync-core `R02`×2（三次同步仍 conflict、内容不被覆盖） |
| R03 跨标签旧 flush | **已验证** | Web Locks 账号级互斥 + outbox claim 租约（陈旧任务无法重新提交）+ 原子压缩队列 | sync-core `R03`×2（真实两标签页共享 IDB） |
| R04 迟到响应污染 | **已验证** | authEpoch + userId 双校验贯穿启动/登录/同步/冲突/媒体；await 后不满足即丢弃 | auth-epoch `R04`×2 |
| R05 离线重连 CSRF | **已验证** | 联网先 `/api/auth/me` 恢复会话+CSRF 再补传；401 与 403/503/网络分开处理；有界指数退避+抖动单执行器 | sync-core `R05`×2；business E2E B2（自动补传） |
| R06 照片/头像堵塞同步 | **已验证** | 前端真实媒体队列：data URL/blob→`/api/media/upload`（sha256 去重、配额）→原子改写快照+outbox→再提交工作区；失败保留本机并重试 | business E2E B（第二设备读真实字节）；sync-core R06×2；服务器 17 项接口测试 |
| R07 清理缓存删数据 | **已验证** | “清理缓存”只清可重建旧缓存；存在未同步/冲突时明确拒绝并保留快照、outbox、照片、恢复点 | business E2E F；sync-core R07 |
| R08 重置/还原 | **已验证** | 重置/导入/覆盖/游客迁移前先持久化恢复点，写失败即停止；`还原该快照`真实读取并应用恢复点并生成后续同步任务 | business E2E F（记录真实恢复）；sync-core R08×2 |
| R09 加载失败进空库 | **已验证** | 注册/登录/冷启动必须先拉取并落盘服务器工作区；失败进入明确错误+重试，不前端造种子、不进入可编辑空库；有可靠缓存才允许离线使用 | auth-epoch R09×3；business E2E A/B2 |
| R10 旧空库选择/游客迁移 | **已验证** | 初始化选择服务器持久化（`needsInitChoice`/`init-choice`），跨设备一致且一次性；游客迁移含范围预览、双方恢复点、全量 ID 映射（题本/课程/事项/日程/记录/错题照片）、照片自动上传、旧副本保留 | business E2E A3×3；auth-epoch R10×5 |
| R11 主动退出标记 | **已验证** | 显式退出持久标记；logout 失败/离线也不得刷新自动重进；显式登录才解除；待同步数据保留 | auth-epoch R11×5 |
| R12 版本引用漂移 | **已验证** | `localMutationVersion` / `confirmedRevision` / `generationId` 分离；outbox expectedRevision 取已确认云端基线；UI revision 取真实提交结果 | sync-core R12×2 |
| R13 WebView 线程违规 | **已实现+编译/DEX 验证** | WebViewClient 在 UI 线程缓存可信 URL；JS bridge 只读 volatile 缓存；UI 操作统一 runOnUiThread；DEX 断言 0 处直接 `getUrl` | `android-r13-r17-evidence.md`；无真机 logcat |
| R14 APK 不含最新修复 | **已实现；交付阻塞** | 源码含 Host 精确匹配+SHA-256+包名+versionCode+签名证书校验；新包 code4/1.0.3 编译断言通过；旧包断言 16/16 失败并停止分发 | `apk-artifact-review.md`；**缺 keystore 口令无法签名** |
| R15 覆盖安装/拍照流程 | **已实现+编译验证** | REQUEST_INSTALL_PACKAGES+来源授权跳转恢复、ACTION_CHOOSER 相机/相册、DownloadManager 进度/取消/最终状态/重试、文件校验后安装 | 同上；**无设备未做真机验收** |
| R16 失败当最新 | **已验证（逻辑+E2E）** | 真实状态机（checking/latest/update_available/offline/failed/unrecognized）；nonce 回显校验网络新鲜度；503/超时/非法 JSON/SW 回退均不显示最新；30 分钟真实节流+in-flight 去重；手动绕过 | business E2E H×5；versionCheck harness 25/25 |
| R17 自动更新/动作/保护统一 | **已验证（逻辑+E2E）** | 启动/focus/online 统一节流检查；原生整数 versionCode；浏览器只处理 Web 更新；桥失败=unrecognized；旧包复制官网地址；SW 激活等待可观察 controllerchange；不清 IDB | business E2E H；android harness |
| R18 校验遗漏/历史膨胀 | **已验证（服务端接口）** | 全字段强校验（version/plan.type/timerStart/accumulatedMs/日期/有限数/字符串长度/图片引用）；12MiB 载荷上限 413；历史与幂等记录保留策略（7 天窗口、行/字节上限） | `npm run test:server` 17/17；`server-contracts.md` |

## 4. F01–F12 对照

| 项 | 状态 | 说明 |
|---|---|---|
| F01 旧/空代际 | **已验证** | 原直接套代际路径阻断；隔离任务不再被二次同步当作“无修改”；R02 回归覆盖 |
| F02 SW 503 与 CSRF | **已验证** | 503/网络不清身份；重连后重新取 CSRF 再补传；401 才回登录 |
| F03 版本分离 | **已验证** | 三层版本分离 + 基线原子一致；R12 回归 |
| F04 force 本机 CAS | **已验证** | 覆盖前重新核对云端 revision/generation/contentHash，确认期间变化重新核对；服务端事务内 CAS 保留 |
| F05 同 revision 分叉 | **已验证** | 内容哈希比较；相同 revision 不同内容 → 冲突 |
| F06 恢复点 | **已验证** | 冲突/重置/导入/迁移前真实持久化；还原按钮真实生效 |
| F07 错题 bookId | **已修复并回归** | 照片归档默认首本可用题本；照片云同步链路本轮验证 |
| F08 文件/备份入口 | **部分完成** | 常规“我的”已精简、大块 JSON/手动覆盖入口移除、失效“先导出备份”文案清理；旧 `SyncModal/BackupModal/StatesPreview` 仍存在于 `?preview=1` 50 屏视觉矩阵路径（非用户入口），未删除以保留视觉基线；原生文件/照片/下载链已实现（真机未验） |
| F09 原签名 | **脚本已验证；签名包阻塞** | 缺 keystore/口令/指纹不符均 fail-closed；**未生成替代密钥**；v1.0.3 正式包待口令后构建 |
| F10 Restic 真实目录 | **未验收（环境）** | 脚本修复保留（真实目录而非 latest 符号链接）；本机无 restic/远程仓库凭据，未执行远程快照与隔离恢复 |
| F11 周保留策略 | **部分验证** | 现有测试仅验证 ISO 周键计算；备份保留策略未做端到端 8 周演练 |
| F12 严格类型 | **已验证** | 服务端全字段校验 + 客户端媒体引用契约；非法状态/大字符串被结构化拒绝 |

## 5. 真实截图与存储/API 证据

`docs/implementation/evidence/screens/`（隔离环境、真实账号、原生 IndexedDB、真实 SW；非预览）：

- 登录页：412×915、393×873、360×800（`login-*.png`）
- 学习资料库（真实服务器 14/7/22）：三视口（`library-*.png`）
- 「我的」：三视口（`settings-*.png`）
- 真实冲突弹窗（双设备分叉，含双方 revision 摘要）：三视口（`conflict-*.png`）
- 更新弹窗失败态（HTTP 503，不误报最新）：三视口（`update-failed-*.png`）
- 离线重连补传后：`offline-reconnected-412x915.png`

API/存储证据：`business-e2e-results.json`（含云端 14/7/22、媒体 URL、第二设备照片字节数、离线 outbox、恢复点等断言明细）、`business-e2e-server.log`（逐请求日志）、`auth-epoch-results.json`、`test-isolation-baseline-results.json`。

## 6. APK 产物

- 现有公开最高分发版本实际为 **v1.0.2 / versionCode 3**（`release/apk/kaogong-potato-v1.0.2.apk`，280,974 B，证书 SHA-256 `85:75:82:…:36:C1`，与 v1.0.1 连续）；**经 DEX 断言证明不含最新 Java 修复**，不再作为最新包分发（服务端 `apkReleased=false`，`/api/download/apk` 返回 `APK_NOT_RELEASED`）。
- 新源码已编译验证 **v1.0.3 / versionCode 4**，包名 `com.ruyne.kaogong`、minSdk 24/targetSdk 34、含 `REQUEST_INSTALL_PACKAGES`；未签名产物 `android/build/verify/kaogong-potato-v1.0.3-UNSIGNED-NOT-FOR-DISTRIBUTION.apk`（287,912 B，sha256 `50cd19c1…30dd`）。
- **正式签名包阻塞**：缺 `KEYSTORE_PASS`。解除：`KEYSTORE_PASS='<原口令>' ./scripts/build-apk.sh` → 回填 `release.json` 的 `apkSha256/apkSizeBytes/apkReleased:true` → 重跑 `npm test`、`--verify-apk`、服务端下载完整性校验。

## 7. 备份/恢复、容器与灾备

- 真实执行并通过：`backup.sh` → `.tar.gz` 归档 → **全新隔离目录** `restore.sh` → 启动隔离服务 → 读取工作区、错题照片真实字节（SHA 匹配）、`PRAGMA integrity_check=ok`、会话清除、代际轮换、重启后数据仍在。证据 `backup-restore-results.json`。
- **未验收（环境缺工具/凭据，不得宣称已启用）**：Docker 容器重建、宿主目录 UID/卷持久化；Restic 远程仓库快照列举与异地隔离恢复；生产环境备份与回滚。

## 8. 未验收项与复验方法（诚实清单）

| 未验收项 | 原因 | 复验方法 |
|---|---|---|
| Android 正式签名 APK 交付 | 缺 keystore 口令 | 提供口令后构建 v1.0.3，校验证书连续、versionCode 4、SHA-256 与 `release.json` 一致 |
| 真机/模拟器：新装、覆盖升级保留数据、来源授权同意/拒绝、相机/相册取消、安装取消、返回键、安全区、wrong-thread logcat | 本机无 adb/设备/模拟器 | 连接设备后按 R13–R17 清单逐项验证并保存 logcat/截图 |
| 真实旧 SW 页面升级到新资源 | 未独立重跑浏览器多版本 SW 升级场景 | 用旧 dist 缓存启动 → 发布新 dist → 启动/手动检查更新 → 观察 controllerchange 后资源哈希变化 |
| 容器重建/卷持久化/宿主 UID | 无 Docker | `docker compose build && up -d`，重建容器后校验 DB/附件/初始化状态 |
| Restic 异地灾备 | 无 restic/远程凭据 | 配置仓库后 `restic snapshots`、列举 db/清单/附件并在隔离机恢复启动 |
| 生产部署/回滚/nginx/证书 | 用户明确本轮不执行生产发布 | 按第 9 节步骤另行确认执行 |
| F11 8 周保留演练 | 未构造 8 周备份样本 | 用伪造 mtime 的备份文件驱动 `backup.sh` 保留策略并断言 |

## 9. 部署与回滚步骤（**未执行**，待确认）

1. 备份生产：`ssh ubuntu@<host> "DATA_DIR=/home/ubuntu/kaogong-app/data bash scripts/backup.sh"`，保留下载归档。
2. 发布代码与 Web 构建（`npm ci && npm run build`，构建身份来自 `release.json`）；同步 `release.json`/`public/version.json`/`release/apk/kaogong-potato-v1.0.3.apk`（**签名后**）。
3. Nginx 配置校验：`sudo cp deploy/nginx/work.ruyne.space.conf … && sudo nginx -t && sudo systemctl reload nginx`。
4. `docker compose build app && docker compose up -d app`（容器挂载持久卷；等待健康检查）。
5. 线上冒烟：`/version.json` 含 `version=1.0.3 build=20261027.01 nonce 回显`、`/api/health` healthy、`/api/download/apk` 返回新包（签名后）。
6. 回滚：停止新容器 → `DATA_DIR=<data> bash scripts/restore.sh <最近备份.tar.gz>` → 部署上一版镜像/代码 → 冒烟。
7. 发布后观察：同步冲突率、`WORKSPACE_TOO_LARGE`/`APK_NOT_RELEASED` 日志、附件配额。

## 10. 风险与后续建议

- 生产历史清理未执行：本轮仅实现“写入时惰性保留策略”，未对生产 `workspace_history` 做任何清理；上线后建议先观察体积再执行受控清理。
- 媒体迁移兼容：服务端接受有界 legacy data URL（图片 ≤3,000,000 字符、头像 ≤2,000,000），旧账号首次同步会迁移为 media 引用；大历史账号建议先小范围试点。
- 冲突提示依赖服务端 `contentHash`：旧客户端无该字段时按 revision 行为兼容，建议强制升级客户端提示。
- `SyncModal/BackupModal/StatesPreview` 仅保留在 `?preview=1` 视觉矩阵；后续可连同旧测试预期一并删除。
- 所有远端操作（推送、合并、部署、Restic、生产迁移）均未执行，等待最终确认。
