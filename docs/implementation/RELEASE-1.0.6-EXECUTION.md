# 考公工作台 · Web 1.0.6 正式发布与生产更新验收记录

- **发布时间**: 2026-10-28 11:15:55 (Asia/Tokyo) / 2026-10-28T02:15:55Z (UTC)
- **基线 Commit**: `9ed5d4c6c93650d766fc36001892d03e53e28dda` (main)
- **生产目标**: `https://work.ruyne.space`
- **生产主机**: `18.224.72.68` (AWS EC2 Ubuntu 24.04 LTS x86_64)

---

## 1. 预期与实际发布身份核验

| 属性 | 预期身份 | 生产实测回显 (`/version.json`) | 状态 |
| :--- | :--- | :--- | :---: |
| **Web Version** | `1.0.6` | `1.0.6` | ✅ 一致 |
| **Web Build** | `20261028.01` | `20261028.01` | ✅ 一致 |
| **工作区 Schema** | `5` | `5` | ✅ 一致 |
| **Android APK 版本** | `1.0.5` | `1.0.5` | ✅ 一致 (继续保留已签名版本) |
| **Android APK versionCode** | `6` | `6` | ✅ 一致 |
| **APK 下载接口** | `/api/download/apk` | HTTP 200, 大小 305,550 bytes | ✅ 一致 |
| **APK SHA-256** | `394fc45d9bbc...d6d738` | `394fc45d9bbc...d6d738` (完全匹配) | ✅ 一致 |
| **部署时间 (deployedAt)** | 实际发布时间 | `2026-10-28T02:15:55Z` | ✅ 一致 |
| **健康状态** | `healthy` | `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c"}` | ✅ 正常 |

---

## 2. 生产环境数据保护与备份

### 2.1 生产热备份与异机归档
1. **上线前完整热备份**:
   - 目标路径: `/app/data/backups/backup_20261028_021020`
   - 清单校验: 引用 3 个媒体附件，与磁盘附件一致；数据库大小 434,176 bytes，SHA-256 `85c89a5d6dfb504bf02c929974e01af44a114b0a7ba141417ddbb9e2f7260c81`。
   - 归档包: `backup_20261028_021020.tar.gz` (SHA-256: `22699ab4ae406a67a649ee7d966d5721c6071e85d8e15ad8aef8e768722031c8`)
   - 异机下载保存: 本地 `data/prod_offsite_backups/backup_20261028_021020/` 及压缩包。
2. **独立临时目录离线恢复演练**:
   - 在临时目录 `/tmp/test-restore-verify-20261028` 演练 `node --import tsx server/cli.ts restore-offline`，演练通过（`[SUCCESS] 灾难恢复完成`）。
3. **停服切换点最终备份**:
   - 目录: `/app/data/backups/backup_20261028_final_pre_switch`

### 2.2 数据库与附件完整性比对（零数据丢失）
- **用户表 (users)**: 9 条记录（上线前后 100% 一致）
- **工作区表 (workspaces)**: 5 条记录（上线前后 100% 一致）
- **媒体记录表 (media_records)**: 3 条记录（上线前后 100% 一致）
- **媒体磁盘附件 (attachments)**: 3 个文件（`6b7fa434...png`, `6f3dccf6...jpg`, `eaf8c407...jpg`，完全匹配）
- **会话记录 (sessions)**: 4 条记录（上线前后 100% 一致）
- **邀请码记录 (invites)**: 22 条记录（上线前后 100% 一致）

---

## 3. 生产镜像构建与容器平滑切换

- **构建方式**: 在目标 x86_64 生产宿主机直接构建多阶段 Docker 镜像，规避跨架构兼容隐患。
- **镜像标签**:
  - `kaogong-potato-app:1.0.6-20261028.01`
  - `kaogong-potato:1.0.6`
- **隔离测试**: 在临时端口 3001 启动隔离容器测试 `/api/health` 与 `/version.json`，验证 100% 正常后销毁。
- **生产容器切换**:
  - 挂载源不变: `/home/ubuntu/kaogong-app/data:/app/data`（保持真实 inode）
  - 端口绑定不变: `127.0.0.1:3000:3000`
  - 新容器 ID: `caca789dcf88`
  - 启动后 `generationId` 保持为 `gen_1792995329794_e00c30554b4ace1c`，现有用户登录态与同步代际未被重置。

---

## 4. 生产端到端实测验证

### 4.1 独立测试账号端到端全流程验证
使用生产生成的全新邀请码注册专属测试账号 `audit_gw43vr`：
1. **注册与登录**: 成功获取会话 Cookie 与 CSRF Token；
2. **拉取初始工作区**: 成功获取 revision 1 初始数据；
3. **写入 Schema 5 独立计时器与待办**:
   - 构造合法 `timerSessions`（番茄钟、focus/rest 分段）与当天独立待办；
   - 提交至生产 `POST /api/workspace`，HTTP 200 成功，revision 升至 2；
4. **重新拉取核验**: 重新请求 `GET /api/workspace`，Schema 5 结构完整保留，各字段精确吻合。

### 4.2 手机/移动端更新逻辑验证
1. **旧版客户端探测**:
   - 模拟旧 Web 构建 `20261027.04` 与已安装 APK `versionCode: 6`；
   - 比较器正确判定 `webUpdateAvailable: true`，触发网页更新横条；
   - 判定 `apkUpdateAvailable: false`（因已安装 APK versionCode 与云端相同），**不会误报 APK 更新或强推重复下载**。
2. **浏览器真机视口实测**:
   - 通过 Playwright 对生产域名 `https://work.ruyne.space`（393x852 手机视口）进行截图：
     - `output/prod-live-login-393x852.png`: 登录页面正常加载；
     - `output/prod-live-today-393x852.png`: 今日页面显示独立“番茄钟”按钮与待办，无横向溢出；
     - `output/prod-live-settings-393x852.png`: “检查更新”显示“已是最新 (v1.0.6)”；
     - `output/prod-live-about-modal-393x852.png`: “关于应用”显示网页运行版本 `v1.0.6`、构建编号 `20261028.01`；
     - `output/prod-live-update-modal-393x852.png`: 更新弹窗显示“当前已是最新运行版本 v1.0.6 (构建号 20261028.01)”，带 nonce 新鲜度回显证明。
3. **已安装 Android 真机更新说明**:
   - 当前执行环境无已连接的授权物理 Android 设备（`adb` 未连接）；
   - **已将“物理真机实机更新”如实标为待实机打开验证**，并整理了最短人工核验步骤。

---

## 5. 回滚方案 (Rollback Plan)

若生产环境发生意外缺陷：
1. **停止当前容器**:
   ```bash
   docker stop -t 30 kaogong-potato-app && docker rm kaogong-potato-app
   ```
2. **切回上一个不可变镜像**:
   ```bash
   docker run -d --name kaogong-potato-app --restart unless-stopped \
     -p 127.0.0.1:3000:3000 \
     -v /home/ubuntu/kaogong-app/data:/app/data \
     -v /home/ubuntu/kaogong-app/release:/app/release:ro \
     -v /home/ubuntu/kaogong-app/scripts:/app/scripts:ro \
     kaogong-potato-app:1.0.5-20261027.04
   ```
3. **冷备恢复（极端灾备兜底）**:
   - 本地与宿主机均持有 `backup_20261028_021020`，可通过 `restoreOffline` 在离线状态下 100% 恢复至上线前状态。
