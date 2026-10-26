# 考公工作台 · 生产部署与系统运维手册

本手册为考公工作台（土豆新版）的生产环境部署、账号维护、自动化热备、灾难恢复、版本发布与 Android 客户端打包的完整操作指南。

---

## 一、系统架构与端口拓扑

- **前端架构**：React 18 + TypeScript + Vite + Tailwind CSS，由 Service Worker 接管离线 App Shell。
- **后端架构**：Node.js 24 LTS + Express 5 + SQLite 3（WAL 模式 + 原生在线热备 API）。
- **容器服务**：Docker Compose 编排，仅监听 `127.0.0.1:3000` 回路，强制所有外部流量通过 HTTPS 反向代理接入。
- **持久化路径**：宿主机 `./data/` 挂载至容器内部 `/app/data/`，包含 `potato.db`、`potato.db-wal` 及私有附件目录 `attachments/`。

---

## 二、生产服务器部署步骤

### 1. 基础环境需求
- Linux 64位服务器（Ubuntu 22.04 LTS / Debian 12 推荐）
- Docker 24.0+ 与 Docker Compose v2+
- Nginx 或 Caddy 反向代理（带 SSL 证书）

### 2. 启动服务容器
在项目根目录下执行：
```bash
# 1. 确保数据目录及权限正确
mkdir -p data/attachments data/backups
chmod 700 data

# 2. 构建并后台启动容器
docker compose up -d --build

# 3. 查看容器健康状态
docker compose ps
curl -s http://127.0.0.1:3000/api/health
```
健康检查返回：
```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.0.0",
  "generationId": "gen_...",
  "uptime": 12.3
}
```

### 3. HTTPS 反向代理配置

#### Nginx 配置示例 (`/etc/nginx/sites-available/kaogong.conf`):
```nginx
server {
    listen 80;
    server_name kaogong.your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name kaogong.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/kaogong.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kaogong.your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 安全头
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 客户端上传限制（与单张图片限制匹配）
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 三、管理员运维命令速查 (`server/cli.ts`)

管理员可通过命令行工具直接执行日常运维与账号管理：

```bash
# 生成一次性注册邀请码（用户注册后自动作废）
npm run admin create-invite

# 查看所有已注册学员账号、云端修订号与存储配额
npm run admin list-users

# 停用违规用户（立即撤销所有活跃在线会话）
npm run admin disable-user <userId>

# 重新启用用户
npm run admin enable-user <userId>

# 为忘记密码的用户生成30分钟一次性重置码
npm run admin reset-code <userId>

# 管理员使用重置码直接设定新密码
npm run admin reset-password <code> <newPassword>

# 执行单次在线热备份（生成 potato.db 与 manifest.json）
npm run admin hot-backup [目标目录]

# 轮换同步代际标识并强制所有客户端重新协商（整机灾备恢复后执行）
npm run admin rotate-gen

# 针对单个用户恢复特定 JSON 备份存档（不影响其他用户）
npm run admin restore-user <userId> <backupPath>
```

---

## 四、自动化备份与 Restic 异地归档

### 1. 配置定时任务 (Cron)
使用 SQLite 原生在线热备份 API，严禁直接 `cp` 处于写入状态的 WAL 数据库。
在宿主机配置每小时热备任务：
```bash
crontab -e
```
添加如下定时任务：
```cron
# 每小时第 0 分钟执行热备份与保留策略修剪
0 * * * * cd /path/to/kaogong-potato-new && ./scripts/backup.sh >> /var/log/kaogong_backup.log 2>&1
```

### 2. 本地保留策略
- **近 24 小时**：保留每小时的增量热备目录与压缩包；
- **近 30 天**：保留每天的独立归档；
- **近 8 周**：保留每周的基线快照；
- 超期文件由 `scripts/backup.sh` 自动修剪。

### 3. 对接外部 Restic 灾备存储
若需异地备份至云对象存储（如 Cloudflare R2 / S3 / 远程 SFTP），只需在环境变量中配置 `RESTIC_REPOSITORY` 与 `RESTIC_PASSWORD`：
```bash
export RESTIC_REPOSITORY="s3:https://<account-id>.r2.cloudflarestorage.com/kaogong-backups"
export RESTIC_PASSWORD="<YourSecureResticPassword>"
export AWS_ACCESS_KEY_ID="<KeyID>"
export AWS_SECRET_ACCESS_KEY="<SecretKey>"
```
`scripts/backup.sh` 会自动检测并调用 `restic backup`，自动排除 `.wal`、`.shm` 临时文件，并打标 `--tag kaogong --tag automated`。

---

## 五、灾难恢复操作规范

### 1. 整机恢复流程
当服务器发生数据损毁或误操作需要回滚至历史热备时：
```bash
# 停止当前容器
docker compose down

# 执行灾备恢复（支持指定备份目录或 tar.gz 压缩包）
./scripts/restore.sh data/backups/backup_20261026_153756.tar.gz

# 重启容器服务
docker compose up -d
```
**恢复脚本内部关键保障**：
1. 先校验数据库 `PRAGMA integrity_check` 与附件 SHA256 校验和；
2. 自动备份当前受损现场至 `pre_restore_safety_*`；
3. **强制轮换 `generation_id`** 并撤销所有活跃 Token；
4. 旧客户端（或离线设备）尝试用滞后的本地快照提交时，服务端判定 `GENERATION_MISMATCH`（HTTP 409），彻底阻止旧数据反向覆盖灾备结果。

---

## 六、版本发布与平滑回滚

### 1. 软件版本发布
每次正式上线前：
1. 递增 `package.json`、`server/app.ts` 和 `public/version.json` 中的 `build` 流水号（如 `20261026.02`）；
2. 执行测试套件：`npm test`；
3. 执行生产构建：`npm run build`；
4. 重建发布容器：`docker compose up -d --build`。

### 2. 客户端无感感知与防中断机制
- 浏览器与 Android 外壳每 30 分钟或回到前台时自动查询 `/version.json`；
- 检测到新版本时，在顶部显示轻量更新提示；
- **计时保护**：如果考生当前有正在计时的刷题计划（`isAnyTimerRunning() === true`），系统自动阻止强制刷新，必须等考生暂停或确认后再执行重载。

### 3. 发布回滚
如发现重大缺陷需紧急回滚：
1. 检出稳定版本的 Git Tag；
2. **务必递增 `build` 流水号**（如回滚补丁为更高序列 `20261026.03`），确保客户端 Service Worker 识别并更新；
3. 重新构建容器并重启；
4. 用户的本地 IndexedDB 记录不会被清空，保障考生离线学习数据安全。

---

## 七、Android 客户端编译与发布

原生外壳位于 `android/` 目录。

### 1. 配置生产 HTTPS 域名
编辑 `android/app/src/main/res/values/strings.xml`：
```xml
<string name="cloud_url">https://kaogong.your-domain.com</string>
```

### 2. 编译 Release APK
```bash
cd android
./gradlew assembleRelease
```
安装包产物位于：`android/app/build/outputs/apk/release/app-release.apk`。

### 3. 密钥与签名保管
- 严禁将签名密钥 `release.keystore` 提交进 Git 代码仓库；
- 推荐使用环境变量指定签名参数：
  ```bash
  export KEYSTORE_FILE="/path/to/private/release.keystore"
  export KEYSTORE_PASSWORD="<Password>"
  export KEY_ALIAS="kaogong"
  export KEY_PASSWORD="<Password>"
  ```
- Android 客户端内置严格 SSL 验证（证书异常直接终止连接）与禁用明文 HTTP，杜绝中间人劫持。
