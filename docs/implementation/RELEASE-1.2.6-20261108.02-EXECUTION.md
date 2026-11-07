# Release 1.2.6-20261108.02 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.02`
- **Commit**: `6e2f37625ba6586fe2915bd10431d89406079688`
- **Executed At**: 2026-11-07 16:47:49 UTC (2026-11-08 00:47:49 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & Root Cause

### 1.1 Why the Previous Test Email Was Not Found (无法收到 / 进垃圾箱或被拦截)
1. **未认证直投被拒（Direct MX Port 25）**:
   前次测试脚本（`scripts/send-poke-email.py`）直接向腾讯 MX 服务器 `mx1.qq.com:25` 发起未认证发信，发件人声明为虚构的 `service@potato.study`。该域名未配置 SPF/DKIM，发信 IP 属于公有云动态 IP 段，触发了腾讯邮箱反垃圾邮件系统（T-Spam）最高拦截评级，被判定为伪造冒名邮件直接丢弃或进入深度拦截隔离区，导致收件箱和常规垃圾箱均无法找到。
2. **消息信头与域名规范不达标**:
   `server/sharing.ts`、`server/reminders.ts` 原生生成的 Message-ID 使用了 `.local` 后缀（如 `<nudge-xxx@potato.local>`），违反 RFC 5322 规定，触发 SpamAssassin 的 `LOCALPART_IN_MSGID` 规则增加垃圾邮件分值。
3. **发件人展示名缺失**:
   原 `mailTransport.ts` 发信仅使用纯邮箱地址，缺乏符合 RFC 2047 规范的展示名格式（`"土豆考公" <946265043@qq.com>`），容易被邮件客户端降级处理。
4. **链接回退本地 localhost**:
   生产环境变量未显式注入 `PUBLIC_URL` 时，邮件跳转链接降级为 `http://localhost:5174` 或 `example.com`，邮件内包含死链/回环地址加重了反垃圾引擎判定。

---

## 2. Solutions & Architecture Hardening

1. **全面升级官方认证 SMTP SSL 发信通道**:
   - 正式切换至腾讯官方发信网关 `smtp.qq.com:465` (SSL)。
   - 使用经过授权绑定的发件账号密码认证登录，严格保证发信 IP 与 SPF 域名 `spf.mail.qq.com` 吻合，信誉评级最高。
2. **补齐 RFC 反垃圾信头与规范化 Message-ID**:
   - 发件人格式化为 `="土豆考公" <${from}>`。
   - 自动归一化 Message-ID 域名为发件邮箱所属域名（如 `@qq.com`）。
   - 注入自动化事务性通知信头：
     - `Auto-Submitted: auto-generated`
     - `X-Auto-Response-Suppress: All`
     - `X-Mailer: Potato-Study-Workspace`
     - `Reply-To: ${from}`
3. **文案与设计优化**:
   - 邮件主题精细优化为：`⚡️【土豆考公】你的研友「...」向你发来了一记夺命连环催学提醒！`，明确学习提醒属性。
   - 邮件 CTA 按钮与跳转链接统一指向生产真实域名：`https://work.ruyne.space`。
   - 附带纯文本版本（Plain Text）与富文本（HTML）双内容（Multipart/Alternative），符合反垃圾排版规范。
4. **实测投递校验**:
   - 已使用生产容器内部环境成功向 `946265043@qq.com` 投递测试邮件与催学模板邮件，腾讯 SMTP 均返回 `250 OK`。

---

## 3. Release Verification Evidence

### 3.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261107_164558.tar.gz`
  - Database: `potato.db` (30,191,616 bytes)
  - Attachments verified: 87 / 87 (0 missing, 0 mismatched)
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261107_164743.tar.gz`
  - Archive SHA256: `d7c3d6046a20ee82279a767bf35429395dd14fddaae18fd61ade8b632c947779`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 87
    - `sessions`: 8
    - `workspace_history`: 718
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 147, `records`: 147, `wrong`: 53, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 3.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.02`
- **Image ID**: `sha256:7bc7d9fa2c1a67254e1088b28b883dab3445f5d81d13e9a1603f509456eff165`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.01`

### 3.3 Public Endpoint Verification
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c"}`
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.02","deployedAt":"2026-11-07T16:45:00Z"}`
- `https://work.ruyne.space/sw.js`:
  `RELEASE_VERSION = '1.2.6'`, `RELEASE_BUILD = '20261108.02'`
