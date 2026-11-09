# Release 1.2.6-20261109.02 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261109.02`
- **Commit**: `dfa42132342693193265363c3b374975939e71c5`
- **Executed At**: 2026-11-09 03:17:11 UTC (2026-11-09 11:17:11 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Change Summary

针对手机相册选择照片拍摄的 HEIC/HEIF 格式添加错题报错「图片格式错误或无法解析图片数据」问题，进行了根因定位与端到端闭环修复：

1. **根因定位**：
   - 现代安卓（如小米/OPPO/vivo相册开启高画质HEIF）与部分苹果设备选图时，文件扩展名为 `.heic`/`.heif`。
   - 原前端 `compressImage` 直接使用 `FileReader` DataURL 交给 `new Image()`，在大多数移动端 Chromium 内核中无法原生解码 HEIC，触发 `img.onerror` 报错。

2. **核心解码与自适应兼容**：
   - `src/utils/imageCompressor.ts`：
     - 新增 `isHeicImage` 探针：综合 MIME 类型、文件名后缀（`.heic`/`.heif`）及 ISOBMFF 二进制文件头魔数（`ftyp` brand 包含 `heic/heix/hevc/hevx/heim/heis/mif1/msf1`）进行三重精准识别。
     - 引入 `heic2any` 动态按需加载：仅在检测到 HEIC 照片时异步拉取解码模块，平时常规上传零开销。
     - 自动解码转换为高质量 JPEG Blob 后无缝流入原有 Canvas 压缩引擎（标准 1200px / 长图短边 720px 保底），输出标准的 `data:image/jpeg;base64`。
   - `src/components/views/EditModals.tsx`、`ProfileEditModal.tsx`、`EditCompanionNoteModal.tsx`：
     - 文件选择器 `input[type="file"]` 全面将 `accept="image/*"` 扩充为 `accept="image/*,.heic,.heif,image/heic,image/heif"`，防止系统文件选择器将相册中的 HEIC 图片置灰。
     - 学友便签插图与头像上传统一享受 HEIC 自动解码支持。

3. **测试套件与门禁加固**：
   - 新增 `tests/heic-compression-browser.test.ts`：在真实 Headless Chromium 中基于真实 4320x3240 高清 HEIC 样本验证解码与压缩全链路，4/4 测试全通过。
   - 同步修复 `public/sw.js` 与 `release.json` 的版本一致性，所有 328+ 单元及边界回归套件通过。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261109_031408.tar.gz`
  - Archive SHA256: `94f5b6168a0ae62ecfad30d617bbf0130535f5f56ce4a60268c8df7e915693d7`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261109_031702.tar.gz`
  - Archive SHA256: `51e3a590db77ce63de2fbbe02f8afd71157020caddf0fe3d2195329b6b97662c`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10, `workspaces`: 6, `media_records`: 94, `sessions`: 8, `workspace_history`: 808, `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 168, `records`: 167, `wrong`: 58, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261109.02`
- **Image ID**: `sha256:e22a8e4eb4de2f1f691381b5c11c04ae90f6b1ecb8c71c5a0a7710af96d4be0b`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261109.01`

### 2.3 Live Endpoint Verification
- `https://work.ruyne.space/version.json`:
  - `version`: `1.2.6`
  - `build`: `20261109.02`
  - `status`: `healthy`
- `https://work.ruyne.space/api/health`:
  - `ok`: `true`
  - `status`: `healthy`
  - `generationId`: `gen_1792995329794_e00c30554b4ace1c`
