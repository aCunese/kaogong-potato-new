# 考公工作台 · Web 1.0.7 正式发布与生产更新验收记录

- **发布时间**: 2026-10-28 13:07 (Asia/Tokyo) / 2026-10-28T04:07:35Z (UTC)
- **发布内容**: 自定义日程直接填写名称＋八科＋其他；分析页自定义学习用时分布、图例固定颜色、月度各科（含其他）统计；自定义学习库事项名称上限对齐服务端 120；历史工作区快照兼容修复
- **基线 Commit**: `76a6edb` (main)
- **生产目标**: `https://work.ruyne.space`
- **生产主机**: `18.224.72.68` (AWS EC2 Ubuntu 24.04 LTS x86_64)，项目目录 `/home/ubuntu/kaogong-app`
- **发布方式**: 本地版本身份升级 → 生产热备份 → 源码 tar 推送 → 宿主机直接构建镜像 → 隔离容器验收 → 容器切换（保留旧容器秒级回滚）
- **APK**: 保持 `1.0.5` / versionCode `6` 不变（Android 为 WebView 套壳加载生产网页，功能随 Web 自动更新，无需重新安装）

---

## 1. 发布身份核验（预期 = 生产实测）

| 属性 | 预期身份 | 生产实测 (`/version.json`) | 状态 |
| :--- | :--- | :--- | :---: |
| Web Version | `1.0.7` | `1.0.7` | ✅ |
| Web Build | `20261028.02` | `20261028.02` | ✅ |
| 工作区 Schema | `5` | `5` | ✅ |
| Android APK | `1.0.5` / code `6` | `1.0.5` / code `6` | ✅ 不变 |
| APK SHA-256 | `394fc45d…d6d738` | `394fc45d…d6d738`（下载实测一致） | ✅ |
| deployedAt | `2026-10-28T03:56:06Z` | `2026-10-28T03:56:06Z` | ✅ |
| 健康状态 | healthy | `{"ok":true,"status":"healthy"}` | ✅ |

版本接口通过公网返回 `cache-control: no-cache, no-store, must-revalidate`，并回显一次性 nonce（`nonce=live-verify`），确保客户端不会把缓存误判为最新版本。

## 2. 生产数据保护

### 2.1 上线前热备份（切换前完成）
- 备份目录: `/home/ubuntu/kaogong-app/data/backups/backup_20261028_035843`
- 数据库: `potato.db` 476 KB，SHA-256 `a0616cb65cd941de689236bf32b7ad81a2df32ba051c2476825dabaaa1187e1a`，`PRAGMA integrity_check` 通过
- 媒体附件: 3 个，与数据库引用完全吻合
- 归档: `backup_20261028_035843.tar.gz`，SHA-256 `3ec6104ef149f3b08eaa706c4648d449b415ae41d8ebbbc2b920ef2d41d61384`
- 异机下载: 本地 `data/prod_offsite_backups/backup_20261028_035843.tar.gz`（与宿主机 SHA-256 一致）

### 2.2 切换前后数据一致性
- 同步代际 ID 保持 `gen_1792995329794_e00c30554b4ace1c`（现有登录态与同步代际未被重置）
- 表计数切换前后完全一致：`users 10` / `workspaces 6` / `media_records 3` / `sessions 8` / `invites 24`
- 未做任何数据库迁移或数据卷替换，挂载源保持 `/home/ubuntu/kaogong-app/data:/app/data`

## 3. 构建与切换

- 源码传输：本地 tar 推送，关键文件 SHA-256 与本地逐一致（`release.json`、`package.json`、`public/sw.js`、`src/components/views/EditModals.tsx`、`src/utils/workflowMutators.ts`、`server/workspace.ts`）；`data/`、`release/keystore`、`node_modules/`、`dist/` 全程排除
- 镜像构建（宿主机 x86_64 直接构建，构建日志 `/tmp/kaogong-build-1.0.7.log`）:
  - `kaogong-potato-app:1.0.7-20261028.02`
  - `kaogong-potato:1.0.7`
- 隔离验收：`127.0.0.1:3001` + 临时数据卷启动新镜像，验证 health、`/version.json`（1.0.7/20261028.02/nonce）、`/sw.js` 身份、APK 下载 SHA-256 全部通过后销毁
- 生产切换：旧容器 `kaogong-potato-app` 停止并改名保存为 `kaogong-potato-app-prev-1.0.6`；新容器 `69d2754…` 使用相同端口/环境变量/挂载/日志策略启动，`healthy` 通过

## 4. 线上验证

### 4.1 公网接口
- `GET /api/health` → healthy，generationId 不变
- `GET /version.json?nonce=prod-verify-*` → 1.0.7 / 20261028.02，nonce 回显，`no-store`
- `GET /sw.js` → `RELEASE_VERSION='1.0.7'`、`RELEASE_BUILD='20261028.02'`、缓存名 `kaogong-shell-v5-1.0.7-20261028.02`，`no-cache`
- `GET /` → 新构建资源 `assets/index-B2zFuMdd.js`（HTTP 200，619,568 bytes）
- `GET /api/download/apk` → SHA-256 与 release 元数据一致

### 4.2 线上真实浏览器（Playwright，393×852，preview 隔离演示模式，不触碰真实账号数据）
1. 登录页正常加载；
2. 版本接口 1.0.7/20261028.02 + nonce 新鲜度通过；
3. 自定义日程表单：直接填写"事项名称"、科目九项（八科＋其他）、默认 30 分钟、无旧"选择事项"下拉；
4. 分析页"自定义学习用时分布"正常渲染；
5. "我的 → 关于应用"显示 v1.0.7、构建编号 20261028.02；页面 console 0 错误。
截图：`output/prod-1.0.7/prod-login-393.png`、`prod-today-preview-393.png`、`prod-custom-form-393.png`、`prod-analysis-custom-393.png`、`prod-settings-393.png`、`prod-about-393.png`；结果 JSON：`output/prod-1.0.7/prod-live-results.json`。

### 4.3 用户端如何收到更新
- 已登录的 Web/APK（WebView）客户端：启动完成、窗口重新聚焦/切回前台、或网络重连时自动请求 `/version.json`；发现 `20261028.02 > 20261028.01` 后显示"发现新版本 1.0.7"横条（不打断计时），点击即激活并刷新。
- 直接刷新页面/重开 App：加载新的 Service Worker 缓存代次 `kaogong-shell-v5-1.0.7-20261028.02`，立即使用新版本。
- APK 无需升级：外壳只加载 `https://work.ruyne.space`，本次功能随 Web 生效，不产生 APK 升级提示。

## 5. 回滚方案

旧容器与镜像均保留（`kaogong-potato-app-prev-1.0.6` / `kaogong-potato-app:1.0.6-20261028.01`）：

```bash
# 切回 1.0.6（秒级）
sudo docker rm -f kaogong-potato-app
sudo docker rename kaogong-potato-app-prev-1.0.6 kaogong-potato-app
sudo docker start kaogong-potato-app
```

若需恢复数据：本机 `data/prod_offsite_backups/backup_20261028_035843.tar.gz` 或宿主机
`/home/ubuntu/kaogong-app/data/backups/backup_20261028_035843/`，按 `server/cli.ts restore-offline` 离线恢复流程执行。

## 6. 备注

- `deployedAt` 在构建前写入（2026-10-28T03:56:06Z），为本次发布身份的构建时间戳，实际容器切换发生于 04:07:35Z。
- 生产容器仍只绑定 `127.0.0.1:3000`，由 Nginx + Cloudflare 终结 TLS；本次未修改 Nginx 配置。
- 已登录用户的实时计时、离线数据不受发布影响；切换未清缓存、未清库、未改数据卷。
