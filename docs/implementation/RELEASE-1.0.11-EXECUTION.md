# 考公工作台 · Web 1.0.11 正式发布与生产更新验收记录

- **发布时间**: 2026-10-29 00:43 (Asia/Tokyo) / 2026-10-28T15:43Z (UTC)
- **发布内容**: 今日日程已完成卡片瘦身 +「只看未完成」开关；学习登记记录改为按日期查看（当天日程、补登记与当天登记合并，不再平铺全部记录）；学习提醒邮箱管理收进二级弹窗，提醒列表紧凑化（时间/标题/状态两行 + 展开详情），历史记录按日期分组并支持状态筛选与分页
- **基线 Commit**: `dde0f4f`（1.0.10 部署记录）→ 功能提交 `4ad8c56` → 发布提交 `a21ed47`
- **生产目标**: `https://work.ruyne.space`
- **生产主机**: `18.224.72.68`（`/home/ubuntu/kaogong-app`，x86_64 宿主构建）
- **APK**: 保持 `1.0.5` / versionCode `6` 不变（WebView 套壳，随 Web 更新）

## 1. 发布身份核验（预期 = 生产实测）

| 属性 | 预期 | 生产实测 | 状态 |
| :--- | :--- | :--- | :---: |
| Web Version | `1.0.11` | `1.0.11` | ✅ |
| Web Build | `20261029.01` | `20261029.01` | ✅ |
| 工作区 Schema | `5` | `5` | ✅ |
| 生产镜像 | `kaogong-potato-app:1.0.11-20261029.01` | 同名镜像运行中 | ✅ |
| Android APK | `1.0.5` / code `6` | `/api/download/apk` 200、字节数 305550、SHA-256 `394fc45d…d6d738` 不变 | ✅ 不变 |
| 健康状态 | healthy | `{"ok":true,"status":"healthy"}` | ✅ |
| 同步代际 | 保持不变 | `gen_1792995329794_e00c30554b4ace1c` | ✅ |
| 首页资源 | `assets/index-D6GcDH_z.js` | 公网 200、与本地构建一致 | ✅ |

公网 `/version.json?nonce=*` 回显 nonce 且为 `1.0.11 / 20261029.01`；`/sw.js` 身份 `1.0.11 / 20261029.01`，新缓存代次 `kaogong-shell-v5-1.0.11-20261029.01`。

## 2. 生产数据保护与事故恢复记录（重要）

### 2.1 事故经过与恢复

- 执行预发布热备时，沿用了旧 SOP 中的**两参数写法** `hot-backup /app/data /app/data/backups`。当前 CLI 的 `hot-backup [targetDir]` **只接受一个参数**：`args[0]` 被当作备份目标目录，因此目标数据库路径解析为 `/app/data/potato.db`，CLI 先 `unlinkSync` 删除了生产数据库路径，再开始写入备份副本；命令被中断后，该路径留下一个不完整的重写文件。
- 处理过程（未重启旧容器，避免丢失在途数据）：
  1. 旧容器进程仍持有原库与 WAL 的已删除 inode（`/proc/<pid>/fd/18|19|26`，库 1,253,376 B + WAL 2,624,472 B）。
  2. 对旧进程短暂 `SIGSTOP`（约 0.3 秒），从 `/proc/<pid>/fd/` 一致复制 `potato.db`、`potato.db-wal`、`potato.db-shm`，随后 `SIGCONT`；应用健康检查全程正常。
  3. 在隔离一次性容器中对恢复副本执行 `wal_checkpoint(TRUNCATE)`：`integrity_check = ok`，`page_count = 380`，计数与事故前一致（users 10 / workspaces 6 / media 5 / history 149 / bindings 2 / reminders 1 / sharing 2），代际 ID 不变。
  4. 优雅停止旧容器（`docker stop -t 30`），把被重写的损坏文件移入 `/home/ubuntu/kaogong-incident-20261029/` 保留证据；将验证过的恢复库安装回 `data/potato.db`（权限 644、属主 1000:1000），不再带有旧 WAL。
- **数据丢失评估**：旧容器日志显示恢复窗口（15:41:50–15:42:55Z）内没有任何 `POST/PUT/PATCH/DELETE` 写请求；冻结快照中的业务计数与事故前基线完全一致，故本次事故未造成用户数据丢失。
- 恢复副本与事故文件均保留在宿主机：`/home/ubuntu/kaogong-recover-20261029/`（原始 fd 副本）、`/home/ubuntu/kaogong-recover-work/`（checkpoint 后可用库）、`/home/ubuntu/kaogong-incident-20261029/`（被重写文件）。

### 2.2 切换前正式热备份

- 目录：`/home/ubuntu/kaogong-app/data/backups/backup_20261028_1542`
- manifest：`generationId = gen_1792995329794_e00c30554b4ace1c`、`attachmentsCount = 5`、库 1,556,480 B
- 归档：`backup_20261028_1542.tar.gz`，652,585 字节，SHA-256 `9d4a1f182f3217d0ca65cf882493a0cbd0ea747bb77d3be6264d6d6647ec7391`
- 已下载异机副本到本机 `data/prod_offsite_backups/backup_20261028_1542.tar.gz`，SHA-256 与宿主机一致。

### 2.3 切换与数据核对

- 旧容器优雅停止并重命名为 `kaogong-potato-app-prev-1.0.10` 保留，未删除。
- 新容器同名、同端口（`127.0.0.1:3000`）、同挂载（`data` / `release` / `scripts`）、同 env-file 与日志策略启动，只替换镜像。
- 切换前计数：users 10 / workspaces 6 / media 5 / sessions 8 / invites 24 / history 149 / bindings 2 / reminders 1 / sharing 2；`integrity_check = ok`；generation 不变。
- 切换后计数：与切换前**完全一致**，`integrity_check = ok`；`sessions` 保留，用户无需重新登录。
- 新容器启动日志无 SQLite/异常错误。

## 3. 构建与切换

- 源码同步后关键文件 SHA-256 与本地逐一核对一致（`release.json`、`package.json`、`public/version.json`、`public/sw.js`、`src/components/views/TodayView.tsx`、`StudyRecordsModal.tsx`、`EmailRemindersModal.tsx`）。
- 宿主机镜像：`kaogong-potato-app:1.0.11-20261029.01`、`kaogong-potato:1.0.11`（构建日志 `/tmp/kaogong-build-1.0.11.log`，标签导出成功）。
- 本地发布门禁：`npm run typecheck`、`npm test`（279 单元 + 68 服务端 + 24 灾备 = 371 通过）、`verify:boundaries` 12/12、`verify:auth`、`verify:backup`、`npm run build` 全部通过。
- 生产切换时间：`2026-10-28T15:43:27Z`；`release.json` 的 `deployedAt` 为发布名义时间 `2026-10-28T15:21:14Z`，与实际切换时间存在口径差（沿用 1.0.10 记录惯例）。

## 4. 线上验证

### 4.1 公网接口
- `/api/health` healthy，`generationId` 与切换前一致。
- `/version.json?nonce=*` → `1.0.11 / 20261029.01 / Schema 5 / APK 1.0.5`，nonce 回显。
- `/sw.js` → `1.0.11 / 20261029.01`；首页 `assets/index-D6GcDH_z.js` 公网 200；`/api/download/apk` 200 且 SHA-256/字节数不变。

### 4.2 线上真实浏览器（Playwright，393×873，未写入任何用户数据）
- 登录页正常渲染（标题 `考公工作台 · 土豆陪伴版`），页面内 `/version.json` 返回 `20261029.01`，脚本资源全部 200，无页面运行时错误。
- 截图：`output/prod-1.0.11/prod-live-login-393.png`。

## 5. 用户端如何收到更新

已登录 Web/APK 客户端启动、切回前台或网络重连时会检查 `/api/version`，发现 `20261029.01 > 20261028.05` 后出现「发现新版本 1.0.11」横条，点击激活刷新；使用中的编辑/计时会被 `updateGuard` 保护。直接刷新或重开则立即加载新缓存代次。APK 无需升级。

## 6. 回滚方案

```bash
ssh ubuntu@18.224.72.68
docker rm -f kaogong-potato-app
docker rename kaogong-potato-app-prev-1.0.10 kaogong-potato-app
docker start kaogong-potato-app
```

数据恢复（仅在数据库损坏且确认需要时）：使用 `/home/ubuntu/kaogong-app/data/backups/backup_20261028_1542` 或本机异机副本，按 `restore-offline` 流程执行；只回滚代码时保留现有数据卷与新增表，不做数据删除。

## 7. 经验教训与已修正项

1. **热备命令参数错误**：`hot-backup` 只接受一个参数（备份目标目录），传两个参数会把数据目录当成目标并删除主库路径。已在 `RELEASE_SOP.md` 修正示例并加显著警告；后续预发布备份统一使用容器内 `scripts/backup.sh` 或单参数 `hot-backup /app/data/backups/backup_<UTC时间>`。
2. **备份前先确认 CLI 签名**，不要复用旧文档中的历史示例；破坏性命令执行前先在隔离目录演练。
3. 本次恢复依赖“旧容器仍持有所删除 inode”这一点；今后若发生同类问题，严禁先重启/重建容器，应先冻结进程并从 `/proc/<pid>/fd` 取证。
