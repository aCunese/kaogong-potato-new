# 考公工作台 · Web 1.0.12 发布与同步竞态修复记录

- **发布内容**: 修复「前台自动拉取与本地保存同时发生时误报数据版本冲突、并阻塞后续保存」的同步竞态；同时自动修复该类历史误冲突（无需手动裁决即可恢复同步）。
- **版本标识**: Web `1.0.12` / build `20261029.02` / Schema `5`（无数据库结构变化，无需迁移）
- **APK**: 保持 `1.0.5` / versionCode `6` 不变（WebView 套壳，随 Web 更新）
- **基线 Commit**: `bf9da9c` → 本次修复提交
- **生产目标**: `https://work.ruyne.space`（`18.224.72.68`，`/home/ubuntu/kaogong-app`）

## 1. 问题定位（2026-10-29）

### 1.1 现象
用户在每次「完成学习/暂停计时并保存」后都会看到「检测到数据版本冲突」弹窗；弹窗内本机 `Rev 152`、云端 `Rev 117`，两侧条目数一致；点击「保留本机记录（覆盖云端）」后短期内恢复正常，但随后再次出现。当日生产 `workspace_history` 记录了 3 次 `force_local_override`（rev 111 / 114 / 118）与 1 次（10-28 rev 87），与上述现象吻合。

### 1.2 证据链
- 生产日志（单会话、单客户端）：每次冲突前都有一次 `GET /api/workspace`（前台自动拉取），随后数秒内出现「保留本机」的强制覆盖 `POST`；冲突期间 `POST` 全部为 200，从未出现 409。说明冲突并非服务端拒绝，而是客户端拉取路径误判。
- 逐状态对比（`workspace_history`）：
  - 07:39:43.339 启动计时 → 07:39:44.278 拉取 → 冲突（该次拉取在启动计时的保存提交前发出）；
  - 07:52:55.536 拉取 → 07:52:55.758 暂停计时保存 → 冲突；
  - 08:54:51.611 暂停计时保存 → 08:54:52.004 拉取（前台触发）→ 冲突。
- 根因：`pullPath` 在 `await fetchServerSnapshot()` 返回后重新检查未同步队列；若用户在「前台自动拉取」的网络往返期间完成一次保存，刚产生的 outbox 任务会被误判为「本地未解决修改」，从而写入持久化冲突记录。之后每次同步都会在入口直接返回冲突，直到用户手动裁决。另一个同类路径：`ensureSnapshotHasOutbox()` 刚为脏快照补建的恢复任务，也会在同一函数后续检查中被当成冲突（同一根因的另一种表现）。

### 1.3 修复
- `src/utils/syncClient.ts`：
  - `pullPath` 在拉取前记录队列状态；拉取返回后若仅出现「本次拉取期间新增的普通本地修改」，返回可重试的 `waiting` 结果（`LOCAL_EDITS_DURING_PULL`），由下一轮 `pushPath` 用正常 CAS 修订号守卫补传，**不再持久化冲突**；真正由另一写者推进云端时，补传会被服务端 409 拒绝并生成真实冲突（保护不变）。
  - 脏快照在本次拉取中补建的恢复任务同样走补传路径，不再自造冲突。
  - 拉取期间本地快照发生变化的「云端与本机一致」分支也改为重试，避免把过期内容记为已确认。
  - `syncWithLockScope` / `initialHydrateInternal`：对**旧版本遗留的 `LOCAL_UNRESOLVED` 误冲突**增加自动修复——当队列只有普通待传修改、不存在隔离任务时，清除冲突记录并重试正常 CAS 补传；若云端确实已变化，服务端 409 会重新生成真实冲突弹窗。历史误冲突因此在升级后无需人工处理即可解除。
- 回归测试：`tests/sync-core-regressions.test.ts` 新增 2 项——
  1. 拉取网络往返期间提交保存 → 不产生冲突记录，下一轮自动补传成功；
  2. 预置旧版遗留 `LOCAL_UNRESOLVED` 冲突 + 待传修改 → 自动清除冲突并成功上传。
- 既有保护语义回归：S01/S03（云端推进/脏快照不得被静默覆盖）保持通过。

## 2. 发布门禁（2026-10-29，本机）

| 检查 | 结果 |
| :--- | :--- |
| `npm run typecheck` | exit 0（前后端 0 错误） |
| `bun test tests/sync-core-regressions.test.ts` | **20/20 通过**（含本次新增 2 项竞态回归；S01/S03 保护语义保持通过） |
| `npm test` | **exit 0**：unit 281 + server 68 + dr 24 = **373 通过**（release-readiness 身份断言通过） |
| `npm run build` | exit 0；产物身份 `1.0.12 / 20261029.02`，首页资源 `assets/index-191-dKbk.js`，precache-manifest 身份一致 |
| APK 身份 | 保持 `1.0.5 / code 6`，SHA-256 `394fc45d…d6d738`（未重新打包） |

## 3. 部署与验证（生产）

### 3.1 备份（先备份后切换）
- 部署前在线热备：`data/backups/backup_20261029_092344`（库 1988.0 KB + 5 个附件，`integrity_check` ok，代际 `gen_1792995329794_e00c30554b4ace1c`）；归档 SHA-256 `bd1f35e9adb56498973e89f677ba9f7c95fe27fb82fa4a52de0ee560d2b0ec1d`。
- 停服点最终备份：`data/backups/backup_stop_20261029_0929`；归档 SHA-256 `b088770faf6c608ef76555590462e5904e46363d29b4677374e8e256560f4a6b`。
- 两份归档均已取回异机副本至本机 `data/prod_offsite_backups/`，SHA-256 与服务器一致。

### 3.2 构建与切换
- 生产镜像：`kaogong-potato:1.0.12` / `kaogong-potato-app:1.0.12-20261029.02`（image id `sha256:4c9e244462cc3e7e79a80c405cb772eaa5c15fadeaab18c1cd06938ffb82d6f6`）。
- 切换时间：`2026-10-29T09:27:44Z`（旧容器 `docker stop -t 30` 后重命名为 `kaogong-potato-app-prev-1.0.11` 保留；新容器同名、同端口 `127.0.0.1:3000`、同数据卷/env-file 启动）。
- 数据库未迁移，Schema 保持 5；旧容器 Exited (0) 可随时回滚。

### 3.3 上线后验证
- `/api/health` → `healthy`，`generationId` 仍为 `gen_1792995329794_e00c30554b4ace1c`（未轮换，客户端无需重新登录）。
- `/version.json` → `1.0.12 / 20261029.02 / Schema 5 / APK 1.0.5`；`/sw.js` 身份一致；首页资源 `assets/index-191-dKbk.js` 公网 200 且新 bundle 含修复文案。
- 数据库 `PRAGMA integrity_check = ok`；计数：users 10 / workspaces 6 / media 5 / sessions 8 / invites 24 / email_reminders 2 / sharing_grants 2（与切换前基线一致，无数据丢失）。
- APK 下载路由 200 / 305550 字节，SHA-256 不变。
- 旧容器保留：`kaogong-potato-app-prev-1.0.11`（Exited 0）。

## 4. 客户端生效说明
- 已登录 Web/APK 客户端在启动、回前台或网络重连时检查 `/api/version`，发现 `20261029.02 > 20261029.01` 后出现「发现新版本 1.0.12」横条；点击「立即更新」刷新即加载新缓存代次，本地 IndexedDB 数据与登录态保留。
- 升级后：本次竞态不会再生成冲突；旧版本遗留的此类误冲突在下次同步时自动清除（若云端确实被其他写入方推进，仍会返回正常冲突弹窗，保护语义不变）。

## 4. 回滚
保留上一版镜像与容器（`kaogong-potato-app:1.0.11-20261029.01` / 停止后重命名为 `kaogong-potato-app-prev-1.0.11`），异常时改回旧镜像即可，数据卷原地保留。
