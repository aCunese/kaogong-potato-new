# Release 1.2.6-20261108.01 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.01`
- **Commit**: `81c1894c14c0cab01d15d9e20495cbf8af15eebf`
- **Executed At**: 2026-11-07 16:26:25 UTC (2026-11-08 00:26:25 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Release Scope & Features

1. **学习伙伴实时学情感知（极简轻量级陪伴）**:
   - 在「我的」->「学习伙伴」卡片中实时展示学情。
   - 正在专注时保持极简（移除送能量按钮，专心不打扰）。
   - 约定时间超时未学时高亮显示「⚡️ 戳一下」。

2. **一键催学拍一拍与邮件督学**:
   - 点击「⚡️ 戳一下」向对方绑定邮箱投递高质感考公督学 HTML 邮件。
   - 内置 30 分钟防骚扰频率控制与防注入转义（CRLF、HTML）。
   - 邮件实测通过直投测试送达 `946265043@qq.com`（腾讯 MX 返回 `250 OK`）。

3. **首页打气便签（Floating Banner + 自定义表情包）**:
   - 悬浮在「今日」工作台顶部，支持手势上滑（Swipe Up）顺畅收起，点击弹开全屏沉浸大卡片。
   - 发送便签支持本地相册上传图片表情包（前端高质量图片等比压缩至 DataURL）。
   - 支持已读、消除手势记忆与跨用户安全隔离。

---

## 2. Release Verification Evidence

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261107_162313.tar.gz`
  - Database: `potato.db` (30,191,616 bytes)
  - Attachments verified: 87 / 87 (0 missing, 0 mismatched)
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261107_162618.tar.gz`
  - Archive SHA256: `765c2c359783f05c6a5acfb5354d2390ecc029d638a7d59248536fd68367406e`
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

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.01`
- **Image ID**: `sha256:db7f1d81b360ee5976a1555db7f07b8474de554fb5242de15d10cc9b39edba13`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261107.04`

### 2.3 Public Endpoint Verification
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c"}`
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.01","deployedAt":"2026-11-07T16:05:00Z"}`
- `https://work.ruyne.space/sw.js`:
  `RELEASE_VERSION = '1.2.6'`, `RELEASE_BUILD = '20261108.01'`
