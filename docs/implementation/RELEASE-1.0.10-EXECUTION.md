# 考公工作台 · Web 1.0.10 正式发布与生产更新验收记录

- **发布时间**: 2026-10-28 21:36 (Asia/Tokyo) / 2026-10-28T12:36:03Z (UTC)
- **发布内容**: 学习提醒（绑定邮箱、按日期时间设置一次性提醒、到点由服务器发邮件；待发送/历史记录、失败重试、停机 24 小时内补发、结果未知不自动重发）；学习登记修正；学习伙伴只读共享；「我的」页重新分区，保留倒数日与番茄钟
- **基线 Commit**: `f176ec6`（1.0.9 发布提交）→ 合并 `codex/study-reminders-sharing`（`ea60edc`）→ 发布提交 `6a34079`
- **生产目标**: `https://work.ruyne.space`
- **生产主机**: `18.224.72.68`（`/home/ubuntu/kaogong-app`，x86_64 宿主机构建）
- **APK**: 保持 `1.0.5` / versionCode `6` 不变（WebView 套壳，随 Web 更新）

## 1. 发布身份核验（预期 = 生产实测）

| 属性 | 预期 | 生产实测 | 状态 |
| :--- | :--- | :--- | :---: |
| Web Version | `1.0.10` | `1.0.10` | ✅ |
| Web Build | `20261028.05` | `20261028.05` | ✅ |
| 工作区 Schema | `5` | `5` | ✅ |
| Android APK | `1.0.5` / code `6` | `1.0.5` / code `6` | ✅ 不变 |
| APK SHA-256 | `394fc45d…d6d738` | `/api/download/apk` 200，文件名 `kaogong-potato-v1.0.5.apk` | ✅ |
| 健康状态 | healthy | `{"ok":true,"status":"healthy"}` | ✅ |
| 同步代际 | 保持不变 | `gen_1792995329794_e00c30554b4ace1c` | ✅ |

公网 `/version.json?nonce=*` 回显 nonce、`no-store`；`/sw.js` 身份 `1.0.10 / 20261028.05`；首页资源 `assets/index-B2I3IuvJ.js`（HTTP 200，bundle 内含「学习提醒」）。

## 2. 生产数据保护

- 上线前热备份（容器内 `scripts/backup.sh` 在线热备）：
  - 目录 `/home/ubuntu/kaogong-app/data/backups/backup_20261028_122442`
  - 归档 `backup_20261028_122442.tar.gz`（546,222 字节）
  - SHA-256 `ebe10f5360f137144f51900831425fdb0037afdc6163d65b778edb9d19d2c7ae`，与宿主机逐一核对一致；已下载到本机 `data/prod_offsite_backups/`（`integrity_check = ok`）
- 切换前表计数：`users 10` / `workspaces 6` / `media_records 4` / `sessions 8` / `invites 24` / `workspace_history 129`；无数据卷替换、无 AppState 格式变更
- 增量迁移：新增 `account_email_bindings / email_challenges / email_rate_limits / email_reminders / sharing_codes / sharing_grants` 六张表与 `server_meta.account_features_schema=1`，既有表与 `release.json` schemaVersion 5 不变；旧代码回滚时保留新增表、不删数据
- 切换后表计数：`users 10` / `workspaces 6` / `sessions 8` / `invites 24`（`workspace_history` 因真实用户在线活动 129→131，属正常业务写入）；`integrity_check = ok`
- 生产容器内邮件相关表在冒烟测试清理后为 0 行

## 3. 邮件发信配置

- 生产配置 `/home/ubuntu/kaogong-app/.env.smtp.local`（`chmod 600`，`*.local` 被 Git 忽略；**未提交、未写入本记录、未进入镜像**）
- 项目 `.dockerignore` 已增加 `.env*` 排除，避免密钥进入构建上下文与镜像层
- 容器以 `--env-file .env.smtp.local` 注入：`SMTP_HOST/PORT/USER/PASS/FROM` + `EMAIL_CODE_SECRET`；缺失时邮件功能停用且不影响其余学习功能
- 使用 QQ SMTP（`smtp.qq.com:465`，TLS）

## 4. 构建与切换

- 宿主机镜像：`kaogong-potato-app:1.0.10-20261028.05`、`kaogong-potato:1.0.10`（构建日志 `/tmp/kaogong-build-1.0.10.log`，退出码 0）
- 源码推送后关键文件 SHA-256 与本地逐一核对一致（`release.json`、`package.json`、`public/sw.js`、`public/version.json`、`server/reminders.ts`、`server/mailTransport.ts`、`server/emailRoutes.ts`、`package-lock.json`、`.dockerignore`）
- 隔离验收：`127.0.0.1:3001` + 临时数据目录启动新镜像 → healthy、`/version.json` 1.0.10/20261028.05、`/api/account/email` 与 `/api/reminders` 返回 401（路由已挂载、需登录）、`/sw.js` 身份正确；验收后销毁容器与临时目录
- 生产切换（`2026-10-28T12:36:03Z`）：旧容器 `kaogong-potato-app` 停止并重命名为 `kaogong-potato-app-prev-1.0.9` 保留；新容器同名、同端口（`127.0.0.1:3000`）、同挂载（`data` / `release` / `scripts`）、同日志策略启动；healthy，切换后日志无错误

## 5. 线上验证

### 5.1 公网接口
- `/api/health` healthy、`generationId` 不变
- `/version.json?nonce=*` → `1.0.10 / 20261028.05 / Schema 5 / APK 1.0.5`，nonce 回显
- `/sw.js` → `1.0.10 / 20261028.05`；`/` 新资源 `index-B2I3IuvJ.js` 生效；`/api/download/apk` 200 且 SHA-256 不变

### 5.2 线上真实浏览器（Playwright，393×873，未写真实账号数据）
- 登录页正常渲染、标题 `考公工作台 · 土豆陪伴版`，无运行时错误（仅未登录时 `/api/auth/me` 401，属预期）
- 页面内 `/version.json` 返回 1.0.10 / 20261028.05 且 nonce 回显
- 截图：`output/prod-1.0.10/prod-live-login-393.png`

### 5.3 生产环境真实发信冒烟（端到端）
1. 通过 CLI 生成邀请码 → 公网注册验收账号 `smoke_email_1010`（仅用于本次验收，事后已删除）
2. 线上容器向用户真实邮箱（`9462***@qq.com`）发送 6 位验证码：第一次人工录入有误 → 服务端正确拒绝（400 INVALID_CODE，未放行）；重新发送后校验通过，绑定成功（`bound=true`，掩码 `9***@qq.com`）
3. 创建真实提醒「生产环境到点发信测试」，设置 `2026-10-28T12:45:16Z`（Asia/Tokyo 21:45），线上 worker 于 `12:45:32Z` 自动发送，`status=sent`、`attempts=1`、`delayed=0`，延迟 16 秒（<60 秒，不计延后）；发送期间无任何客户端在线
4. 清理：删除验收账号与 3 个 CLI 测试邀请码，生产表计数恢复基线（users 10 / invites 24），`integrity_check=ok`；容器保持运行

## 6. 用户端如何收到更新

- 已登录 Web/APK：启动、切回前台或网络重连时自动检查，发现 `20261028.05 > 20261028.04` 后显示「发现新版本 1.0.10」横条，点击激活刷新；30 分钟检查节流
- 直接刷新/重开立即加载新缓存代次 `kaogong-shell-v5-1.0.10-20261028.05`；APK 无需升级
- 「我的 → 学习提醒」入口对已登录用户默认可见；邮件功能依赖服务器 SMTP 配置（当前已启用）

## 7. 回滚方案

```bash
ssh ubuntu@18.224.72.68
docker rm -f kaogong-potato-app
docker rename kaogong-potato-app-prev-1.0.9 kaogong-potato-app
docker start kaogong-potato-app
```

数据恢复：本机 `data/prod_offsite_backups/backup_20261028_122442.tar.gz` 或宿主机备份目录，按 `restore-offline` 流程执行；回滚代码时保留新增邮件/共享表，不做数据删除。

## 8. 风险与后续建议

- 当前发信使用个人 QQ 邮箱 SMTP：存在日发送量限制、反垃圾策略与账号风控风险，随用户量增长应迁移到专用发信服务（自有域名 + 事务邮件 SMTP/API），并监控退信率与发送延迟
- `deployedAt` 元数据为发布名义时间 `2026-10-28T12:40:00Z`，实际容器切换时间 `12:36:03Z`，属发布元数据口径
- 提醒为一次性发送；“已提交邮件服务器”仅代表 SMTP 接受，实际到达取决于收件方邮箱；发送失败/未知不自动重发，需用户确认后重新安排
