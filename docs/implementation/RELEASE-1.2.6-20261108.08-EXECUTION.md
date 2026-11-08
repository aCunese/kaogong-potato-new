# Release 1.2.6-20261108.08 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.08`
- **Commit**: `0e3c35de7de9f4f422617d07760aa95d164554b2`
- **Executed At**: 2026-11-08 08:24:43 UTC (2026-11-08 16:24:43 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & Fix Verification

### 1.1 前次修复缺陷审查与彻底重构
1. **前次尝试缺陷剖析**:
   - 前次实现中为研友胶囊硬编码了 `min-w-[200px]`，但移动端在 `max-w-md` (448px) 与 `px-4` 内边距约束下，实际视口内容宽度仅 328px ~ 358px。当右侧 3 个操作按钮占据 ~230px 时，200px + 230px = 430px > 358px，强制导致顶部栏在绝大多数 iPhone / Android 真机上**100% 永久折为两行**。
   - 顶部折为两行时，右侧按钮组因 `ml-auto` 产生不对称悬挂（左侧大面积空白，右侧局促挤压在屏幕边缘）。
   - 胶囊内部文案存在三重状态指示重叠：绿点、`🟢 正在专注《...》` 与角标 `🟢 专注中`，信息冗余累赘。
   - Tailwind 样式中使用了不存在的类名 `shadow-2xs`、`backdrop-blur-xs` 与 `z-60`，导致阴影、模糊滤镜缺失，图片预览浮层未生效 `z-[60]`。
   - 便签长文折叠处未设置 `break-words`，极端长无空格字符串（如 URL）存在横向溢出风险。
2. **本次改进措施**:
   - **弹性自适应宽带与防挤压重合**:
     - 研友状态胶囊重构为 `flex-1 min-w-[120px] sm:min-w-[160px] overflow-hidden`，在 iPhone 12/13/14/15 (390px) 标准视口下支持优雅单行并排；在小于 360px 或极端窄屏下优雅折行。
     - 内部采用 `flex-1 min-w-0 overflow-hidden` + `truncate` 边界，无论外部容器被挤压到何种尺寸，内部昵称与状态标题严格依视口截断，与右侧角标有固定间距，在 CSS 盒模型层面杜绝任何文字重叠。
     - 移除实时标题中的冗余 `🟢`，保持左侧脉冲绿点 + 昵称 + 标题 + 右侧专注角标的清晰视觉层次。
     - 操作按钮组各按钮设置 `whitespace-nowrap`，文字绝对不纵向断行。
   - **Tailwind 基础设施修复**:
     - `tailwind.config.js` 扩展 `boxShadow` 的 `'2xs'` 与 `'xs'` 规范，使微阴影生效。
     - 便签箱图片预览修复为 `z-[60]` 与 `backdrop-blur-sm`，确保大图预览层级高于 `Modal` 的 `z-50`。
   - **便签箱方案 1 深度加固**:
     - 便签文本添加 `whitespace-pre-wrap break-words`，支持长网址与连续字符安全自动折行。
     - 保持 55vh 定高列表容器限制、超过 70 字/3 行自动折叠 `line-clamp-3` 与展开/收起切换、分页加载与全部加载提示。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_082257.tar.gz`
  - Archive SHA256: `e7c538a14c14f08de2706f714481e79a5e6639c69b6883006c4dfd7cfe72831c`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_082437.tar.gz`
  - Archive SHA256: `7abc90cb1f4185b03a367b7a645a54c488a778d8ec36da6b854fc9bb8e19f991`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 88
    - `sessions`: 8
    - `workspace_history`: 722
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 149, `records`: 149, `wrong`: 54, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.08`
- **Image ID**: `sha256:91eeb40128e0841aa80b1858721b7678a616844a94ea6f7ce47e0f3174a70d5b`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.07`

### 2.3 Public Endpoint Verification
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.08","deployedAt":"2026-11-08T08:18:00Z",...}`
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c",...}`
