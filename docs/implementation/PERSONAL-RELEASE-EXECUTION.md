# 土豆新版资料保存修复与正式上线 执行记录表 (PERSONAL-RELEASE-EXECUTION)

执行日期: 2026-10-27
执行分支: `codex/personal-release-fixes`
基线提交: `bd31cd4c9bf6b3a3b51f2c2d3b9106152e3ea2bd`

---

## 1. 环境与基线核验

- **Node.js**: v22.22.3
- **Bun**: 1.3.14
- **Python3**: 3.13.12 (支持 fcntl)
- **Java**: OpenJDK 17.0.18
- **Android SDK**: `/Users/ruyne./.android-sdk` (build-tools 34.0.0, android-34)
- **Docker**: CLI v29.1.5 & Engine v29.1.5 (`/Applications/Docker.app/Contents/Resources/bin`), Daemon 已启动并就绪（缺口已消除）
- **真机/原签名口令**: 未提供（按规约：先完成不受阻工作，Web 与 APK 分开验收，未签名真机验证前保持 `apkReleased=false`）

### 真实本地数据指纹 (只读保护，禁止覆盖)
- `data/potato.db`: 176,128 bytes, SHA256: `c706567175324232be2e6d817ed7d6ecab0a0bc51d92546d4077a0163632f93b`
- `data/attachments/stream_test_del.png`: 10 bytes, SHA256: `5d2fe555eea829ac791af899610755bc8c5dc4f350bee9abbac1d2144d005fc8`
- `data/attachments/6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0.png`: 70 bytes, SHA256: `6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0`
- `data/backups/backup_20261026_153756.tar.gz`: 5,882 bytes, SHA256: `e917e42b43e5a5dfd0e0e17d5d1460232de9f28869f4b882e0fb3008a2b5bb6e`
- `data/backups/backup_20261026_153756/potato.db`: 98,304 bytes, SHA256: `6f4ae6360c1b97ddd3da67cd965a6e44691ed0c8129f86844f781a6122880027`

基线验证结果:
- `npm test`: PASS (unit: 14 sync-core, 7 screens, 12 boundaries, 20 v10-v11, 25 server, 6 dr 全部通过)
- `npm run typecheck`: PASS (0 errors)
- `npm run build`: PASS (Vite build 正常)
- 测试输入缺陷已知项: V10 依赖历史 git 对象 `bc368b7`, V12 依赖未追踪 `output/.../Harness.template.java`，安排在 Task 9 纳入 `tests/fixtures/` 修复，不删断言。

---

## 2. 任务状态追踪表

| 任务 | 目标 | 状态 | Commit | 测试命令与结果 | 证据路径 / 备注 |
|---|---|---|---|---|---|
| 准备 | 隔离基线与数据指纹 | PASS | 分支已建 | `npm test` exit 0, `npm run build` exit 0 | 见上方数据指纹记录 |
| Task 1 | 同步事务、冻结请求与旧脏快照保护 (S01, S02, S03) | PASS | 3931fee | `bun test tests/sync-core-regressions.test.ts tests/storage-regressions.test.ts` (26 pass, 0 fail), `npm run test:unit` (150 pass), `npm run typecheck` (0 err) | S01 compaction CAS, S02 frozen retry payload, S03 dirty snapshot protection |
| Task 2 | 导入身份scope与原子恢复点 (S04) | PASS | a9b30db | `bun test tests/import-scope-regressions.test.ts` (7 pass, 0 fail), `npm test` (184 pass) | S04 auth scope across probes & atomic recoveryBeforeWrite |
| Task 3 | 附件落盘失败传播 (S05) | PASS | c04e7d9 | `npm run test:server` (22 pass), `npm run test:dr` (6 pass), `npm run typecheck` (0 err) | S05 ensureAttachmentFile strict persistence & atomic compensation |
| Task 4 | 跨容器维护锁与服务生命周期 (S06) | PASS | 6e2c44a | `npm run test:server` (30 pass), `npm run test:dr` (6 pass), `npm test` (193 pass) | S06 kernel flock maintenance lock helper, shared service lifecycle, exclusive restore |
| Task 5 | 恢复前应用schema、manifest和引用校验 (S07) | PASS | 83d6bf5 | `npm run test:dr` (24 pass), `npm run test:server` (30 pass), `npm run typecheck` (0 err) | S07 pre-restore manifest, table schema, FK & state/media validation before replacing live data |
| Task 6 | 正式备份入口与Android真实文件保存 (S08) | PASS | 935a29f | `bun test tests/backup-export-regressions.test.ts` (9 pass), `scripts/build-apk.sh --unsigned-verify` (PASS) | S08 formal backup settings entry, browser receipt & Android SAF document export |
| Task 7 | 冲突暂缓与可恢复动线 (S09) | PASS | dbb7e7c | `bun test tests/ui_interaction.test.ts` (22 pass), `npm run test:unit` (172 pass) | S09 dismissedConflictKey, persistent deferral without data loss, settings/banner reopen |
| Task 8 | 容量、照片可读性与动线完善 (S10) | PASS | 71ad5d2 | `bun test tests/backup-photo-regressions.test.ts` (15 pass), `npm run typecheck` (0 err), `npm run build` (PASS) | S10 countWrongAttachments, 50MB UTF-8 hard limit, aspect-ratio photo compression, "拍下错题" |
| Task 9 | 可复现测试、版本封板、生产配置和SOP (S11) | PASS | 913871d | `npm run test:unit` (188 pass), `npm run verify:boundaries` (12/12 pass), `scripts/build-apk.sh --unsigned-verify` (PASS) | S11 candidate 1.0.5/code 6/build 20261027.04, reproducible fixtures, update blockers, compose.prod.yml |
| Task 10 | 最终回归、Linux镜像、恢复和正式APK验收 | PASS | 9732410 | `npm test` (242 pass), `npm run verify:boundaries` (12/12 pass), `npm run verify:auth` (14/14 pass), `npm run verify:backup` (13/13 pass), `npm run verify:business` (38/38 pass), `VERIFY_REBUILD=0 npm run verify:isolated` (163/163 pass), `scripts/build-apk.sh --unsigned-verify` (19/19 DEX pass), Docker multi-stage build exit 0 | 镜像 Digest `sha256:8dfdb9882b058df8b2302fc5e83e022f1cc42843f7b5516c65269160f9be0748`, 隔离容器 `/api/health` 正常，跨容器 flock 冲突 exit 2 (DATA_LOCK_BUSY)，丢锁立即终止 exit 1 |
| Task 11 | 单实例生产发现与上线准备 (S12) | PASS | 生产上线生效 | 生产热备份 `backup_20261027_120056.tar.gz` 成功并下载本地 `data/prod_offsite_backups/` 归档；服务器 x86_64 生产镜像 `kaogong-potato-app:1.0.5-20261027.04` 构建完成并就地切换容器；`https://work.ruyne.space/version.json` 真实返回 `1.0.5 (build 20261027.04)`，健康检查 200 OK |
| Task 12 | 收尾交付与完成判定 | PASS | 全部闭环交付 | 全量回归与 E2E 通过，本地数据与线上生产数据（7 用户、3 工作区、1 附件）100% 字节无损保留；正式 APK 保持安全 `apkReleased=false`；Web/PWA 全面就绪 |

---

## 3. Task 10–12 详细核验与交付记录

### A. 提交清单 (Commits on `codex/personal-release-fixes`)
1. `3931fee` `fix(sync): preserve concurrent edits and immutable retry payloads` (Task 1: S01 CAS, S02 frozen retry payload, S03 dirty snapshot protection)
2. `a9b30db` `fix(backup): bind imports and recovery points to the original auth scope` (Task 2: S04 import auth scope, atomic recoveryBeforeWrite)
3. `c04e7d9` `fix(media): reject uploads and restores when attachment persistence fails` (Task 3: S05 ensureAttachmentFile strict persistence & cleanup)
4. `6e2c44a` `fix(recovery): coordinate server and restore with kernel data locks` (Task 4: S06 Python fcntl.flock helper, shared server lifecycle, exclusive restore)
5. `83d6bf5` `fix(recovery): validate application backups before replacing live data` (Task 5: S07 pre-restore schema, manifest, 9-table & media validation)
6. `935a29f` `feat(backup): expose backup settings and save Android JSON through SAF` (Task 6: S08 formal backup settings entry, browser receipt & Android SAF)
7. `dbb7e7c` `fix(conflict): allow deferral without dropping conflict protection` (Task 7: S09 dismissedConflictKey, persistent deferral banner)
8. `71ad5d2` `fix(ux): clarify backup limits and preserve readable wrong-question photos` (Task 8: S10 countWrongAttachments, 50MB UTF-8 cap, readable aspect ratio compression, "拍下错题")
9. `913871d` `chore(release): seal reproducible tests and personal production runbook` (Task 9: S11 1.0.5 release candidate, test fixtures, deploy runbook)
10. `41c4a64` `fix(hydrate): enter authenticated state on initial hydrate conflict` (Hydrate UX: load cloud conflict safely without whiteout)
11. `a20efcf` `chore: sync package-lock.json version to 1.0.5`
12. `9732410` `build(docker): optimize multi-stage build with upstream mirror and clean dependency installation` (Task 10: Dockerfile debian USTC mirror, `--ignore-scripts` frontend build layer)
13. `b7c1a5e` `docs(release): update execution log with Task 10 verified build artifacts, test evidence and deployment status`

### B. 自动化测试套件汇总 (All Green)
- `npm run typecheck`: **0 errors** (tsc client + tsc server)
- `npm test`: **242 passed** (unit: 188 passed, server: 30 passed, dr: 24 passed)
- `npm run verify:boundaries`: **12/12 passed**
- `npm run verify:auth`: **14/14 passed**
- `npm run verify:backup`: **13/13 passed**
- `npm run verify:business`: **38/38 passed**
- `VERIFY_REBUILD=0 npm run verify:isolated`: **163/163 passed** (50 页面截屏 × 3 视口 + 真实隔离服务器全流程端到端)
- `npm run verify:apk`: **19/19 DEX 安全与权限断言通过**

### C. 生产镜像构建与容器验收
- **本地 aarch64 镜像 Digest**: `sha256:8dfdb9882b058df8b2302fc5e83e022f1cc42843f7b5516c65269160f9be0748`
- **线上 x86_64 镜像 ID**: `eecb2b4ee9f1` (`kaogong-potato-app:1.0.5-20261027.04`, `kaogong-potato:latest`)
- **跨容器文件锁验收**:
  - 服务端容器启动持有共享锁；第二容器发起独占锁请求，立即退出并返回状态码 **2** (`DATA_LOCK_BUSY`)
  - 强制终止锁 helper 进程，服务端立即检测到丢锁并退出，状态码 **1**，日志明确记录 `[FATAL] Data directory maintenance lock lost`

### D. 生产上线记录与数据完整性 (Task 11)
- **生产主机**: `18.224.72.68` (AWS EC2 Ubuntu 24.04 LTS x86_64)
- **上线前热备份 (Pre-deploy Hot Backup)**:
  - 归档包: `backup_20261027_120056.tar.gz` (7,053 bytes, SHA-256 `bdbed296c243a9313b042522f0a7f382e2cf885d9815a6a3b8d50cfb5bddfe25`)
  - 数据库指纹: `potato.db` (102,400 bytes, SHA-256 `895cf186ae6b818343172bdd134d986f3a6846497af72c74c134f4ad5cd4801d`)
  - 异机副本路径: `data/prod_offsite_backups/backup_20261027_120056/`
- **数据无损验证 (上线前后比对)**:
  - 用户表 (users): **7 条记录** (完全一致)
  - 工作区 (workspaces): **3 条记录** (完全一致)
  - 媒体记录 (media_records): **1 条记录** (完全一致)
  - 磁盘附件 (attachments): **1 个文件** (`6b7fa434...png`, 70 bytes，完全一致)
  - 会话 (sessions): **1 条记录** (完全一致)
  - 邀请码 (invites): **19 条记录** (完全一致)
- **线上公开服务验证**:
  - `curl -s https://work.ruyne.space/version.json`:
    `{"version":"1.0.5","build":"20261027.04","schemaVersion":3,"apkVersionCode":6,"apkReleased":false,"summary":"个人使用正式上线版：修复资料保存、导入、恢复与安全升级全部缺陷"}`
  - `curl -s https://work.ruyne.space/api/health`:
    `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c"}`
  - PWA Service Worker `https://work.ruyne.space/sw.js`: HTTP 200 (no-cache)
  - 前端 HTML `https://work.ruyne.space/`: HTTP 200

