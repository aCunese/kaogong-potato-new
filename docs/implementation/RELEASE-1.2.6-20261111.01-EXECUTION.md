# Release 1.2.6-20261111.01 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261111.01`
- **Commit**: `c6d03cfbde948a293100ff76b7f7502a1075cb1a`
- **Executed At**: 2026-11-11 10:25:23 UTC (2026-11-11 19:25:23 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对主页展开悬浮打气便签上滑手势联动滚动异常与便签箱无法查看我写给好友的历史与今日内容两个核心问题进行全链路闭环解决并安全上线：

1. **悬浮打气便签上滑手势与微信式消失动效修复**：
   - `src/components/views/TodayView.tsx`：
     - 为顶部悬浮 Banner 容器声明 `touch-none` 类及内联 `touchAction: 'none'`，彻底阻断移动端浏览器将上滑判定为祖先滚动容器手势而触发的整页下滑；
     - 新增 `isDragging` 状态：在用户手指拖拽过程中挂载 `transition-none` 实现 1:1 跟手，反向回滑（`deltaY >= 0`）实时归零防悬空；
     - 修复内联 `style.transform` 特异性覆盖 Tailwind 收起类名的问题：在触发 `dismissBanner()` 时解除内联位移限制，允许 Tailwind `-translate-y-8 opacity-0 max-h-0` 丝滑播放微信横幅式上收淡出动效；
     - 增加 `onTouchCancel` 容错监听，异常中断时平稳重置状态。

2. **打气便签箱新增「我写出的」发件箱维度与爱心反馈**：
   - `src/types/companionNote.ts`：
     - `CompanionNote` 结构扩充 `toNickname`、`toAvatar` 接收人专属展示字段。
   - `server/sharing.ts`：
     - 提取通用 `resolveUserAvatar` 辅助函数；
     - `listCompanionNotes` 放宽为 `WHERE (n.to_user_id = ? OR n.from_user_id = ?)`，`LEFT JOIN` 接收人昵称与头像，支持发件人查阅发出便签；
     - `createCompanionNote` 创建便签时同步返回接收方昵称与头像。
   - `src/components/views/CompanionNotesHistoryModal.tsx`：
     - 便签箱由双 Tab 升级为三 Tab 架构：`今日收到` / `往常回忆` / `我写出的`；
     - 在「我写出的」Tab 下卡片采用发件专属呈现：展示好友头像与备注名（标有「寄给学友」标签）、学友回赠爱心反馈（「❤️ 学友已回赠 X 颗爱心」/「学友暂未回赠爱心」）；
     - 剔除不适用的“置顶展示”与“回赠爱心”，提供“再贴一张”快捷唤起直达好友的便签弹窗；
     - `TodayView` 接入发件乐观追加（`onNoteSent`）与智能回贴目标对齐（`noteReplyTarget`）。

3. **测试门禁与安全验证**：
   - `tests/companion-features-server.test.ts`：验证发件人能正确查到发出的便签并携带接收方昵称与头像；
   - `tests/companion-ui.test.tsx`：验证三 Tab 切换、「我写出的」卡片排版、无自我点赞/自我置顶按钮；
   - 全量门禁套件全部 100% 通过（316 单元测试 + 94 服务端测试 + 9 图像/Python 测试 + 24 灾备恢复演练）。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit (无损发布验证)
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261111_101237.tar.gz`
  - Archive SHA256: `000e5692d5c908086f60299a6f556dd3eb0c3ae765d5ad517f684337ceed9c6f`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261111_102514.tar.gz`
  - Archive SHA256: `0031e9f63c4c8840a7b52e5486908a3f53db87fa185e46ed0597bb90c358b431`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities (零数据丢失验证):
    - `users`: 10, `workspaces`: 6, `media_records`: 110, `sessions`: 8, `workspace_history`: 924, `invites`: 24
    - `books`: 49, `courses`: 32, `plans`: 215, `records`: 213, `wrong`: 65, `todos`: 10, `timerSessions`: 5
    - `attachments`: 110（`missing: 0`, `mismatched: 0`）
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261111.01`
- **Image ID**: `sha256:e101fb86ef486ac357f78b8bd6fb2faf1c4031cee58c719149ecea027bdab9e8`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261110.01`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261111.01`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
- `https://work.ruyne.space/sw.js`:
  - HTTP 200, `RELEASE_BUILD = '20261111.01'`
- `https://work.ruyne.space/`:
  - HTTP 200
