# Release 1.2.6-20261112.03 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261112.03`
- **Commit**: `7c5858c727c64080f95bbc7dde1a2d603f4da28e`
- **Executed At**: 2026-11-12 13:59:14 UTC (2026-11-12 21:59:14 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对错题大图查看、手动快捷纠偏、OCR自动摆正识别速度与长图保护、媒体缓存策略等进行全链路闭环优化、测试验证与无损发布上线：

1. **错题详情弹窗手动旋转 90° 快捷按钮、缩略图 `cover` 与编辑网格 `<OrientedImage>` 渲染**：
   - `src/components/views/EditModals.tsx`：
     - 在 `WrongDetailModal` 错题详情弹窗中新增手动顺时针旋转 90° 快捷按钮（状态栏及全屏放大预览栏），支持一键手动纠偏并触发保存与提示；
     - 缩略图轮播导航卡片增加 `cover` 属性，确保不同宽高比图片与旋转角度下裁切充满容器，避免黑边与比例失调；
     - 笔记编辑弹窗配图管理网格从原生 `<img>` 切换为 `<OrientedImage>` 并注入对应的旋转角度与 `cover` 属性，保持编辑视图与预览视图方向一致；
   - `src/context/AppContext.tsx` & `src/utils/workflowMutators.ts`：
     - 实现并暴露 `rotateWrongImage(id, index, delta)` 接口，通过 `applyRotateWrongImage` 原子更新指定错题图片的旋转状态。

2. **Python OCR 引擎提速与长图切片保护**：
   - `scripts/lib/image-orientation.py`：
     - 在 Tesseract 调用参数中显式注入 `--dpi 150`，消除分辨率计算开销与无效告警；
     - **长图切片保护**：当长宽比大于 2.5 时，对超长截图进行顶部 2.2:1 代表性切片，防止缩放至 1600x1600 时字体严重压缩导致 OCR 漏检或极端耗时；
     - **OSD 排序剪枝**：提取 PSM 0 倾向旋转角与置信度，优先评估倾向角并在满足高置信度与充足文字时直接完成研判，裁剪冗余角度的 OCR 调用（单张耗时从 10s 降低至 3.5s，提速 ~65%）；
     - **`select_rotation` 综合证据排序**：引入基于有效字数与可信字数的置信度权重因子，彻底解决图表噪点误触发微弱置信度导致反客为主的问题；
   - `tests/image_orientation_helper_test.py`：
     - 新增综合证据排序抗噪、长图切片比例保护以及 OSD 倾向剪枝等单测，12 项测试全部通过。

3. **媒体路由 Nginx 缓存策略精准分流**：
   - `deploy/nginx/work.ruyne.space.conf` & 服务器配置：
     - 将原前缀 `location ^~ /api/media/media_` 精细化调整为：
       - `~* ^/api/media/[^/]+/orientation$`：方向识别计算端点，强制附加 `no-store, no-cache, must-revalidate, private`，彻底杜绝识别重试或错误被 `immutable` 强缓存；
       - `~* ^/api/media/(media_[a-zA-Z0-9_]+)$`：内容寻址的纯媒体静态资源，保持 `private, max-age=31536000, immutable` 长效缓存，秒级呈现。

4. **版本发布与配置**：
   - 同步升级构建版本至 `1.2.6-20261112.03`，更新 `public/version.json`、`release.json`、`public/sw.js`。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit (无损发布验证)
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261112_135601.tar.gz`
  - Archive SHA256: `cbeee59587c00a284fd629e7b9c39550f709e355bc04e60ea940d68bcd790986`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261112_135859.tar.gz`
  - Archive SHA256: `5ce9c6dfb909da1c734acd1b9d859e28df8be1a10ece61b89b657f5b331dbca7`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities (零数据丢失验证):
    - `users`: 10, `workspaces`: 6, `media_records`: 119, `sessions`: 8, `workspace_history`: 867, `invites`: 24
    - `books`: 49, `courses`: 32, `plans`: 235, `records`: 235, `wrong`: 70, `todos`: 10, `timerSessions`: 5
    - `attachments`: 119（`missing: 0`, `mismatched: 0`）
  - Integrity Check: `ok`, 0 Foreign Key errors.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261112.03`
- **Image ID**: `sha256:41c2551fe6ebc66b20ed7110b82ab5d881768d60f438b64486c304dacb94dd9c`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261112.02`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261112.03`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
- `https://work.ruyne.space/sw.js`:
  - HTTP 200, `RELEASE_BUILD = '20261112.03'`
- `POST https://work.ruyne.space/api/media/:mediaId/orientation`:
  - `cache-control: no-store, no-cache, must-revalidate, private`（无 `immutable`）
- `GET https://work.ruyne.space/api/media/:mediaId`:
  - `cache-control: private, max-age=31536000, immutable`（长效缓存）
- `https://work.ruyne.space/`:
  - HTTP 200
