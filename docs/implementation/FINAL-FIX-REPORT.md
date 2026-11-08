# 考公工作台（土豆新版）v1.0.4 · 私域小规模上线 · 最终修复报告

> **审查对象**：《生产上线与资料保存全景评估报告》+《RELEASE_SOP.md》两份既有报告
> **审查基线**：分支 `codex/joint-release-hardening` ｜ HEAD `bd31cd4`（2026-10-27 13:21 +0900）｜ 工作区源码零改动
> **发布身份**：Web `1.0.4` / build `20261027.03` / Schema `3` ｜ Android `1.0.4` / `versionCode 5`
> **使用场景**：你 + 朋友的小范围私域使用（**不含灰度、不做大规模流量分发**）
> **生成日期**：2026-10-27（Asia/Tokyo）
> **审查方式**：只读代码 + 本机实跑验证 + 生产域名只读探测；**未修改任何业务代码**。本报告是唯一新增文件。

---

## 0. 最终结论（TL;DR）

1. **可以上线，且建议以「Web / PWA 先行」方式上线 v1.0.4。**
   代码层数据安全链路（IndexedDB v3 事务 + 服务端 SQLite WAL CAS + Outbox、照片去重/自愈、切号隔离、灾备原子恢复）已闭环，本报告重新实跑验证全部为绿。
2. **Android 正式签名包不是这次私域上线的阻断项。**
   私域场景可直接用浏览器 / PWA；已装旧版 APK（v1.0.1 / code 2、v1.0.2 / code 3）的朋友也不需要重装，因为 Android 壳是加载线上网页的 WebView，网页升级后旧壳照常使用。正式签名包作为「可选后续任务」。
3. **旧报告里 P0「设置页缺数据备份入口」属实，但性质被高估了。**
   该入口是仓库里 `F08` 与回归测试**刻意精简**掉的（不是漏写）；且「换手机」这一刚需本身可以靠**新设备登录 → 从服务器回灌**完成，所以它不是数据安全阻断项。不过对「单机 VPS + 无异地备份」的私域部署来说，它是**最便宜的一份额外保险**，建议补，且补的时候必须同步改一条回归测试断言，否则 `npm test` 会变红（详见 §5.1）。
4. **旧报告有 6 类事实错误、5 处流程命令不可直接执行**，其中最容易踩坑的是：容器名/服务名/路径写错、`SESSION_SECRET` 根本不存在、Restic 不是必做、用户图片配额是 **500MB 而非 50MB**、证书指纹在粘贴文本里被截断。逐条更正见 §2。
5. **这次上线不是「新装」，而是对线上已有 v1.0.1 真实数据的原地升级。**
   生产域名 `work.ruyne.space` 当前可访问，运行 `1.0.1 / build 20261026.02 / schema 3`，健康检查 `healthy`，且仍在分发 `v1.0.1` APK。**上线前必须先热备 + 把备份下载到本地**，这是本报告唯一的「绝对必做」步骤。
6. **不做灰度是合理的。** 单容器部署本身没有流量切分能力；用「部署后 5–10 分钟双端冒烟 + 24–48h 日志观察 + 保留回滚镜像/备份」替代即可。真正要防的是「升级覆盖数据」和「单盘损坏」，不是流量。

---

## 1. 审查基线与本次实测结果

### 1.1 代码状态

| 项目 | 结果 |
|---|---|
| 分支 / HEAD | `codex/joint-release-hardening` / `bd31cd4` |
| 源码改动 | **0**（`git diff -- src server scripts public release.json package.json Dockerfile docker-compose.yml` 为空） |
| 工作区既有未提交项 | evidence 结果/截图（历史审计重跑产生）+ 未跟踪的 `docs/implementation/RELEASE_SOP.md` |
| 发布身份一致性 | `package.json` `1.0.4` = `release.json` webVersion `1.0.4` = `public/version.json` `1.0.4`；`android/app/build.gradle` `versionCode 5` / `versionName 1.0.4` |
| `dist/` 构建身份 | `precache-manifest.json`：`1.0.4 / 20261027.03`，6 项预缓存 |

### 1.2 本次实跑（干净串行环境）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 双工程类型检查 | `npm run typecheck` | **exit 0**（前后端 0 错误） |
| 全量自动化测试 | `npm test` | **173/173 通过**（单元 146 + 服务端 21 + 灾备 6），exit 0 |
| 生产构建 | `npm run build` | **exit 0**，产物身份 `1.0.4 / 20261027.03`；本机因 iCloud 盘 I/O 慢耗时 14m27s（VPS/Linux 上会正常得多，不是应用问题） |
| 边界回归 | `npm run verify:boundaries` | **12/12 通过**，exit 0 |
| 身份/会话/初始化/游客迁移 | `npm run verify:auth` | **14/14 通过**，exit 0 |
| 备份/恢复审计 | `npm run verify:backup` | **13/13 通过**，exit 0；其中 Docker 容器重建、Restic 异地仓库明确标记 `NOT_VERIFIED`（本机无 Docker/restic） |
| APK 编译 + 内容断言（未签名校验模式） | `npm run verify:apk` | **exit 0**，Manifest 7 项 + DEX 11 项 + R13 线程约束 + 旧路径清理，共 **20 个断言全绿**（旧文档写「19/19」，属计数口径差异；实际输出 20 个 ✅） |
| 历史证据复核（`bd31cd4` 当日跑） | `docs/implementation/evidence/*.json` | business **38/38**、isolated **163/163**、auth **14/14**、backup **13/13**、boundaries **12/12** |
| 生产域名只读探测 | `curl` / HTTP GET | `/api/health` → `200 healthy`；`/version.json` → **1.0.1 / 20261026.02**；`/api/download/apk` → **200 v1.0.1 APK（94,715 B）**；`/api/version` → 404（旧版本尚无该路由） |
| 旧 APK 签名连续性 | `apksigner verify --print-certs` | v1.0.1 / v1.0.2 证书 SHA-256 均为 `857582EF…736C1`，与 `release.json` 期望指纹完全一致 → 用原 keystore 签 v1.0.4 可覆盖升级 |
| 本地 Docker / adb / restic | `command -v` | **均不可用**（Docker、adb、restic 未安装）→ 容器、真机、异地灾备只能到 VPS/真机上验收，本报告不宣称已验证 |

> **操作提示（实测踩坑）**：`npm test` 的边界回归用例会派生 `node` 子进程启动临时服务，**不要和其它重任务（`npm run build`、APK 构建）并行跑**，否则子进程超时会造成 V06/V07/V08/V10 的**假失败**。本次第一次并行跑出现 6 个超时假失败，单独串行重跑 173/173 全绿。

---

## 2. 旧报告逐条核验与纠偏

### 2.1 结论类核验

| # | 旧报告结论 | 最新代码事实（证据） | 最终裁定 |
|---|---|---|---|
| 1 | **P0**：设置页完全遗漏「数据备份与恢复」入口，考生换手机无法导出存档 | 属实没有用户入口：`SettingsView` 主列表只有 同步/检查更新/关于/账号与数据设置/退出登录（[SettingsView.tsx](../../src/components/views/SettingsView.tsx) L275–380）；`BackupModal` 只在 `?preview=1` 预览矩阵里可达（[App.tsx](../../src/App.tsx) L171–172 预览守卫、L228–231 路由、L1064 渲染） | **降级为 P1 体验缺口**：这是 [FINAL-VERIFICATION.md](./FINAL-VERIFICATION.md#L70) F08「刻意精简入口」+ `tests/ui_interaction.test.ts` L334–360 断言「eliminate obsolete offline/backup cards」固化的产品决策，不是遗漏。**换手机不必依赖它**：登录即从服务器回灌（见 §3）。仍建议补回，理由与补法见 §5.1 |
| 2 | **生产硬阻断**：APK 未签名，`apkReleased:false`，下载路由拦截 | 属实：[release.json](../../release.json) L8–11 为空哈希/0 字节/`false`；`release/apk/` 只有 v1.0.1、v1.0.2；[server/app.ts](../../server/app.ts) L334–341 在 `apkReleased=false` 时返回 404 `APK_NOT_RELEASED`；[build-apk.sh](../../scripts/build-apk.sh) L388–395 无 `KEYSTORE_PASS` 直接 fail-closed | **对私域不构成阻断**：Web/PWA 不依赖 APK；旧 APK 是远程 WebView 壳，网页升级后继续可用。仅当你要「给朋友发安装包 / 让老 APK 内升级」时才需要签名（见 §4.9） |
| 3 | 物理环境前置：Docker 卷 UID、真机覆盖升级未验收 | 属实：本机无 Docker/adb；`verify:backup` 证据 `dockerAvailable:false`、`resticAvailable:false` | **保留为 VPS/真机现场检查项**；命令按实际 `docker-compose.yml` 更正（见 §4.2–4.4） |
| 4 | 第四步必须做 Restic 异地冷备份 | 不准确：[scripts/backup.sh](../../scripts/backup.sh) L139–162 仅在 **已安装 restic 且设置了 `RESTIC_REPOSITORY`** 时才推送，否则只做本地热备 + tar.gz；证据亦为 `resticAvailable:false` | **改为可选**：私域用「本地热备 + 手动 scp 到本机」即可满足异地要求 |
| 5 | 第五步灰度 24h（10%–20% 流量） | 单容器、无负载均衡，技术上无法灰度；私域用户只有你和朋友 | **删除**，替换为 5–10 分钟冒烟 + 24–48h 日志观察（见 §4.4–4.7） |
| 6 | P1：冲突弹窗技术黑话、只对比日程/记录数、缺照片张数 | 属实：[ConflictModal.tsx](../../src/components/views/ConflictModal.tsx) L45–76 仍显示 `Rev N` 与「今日日程/累计记录」两个数字，L78–103 为二选一覆盖 | **保留 P1、可延后**；改进点见 §5.2 |
| 7 | P1：做题登记完成页缺「一键拍错题」 | 属实：完成页只有「返回今日工作台」（[CompletionModal.tsx](../../src/components/views/CompletionModal.tsx) L182–221） | **保留 P1、可延后**；改进点见 §5.3 |
| 8 | 「不重复计入 **50MB** 用户配额」 | **错误**：服务端单用户媒体配额是 **500MB**（可被 `USER_MEDIA_QUOTA_BYTES` 覆盖，[media.ts](../../server/media.ts) L6）；50MB 是**离线备份 JSON 文件**上限（[backupValidator.ts](../../src/utils/backupValidator.ts) L4）；工作区同步载荷上限 12MiB（[workspace.ts](../../server/workspace.ts) L72）；单图上限 10MB | 更正为「500MB 用户配额 / 50MB 备份包 / 12MiB 工作区 / 10MB 单图」 |
| 9 | RPO=0（在线故障零丢失） | 需加限定：服务端 WAL 但 `synchronous=NORMAL`（[db.ts](../../server/db.ts) L33–34）→ 进程崩溃安全；**主机掉电理论上可能丢最后一笔已提交事务**。客户端 Outbox 会重传本地未确认修改 | 更正为「进程/服务崩溃 RPO≈0；掉电最坏丢最后一笔已落库事务；客户端侧由 Outbox 兜底」 |
| 10 | 「APK 断言 19/19」 | 实测 20 个断言全绿（7 Manifest + 11 DEX + 2 结构断言） | 数目口径更正，结论不变（全绿） |
| 11 | 「SW 30 分钟内自动感知新构建号」 | 属实：`UPDATE_CHECK_THROTTLE_MS = 30 * 60 * 1000`（[versionCheck.ts](../../src/utils/versionCheck.ts) L42），回前台也会触发 | 保留；提醒朋友「升级后重新打开/刷新一次」即可立即生效 |
| 12 | 「覆盖安装后设置页显示 v1.0.4 (code 5)，检查更新提示已是最新」 | **条件不成立**：在新包未签名发布（`apkReleased:false`）时，已装 v1.0.2（code 3）的旧壳检查更新会显示「发现网页资源新版本…新版 Android 安装包暂未开放下载」，或「云端存在新版本规划…暂不提示升级」（[versionCheck.ts](../../src/utils/versionCheck.ts) L968–998），**不会显示"已是最新"**。只有签名发布后才显示安装包升级 | 更正验收文案；真机验收项见 §4.9 |

### 2.2 命令 / 流程纠偏（旧 SOP 直接执行会踩的坑）

| # | 旧报告写法 | 实际配置 / 正确做法 |
|---|---|---|
| 1 | `docker exec -t kaogong-app ./scripts/backup.sh`；`docker stop kaogong-app && docker rm kaogong-app` | 容器名是 **`kaogong-potato-app`**，Compose 服务名是 **`kaogong-app`**（[docker-compose.yml](../../docker-compose.yml) L6、L11）。正确：`docker compose exec -T kaogong-app ./scripts/backup.sh`、`docker compose restart kaogong-app` |
| 2 | `docker build -t kaogong-potato:1.0.4 .` + `docker run ... -p 3000:3000 -v /opt/kaogong/data:/app/data -e SESSION_SECRET=...` | 实际部署是 Compose：镜像 `kaogong-potato:latest`，仅绑 `127.0.0.1:3000`，数据卷 `./data:/app/data`（项目目录相对路径，不是 `/opt/kaogong`），**代码里不存在 `SESSION_SECRET`**。正确：`docker compose build kaogong-app && docker compose up -d kaogong-app` |
| 3 | `sudo chown -R 1000:1000 /opt/kaogong/data` | 路径按实际项目根（文档中曾出现 `/home/ubuntu/kaogong-app/data`）。容器内 `USER node` = UID 1000（[Dockerfile](../../Dockerfile) L51–54）；**仅当 `ls -ln data` 显示属主不是 1000 时才需要 chown**；Ubuntu 上用 `ubuntu` 用户创建的目录通常天然是 1000:1000 |
| 4 | 第五步灰度 + 全量切换解析 + Restic 异地仓库 | 见 §2.1 第 4/5 条：私域删除灰度；Restic 可选 |
| 5 | 「回填 release.json 后提交并打 tag」即完成发布 | 缺了关键一步：**Docker 镜像在构建时把 `release.json` 打包进镜像**（[Dockerfile](../../Dockerfile) L45），改完元数据必须**重新 build 镜像并重建容器**，否则线上仍是旧身份；且签名包要放在 `release/apk/kaogong-potato-v1.0.4.apk`（canonical 文件名，[server/app.ts](../../server/app.ts) L342） |
| 6 | 证书指纹长串（粘贴文本里被截成 `…E7:11:2￺3:23:4B:6B…`） | 正确完整值见 §7.1；已用 v1.0.1/v1.0.2 实际 APK 证书核对一致 |
| 7 | `release.json` 里 `deployedAt` 保持 `2026-10-27T00:00:00Z`、`summary` 不变 | 建议部署时把 `deployedAt` 改为真实 UTC 时间、`summary` 写明本次发布内容（仅元数据，不影响功能） |
| 8 | 「确认 Nginx `client_max_body_size 50M`」在另一处写成 `55M` | 仓库内配置是 **50M**（[deploy/nginx/work.ruyne.space.conf](../../deploy/nginx/work.ruyne.space.conf) L123），保持 50M 即可；若线上 Nginx 已是 v1.0.1 时的配置，无需改动 |

### 2.3 两份旧报告共同遗漏的三件事（对私域很关键）

1. **注册是邀请制**：朋友必须先有一次性邀请码（`server/app.ts` L411–425），否则注册接口直接拒绝。生成命令见 §4.5。
2. **线上是原地升级**：`work.ruyne.space` 正在跑 v1.0.1，有真实数据；不是空库新装。**本地 `data/` 是测试数据，绝不能同步覆盖服务器 `data/`**（`.gitignore`/`.dockerignore` 也把 `data/` 排除，但手工 rsync 时要自己加 `--exclude data`）。
3. **密钥库备份**：`release/kaogong-release.keystore` 被 `.gitignore` 排除、当前仅存在于工作区/本地；**一旦丢失，未来所有 Android 覆盖升级都不可能**。请单独离线备份 keystore + 口令（不要提交进 git、不要同步到 VPS）。

---

## 3. 「资料会不会丢」——私域场景最终判定

> 判定口径：以「你 + 朋友、单台 VPS、每日/每周有备份」为边界。

| 真实场景 | 最新代码机制（已验证） | 私域结论 | 残余风险 / 你需要做的 |
|---|---|---|---|
| 自习室断网刷题、打卡 | 本地 IndexedDB 事务落盘 + Outbox 待传队列；联网/回前台自动补传（`syncClient`/`AppContext`；`verify:boundaries` V01–V05、business E2E 覆盖） | **不丢**。断网只影响上云，界面立即成功反馈 | 手机丢失且从未联网同步 → 该段离线数据丢失；正常使用会很快补传 |
| 错题试卷拍照 | 前端 Canvas 压缩（长边 1100px / 质量 0.72，缩略图 320px；[imageCompressor.ts](../../src/utils/imageCompressor.ts) L4–5）→ 上传；服务端 `(user_id, sha256)` 秒传去重、坏文件自愈（A05/A09；`verify:backup` 13/13 含真实字节比对） | **不丢、不重复占配额**（配额 500MB） | 单图 ≤10MB；单错题 ≤9 张（[workspace.ts](../../server/workspace.ts) L435） |
| 手机没电 / 后台被杀 | 计时基于绝对时间戳 `timerStart`；累计毫秒落盘 | **用时不清零** | 无 |
| **换新手机** | 登录 → 服务端工作区回灌（含照片媒体引用；business E2E 已验证第二设备真实读取字节）；旧机数据无需手动迁移 | **不需要导出 JSON 也能换机**；服务器是主副本 | 前提是账号密码可登录；忘记密码可由管理员 `reset-code` 重置（§4.5）。JSON 备份入口仍建议补（§5.1），作为「服务器也没了」时的保险 |
| 手机 + 电脑多端同时用 | 服务端 CAS（expectedRevision / contentHash）+ 冲突弹窗 + 覆盖前本地恢复快照 | **不会静默覆盖**，会弹冲突 | P1：冲突文案仍不够友好（§5.2）；冲突时按提示选一方，另一方在恢复点里可找回 |
| 公共电脑退出/切号 | `authEpoch` 代次守卫 + 显式退出标记（A02；`verify:auth` 14/14） | **不会串号** | 公共电脑用完点「退出登录」 |
| 服务器/磁盘故障 | SQLite WAL + 热备/恢复脚本 + 代际轮换（`restore-offline` 原子切换，`verify:backup` 13/13） | **有备份就能恢复**；恢复后旧客户端不会反向覆盖（generation 轮换） | **私域最大风险**：单台 VPS 单块盘。必须做 §4.2 上线前备份 + §4.6 持续备份 + 把 tar.gz 拷到本地/网盘 |
| 误删 / 重置 / 导入覆盖 | 危险操作前自动保存恢复点；「还原最近应急恢复点」入口在设置弹窗内（[SettingsView.tsx](../../src/components/views/SettingsView.tsx) L465–486） | **可还原** | 恢复点存在本机 IndexedDB；换机后本机恢复点不带过去（服务器历史有 30 版：`WORKSPACE_HISTORY_KEEP_ROWS=30`） |
| 线上升级 v1.0.4 本身 | Schema 仍为 3；服务端建表均为 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN` 容错迁移（[db.ts](../../server/db.ts) L126–150）；服务端保留旧客户端兼容路径（legacy data URL/旧字段，`tests/server.test.ts` L840–885、L954–962、L1097+ 有覆盖） | **风险可控，但必须按 §4 顺序操作** | 升级时若有朋友正在用旧页面：30 分钟内会自动更新；建议挑没人用的时间部署，并在升级后看日志 |

### 3.1 联合裁定

- **数据保存：没有代码级阻断项。** 你关心的 A01–A09 修复在最新代码里真实存在且被 173 项测试 + 5 组审计证据覆盖；报告里的「P0 入口缺失」不构成资料丢失（服务器登录回灌兜底），但建议补。
- **上线：对私域是「值班式放行」**——不需要灰度、不需要 Restic、可以先不发 APK；需要的是 **备份 → 部署 → 冒烟 → 观察 → 回滚预案** 五件事（§4）。
- **前提约束（也是本报告与旧报告的差别）**：本报告把「Docker/真机/Restic 未验收」如实标为**未验证**，不宣称已通过；这些会在你 VPS/手机上执行时完成验收。

---

## 4. 私域上线操作手册（无灰度版）

> 路径以 VPS 实际项目目录为准，下文用 `/home/ubuntu/kaogong-app` 示例（旧文档中出现过该路径），请按实际替换。
> 所有 `docker compose` 命令在**项目根目录**执行；容器名 `kaogong-potato-app`，服务名 `kaogong-app`。

### 4.0 上线前 1 分钟本地自检（已完成，可复核）

```bash
cd <本地项目根>

# 1) 类型检查（约 20–40s）
npm run typecheck          # 期望 exit 0

# 2) 全量测试（约 1–2 分钟；务必单独跑，不要和 build/APK 构建并行）
npm test                   # 期望：146 + 21 + 6 = 173 passed / 0 failed

# 3) 边界 / 身份 / 灾备审计（各约 3–30s）
npm run verify:boundaries  # 期望 12/12
npm run verify:auth        # 期望 14/14
npm run verify:backup      # 期望 13/13（Docker/Restic 会显示 NOT_VERIFIED，属正常）

# 4) APK 源码级验证（可选；本机无签名口令时用未签名校验模式）
npm run verify:apk         # 期望 exit 0，20 项内容断言通过
```

> 本次审查已全部跑过（结果见 §1.2）。`npm run build` 本地可跳过——Docker 镜像里会重新构建前端。

### 4.1 第 1 步：VPS 上线前热备（**绝对必做**）

```bash
ssh ubuntu@<你的VPS>
cd /home/ubuntu/kaogong-app          # 按实际路径

# 0) 先看清当前部署形态
docker compose ps                    # 确认服务名 kaogong-app / 容器 kaogong-potato-app
ls -ln data                          # 确认 data 属主（目标 UID 1000；不是的话见下方 chown）

# 1) 在容器内做 SQLite 在线热备（不要直接 cp WAL 数据库！）
docker compose exec -T kaogong-app ./scripts/backup.sh
# 产物：data/backups/backup_YYYYMMDD_HHMMSS/ 与同名 .tar.gz

# 2) 记录最新备份路径
LATEST=$(ls -td data/backups/backup_*.tar.gz | head -1)
echo "$LATEST" | tee /tmp/kaogong_last_backup.txt
shasum -a 256 "$LATEST" || sha256sum "$LATEST"

# 3) 保存当前运行镜像，供回滚
docker tag kaogong-potato:latest kaogong-potato:rollback-$(date +%Y%m%d%H%M)
docker images | grep kaogong

# 4) 把备份拉回本地/网盘（真·异地，*必做*）
#    在你自己电脑上执行：
#    scp ubuntu@<VPS>:<项目路径>/data/backups/backup_YYYYMMDD_HHMMSS.tar.gz ~/kaogong-backups/
```

> 若 `docker compose exec -T kaogong-app ls scripts/backup.sh` 提示不存在（旧镜像未挂载 scripts 卷），改用容器内 CLI 热备：
> `docker compose exec -T kaogong-app node --import tsx server/cli.ts hot-backup "/app/data/backups/backup_$(date +%Y%m%d_%H%M%S)"`
> 若 `ls -ln data` 显示属主不是 `1000 1000` 且容器日志出现 `EACCES/SQLITE_CANTOPEN`，再执行：`sudo chown -R 1000:1000 data`。
> `backup.sh` 的保留策略：24 小时内全留、30 天每日、8 周每周（[backup.sh](../../scripts/backup.sh) L52–136）。

### 4.2 第 2 步：同步代码到 VPS

本仓库**没有配置 git remote**（`git remote -v` 为空），因此按你现有方式二选一：

```bash
# 方式 A：VPS 上本来就有独立 git 仓库
cd /home/ubuntu/kaogong-app && git fetch --all && git checkout bd31cd4   # 若 VPS 仓库有远端；无远端则用方式 B

# 方式 B（推荐，从本地推）：rsync（严格排除本地测试数据、密钥、构建产物）
rsync -avz \
  --exclude='.git' --exclude='node_modules' --exclude='dist' \
  --exclude='data' --exclude='android/build' --exclude='*.keystore' \
  ./ user@<VPS>:/home/ubuntu/kaogong-app/
```

> ⚠️ **绝不**把本地 `data/` 同步到服务器（本地是测试库，覆盖=真数据丢失）；`*.keystore` 也不要上传 VPS。
> 部署后建议在 VPS 打 tag：`git tag -a v1.0.4 -m "Release v1.0.4 (Web 20261027.03 / Android Code 5)"`（若 VPS 有 git）。

### 4.3 第 3 步：构建 + 启动 + 健康检查

```bash
cd /home/ubuntu/kaogong-app

# 1) 重建镜像（会重新 npm ci + vite build，首次/无缓存需数分钟；网络需可达 npm registry）
docker compose build kaogong-app

# 2) 重建容器（保持数据卷挂载不变）
docker compose up -d kaogong-app
docker compose ps                     # 期望 healthy

# 3) 服务端身份 + 健康检查（容器内端口，不经 Nginx）
curl -s http://127.0.0.1:3000/api/health
# 期望：{"ok":true,"status":"healthy","generationId":"gen_...","time":"...","uptime":...}

curl -s http://127.0.0.1:3000/version.json
# 期望：version=1.0.4, build=20261027.03, schemaVersion=3, apkReleased=false（未签名时）

# 4) 容器运行日志
docker compose logs --tail=100 kaogong-app
```

预期事实（未签名发布时）：

- `/api/download/apk` 返回 **404 `APK_NOT_RELEASED`** —— 这是正确行为，不是故障。
- 已安装旧版 APK 的朋友打开 App：WebView 自动加载新网页；点「检查更新」会看到「云端存在新版本规划（v1.0.4）…暂不提示升级」，**不会**显示「已是最新」，也暂时拿不到新安装包。
- 浏览器端 Service Worker 30 分钟内自动感知新构建号 `20261027.03`；让朋友关掉页面重开一次可立即生效。

### 4.4 第 4 步：5–10 分钟线上冒烟（替代灰度）

用 **1 台电脑 + 1 部手机**，都访问 `https://work.ruyne.space`：

- [ ] 登录已有账号（朋友账号也可），**历史数据完整**：题本进度、做题记录、错题照片都在
- [ ] 新建一条计划 → 开始计时 → 杀进程/关页面 → 重开，计时未清零
- [ ] 手机拍照上传一道错题 → 图片正常显示；重复上传同一张 → 不额外占配额、不报错
- [ ] 断网打卡一条 → 界面立即成功 → 联网后自动补传（设置页同步状态变「已保存到服务器」）
- [ ] 设置页「关于应用」显示 `v1.0.4`、构建号 `20261027.03`
- [ ] 手动「检查更新」不报错；SW 更新后页面版本一致
- [ ] `/api/health` 200、`/version.json` 为 1.0.4/20261027.03
- [ ] `docker compose logs --tail=200 kaogong-app | grep -E ' (4[0-9]{2}|5[0-9]{2}) [0-9]+ms'` 无异常 4xx/5xx 激增（登录 401、APK 404 属正常）

### 4.5 第 5 步：给朋友开户（邀请码）+ 安装方式

注册是**邀请制、一次一码**。每邀请一个朋友生成一个：

```bash
cd /home/ubuntu/kaogong-app
docker compose exec -T kaogong-app node --import tsx server/cli.ts create-invite
# 输出一次性邀请码，发给他；注册后自动作废

# 管理辅助
docker compose exec -T kaogong-app node --import tsx server/cli.ts list-users
docker compose exec -T kaogong-app node --import tsx server/cli.ts reset-code <userId>   # 忘记密码时生成 30 分钟重置码
docker compose exec -T kaogong-app node --import tsx server/cli.ts reset-password <code> <新密码>
```

给朋友的说明（推荐 **PWA**，无需 APK）：

- **Android / Chrome**：打开 `https://work.ruyne.space` → 菜单「添加到主屏幕」→ 从桌面图标打开（体验接近原生 App）
- **iPhone / Safari**：打开后点「分享」→「添加到主屏幕」
- 已装旧版 APK 的朋友：**不用重装**，继续用即可（壳会加载新网页）；想要新安装包再等 §4.9 签名发布
- 提醒：**换手机只要登录，数据会自动回来**；但请务必记住用户名密码

### 4.6 第 6 步：备份纪律（私域最重要的一条）

```bash
# 每小时热备（cron；docker 用绝对路径）
crontab -e
# 0 * * * * cd /home/ubuntu/kaogong-app && /usr/bin/docker compose exec -T kaogong-app ./scripts/backup.sh >> /var/log/kaogong_backup.log 2>&1
```

- 每周把最新 `data/backups/*.tar.gz` 拉到本地/网盘（§4.1 第 4 步），保留至少最近 2 份。
- 可选的恢复演练（不动生产数据，2 分钟）：
  ```bash
  docker compose exec -T kaogong-app sh -c 'rm -rf /tmp/kaogong_restore_test && \
    DATA_DIR=/tmp/kaogong_restore_test ./scripts/restore.sh "$(ls -td /app/data/backups/backup_* | head -1)"; echo "RESTORE_EXIT=$?"'
  # 期望 RESTORE_EXIT=0；执行完毕后可删除 /tmp/kaogong_restore_test
  ```

### 4.7 第 7 步：观察 24–48 小时

- 看：`docker compose logs --tail=500 kaogong-app`，重点 `/api/workspace`（409 冲突是否被客户端正常处理）、`/api/media/upload`（去重/配额）、5xx。
- 看：`docker stats`（512MB 内存限制下是否稳定）、`df -h`（附件增长）。
- 触发回滚的条件：登录/同步出现 5xx 持续错误、照片无法读取、多人同时报告数据异常、容器反复重启。

### 4.8 第 8 步：简版回滚预案

| 场景 | 操作 |
|---|---|
| **Web 代码问题** | 回退代码到上一个稳定提交（`git checkout <上一提交>`）→ `docker compose build kaogong-app && docker compose up -d kaogong-app`。注意：Service Worker 只认「更新的 build 号」，若回滚后客户端仍显示新版，可让用户在浏览器「强制刷新/清除站点数据」一次；更稳的做法是回滚提交里把 `webBuild` 递增（如 `20261027.04`）再发 |
| **数据异常/误操作** | `docker compose stop kaogong-app` → 用镜像内脚本恢复（容器已停，用一次性容器挂同一数据卷）：<br>`docker compose run --rm --entrypoint sh kaogong-app -c 'DATA_DIR=/app/data ./scripts/restore.sh /app/data/backups/backup_YYYYMMDD_HHMMSS.tar.gz'`<br>→ `docker compose start kaogong-app`。恢复脚本会做完整性校验、留存安全备份并轮换 `generation_id`，旧客户端不会反向覆盖 |
| **APK 有问题** | 保持 `release.json` 的 `apkReleased:false` 即可停止分发（当前默认就是关的），网页端不受影响 |
| **旧镜像回滚** | 用 §4.1 保存的 `kaogong-potato:rollback-*` 镜像启动旧版（数据库为增量迁移、schema 未变，旧代码通常可直接读；如仍异常，以恢复备份为准） |

### 4.9 可选：正式签名 APK（只有在你要给朋友发安装包 / 让旧 APK 内升级时才做）

前置：`release/kaogong-release.keystore` + 口令（请确认你手上有；若丢失则无法覆盖升级，只能卸载重装后重新登录，服务器数据仍会回来）。

```bash
cd <本地项目根>

# 1) 正式签名构建（会强校验证书指纹 = 官方指纹）
KEYSTORE_PASS='<你的密钥库口令>' ./scripts/build-apk.sh
# 产物：release/apk/kaogong-potato-v1.0.4.apk + .sha256

# 2) 取真实字节数与 SHA-256
stat -f%z release/apk/kaogong-potato-v1.0.4.apk          # macOS
shasum -a 256 release/apk/kaogong-potato-v1.0.4.apk | awk '{print $1}'

# 3) 回填 release.json 与 public/version.json：
#    apkSha256 = <上一步真实值>
#    apkSizeBytes = <真实字节数>
#    apkReleased = true
#    deployedAt = <真实 UTC 时间>
#    summary = <本次发布说明>

# 4) 校验签名指纹（应为 §7.1 的值）
~/.android-sdk/build-tools/34.0.0/apksigner verify --print-certs \
  release/apk/kaogong-potato-v1.0.4.apk | grep -i "SHA-256"

# 5) 把改好的 release.json / public/version.json 与签名 APK 一起同步到 VPS（release.json 会被打进镜像）：
#    rsync ... ./release/apk/kaogong-potato-v1.0.4.apk user@VPS:/home/ubuntu/kaogong-app/release/apk/
#    （代码同步见 §4.2；务必确认服务器上的 release.json 已是 apkReleased:true）
docker compose build kaogong-app && docker compose up -d kaogong-app

# 6) 上线后验证下载链路（服务端会校验磁盘文件哈希）
curl -sI https://work.ruyne.space/api/download/apk | grep -Ei "HTTP/|content-length|content-disposition"
# 期望：HTTP 200、content-length=<apkSizeBytes>、filename="kaogong-potato-v1.0.4.apk"（经 Cloudflare 可能为小写头）

# 7) 覆盖升级兼容性（已由本报告用旧 APK 证书验证）
#    v1.0.1/v1.0.2 与本仓库 keystore 证书 SHA-256 完全一致 → 可覆盖安装、登录态与本地数据保留
```

> 若 `apkReleased:true` 但磁盘 APK 哈希与 `release.json` 不一致，下载路由会返回 500 `INTEGRITY_VIOLATION` 并打印安全告警（[server/app.ts](../../server/app.ts) L355–368）——这是防篡改设计，不是 bug。

---

## 5. 建议修复项（仅为建议，**未改任何代码**）

### 5.1 P1（建议，不阻断）：恢复「数据备份与恢复」用户入口

> 现状：能力完整（导出 JSON 含图片 Data URL、导入单事务落盘 + 先建恢复点），但生产入口不可达；且现有回归测试**主动断言**它被移除，所以「补入口」= 产品决策 + 测试同步。

最小改动（约 12 行，位置已核对）：

1. [App.tsx](../../src/App.tsx) L813 `<SettingsView ...>` 处增加：
   ```tsx
   onOpenBackup={() => setBackupModalOpen(true)}
   ```
2. [SettingsView.tsx](../../src/components/views/SettingsView.tsx) L31–43 props 增加 `onOpenBackup: () => void;`；在 L343–360「必要的账号与数据设置」列表项附近加一条同风格入口（或放进 L438 的账号与数据安全弹窗）：
   ```tsx
   <div onClick={onOpenBackup} className="flex items-center justify-between px-4 py-3.5 hover:bg-cream/40 cursor-pointer ...">
     <div className="flex items-center gap-3">
       <div className="w-8 h-8 rounded-xl bg-sage-light/60 flex items-center justify-center text-sage"><Download size={16} /></div>
       <div>
         <div className="text-xs font-bold text-ink-main">数据备份与恢复</div>
         <div className="text-[11px] text-ink-muted mt-0.5">导出含错题照片的 JSON 备份，换机/重装可一键恢复</div>
       </div>
     </div>
     <ChevronRight size={15} className="text-ink-muted/60" />
   </div>
   ```
3. **必须同步改测试** [tests/ui_interaction.test.ts](../../tests/ui_interaction.test.ts) L334–360：现有断言 `expect(html).not.toContain('本地 JSON 备份')` 会失败。把「消除废弃备份卡片」的断言改为「备份入口存在且文案准确」（例如断言包含「数据备份与恢复」），并给测试中的 `SettingsView` 传入 `onOpenBackup: () => {}`。
4. 改完跑 `npm test` + `npm run typecheck` 确认全绿。

> 不补也安全：换机登录即回灌（§3）。补它是为了「服务器也挂了/想留一份离线存档」的场景。

### 5.2 P1（可延后）：冲突弹窗可读性

[ConflictModal.tsx](../../src/components/views/ConflictModal.tsx)：

- 去掉/弱化 `Rev N`（考生看不懂），文案改为「检测到两台设备都有新记录」；
- 对比卡补充「错题照片：本机 N 张 / 云端 M 张」（`wrong[].images`/`image` 计数，数据在 `state` 里现成）；
- 覆盖按钮加一句「覆盖失败可用恢复点找回」。
- 若改，需同步 `tests/*` 中冲突弹窗相关断言（搜 `Rev `）。

### 5.3 P1（可延后）：完成登记成功页加「一键拍错题」

[CompletionModal.tsx](../../src/components/views/CompletionModal.tsx) L182–221 成功页：若 `plan.type === 'book' && errors > 0`，增加按钮「立即为这 N 道错题拍照归档」→ 关闭弹窗并跳到错题页/打开上传（需要透传 `onOpenWrongCapture` 类回调，改动比 §5.1 大）。

### 5.4 P2：文档 / 元数据小修（不影响功能）

| 项 | 位置 | 建议 |
|---|---|---|
| Android README 版本过期 | [android/README.md](../../android/README.md) L5 仍写 `versionCode 4 / 1.0.3` | 改为 `versionCode 5 / 1.0.4` |
| backup.sh Restic 标签硬编码旧版 | [scripts/backup.sh](../../scripts/backup.sh) L154 `--tag "v1.0.1"` | 改为动态版本（`v${release.json webVersion}`）或 `v1.0.4` |
| 发布元数据占位 | [release.json](../../release.json) L13 `deployedAt` 为 00:00:00Z | 部署时写真实时间；`summary` 更新 |
| 旧 SOP 命令纠偏 | [RELEASE_SOP.md](./RELEASE_SOP.md) §三/§五/§六 | 用本报告 §4 替换对应段落（尤其容器名、路径、Restic 可选、删除灰度） |
| 未跟踪文件 | `docs/implementation/RELEASE_SOP.md` | 若希望留档，`git add` 纳入版本库 |
| 密钥库 | `release/kaogong-release.keystore`（git 忽略） | **离线备份 keystore + 口令**；不进 git、不上 VPS |

---

## 6. 风险接受声明（私域小规模）

在「你 + 朋友、单 VPS、无灰度」的前提下，以下风险**明确接受**，并以对应措施兜底：

| 接受的风险 | 兜底措施 |
|---|---|
| 没有灰度、没有第二节点/负载均衡，升级瞬间全员同版本 | 挑无人使用时段部署；部署前热备；保留旧镜像 + 备份；冒烟不通过立即回滚 |
| 没有异地灾备（Restic 未启用） | 上线前 + 每周把 `backup_*.tar.gz` scp 到本地/网盘（这就是异地副本） |
| 单块磁盘、单台 VPS | 同上；可用 VPS 快照做第二层（可选） |
| APK 暂不签名，`/api/download/apk` 返回 404 | Web/PWA 全功能；旧壳继续用；需要时按 §4.9 补签 |
| 设置页无 JSON 备份入口 | 换机靠登录回灌；服务器备份兜底；建议按 §5.1 后续补 |
| 冲突弹窗/完成页仍有 P1 文案问题 | 不影响数据正确性；冲突时有恢复点；延后优化 |
| 掉电最坏丢最后一笔已提交事务（WAL NORMAL） | 频率极低；客户端 Outbox 会重传未确认修改；定期备份 |
| 旧浏览器页面与新服务端混跑（升级后 30 分钟内） | 服务端保留旧客户端兼容路径（测试覆盖）；升级后观察日志，异常则回滚 |

---

## 7. 附录

### 7.1 正确发布身份与证书指纹

- Web：`1.0.4` / build `20261027.03` / Schema `3`
- Android：`1.0.4` / `versionCode 5` / 包名 `com.ruyne.kaogong` / minSdk 24 / targetSdk 34
- APK 官方证书 SHA-256（**完整正确值**，已用 v1.0.1、v1.0.2 实际 APK 与 `release.json` 双向核对）：
  `85:75:82:EF:D9:20:83:CC:75:E5:C5:A0:C2:0D:B3:26:25:2C:BF:80:E7:11:23:23:4B:6B:F5:9D:CD:17:36:C1`
- APK 下载 canonical 文件名：`release/apk/kaogong-potato-v1.0.4.apk`

### 7.2 容量 / 限额速查（代码实测值）

| 限制项 | 值 | 出处 |
|---|---|---|
| 单用户媒体配额 | **500MB**（可 `USER_MEDIA_QUOTA_BYTES` 覆盖） | [server/media.ts](../../server/media.ts) L6 |
| 离线备份 JSON 上限 | 50MB（导入/导出同限） | [backupValidator.ts](../../src/utils/backupValidator.ts) L4 |
| 工作区同步载荷 | 12MiB | [server/workspace.ts](../../server/workspace.ts) L72 |
| 单张图片上传 | 10MB | [server/app.ts](../../server/app.ts) L655 |
| 单道错题图片数 | ≤ 9 张 | [server/workspace.ts](../../server/workspace.ts) L435 |
| 服务端历史版本 | 保留 30 版（另有 8MiB / 7 天窗口策略） | [server/retention.ts](../../server/retention.ts) L22–26 |
| 更新检查节流 | 30 分钟（回前台/手动可绕过） | [src/utils/versionCheck.ts](../../src/utils/versionCheck.ts) L42 |
| Nginx 请求体上限 | 50M | [deploy/nginx/work.ruyne.space.conf](../../deploy/nginx/work.ruyne.space.conf) L123 |
| 会话有效期 | 30 天 | [server/app.ts](../../server/app.ts) L542 |

### 7.3 本次审查「未验证 / 无法在本机验证」清单（如实声明）

- Docker 镜像构建、容器重建、持久卷 UID/权限（本机无 Docker）；
- Android 真机覆盖安装与拍照/计时 UI（本机无 adb/设备；仅完成 APK 编译 + 20 项内容断言 + 旧包证书连续性验证）；
- Restic 异地仓库快照与异地恢复（本机无 restic/凭据）；
- VPS 上的实际 Compose 服务名、数据目录路径、Nginx 生效配置（只读探测了公网端点，未登录主机）；
- `verify:business`（38/38）与 `verify:isolated`（163/163）未在本次重跑，引用 `bd31cd4` 当日 04:25–04:28Z 的新鲜证据 JSON。

### 7.4 本次审查对工作区的改动

- **未修改任何业务代码 / 配置 / 发布元数据**；
- 新增本文件 `docs/implementation/FINAL-FIX-REPORT.md`；
- 重跑 `verify:boundaries` / `verify:auth` / `verify:backup` 时，脚本自动刷新了 `docs/implementation/evidence/` 下的结果 JSON/日志（这些文件在审查开始前已是未提交修改状态）；
- `dist/`（构建产物）与 `android/build/`（未签名验证包）均被 `.gitignore` 忽略。

### 7.5 上线前检查清单（可直接勾选）

- [ ] 本地：`npm run typecheck` / `npm test` 全绿（单独串行跑）
- [ ] VPS：执行 `backup.sh` 成功，`.tar.gz` 已拉到本地
- [ ] VPS：旧镜像已 tag 保存（`kaogong-potato:rollback-*`）
- [ ] 代码已同步（不含本地 `data/`、不含 `*.keystore`）
- [ ] `docker compose build kaogong-app && docker compose up -d kaogong-app` 成功，`healthy`
- [ ] `/version.json` = `1.0.4 / 20261027.03`，`/api/health` = healthy
- [ ] 电脑 + 手机冒烟（§4.4）全部通过，日志无异常 5xx
- [ ] 已为朋友生成一次性邀请码；已告知 PWA 安装方式
- [ ] 已配置每小时热备 cron；已计划每周异地拷贝
- [ ] （可选）APK 已按 §4.9 签名、回填、重建镜像并验证 `/api/download/apk`
- [ ] 已记录回滚入口（旧镜像 tag / 最近备份路径 / 上一提交号）
