# Release 1.2.6-20261108.05 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.05`
- **Commit**: `4b66cfdfbaef39e7d67491a6f97ced6ae3676954`
- **Executed At**: 2026-11-08 06:03:16 UTC (2026-11-08 14:03:16 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & 5 Reported Issues Verification

### 1.1 问题一：首页便签上滑收起后重新进页面复现、便签箱入口缺失、头像与昵称不准确
1. **根本原因**:
   - `TodayView.tsx` 中上滑收起（`dismissBanner`）此前延后 250ms 写入 localStorage，如果用户快速切页或刷新，异步写入未完成便会丢失。
   - `isNoteDismissed` 判定键只记录单键，未能多维度隔离游客与已登录用户（`guest` vs `uid`）。
   - 缺少查看往期便签与今日便签的专门收件箱（便签箱）入口。
   - 头像固定写死或未跟随好友最新的 `profile.avatar` 动态更新，便签展示名不支持自定义研友备注。
2. **修复措施**:
   - `dismissBanner` 改为物理同步原子写入 localStorage（多阶 key：`kaogong_dismissed_note_${uid}_${noteId}` 与通用 key），上滑瞬间即刻持久化。
   - 新增独立组件 `CompanionNotesHistoryModal.tsx`（「研友便签回忆箱」），支持「今日便签」与「往常便签回忆」双 Tab 浏览。
   - 首页 Header 新增「便签箱」快捷入口，若当前最新便签已收起，提供微小提示胶囊「展开便签」和「便签箱」。
   - 在便签箱中支持「置顶展示」（点击可直接将往期或今日某张便签重新固定到首页顶部 Banner 持续鼓励），同时支持「回赠爱心」与「我也回一张」。
   - 服务端 `server/sharing.ts` 的 `listCompanionNotes` 动态关联各用户的最新 `workspaces.state_json` 提取头像，前端统一接入 `getCompanionDisplayName(note.fromUserId, note.fromNickname)` 提取自定义备注名。
   - 在 `CompanionNoteDetailModal.tsx` 中支持在查看便签大卡片时直接点击铅笔图标编辑研友备注名。

### 1.2 问题二：伙伴列表卡片排版不规整与错位
1. **根本原因**:
   - `SharingModal.tsx` 中伙伴卡片的操作按钮根据对方状态动态展示不同宽度和行数，导致卡片高度参差不齐、按钮在不同分辨率手机下不对齐。
2. **修复措施**:
   - 重新规范化伙伴卡片网格布局，标准化为 3 列等宽栅格 `grid-cols-3 gap-2`：
     - `[学情]`：查看今日学习统计与历史折线。
     - `[贴便签]`：直接打开便签发送弹窗。
     - `[⚡️ 戳一戳 / 专注中]`：状态感知主操作按钮。
   - 状态胶囊统一为规整的设计语言：
     - 🟢 正在专注《...》
     - 👏 今日任务已打卡完成
     - 🟠 约定时间未学（高亮强调）
     - 约定时间学习 · 今日尚未开始
   - 在 Compact (360x800)、iPhone (393x873)、Pixel (412x915) 三种主流视口比例下均实现严密规整对齐。

### 1.3 问题三：约定学习时间界面优化与自定义时间支持
1. **根本原因**:
   - 原有的时间选择只有几个固定选项，缺少快捷预设与任意时间精细自定义。
2. **修复措施**:
   - 在「我的」->「学习伙伴」抽屉中重构约定时间设置卡片：
     - 提供 5 个典型考公时段快捷胶囊：`08:30` (晨间行测)、`10:00` (上午刷题)、`14:00` (午后申论)、`19:30` (晚间巩固)、`21:00` (考前自查)。
     - 增加「自定义」时间切换按钮，点击展开原生时间选择器 `<input type="time" />`，支持精确到分钟的任意个性化时间配置。
     - 自动同步至服务端伙伴设置数据库，实时更新对伙伴的催学判断时限。

### 1.4 问题四：正在学习时禁止戳一戳，未学习时随时可戳
1. **根本原因**:
   - 原先逻辑限制仅在“超时未学”时才允许戳，且研友正在番茄钟专注时仍能点击，导致打扰研友学习。
2. **修复措施**:
   - **严格免打扰保护**: 当伙伴处于专注中（`state === 'focusing'`）时：
     - 前端按钮强制置灰禁用，文案显示 `专注中`，悬浮或点击提示 `研友正在专注学习中，请勿打扰~`。
     - 服务端 `server/sharing.ts` 的 `pokeCompanion` 执行前置硬断言，若研友当前状态为 `focusing`，直接抛出 `400 PARTNER_FOCUSING` 拒绝打扰。
   - **灵活关怀催学**: 当伙伴未在学习中时，不再死板限制必须超过约定时间，研友随时可以看情况发起关怀提醒（仅保留 30 分钟防骚扰冷却机制）。

### 1.5 问题五：邮件内容自定义、快捷词条与C版小猫督学封套
1. **根本原因**:
   - 催学邮件原先为固定单调模版，缺少个性化留言与灵活备考自查要点。
2. **修复措施**:
   - **自定义督学弹窗**: 引入 `PokeCustomModal.tsx`：
     - 自定义督学寄语输入框，附带字数限制与 5 条考公真实快捷短语（如“说好一起上岸，快回书桌前！”、“抓紧回桌前学 25 分钟！”）。
     - 「今日自查 (BEFORE YOU START)」要点自由编辑区，支持动态新增、删除、编号（01, 02）自查项，并提供 4 个高频科目自查芯片（行测言语、资料分析、申论结构、常识速记）。
   - **C版小猫督学封套 (`final_C`)**:
     - 基于用户提供的 `/Users/ruyne./Downloads/邮箱封面设计.zip` 中 `final_C` 模板全面升级 `server/pokeEmailTemplate.ts`。
     - 包含红白督学印章、小猫拍桌催学主图、猫爪暗印、爪印足迹、25分钟番茄钟指引、高质感行动按钮、以及底部备考格言与趴睡小猫。
     - 邮件静态图片资源安全落盘至 `public/assets/email/`，生产由 Nginx/Node 静态托管并在邮件中自适应引用。

---

## 2. Release Verification Evidence

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_060105.tar.gz`
  - Archive SHA256: `b26a1b5496a03a0ce1b721663c11318341944434c4ddadfe45d5327583d1b356`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_060308.tar.gz`
  - Archive SHA256: `c422354df65897a67c2b6e8e46d7a5bd1a1b1b3b31585db5fea75daa6c5a86e3`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 87
    - `sessions`: 8
    - `workspace_history`: 726
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 149, `records`: 149, `wrong`: 53, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.05`
- **Image ID**: `sha256:2d632a3d9fdead67ac8ba244dce9a22beac00d718cb11c6d0bb1dcb556a4666a`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.04`

### 2.3 Public Endpoint Verification
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.05","servedAt":"2026-11-08T06:03:32.842Z"}`
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c"}`
- `https://work.ruyne.space/assets/email/cat_poke.png`:
  `HTTP/2 200 OK`, `content-type: image/png`, `content-length: 28261`
