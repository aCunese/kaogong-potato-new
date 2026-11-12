# Release 1.2.6-20261112.04 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261112.04`
- **Commit**: `d6155be38e88253f151536c94c7829fdfe6ef8ad`
- **Executed At**: 2026-11-12 15:11:37 UTC (2026-11-12 23:11:37 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对错题单图定向重新识别误重置全题图片方向、手动纠偏后残留重试报错状态与慢速网络竞态覆盖等缺陷完成深度审计、修复、补齐单测并无损切流发布上线：

1. **错题单图精准重新识别（Targeted Re-identification）与接口契约补全**：
   - `src/components/views/EditModals.tsx`：
     - 在 `WrongDetailModal` 的「重新识别」按钮点击事件中，补传 `safeIndex` 参数：`requestWrongImageOrientations?.(liveRecord.id, true, safeIndex)`，解决多图错题中针对某一张未识别图片点击重试却把该错题下其余已成功摆正的图片全部清空为未识别方向的问题；
     - 状态提示文案统一为「已确认图片方向」，使手动旋转 90° 纠偏与自动识别确认的语义统一自然。
   - `src/context/AppContext.tsx`：
     - 在 `AppContextType` 接口中为 `requestWrongImageOrientations` 显式补全可选 `targetIndex?: number` 类型声明。

2. **状态机与慢速网络并发保护（Concurrency & State Machine Robustness）**：
   - `src/hooks/useWrongImageOrientation.ts`：
     - **错误状态自动收敛**：在向 UI 输出 `orientationErrors` 时，过滤掉已成功摆正（`record.imageOrientations?.[index]?.status === 'resolved'`）的图片，彻底杜绝手动旋转纠偏后界面依然残留「识别暂未完成，请重试」及「重新识别」按钮的假性错误；
     - **慢速网络竞态保护**：在后台 OCR 响应落地提交 mutation 前，二次校验当前图片是否已被用户手动旋转或确认（`currentRecord?.imageOrientations?.[task.index]?.status === 'resolved'`），优先保护用户的主动纠偏意图，防止慢速网络返回的自动推测覆盖用户决策。

3. **Python OCR 引擎空候选防御与测试用例跨平台清洁**：
   - `scripts/lib/image-orientation.py`：
     - 在 `select_rotation(candidates)` 增加 `if not candidates: return {'status': 'unresolved', ...}` 防御性边界检查，防止异常空列表输入导致 `IndexError`。
   - `tests/image_orientation_helper_test.py`：
     - 增加针对空候选列表的单测，验证边界安全性。
   - `tests/photo-orientation.test.ts`：
     - 补齐 `applyRotateWrongImage` 连环 90°/270° 旋转、越界保护、多图独立性单测；
     - 补齐 `applyPrepareWrongImageOrientations` 单图 `targetIndex` 定向重置保留兄弟图片的单元测试。
   - `tests/heic-compression-browser.test.ts`：
     - 清除硬编码的个人本地缓存路径回退，完全收敛至标准的仓库内置 fixture。

4. **版本发布与配置**：
   - 同步升级构建版本至 `1.2.6-20261112.04`，更新 `public/version.json`、`release.json`、`public/sw.js`。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit (无损发布验证)
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261112_150146.tar.gz`
  - Archive SHA256: `6f3d71bf65c799b3f160637f3dc068572c14b593c7ac69cdafdaf97a9fb6a2e8`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261112_151124.tar.gz`
  - Archive SHA256: `f3b2d0c23f949f6ebca9798b99c25dbd1f8ec185b876fe0037e142031f64f730`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities (零数据丢失验证):
    - `users`: 10, `workspaces`: 6, `media_records`: 120, `sessions`: 8, `workspace_history`: 883, `invites`: 24
    - `books`: 48, `courses`: 32, `plans`: 237, `records`: 236, `wrong`: 70, `todos`: 10, `timerSessions`: 5
    - `attachments`: 120（`missing: 0`, `mismatched: 0`）
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261112.04`
- **Image ID**: `sha256:631543b44e770258b01801e31c91bc1f69f1ba31cd81bc81e4f3c13e4b750130`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261112.03`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261112.04`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
- `https://work.ruyne.space/sw.js`:
  - HTTP 200, `RELEASE_BUILD = '20261112.04'`
- `POST https://work.ruyne.space/api/media/:mediaId/orientation`:
  - `cache-control: no-store, no-cache, must-revalidate, private`
- `GET https://work.ruyne.space/api/media/:mediaId`:
  - `cache-control: private, max-age=31536000, immutable`
- `https://work.ruyne.space/`:
  - HTTP 200
