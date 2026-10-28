# 考公工作台 · Web 1.0.8 正式发布与生产更新验收记录

- **发布时间**: 2026-10-28 14:59 (Asia/Tokyo) / 2026-10-28T05:59:15Z (UTC)
- **发布内容**: 番茄钟改为开始前选择学习类别并自动登记；首页倒数日支持自定义名称/日期（最多 6 个，可增删改、已结束态）
- **基线 Commit**: `8d23bcc` (main，功能提交)
- **生产目标**: `https://work.ruyne.space`
- **生产主机**: `18.224.72.68`（项目目录 `/home/ubuntu/kaogong-app`，x86_64 宿主机构建）
- **发布方式**: 版本升级 → 生产热备份 → 源码推送 → 宿主机构建镜像 → 隔离容器验收 → 容器切换（保留旧容器秒级回滚）
- **APK**: 保持 `1.0.5` / versionCode `6` 不变（WebView 套壳加载生产网页，功能随 Web 更新）

## 1. 发布身份核验（预期 = 生产实测）

| 属性 | 预期 | 生产实测 | 状态 |
| :--- | :--- | :--- | :---: |
| Web Version | `1.0.8` | `1.0.8` | ✅ |
| Web Build | `20261028.03` | `20261028.03` | ✅ |
| 工作区 Schema | `5` | `5` | ✅ |
| Android APK | `1.0.5` / code `6` | `1.0.5` / code `6` | ✅ 不变 |
| APK SHA-256 | `394fc45d…d6d738` | 下载实测一致 | ✅ |
| 健康状态 | healthy | `{"ok":true,"status":"healthy"}` | ✅ |

版本接口公网返回 `cache-control: no-cache, no-store, must-revalidate` 并回显 nonce；`sw.js` 身份为 `1.0.8 / 20261028.03`；首页新资源 `assets/index-Cnqs0-7z.js`（HTTP 200）。

## 2. 生产数据保护

- 上线前热备份: `/home/ubuntu/kaogong-app/data/backups/backup_20261028_055512`（`potato.db` 648 KB，3 个媒体附件与引用一致，PRAGMA integrity_check 通过）
- 归档: `backup_20261028_055512.tar.gz`，SHA-256 `d55253c51b59436f7a27dc9f6dcd8564da404ad90bbecc767b4c906b03a72188`，已下载到本地 `data/prod_offsite_backups/`（与宿主机哈希一致）
- 切换前后表计数完全一致：`users 10` / `workspaces 6` / `media_records 3` / `sessions 8` / `invites 24`
- 同步代际保持 `gen_1792995329794_e00c30554b4ace1c`（登录态与同步代际未重置）；未做数据库迁移、未替换数据卷

## 3. 构建与切换

- 源码推送：关键文件 SHA-256 与本地逐一核对一致（`release.json`、`package.json`、`public/sw.js`、番茄钟/倒数日相关 6 个源码文件）；`data/`、keystore、node_modules、dist 全程排除
- 宿主机构建镜像（日志 `/tmp/kaogong-build-1.0.8.log`）：
  - `kaogong-potato-app:1.0.8-20261028.03`
  - `kaogong-potato:1.0.8`
- 隔离验收：`127.0.0.1:3001` + 临时数据卷启动新镜像，health / version / sw 身份全部正确后销毁
- 生产切换：旧容器改名保留 `kaogong-potato-app-prev-1.0.7`（另有更早的 `prev-1.0.6`）；新容器 `aba5b2ff…` 使用相同端口/环境/挂载/日志策略启动，healthy 通过，切换后日志 0 错误

## 4. 线上验证

### 4.1 公网接口
- `/api/health` healthy、generationId 不变
- `/version.json?nonce=*` → 1.0.8 / 20261028.03 / Schema 5 / APK 1.0.5，nonce 回显、no-store
- `/sw.js` → `RELEASE_VERSION='1.0.8'`、`RELEASE_BUILD='20261028.03'`
- `/api/download/apk` → SHA-256 与 release 元数据一致

### 4.2 线上真实浏览器（Playwright，393×873，preview 隔离状态，不写真实账号数据）
1. 登录页正常加载；
2. 版本接口 1.0.8 / 20261028.03 + nonce 新鲜度通过；
3. 番茄钟：开始按钮在未选类别时禁用，9 个类别可选；选「申论」开始 → 类别锁定；20 分钟后「结束并自动登记」→ 提示已记录 20 分钟，今日日程出现已完成「番茄钟 · 申论」；
4. 分析页：自定义学习与专注与休息两个视图都包含这 20 分钟；
5. 倒数日：新增自定义名称/日期并改名成功渲染；
6. 关于应用显示 v1.0.8 / 构建编号 20261028.03；页面 console 0 错误。
截图：`output/prod-1.0.8/prod-login-393.png`、`prod-timer-running-393.png`、`prod-timer-registered-393.png`、`prod-timer-analysis-393.png`、`prod-countdown-393.png`、`prod-about-393.png`；结果 JSON `output/prod-1.0.8/prod-live-results.json`。

### 4.3 用户端如何收到更新
- 已登录 Web/APK（WebView）：启动完成、切回前台或网络重连时自动请求 `/version.json`，发现 `20261028.03 > 20261028.02` 后显示「发现新版本 1.0.8」横条，点击激活刷新；
- 直接刷新/重开 App 立即加载新 Service Worker 缓存代次 `kaogong-shell-v5-1.0.8-20261028.03`；
- APK 无需升级。

## 5. 回滚方案

```bash
ssh ubuntu@18.224.72.68
sudo docker rm -f kaogong-potato-app
sudo docker rename kaogong-potato-app-prev-1.0.7 kaogong-potato-app
sudo docker start kaogong-potato-app
```

数据恢复：本地 `data/prod_offsite_backups/backup_20261028_055512.tar.gz` 或宿主机备份目录，按 `restore-offline` 流程执行。
