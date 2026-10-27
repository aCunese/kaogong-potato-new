# 考公工作台 · 个人与亲友单实例正式发布与运维操作指南 (SOP)

> **版本标识**：Web `1.0.5` (build `20261027.04`) ｜ Android `1.0.5` (`versionCode 6`) ｜ 数据架构 Schema `3`  
> **适用范围**：单实例个人与亲友独立部署 ｜ 生产域名：`https://work.ruyne.space`  
> **架构定位**：不可变 Docker 镜像、宿主机绝对物理路径数据卷、原地升级全量切换（无灰度/无多节点集群）。  
> **安全底线**：严禁 `docker compose down -v`、严禁 volume prune、严禁直接从本地覆盖服务器数据库、严禁泄露密钥。

---

## 目录
1. [一、系统架构与运行原则](#一系统架构与运行原则)
2. [二、发布前自动化基线验证](#二发布前自动化基线验证)
3. [三、生产配置与环境变量准备](#三生产配置与环境变量准备)
4. [四、发布前热备份与异地归档](#四发布前热备份与异地归档)
5. [五、安全停机、最终备份与镜像切换](#五安全停机最终备份与镜像切换)
6. [六、部署后验证与客户端更新验收](#六部署后验证与客户端更新验收)
7. [七、灾难恢复：离线一次性容器恢复流程](#七灾难恢复离线一次性容器恢复流程)
8. [八、紧急回滚方案 (Rollback Runbook)](#八紧急回滚方案-rollback-runbook)

---

## 一、系统架构与运行原则

1. **单实例 personal + friends 范围**：
   - 本项目面向本人及少量亲友考生使用，不设大规模流量分组、灰度发布或跨主机集群。
   - 前端采用 React 18 + IndexedDB，支持断网离线记录与网络重连同步。
   - 后端为单实例 Express + better-sqlite3，容器内由 `node` 非 root 用户运行。
   - 服务内部通过 Unix 内核文件锁（`dataLock` helper 共享锁/独占锁）保证多进程读写互斥，崩溃自动释锁。
2. **编排与容器命名**：
   - Docker Compose 服务名：`kaogong-app`
   - 容器名称：`kaogong-potato-app`
   - 生产配置文件：`deploy/compose.prod.yml`
   - 生产环境变量文件：`deploy/release.env`
3. **数据安全性承诺**：
   - 数据目录必须为生产宿主机的真实绝对物理路径（`PROD_DATA_DIR`），不可使用相对路径，不可临时变更 inode。
   - 升级操作仅切换不可变镜像，数据库原地保留；新旧版本均基于 Schema 3，绝不清库、不删表、不换命名空间。

---

## 二、发布前自动化基线验证

在构建生产镜像或上线前，必须在源码目录完成全部本地自动化自检，确保全部通过（PASS / exit 0）：

```bash
# 1. 静态类型检查（双工程 TypeScript 0 错误）
npm run typecheck

# 2. 单元与服务端套件（全部 PASS）
npm run test:unit
npm run test:server

# 3. 灾备与热备钻练（离线恢复、代际轮换、Schema 校验全部 PASS）
npm run test:dr

# 4. 边界回归与身份隔离套件（V01–V12 全部 PASS，无 external repo 依赖）
npm run verify:boundaries
npm run verify:auth
npm run verify:backup

# 5. 前端生产打包验证
npm run build

# 6. Android APK 编译与 19 项 DEX/Manifest 安全断言
ANDROID_HOME=/Users/ruyne./.android-sdk ./scripts/build-apk.sh --unsigned-verify
```

---

## 三、生产配置与环境变量准备

### 步骤 3.1：核验生产宿主机配置与既有容器状态
通过 SSH 连接生产宿主机，核验正在运行的容器及挂载点（禁止盲猜路径）：

```bash
# 1. 查看正在运行的容器
docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}'

# 2. 确认当前容器的绝对挂载源（获得 PROD_DATA_DIR 真实路径）
docker inspect --format '{{json .Mounts}}' kaogong-potato-app

# 3. 检查当前在线服务健康
curl --fail --silent http://127.0.0.1:3000/api/health
```

### 步骤 3.2：准备生产环境变量 `release.env`
从模板 `deploy/release.env.example` 创建 `deploy/release.env`，并设置严格权限：

```bash
cp deploy/release.env.example deploy/release.env
chmod 600 deploy/release.env
```

填入已核验的真实参数：
```ini
# [必须] 冻结的目标不可变镜像（含版本或 digest）
APP_IMAGE=kaogong-potato:1.0.5

# [必须] 生产宿主机持久化绝对物理路径（与旧容器 inspect Mount Source 完全一致）
PROD_DATA_DIR=/data/kaogong/data

# [必须] 生产高强度随机会话密钥（至少 32 字符）
SESSION_SECRET=your_production_secret_key_random_and_secure

# [可选] 宿主机回环监听端口
PORT=3000
```

### 步骤 3.3：校验 Compose 配置解析
```bash
docker compose --env-file deploy/release.env -f deploy/compose.prod.yml config
```
确保服务名 `kaogong-app`、镜像、绝对路径挂载点及回环端口映射均解析正确。

---

## 四、发布前热备份与异地归档

在进入维护窗口前，先在线上创建一次完整的预发布热备份，并将其取回异地副本：

### 步骤 4.1：执行在线热备份
通过运行中的容器或宿主机 CLI 执行热备份（持 shared 锁，支持在线读）：

```bash
# 方式 A：在运行中容器内执行
docker exec -t kaogong-potato-app node --import tsx server/cli.ts hot-backup /app/data /app/data/backups

# 方式 B：使用备份脚本
docker exec -t kaogong-potato-app ./scripts/backup.sh
```

备份完成后，检查最新备份目录中的 `manifest.json` 与 `potato.db`，确认文件完整且 SHA-256 哈希匹配。

### 步骤 4.2：导出异机副本
将该备份包拉取至异地安全存储（本地安全备份机或已配置的 Restic 存储库）：

```bash
# 示例：通过 scp / rsync 取回本地安全目录
rsync -avz user@server:${PROD_DATA_DIR}/backups/backup_YYYYMMDD_HHMMSS/ ~/safe_backups/predeploy_backup/
```

---

## 五、安全停机、最终备份与镜像切换

### 步骤 5.1：告知亲友并进入短维护窗口
通知本人及使用本服务的亲友在维护期间暂停录入并完成本机最后一次同步。

### 步骤 5.2：安全停止旧版容器
使用优雅停机信号终止旧服务（给 30 秒超时让现有短请求完成）：

```bash
docker compose --env-file deploy/release.env -f deploy/compose.prod.yml stop -t 30 kaogong-app
```

### 步骤 5.3：利用一次性容器完成停服最终备份
在旧容器停止后，宿主机数据卷处于完全无写状态。启动一次性无网络容器，对同卷执行停机点最终安全备份：

```bash
docker run --rm --network none \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=bind,src=${PROD_DATA_DIR},dst=/app/data" \
  -e DATA_DIR=/app/data "${APP_IMAGE}" \
  node --import tsx server/cli.ts hot-backup /app/data /app/data/backups
```

确认备份成功后，原始数据保持在原位，进入新镜像启动。

### 步骤 5.4：启动新版本容器
使用新不可变镜像原地启动，保持挂载卷不变：

```bash
docker compose --env-file deploy/release.env -f deploy/compose.prod.yml up -d \
  --no-deps --no-build --wait --wait-timeout 120 kaogong-app
```

---

## 六、部署后验证与客户端更新验收

### 步骤 6.1：服务端接口验证
```bash
# 1. 验证健康检查接口（HTTP 200 且 status 为 healthy）
curl --fail --silent http://127.0.0.1:3000/api/health

# 2. 验证版本接口（版本号、构建号准确回显，带防缓存 nonce 证明）
curl --fail --silent "http://127.0.0.1:3000/api/version?nonce=$(date +%s)"
```

### 步骤 6.2：Web 客户端安全更新验证
1. 打开既有浏览器会话（原登录状态保持，无需注销或清空站点数据）。
2. 若当前有弹窗编辑中、计时器运行中、或未同步数据存在，`updateGuard` 会有效阻止刷新，并提示“正在进行数据编辑或操作，已暂缓应用更新”。
3. 完成编辑或关闭弹窗后，点击更新提示或在“设置 → 检查更新”中手动点击更新：
   - 页面平滑重载至新构建 `20261027.04`。
   - 检查历史日程、做题打卡、题本统计及错题照片全部完好。
   - 新建一条做题记录，验证同步至服务端成功。

### 步骤 6.3：正式 Android APK 验收（若发布 APK）
> 若本轮未提供正式签名密钥或无实体机验收，`release.json` 中保持 `apkReleased: false`，Web 保持独立可用。

当满足正式签名条件时：
1. 使用原证书对 `1.0.5`（`versionCode: 6`）执行签名构建。
2. 实测计算 APK SHA-256 与文件字节数，回填至 `release.json` 与 `public/version.json`，并将 `apkReleased` 设为 `true`。
3. 在真实测试手机上从旧版覆盖安装，核验无感保留登录态、错题长图正常显示、SAF 文件导出成功。

---

## 七、灾难恢复：离线一次性容器恢复流程

> **绝对禁止**：严禁在生产执行 `docker compose down -v`！持久化卷上的数据任何情况下不得直接丢弃。

若生产数据出现非预期损坏或误操作，需恢复至特定历史备份点，按以下标准化程序操作：

### 步骤 7.1：彻底停止应用服务
```bash
docker compose --env-file deploy/release.env -f deploy/compose.prod.yml stop -t 30 kaogong-app
```

### 步骤 7.2：确认恢复源与生产数据目录
```bash
RESTORE_SOURCE="${PROD_DATA_DIR}/backups/backup_YYYYMMDD_HHMMSS"

# 验证源备份包含必要文件
test -d "${PROD_DATA_DIR}"
test -f "${RESTORE_SOURCE}/potato.db"
test -f "${RESTORE_SOURCE}/manifest.json"
```

### 步骤 7.3：通过一次性隔离容器执行恢复
使用无网络（`--network none`）一次性只读挂载恢复源，排他写入目标卷，严格指定 `--offline-confirmed`：

```bash
docker run --rm --network none \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=bind,src=${PROD_DATA_DIR},dst=/app/data" \
  --mount "type=bind,src=${RESTORE_SOURCE},dst=/restore-source,readonly" \
  -e DATA_DIR=/app/data "${APP_IMAGE}" \
  node --import tsx server/cli.ts restore-offline \
  /restore-source /app/data --offline-confirmed
```

恢复程序特性保证：
- 内核排他锁保护，防止并发写入；
- 暂存区（staging）先校验 Schema 3、外键约束、附件哈希一致性；
- 验证通过后自动生成恢复前安全快照（pre-restore backup）；
- 原子轮换 `generationId` 并撤销旧活跃会话，防止脏客户端增量覆盖；
- 原子替换主库文件，保持数据目录 inode 不变。

### 步骤 7.4：重启服务并重新登录
```bash
docker compose --env-file deploy/release.env -f deploy/compose.prod.yml up -d --wait kaogong-app
```
用户客户端重新登录后，将自动以新 `generationId` 拉取恢复后的全量快照。

---

## 八、紧急回滚方案 (Rollback Runbook)

### 场景 1：前端代码缺陷，但数据库完整
**原则**：绝不恢复或回退数据库！
1. 检出修复分支，保留现有数据保护与 Schema 3 结构。
2. 将构建号单调递增（例如递增至 `20261027.05`），构建新镜像。
3. 切换 `APP_IMAGE` 重启容器，客户端检测到更高构建号后安全升级。

### 场景 2：数据库物理损坏或脏数据污染
1. 立即停止服务：`docker compose --env-file deploy/release.env -f deploy/compose.prod.yml stop kaogong-app`。
2. 选定确认无损的备份目录，按 [第七节 灾难恢复](#七灾难恢复离线一次性容器恢复流程) 完整执行。
3. 恢复成功后拉起服务。

### 场景 3：新版 Android APK 存在兼容性问题
1. 编辑生产 `release.json` 与 `public/version.json`，将 `apkReleased` 设为 `false`。
2. 客户端将立即隐藏 APK 更新入口，阻止新用户下载问题包。
3. 已安装用户严禁通过卸载安装旧版（会导致本地未同步数据及缓存丢失），必须通过官方证书发布更高 `versionCode`（如 `versionCode 7`）的修复包覆盖升级。
