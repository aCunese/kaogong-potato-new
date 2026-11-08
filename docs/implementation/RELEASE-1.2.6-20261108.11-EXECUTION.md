# Release 1.2.6-20261108.11 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.11`
- **Commit**: `f190753789f6a84ea9b800674bae7c344d25e6d8`
- **Executed At**: 2026-11-08 09:44:43 UTC (2026-11-08 17:44:43 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

- 将全站及服务端邮件模板中「研友」统一替换为「学友」，包括：
  - `src/components/views/CompanionNoteDetailModal.tsx`（`💌 学友打气便签`、`学友打气`、陪伴与督学说明、备注更新提示等）
  - `src/components/views/CompanionNotesHistoryModal.tsx`（`学友打气` 标签与空状态说明）
  - `src/components/views/EditCompanionNoteModal.tsx`（`学友专属打气`）
  - `src/components/views/PokeCustomModal.tsx`（`💌 学友来信正文` 与占位提示）
  - `src/components/views/SharingModal.tsx`（`学友` 徽章、修改备注提示、约定时间与戳一戳规则说明）
  - `src/components/views/TodayView.tsx`（首页顶部横幅、实时学情状态与写便签提示）
  - `src/utils/companionRemarks.ts`（默认称谓回退值 `学友`）
  - `server/pokeEmailTemplate.ts` 及 `server/sharing.ts`（催学提醒邮件与便签文案）

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_094318.tar.gz`
  - Archive SHA256: `9880aae3982a66e0dc3298957da19ff3a53d971d5fe4a8707ab5b7aed5c311ed`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_094437.tar.gz`
  - Archive SHA256: `d1e3027f2ada8354cf8dba9b36da59bab906361c295528c88639a3f6fc35218d`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10, `workspaces`: 6, `media_records`: 88, `sessions`: 8, `workspace_history`: 719, `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 150, `records`: 151, `wrong`: 54, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.11`
- **Image ID**: `sha256:8c6958179feb6f5cb97c987e63ecb9e0c86a377349011342c5b15eafcccdb1d3`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.10`
