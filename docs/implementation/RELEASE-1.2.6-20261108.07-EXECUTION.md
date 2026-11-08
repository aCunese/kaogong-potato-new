# Release 1.2.6-20261108.07 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.07`
- **Commit**: `1b5761fcc550e1e6142e1659732683fddfa08073`
- **Executed At**: 2026-11-08 07:52:23 UTC (2026-11-08 15:52:23 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & Fix Verification

### 1.1 需求 1：首页顶部最左侧研友状态胶囊与便签箱操作组排版重叠、挤压截断问题彻底修复
1. **根本原因**:
   - `TodayView.tsx` 中顶部研友状态胶囊栏与右侧操作按钮组（「便签箱」、「写便签」、以及收起浮层后展示的「展开便签」）置于同一个 `flex items-center justify-between` 容器中。
   - 在移动端小屏幕（如 360px ~ 393px 视口）且同时存在 3 个操作按钮时，右侧按钮组占据约 230px，导致左侧研友状态胶囊被极致挤压至仅 60px ~ 90px。
   - 研友状态胶囊内部的研友昵称带 `shrink-0`，右侧状态角标「专注中」（`bg-cream/80` 带有半透明）同样带 `shrink-0`，在空间不足且父容器使用 `justify-between` 时，两层元素直接发生物理叠合，底层文字透过半透明角标透出，造成严重视觉重影与乱码错位（如截图所示的「🟢 专注中」与研友名字重合）。
2. **修复措施**:
   - **响应式弹性换行布局**: 顶层容器升级为 `flex flex-wrap items-center justify-between gap-2 px-0.5 mb-1`。
   - **胶囊最小宽度保护与防止溢出**:
     - 研友状态胶囊设定 `flex-1 min-w-[200px] sm:min-w-[240px] overflow-hidden`，在移动端屏幕宽度不足时自动下沉按钮组或自适应占满整行，确保胶囊内文字永远拥有充裕展示空间。
     - 研友昵称设置 `truncate max-w-[80px] sm:max-w-[120px] shrink-0`；实时专注标题设置 `truncate min-w-0 flex-1`，超长学习标题优雅使用省略号，绝对不被挤压变形。
     - 专注中徽标改用实心高辨识度材质 `bg-emerald-50 text-emerald-700 border border-emerald-200/80`，彻底杜绝半透明透字重叠。
     - 操作按钮组设置 `ml-auto`，折行时靠右整齐排列，整体排版在 320px、360px、390px、412px 及桌面宽屏下均优雅协调。

### 1.2 需求 2：打气便签箱（CompanionNotesHistoryModal）便签过多防上下滚动过长（方案 1）
1. **根本原因**:
   - 便签箱弹窗未针对超长留言与大量便签进行分页与长文折叠，当便签内容较多或留言达到数百字时，弹窗纵向滚动条极长，阅读与交互体验不佳。
2. **修复措施（落实用户选定方案 1）**:
   - **定高容器限制**: 便签列表容器严格限制在 `max-h-[55vh] overflow-y-auto pr-0.5`，确保手机屏幕上弹窗不会顶天立地，留出舒适的视口上下留白。
   - **长文便签折叠**:
     - 引入 `expandedNoteIds` 状态，当便签内容字数超过 70 字或超过 3 行时，默认通过 `line-clamp-3` 折叠。
     - 卡片右下方提供轻量交互开关「展开全文 ▼」与「收起全文 ▲」，用户可按需逐张展开或收起长文，避免长篇大论撑爆卡片。
   - **分页与加载更早便签**:
     - 默认每页展示 5 条便签（`PAGE_SIZE = 5`），按时间倒序排列。
     - 若当前分类下便签数量超过当前展示条数，列表底部自动呈现「加载更早便签 (剩余 N 条)」按钮，点击即追加展示下一页。
     - 全部加载完毕后展示温情提示「已展示全部 N 条便签 🥔」。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_075015.tar.gz`
  - Archive SHA256: `0adca9b4a15ef5ebb6393a245d362ee252f7a4ec29b25556bc533f8db4eb6e9e`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_075217.tar.gz`
  - Archive SHA256: `ce69b1f6180f3567edb8ee20a40380900e32ef71eb43f4d2df505ef7afd7a846`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 87
    - `sessions`: 8
    - `workspace_history`: 718
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 150, `records`: 149, `wrong`: 53, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.07`
- **Image ID**: `sha256:328d21076c682a8ac7734daa9be705aa44e6ddfe3ed5e5db8ed5bcbfb65dac0d`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.06`

### 2.3 Public Endpoint Verification
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.07","deployedAt":"2026-11-08T07:48:00Z",...}`
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c",...}`
