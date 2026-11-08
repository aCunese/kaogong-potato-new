# Release 1.2.6-20261108.10 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.10`
- **Commit**: `7c037951b47c8364696a241cc6b497201bc991e5`
- **Executed At**: 2026-11-08 09:29:05 UTC (2026-11-08 17:29:05 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & Fix Verification

### 1.1 需求 1：首页研友呼吸灯与学情详情交互深入修复
1. **根本原因**:
   - 上一轮尝试在指示器上仅为外圈挂载 `animate-ping`，核心圆点完全静止，缺乏呼吸灯特有的明暗起伏呼吸感（pulse）；
   - 学情浮层误用了未配置的无效样式类（`xs:w-[320px]` 与未安装插件的 `animate-in fade-in zoom-in-95`），导致动画完全失效且非标准响应式断点被浏览器忽略；
   - 浮层卡片拦截了冒泡点击，在专注模式下卡片内部无操作按钮，用户在移动端点击卡片本身无法收起，交互体验生硬。
2. **修复措施**:
   - **真实呼吸灯动效**:
     - 结合外圈扩散环 `animate-ping` 与内圈核心点 `animate-pulse`，实现真正有呼吸节奏的绿光（学习中）与黄光（未学习）呼吸指示器；
   - **像素级对齐图 3 规范与轻量弹层动效**:
     - 增加原生关键帧 `@keyframes popIn` 与 `.animate-pop-in`，实现 160ms 极轻平滑弹入动画；
     - 徽标使用 `rounded-full` 圆角胶囊严格还原图 3 实心 `[ ● 专注中 ]` 徽标；
     - 浮层支持点击自身或点击遮罩随时收起，收放自如。

### 1.2 需求 2：便签草稿与大图发送多重校验修复
1. **修复措施**:
   - 修复 `loadCompanionNoteDraft` 中仅同时存在 `recipientId` 与 `grantId` 才做 fallback 的漏洞，增加独立 `grantId` 或 `recipientId` 的备选索引查找；
   - 清空内容与图片时自动重置 `hasDraftRestored` 提示，避免空输入状态下仍然显示已恢复提示。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_092316.tar.gz`
  - Archive SHA256: `43d6e89bd65e3d7470acc7704e6361305ce6e74894a51ac0258706cc50cedff3`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_092854.tar.gz`
  - Archive SHA256: `0f3d9c7064d5376750284a7ca380e0321313cb7c3b942969d2bb288a4d43f07c`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 88
    - `sessions`: 8
    - `workspace_history`: 719
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 150, `records`: 151, `wrong`: 54, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.10`
- **Image ID**: `sha256:17713b2862931aed6112c143ef2ce44d67eac47c7cb5dfe948f84d9f5b4d02b5`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.09`

### 2.3 Public Endpoint Verification
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.10","deployedAt":"2026-11-08T09:20:00Z",...}`
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c",...}`
