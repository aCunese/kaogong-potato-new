# Release 1.2.6-20261108.03 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.03`
- **Commit**: `b834560c3f6e45cf4b7e096ee5138d80e23a95d8`
- **Executed At**: 2026-11-07 17:11:46 UTC (2026-11-08 01:11:46 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & Root Cause

### 1.1 Why the Previous Test Email Was Not Found (无法收到 / 进垃圾箱或被拦截)
1. **未认证直投被拒（Direct MX Port 25）**:
   最早的测试脚本（`scripts/send-poke-email.py`）直接向腾讯 MX 服务器 `mx1.qq.com:25` 发起未认证发信，发件人声明为虚构的 `service@potato.study`。该域名未配置 SPF/DKIM，发信 IP 属于公有云动态 IP 段，触发了腾讯邮箱反垃圾邮件系统（T-Spam）最高拦截评级，被判定为伪造冒名邮件直接丢弃或进入深度拦截隔离区，导致收件箱和常规垃圾箱均无法找到。
2. **前次修复的缺陷与盲区**:
   - **硬编码明文密码泄露风险**: 前次提交在 `scripts/send-poke-email.py` 中将 QQ 邮箱授权码硬编码写入代码并提交入库，违反了生产安全规范。现已彻底移除硬编码，使用本地 gitignored 的 `.env.smtp.local` / 容器环境变量加载。
   - **邮件主题与正文含敏感催促拦截词**: 邮件标题中仍包含 `⚡️` 警报 Emoji 以及 `夺命连环催学提醒` 等强营销催促敏感词汇，容易被邮件服务商的智能文本分类器判为垃圾邮件或骚扰邮件。现已规范为高信誉度的品牌标准前缀 `【土豆考公】你的研友「...」提醒你回书桌前学习打卡啦 🥔`。
   - **`Auto-Submitted: auto-generated` 信头导致邮件降权**: RFC 3834 规定 `Auto-Submitted: auto-generated` 仅用于自动化守护进程（如自动退信、Cron 批量报表）。在主流邮件客户端（iOS Mail、Outlook、QQ 邮箱智能收件箱）中，该信头会阻止向用户手机发送通知推送，甚至将邮件降级到“订阅”或次级文件夹。现已移除该信头，保留规范的 `X-Auto-Response-Suppress: All` 与 `X-Mailer`。
   - **未核验用户实际收件箱状态**: 前次工人仅依据 SMTP 250 回执推测邮件已送达，未能登录收件箱实际验证。本次使用真实的官方 IMAP SSL 连接对目标邮箱 `946265043@qq.com` 进行了物理验证，证实邮件直接进入收件箱 `INBOX`（最新序号 `835`），垃圾箱未产生任何拦截（垃圾邮件数保持 3 封不变）。

---

## 2. Solutions & Architecture Hardening

1. **凭证隔离与安全防护**:
   - 将真实 SMTP 凭证抽离至本地 `.env.smtp.local`（已由 `.gitignore` 的 `.env.*` 严格忽略），杜绝密钥泄露风险。
   - 脚本 `scripts/send-poke-email.py` 严格校验凭证完整性，缺失时友好报错退出。
2. **反垃圾与信誉评级优化**:
   - 邮件主题精细调整为：`【土豆考公】你的研友「...」提醒你回书桌前学习打卡啦 🥔`，正文与卡片均使用正面鼓励打卡用语，去除“夺命连环催”等敏感词。
   - 移除 `Auto-Submitted: auto-generated`，避免客户端弹窗静默或智能分类下沉。
   - 保留规范的反退信信头 `X-Auto-Response-Suppress: All`，发件人展示名 `"土豆考公" <946265043@qq.com>`，以及规范 Message-ID。
3. **真实端到端 IMAP 投递核验**:
   - 经由生产容器直接发信实测，成功向目标邮箱 `946265043@qq.com` 发送最新规范邮件。
   - 通过 IMAP 检索收件箱最新邮件（Message-ID: `<tencent_...>`, X-OQ-MSGID: `<prod-test-poke-1.2.6-20261108.03@qq.com>`），证实邮件实时投递至 `INBOX`，无任何拦截或丢弃。

---

## 3. Release Verification Evidence

### 3.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261107_171001.tar.gz`
  - Archive SHA256: `a811a5a00ef1654efa078676a7cb8e260ebb15f9e961f0d5c8c842663d89ae91`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261107_171140.tar.gz`
  - Archive SHA256: `0bddecfea7509668adb6ac5484ecab16949419c57181178e89cade2e4e8ea505`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 87
    - `sessions`: 8
    - `workspace_history`: 719
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 147, `records`: 147, `wrong`: 53, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 3.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.03`
- **Image ID**: `sha256:69344ae79ae7b61bec19005723f3bf602ec20ab19695578807b4b9457707105c`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.02`

### 3.3 Public Endpoint Verification
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c"}`
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.03","deployedAt":"2026-11-07T17:05:00Z"}`
- `https://work.ruyne.space/sw.js`:
  `RELEASE_VERSION = '1.2.6'`, `RELEASE_BUILD = '20261108.03'`
