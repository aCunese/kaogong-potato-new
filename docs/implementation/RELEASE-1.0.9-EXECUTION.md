# 考公工作台 · Web 1.0.9 正式发布与生产更新验收记录

- **发布时间**: 2026-10-28 15:33 (Asia/Tokyo) / 2026-10-28T06:33:16Z (UTC)
- **发布内容**: 倒数日由「一行横向滑动」改为「上下纵向列表」（最多 6 个，可增删改、已结束态）；其余功能同 1.0.8（番茄钟开始前选类别并自动登记）
- **基线 Commit**: `1462f80`（1.0.8 发布提交）+ 本次纵向布局修复
- **生产目标**: `https://work.ruyne.space`
- **生产主机**: `18.224.72.68`（`/home/ubuntu/kaogong-app`，x86_64 宿主机构建）
- **APK**: 保持 `1.0.5` / versionCode `6` 不变（WebView 套壳，随 Web 更新）

## 1. 发布身份核验（预期 = 生产实测）

| 属性 | 预期 | 生产实测 | 状态 |
| :--- | :--- | :--- | :---: |
| Web Version | `1.0.9` | `1.0.9` | ✅ |
| Web Build | `20261028.04` | `20261028.04` | ✅ |
| 工作区 Schema | `5` | `5` | ✅ |
| Android APK | `1.0.5` / code `6` | `1.0.5` / code `6` | ✅ 不变 |
| APK SHA-256 | `394fc45d…d6d738` | 下载实测一致 | ✅ |
| 健康状态 | healthy | `{"ok":true,"status":"healthy"}` | ✅ |

版本接口公网 `no-store` + nonce 回显；`sw.js` 身份 `1.0.9 / 20261028.04`；首页资源 `assets/index-C0I1N9xg.js`（HTTP 200）。

## 2. 生产数据保护

- 上线前热备份: `/home/ubuntu/kaogong-app/data/backups/backup_20261028_062915`（`potato.db` 648 KB，3 个媒体附件一致，integrity_check 通过）
- 归档 SHA-256 `0221ce0f3b0f2a011285c5fb1c8690e66af6d4ac8186e033c4f00c077c0d611a`，已下载到本地 `data/prod_offsite_backups/`（与宿主机哈希一致）
- 切换前后表计数一致：`users 10` / `workspaces 6` / `media_records 3` / `sessions 8` / `invites 24`
- 同步代际保持 `gen_1792995329794_e00c30554b4ace1c`；无数据库迁移、无数据卷替换

## 3. 构建与切换

- 源码推送后关键文件 SHA-256 与本地逐一核对一致（`release.json`、`package.json`、`public/sw.js`、`src/components/views/TodayView.tsx` 等）
- 宿主机镜像：`kaogong-potato-app:1.0.9-20261028.04`、`kaogong-potato:1.0.9`（构建日志 `/tmp/kaogong-build-1.0.9.log`）
- 隔离验收：`127.0.0.1:3001` + 临时数据卷验证 health / version 1.0.9 后销毁
- 生产切换：旧容器保留为 `kaogong-potato-app-prev-1.0.8`（更早的 `prev-1.0.7`、`prev-1.0.6` 亦保留）；新容器 `5b8c9672…` 同端口/环境/挂载启动，healthy，切换后日志无错误

## 4. 线上验证

### 4.1 公网接口
- `/api/health` healthy、generationId 不变
- `/version.json?nonce=*` → 1.0.9 / 20261028.04 / Schema 5 / APK 1.0.5，nonce 回显、no-store
- `/sw.js` → `1.0.9 / 20261028.04`；`/` 新资源生效；`/api/download/apk` SHA-256 一致

### 4.2 线上真实浏览器（Playwright，393×873，preview 隔离状态，不写真实账号数据）
1. 登录页正常；
2. 版本接口 1.0.9/20261028.04 + nonce 通过；
3. 番茄钟：未选类别不可开始 → 选「申论」→ 20 分钟 → 结束自动登记，今日日程出现「番茄钟 · 申论」；
4. 分析页：自定义学习与专注与休息视图都包含这 20 分钟；
5. **倒数日：卡片上下纵向排列、无横向滚动**（第二项在第一项下方同列），新增/改名正常；
6. 关于应用显示 v1.0.9 / 20261028.04；console 0 错误。
截图：`output/prod-1.0.9/prod-countdown-vertical-393.png`、`prod-timer-registered-393.png`、`prod-timer-analysis-393.png`、`prod-about-393.png` 等；结果 JSON `output/prod-1.0.9/prod-live-results.json`。

### 4.3 用户端如何收到更新
- 已登录 Web/APK：启动、切回前台或网络重连时自动检查，发现 `20261028.04 > 20261028.03` 后显示「发现新版本 1.0.9」横条，点击激活刷新；
- 直接刷新/重开立即加载新缓存代次 `kaogong-shell-v5-1.0.9-20261028.04`；
- APK 无需升级。

## 5. 回滚方案

```bash
ssh ubuntu@18.224.72.68
sudo docker rm -f kaogong-potato-app
sudo docker rename kaogong-potato-app-prev-1.0.8 kaogong-potato-app
sudo docker start kaogong-potato-app
```

数据恢复：本地 `data/prod_offsite_backups/backup_20261028_062915.tar.gz` 或宿主机备份目录，按 `restore-offline` 流程执行。
