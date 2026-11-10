# Release 1.2.6-20261110.01 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261110.01`
- **Commit**: `89c0d28a86ee66b2cf41a5fee973b7dad387c8fb`
- **Executed At**: 2026-11-10 08:43:25 UTC (2026-11-10 17:43:25 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对自定义日程预设分科目管理与每日刷题模块的正确率展示进行全链路优化与落地：

1. **自定义日程预设分科目管理**：
   - `src/utils/scheduleSelection.ts`：
     - 新增科目预设持久化与隔离映射，用户在不同科目下添加自定义日程时，预设条目按科目完全独立隔离存储。
     - 切换科目时自动加载对应科目的预设选项，默认标题清空防污染。
   - `src/components/views/EditModals.tsx`：
     - `AddPlanModal` 全面接入分科目预设管理，支持在计划添加弹窗内直接管理当前科目自定义日程预设（新增、选择、删除）。

2. **每日刷题正确率展示与统计明细优化**：
   - `src/components/views/DailyBookPractice.tsx`：
     - 优化题目练习汇总与详情行的正确率展示，支持百分比及正确/错误题数对比，提升考生每日刷题成果的直观感知。

3. **测试套件与门禁加固**：
   - `tests/custom-schedule.test.tsx`：
     - 新增分科目预设隔离、添加计划弹窗内预设控制、DailyBookPractice 正确率展示等全套单元测试（14/14 全数通过）。
   - 全部门禁检查通过：
     - `npm run build`（TypeScript 前后端 0 错误 + Vite 构建成功）。
     - `npm run test:server`（94 个服务端集成测试 + Python 原生 OCR 测试全通过）。
     - `npm run test:dr`（24 个灾备恢复与在线热备容灾演练全通过）。
     - `tests/release-readiness.test.ts`、`tests/heic-compression-browser.test.ts`、`tests/record-correction-browser.test.ts` 等全部通过。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261110_084043.tar.gz`
  - Archive SHA256: `fecb3dc9f510d2992b58b9d86299658d57d8274c6b6eda10528702a3d45a8eba`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261110_084317.tar.gz`
  - Archive SHA256: `dec63b9c139ee74db79934fd10ca3d4ff803e8d6b557ea1d193c14f5809f3ad0`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10, `workspaces`: 6, `media_records`: 103, `sessions`: 8, `workspace_history`: 880, `invites`: 24
    - `books`: 49, `courses`: 32, `plans`: 196, `records`: 194, `wrong`: 61, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261110.01`
- **Image ID**: `sha256:07c3631e8118a8a259763fc8917d43a1fb3e9e4bcdc5e91b563c90e515a21b4d`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261109.02`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261110.01`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
- `https://work.ruyne.space/sw.js`:
  - HTTP 200, `no-cache, no-store, must-revalidate`
- `https://work.ruyne.space/`:
  - HTTP 200
