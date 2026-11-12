# Release 1.2.6-20261112.02 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261112.02`
- **Commit**: `342e8d4919340fc798a679d679927329bdb401a5`
- **Executed At**: 2026-11-12 09:51:14 UTC (2026-11-12 17:51:14 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对好友学情学习分钟未能实时同步、学情弹窗分栏切换白屏崩溃，以及主页今日日程待登记提示条冗余等问题，完成全链路闭环修复、测试门禁与安全无损上线：

1. **好友学情学习分钟与今日已累计学习全口径实时同步（含独立番茄钟累加）**：
   - `server/sharing.ts`：
     - 重构 `getSharedStudyOverview`：除了已点击「完成登记」生成的 `state.records` 外，将未归档（`!plan.archived`）且未生成正式记录的计划用时（已暂停 `accumulatedMs`、历史兼容 `actualMinutes`、以及运行中 `now - timerStart`）通过毫秒级聚合计入 `selectedTotals.minutes` 与 `allTimeTotals.minutes`；
     - **独立番茄钟只做时长累加，不提前独立登记**：将未关联计划且未生成记录的 `running` / `paused` / `pending` 独立番茄钟通过 `splitSessionFocusByDay` 按跨日分割纯累加至学习分钟，不改变独立番茄钟原有生命周期；
     - 严格保持 `SharedStudyTotals` 的 5 字段数据结构不变，并在 `SharedStudyOverview` 暴露 `recordedMinutes` 与 `pendingMinutes` 供前端做更细腻的文案展示；
     - 基于客户端 `tzOffset` 与 `timeZone` 做服务端本地跨日边界切分（`localDayEndMs`），避免 UTC 运行环境产生跨时区统计截断。
   - `src/components/views/SharingModal.tsx`：
     - 查询好友学情 `/overview` 时传递 `localDate` 与 `tzOffset`；
     - 增加 12 秒静默定时轮询（`loadList(true)`、`fetchOverview(true)`）及 `window.focus` / `visibilitychange` 静默刷新，避免遮罩闪烁并防范竞态；
     - 修正 `Totals` 状态逻辑：当仅有进行中/待登记分钟数而无正式打卡记录时展示 `学习中 ⏱️`，并在黄色提示卡片说明学习分钟已实时包含投入，待完成登记后转入正式明细。
   - `src/components/views/TodayView.tsx`：
     - 主页「今日已累计学习」同步将未绑定计划的进行中/暂停独立番茄钟专注时长累加计入 `totalElapsedMs` 与 `pendingMinutes`，并挂载每秒实时定时器，实现两端分钟数秒级对齐。

2. **修复学情弹窗分栏切换 React Hook 顺序崩溃（#300）与整站异常隔离**：
   - `src/components/views/SharingModal.tsx`：
     - 将原条件 `return` 之后执行的 `dailyRecords` `useMemo` 提取至最顶层，并将 `当日学情`、`累计资料`、`全部统计` 拆分为 `PartnerDailyTab`、`PartnerLibraryTab`、`PartnerAllStatsTab` 三个独立纯组件，彻底杜绝 Hook 数量动态变化；
     - 「点击看全部 ->」快捷胶囊统一加入 `setPage(1)` 与 `setError('')` 重置；
     - 弹窗外层包裹专用 `ErrorBoundary`，提供「重试」与「关闭」按钮。
   - `src/components/common/ErrorBoundary.tsx` & `src/main.tsx`：
     - 新增全功能 `ErrorBoundary` 类组件，并在 `main.tsx` 根部挂载全局防白屏护盾。

3. **清理主页今日日程上方冗余的待登记黄色提示条**：
   - `src/components/views/TodayView.tsx`：
     - 彻底清理「今日日程」上方带小灯泡的黄色提示卡片（`data-testid="today-pending-banner"`），界面更加清爽聚焦。

4. **版本更新与发布配置**：
   - 更新 `public/version.json`、`release.json`、`public/sw.js` 构建标识为 `1.2.6-20261112.02`。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit (无损发布验证)
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261112_094931.tar.gz`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261112_095058.tar.gz`
  - Archive SHA256: `5e8fefe4a4c90560a108151ea9bfa71eba34d1e7bb001dd5c409602c9b279f7e`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities (零数据丢失验证):
    - `users`: 10, `workspaces`: 6, `media_records`: 119, `sessions`: 8, `workspace_history`: 897, `invites`: 24
    - `books`: 49, `courses`: 32, `plans`: 232, `records`: 231, `wrong`: 70, `todos`: 10, `timerSessions`: 5
    - `attachments`: 119（`missing: 0`, `mismatched: 0`）
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261112.02`
- **Image ID**: `sha256:d335eec6087212efe977810dd880a05584e149e54387ce2ec8164b2ac317949f`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261112.01`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261112.02`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
- `https://work.ruyne.space/sw.js`:
  - HTTP 200, `RELEASE_BUILD = '20261112.02'`
- `https://work.ruyne.space/`:
  - HTTP 200
