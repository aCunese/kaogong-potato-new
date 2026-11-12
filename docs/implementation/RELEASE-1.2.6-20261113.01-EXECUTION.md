# Release 1.2.6-20261113.01 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261113.01`
- **Commit**: `bc34e8814c9c548b11dea29f2cfd256dd4d91207`
- **Executed At**: 2026-11-12 19:48:31 UTC (2026-11-13 03:48:31 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对同步成功后状态机被后续独立 if-else 分支误置为 failed 导致界面一直显示「正在重试」与红色「全部学情与照片已保存到服务器」、邮件提醒服务在生产容器缺失环境变量显示未启用、以及新版本升级弹窗打扰用户等问题，完成最小范围精准修复、补齐单测、安全构建并无损发布上线：

1. **同步状态机判定与文案收敛（Sync State Machine & UI Polish）**：
   - `src/context/AppContext.tsx`：
     - 修复 `triggerSync` 中 `result.status === 'synced'` 成功后未以 `else if` 链接后续分支，导致同步成功后必然穿透落入末尾 `else` 执行 `setSyncStatus('failed')` 并将 `syncMessage` 设为 `全部学情与照片已保存到服务器` 的重大缺陷；
     - 同步成功后将 `syncStatus` 确立为 `synced`，并将 `syncMessage` 设为 `null`；在初始加载 `hydrate.status === 'synced'` 时同样设为 `null`。
   - `src/components/views/SettingsView.tsx`：
     - 在状态徽章下方，防御性屏蔽 `全部学情与照片已保存到服务器` 的冗余报警文本，确保状态为绿色徽章（已同步）时不展示多余的提示信息；
     - 在手动触发同步成功时，不弹出冗余 toast，践行「同步状态只要是绿色那就默认同步了不用提醒用户」。

2. **邮件提醒服务环境变量注入与降级保障（Email Service Environment & Defense-in-Depth）**：
   - `server/index.ts`：
     - 在服务启动流程中增加轻量级运行时配置覆盖加载器：若检测到 `data/.env.runtime` 存在，自动将持久化卷中配置的 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`、`EMAIL_CODE_SECRET` 注入 `process.env`，提供多层防御保障；
   - `scripts/package-release-1.2.6-20261113.01.py`：
     - 在部署切换脚本 `switch-release.py` 中，读取宿主机 `/home/ubuntu/kaogong-app/.env.runtime` 并合并注入容器运行时 `runtime.private.env`，彻底解决旧容器未带入 SMTP 环境变量导致的邮件服务不可用（503 `EMAIL_UNAVAILABLE`）缺陷。

3. **平滑静默更新（Silent Auto-Update）**：
   - `src/context/AppContext.tsx`：
     - `checkForUpdate` 发现新版本时，不再弹出顶部更新横幅（`setUpdateInfo(null)`），而是在具备安全防护条件（`updateGuard().ok`）下于后台静默调用 `applyWebUpdate` 向 waiting service worker 发送 `SKIP_WAITING`；
     - 在用户登录及身份恢复链路中（`login`），自动检查并激活等待中的 Service Worker，确保「这次更新不用提醒用户，用户下次登录进去就自动更新了」。

4. **版本发布与测试回归**：
   - 升级版本至 `1.2.6-20261113.01`，同步更新 `public/version.json`、`release.json`、`public/sw.js`；
   - 补齐 `SettingsView` 状态渲染单测与服务端运行时环境变量加载器单测，全部通过。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit (无损发布验证)
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261112_194456.tar.gz`
  - Archive SHA256: `20200203b4989134e113e92205fdd5eb4d6993033cef20343011b3f79a65718f`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261112_194819.tar.gz`
  - Archive SHA256: `742eb79d41ed1a635df35c44799619a86e6b58dd02916041a5dfb18439edb639`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities (零数据丢失验证):
    - `users`: 10, `workspaces`: 6, `media_records`: 120, `sessions`: 8, `workspace_history`: 888, `invites`: 24
    - `books`: 48, `courses`: 32, `plans`: 238, `records`: 238, `wrong`: 70, `todos`: 10, `timerSessions`: 5
    - `attachments`: 120（`missing: 0`, `mismatched: 0`）
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261113.01`
- **Image ID**: `sha256:969b117c45fe43b04595923a631c4adcb009a4fbc11eab3285264377859b14f3`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261112.04`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261113.01`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
- `https://work.ruyne.space/sw.js`:
  - HTTP 200, `RELEASE_BUILD = '20261113.01'`
- `docker inspect kaogong-potato-app` Env Check:
  - `SMTP_HOST=smtp.qq.com`, `SMTP_PORT=465`, `SMTP_USER=946265043@qq.com` present and verified
- `createAccountEmailService.status`:
  - `available: true` verified inside production container.
