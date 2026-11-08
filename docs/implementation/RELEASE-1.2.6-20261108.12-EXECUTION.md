# Release 1.2.6-20261108.12 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.12`
- **Commit**: `8b7e2500d35a54f355d20c836a5bdff58ca446d2`
- **Executed At**: 2026-11-08 12:29:52 UTC (2026-11-08 20:29:52 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

- **核心需求**：修复「今日便签」展示逻辑，确保用户只接收学友发来的打气便签，而完全排除自己发送的便签。
- **服务端修改** (`server/sharing.ts`)：
  - `listCompanionNotes(userId)` 查询过滤条件从 `WHERE n.to_user_id = ? OR n.from_user_id = ?` 修正为 `WHERE n.to_user_id = ? AND n.from_user_id <> ?`，从数据库层彻底杜绝发送者收到自己发出的便签或系统催学便签。
- **客户端防线强化**：
  - `src/components/views/TodayView.tsx`：
    - `getInitialActiveNote`：检测本地缓存的活跃便签，若 `fromUserId === currentUser.id` 则自动清理并返回 `null`。
    - `useEffect` 请求 `/api/sharing/notes` 后：通过 `n.fromUserId !== currentUser.id` 防御性过滤，有学友新便签才展示并更新 `allNotes` / `activeNote`；若无学友便签则清空 `allNotes` 为 `[]` 并置空 `activeNote`，避免便签箱内出现假数据或自己发送的便签。
    - `handlePinNoteToTop`：禁止将自己发送的便签设为置顶便签。
  - `src/components/views/CompanionNotesHistoryModal.tsx`：
    - `useMemo` 计算 `todayNotes` 与 `pastNotes` 时跳过 `currentUserId && note.fromUserId === currentUserId` 的条目。
  - `src/components/views/SharingModal.tsx`：
    - 便签箱数据拉取回调中增加 `fromUserId !== userId` 过滤。
- **测试套件**：
  - `tests/companion-features-server.test.ts`：增加发送者不应在 `listCompanionNotes` 中获取到已发便签的断言。
  - `tests/companion-ui.test.tsx`：增加便签箱（CompanionNotesHistoryModal）自动过滤当前用户本人发出便签的测试用例。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_122753.tar.gz`
  - Archive SHA256: `bfda792f1f69cf758b0739ed3d1e518399cd67ff959333843051c9b9314fde11`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_122945.tar.gz`
  - Archive SHA256: `2732be8ee85d7ef0abe5119be9d3074c2876ea25879ac200518a50c01f245596`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10, `workspaces`: 6, `media_records`: 88, `sessions`: 8, `workspace_history`: 749, `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 157, `records`: 156, `wrong`: 54, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.12`
- **Image ID**: `sha256:4fdd45f62efb1250f4932b0298cec1f003d01cba4b3ebf61399f913cdb344692`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.11`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261108.12`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
