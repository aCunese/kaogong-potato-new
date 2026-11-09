# Release 1.2.6-20261109.01 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261109.01`
- **Commit**: `772c046102573b329764bd435fbf4e1b2ed2cc17`
- **Executed At**: 2026-11-09 01:34:40 UTC (2026-11-09 09:34:40 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

本次发布针对多智能体协同代码走查审计发现的真实核心缺陷进行了系统级加固：

1. **核心数据逻辑与状态重置**：
   - `src/utils/workflowMutators.ts`：
     - 新增并导出 `applyResetWorkspace`，在清空 `plans`, `records`, `wrong` 及重置题本进度时，**彻底清空 `todos` 与 `timerSessions`**，消除了重置后的孤儿会话与待办残留。
     - 在 `applyDeleteBook` 与 `applyDeleteCourse` 中增加关联 plans 降级处理：未完成的关联计划平滑转换为 `custom` 计划，清空已失效的 `sourceId` 与 `libraryId`，保留已记录时长，防止用户打卡被 `SOURCE_DELETED` 阻断。
     - 题本删除前自动将科目固化到关联 `wrong` 错题记录的 `subject`，杜绝因题本删除导致错题分类回退为 `'其他'`。
   - `src/context/AppContext.tsx`：
     - 接入 `applyResetWorkspace`，保证工作台重置逻辑与纯函数 mutator 严格一致。

2. **移动端 UI、视口与手势交互适配**：
   - `src/App.tsx`：
     - Toast 提示条与常驻计时浮条（`timerNotice`）全面引入 `env(safe-area-inset-bottom)` 动态计算，彻底消除全面屏设备上浮层被底部胶囊导航栏压盖的问题。
     - 主滚动容器在计时浮条激活时动态追加 `pb-32` 内边距，确保列表末端卡片和操作按钮可完全滚动露出。
   - `src/components/common/UIComponents.tsx`：
     - `Modal` 组件全面接入 `visualViewport` 监听，移动端软键盘弹出时自动跟随可见视口居中调整，确保表单底部的保存和提交按钮始终可见。
   - `src/components/views/TodayView.tsx`：
     - 学友打气便签触摸手势增加 `touchStartX` 记录及轴向锁定（`Math.abs(deltaY) > Math.abs(deltaX)`），防止常规上下浏览日程时误触收起便签。
   - `src/components/views/AnalysisView.tsx`：
     - 折线图 X 轴日期标注增加 `samplingInterval` 动态步进抽样，多记录天数（30天/90天）下自动防重叠，保持图表清晰整洁。

3. **草稿优化与识别重试**：
   - `src/components/views/EditCompanionNoteModal.tsx`：
     - 便签草稿录入增加 300ms 防抖保存（`draftTimerRef`），彻底消除了高速输入时同步写入大图 Base64 的主线程卡顿；在组件卸载、使用预设常用语及发送成功前妥善清理与同步计时器。
   - `src/hooks/useWrongImageOrientation.ts`：
     - 优化异常捕获逻辑，防止高频重试破坏队列处理。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261109_013233.tar.gz`
  - Archive SHA256: `5f7ac5563e7f698b49d4bba08bf993ca92ab4c404199db9a1a6af42c66e994b1`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261109_013432.tar.gz`
  - Archive SHA256: `c547b9ac6c40be3d4b5cb8c2143cb00871385d52e7d9620897409ea8ae27b946`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10, `workspaces`: 6, `media_records`: 88, `sessions`: 8, `workspace_history`: 788, `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 164, `records`: 166, `wrong`: 54, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261109.01`
- **Image ID**: `sha256:0415e73bf0c46a75d175ba422d30b2de2edd6b0aba357bf385661b63819c43bc`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.12`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261109.01`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
