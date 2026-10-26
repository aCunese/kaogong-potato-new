# 交接文档 · 考公工作台（土豆新版）— 当前真实状态

> 权威验证明细见 [FINAL-VERIFICATION.md](./FINAL-VERIFICATION.md)。本文件只保留交接必需信息。

## 1. 环境与版本

- 项目路径：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
- 分支：`codex/prod-release-m1-m4`；基线 HEAD：`bc368b7b8ac6217b1a31ef78cf74c5d0e7ebaa9c`
- 本轮提交：`f24ae56` 核心修复与产物 → `91b07e5` 隔离测试与证据 → `d085d94` 身份/初始化/游客迁移回归 → `本文件所在提交` 交接与报告（**尚未推送/合并**）
- 统一发布身份 `release.json`：Web `1.0.3` / build `20261027.01` / schema 3；Android `1.0.3` / `versionCode 4`
- 技术栈未变：React 18 + Vite、Express 5、SQLite（WAL）、IndexedDB（v3，增量迁移）、Android Java WebView
- 生产目标：`https://work.ruyne.space`（本轮**未部署**）

## 2. 用户决策与不可违反项（沿用）

- 土豆品牌母版与 8 姿势插图不重新设计；保留密码可见开关、Let's Encrypt 配置与现有品牌素材。
- 正式入口必须登录，无游客入口；注册保留邀请码、密码 ≥8 位。
- 新账号由服务器注册事务一次性初始化 14 本 / 7 门 / 22 项；进度与错题清零；删除后不复活；旧空库选择服务器持久化、跨设备一致。
- “我的”保持紧凑结构；后台备份、历史快照、冲突恢复点必须保留；清理缓存不得删除未同步业务数据与照片。
- 不新增题库/自动判题/播放器/AI；不更换数据库或认证服务；无新增生产依赖。
- 备份恢复点、冲突状态下不得静默覆盖；生产迁移/部署/远程推送/Restic 操作需另行确认。

## 3. 本轮完成（有运行证据）

- 数据一致性/同步：三层版本分离（本地写计数 / 已确认云端 revision / generation）、内容哈希收敛、隔离任务仍算未解决、跨标签页 Web Locks+租约、稳定 requestId+CAS+幂等、有界退避重试。
- 账号隔离：authEpoch+userId 贯穿启动/登录/同步/媒体/冲突；401 与 403/503/离线区分；离线重连先恢复会话+CSRF 再补传；显式退出持久标记。
- 媒体：错题照片与头像 data URL/blob → 服务器附件（sha256 去重、配额、权限隔离）→ 原子引用改写 → 再提交工作区；第二设备可读真实照片字节。
- 恢复/初始化：清理缓存安全拒绝；重置/导入/覆盖/游客迁移前真实恢复点；还原快照真实生效；登录/注册先拉取云端再进入；游客迁移全量 ID 映射 + 双向恢复点 + 一次性。
- 服务端：图片/头像契约、全字段校验+12MiB 上限+历史/幂等保留策略、初始化选择、媒体去重、版本 nonce、contentHash。
- Android/更新：线程安全桥接、安装强校验（SHA/包名/versionCode/证书）、来源授权与 ACTION_CHOOSER、DownloadManager 状态/重试、版本检查真实状态/节流/nonce 新鲜度、SW 不缓存 version.json。
- 测试隔离：临时 DATA_DIR/端口/context，真实 data/ 运行前后指纹一致。

## 4. 验证命令（全部可复跑）

```bash
npm test                                   # exit 0: 116 单测 + 17 接口 + 3 灾备
npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit   # exit 0
npm run build                              # exit 0
bun scripts/run-isolated-audit.ts          # exit 0: 163/163（156 视觉 + 7 真实业务）
bun scripts/business-e2e-audit.ts          # exit 0: 38/38（含 16 张真实截图）
bun scripts/auth-epoch-audit.ts            # exit 0: 14/14（R04/R09/R10/R11）
bun scripts/backup-restore-audit.ts        # exit 0: 13/13（Docker/Restic 标记 NOT_VERIFIED）
./scripts/build-apk.sh --unsigned-verify   # exit 0（v1.0.3/code4 未签名编译断言）
./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk  # exit 1（旧包不含最新修复，预期）
KEYSTORE_PASS='<原口令>' ./scripts/build-apk.sh   # 生成正式签名包（当前阻塞）
```

证据目录：`docs/implementation/evidence/`（日志、结果 JSON、APK 复核、真实截图 `screens/`）。

## 5. 已知阻塞与未验收

1. **Android 正式签名 APK 阻塞**：`release/kaogong-release.keystore` 存在但缺 `KEYSTORE_PASS`；未生成/伪造替代密钥。服务端已置 `apkReleased=false`，旧 v1.0.2 不再作为最新包分发。
2. **无 adb/设备/模拟器**：R13 运行时线程日志、R15 安装授权/相机相册/取消、覆盖升级保留数据均未设备级验收。
3. **无 Docker / Restic / 远程凭据**：容器重建与卷持久化、异地灾备未验收。
4. 生产部署、Nginx/证书上线、生产数据迁移、历史清理、推送合并均**未执行**。
5. 旧 `SyncModal/BackupModal/StatesPreview` 仅保留于 `?preview=1` 视觉矩阵，非用户入口。

## 6. 下一步（按序）

1. 取得原 keystore 口令 → 构建签名 `release/apk/kaogong-potato-v1.0.3.apk` → 回填 `release.json`（sha/size/apkReleased）→ 复跑测试与 APK 断言。
2. 真机验收 R13–R17（含 logcat 无 wrong-thread 异常、覆盖升级保留数据）。
3. Docker 容器重建 + 卷持久化 + 宿主 UID 校验；Restic 仓库快照与隔离恢复。
4. 生产发布审批：备份 → 部署（第 9 节步骤）→ 冒烟 → 观察同步冲突率/配额；失败按恢复点回滚。
5. 可选清理：删除 preview-only 旧组件与旧测试预期。
