# Release 1.2.6-20261108.09 Execution Record

- **Release Version**: `1.2.6`
- **Build ID**: `20261108.09`
- **Commit**: `3831b3a8fc0f68bf921a363c675bf9f0cd48d975`
- **Executed At**: 2026-11-08 08:57:08 UTC (2026-11-08 16:57:08 CST)
- **Domain**: https://work.ruyne.space

---

## 1. Problem Analysis & Fix Verification

### 1.1 需求 1：首页顶部研友状态栏移入第二行操作栏最左侧，紧凑呼吸灯指示 + 点击仅展示学情详情弹层
1. **根本原因**:
   - 顶部状态栏此前为完整条状胶囊，不仅在移动端独占一行或与右侧按钮组发生换行折叠，而且点击该胶囊会直接触发 `openSharing` 进入学习伙伴空间，与用户“只想快速一眼看好友在学什么”的高频轻量诉求不符。
2. **修复措施**:
   - **紧凑呼吸灯按钮**:
     - 移除旧版顶部冗长占行胶囊，在【便签箱】【写便签】【展开便签】这一行最左侧放置好友学习状态紧凑指示器。
     - 好友在学习时：保留**绿色呼吸灯**（`bg-emerald-500 animate-ping` 与 `animate-pulse`），文字标注**学习中**。
     - 好友未在学习时：保留**黄色呼吸灯**（`bg-amber-500 animate-ping` 与 `animate-pulse`），文字标注**未学习**。
     - 若未绑定研友，展示「添加学习伙伴」入口。
   - **点击仅展示图 3 学情详情（不跳转好友空间）**:
     - 点击该指示器时，不再跳转好友空间，而是展开专属浮层，严格只展示图 3 内容：
       - 左侧：绿色脉冲点 + `正在专注《{focusTitle}》{focusMinutes}m`（或未学习文案）
       - 右侧：实心胶囊徽标 `[ ● 专注中 ]`（或未学习时的催学「戳一下」按钮）
     - 支持点击背景区域、二次点击按钮或按 `Escape` 键快速关闭，轻量无侵扰。
     - 整行布局在各类手机视口与桌面端保持单行舒适排布，杜绝大面积空白与不对称折叠。

### 1.2 需求 2：打气便签发送草稿本地保存与大图/表情包发送崩溃修复
1. **根本原因**:
   - 便签发送时若包含用户从相册上传的大图或表情包，此前服务器 `express.json` 对非同步端点限制为 `64kb`，导致 base64 图片直接触发请求体超限异常（`413/500`），客户端报错“服务器内部繁忙，请稍后再试”。
   - 客户端模态框关闭或网络发送失败时直接清空编辑内容，导致用户辛辛苦苦编辑的考公打气骚话和选好的图片完全丢失。
2. **修复措施**:
   - **服务端放行大图**:
     - `server/app.ts` 细粒度中间件调整，放行 `/api/sharing/notes` 至 `10mb` 请求体，并在业务层限制单图 `5MB`，彻底解决图片便签 500/413 报错。
     - 前端 `compressImageToDataUrl` 智能双阶压缩（最大边 1200px，超限降质 0.65），既保证真题图片清晰度又确保体积轻巧。
   - **草稿自动保存与防丢失**:
     - 引入 `src/utils/companionNoteDraft.ts`，自动按用户和研友维度将未发送的文字、表情包或相册图片持久化至本地存储。
     - 再次打开便签弹窗自动恢复上次未发送的草稿，并显示「已自动恢复未发送内容」徽标。
     - **关键规则**：严格在且仅在接口返回 200 成功响应后才清除草稿；发送失败、取消或误关弹窗绝对不丢失内容。

---

## 2. Production Deployment & Verification Records

### 2.1 Production Data Snapshot & Integrity Audit
- **Pre-deployment Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.6_20261108_085504.tar.gz`
  - Archive SHA256: `c65f7f9c6eda4eb5c4d49f0ecf395699c95bcedae60b15c087fb5036cc5f5a23`
  - Generation: `gen_1792995329794_e00c30554b4ace1c`
- **Post-switch Hot-Backup**: `/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.6_20261108_085700.tar.gz`
  - Archive SHA256: `c7e6314954f37ff1f373d5f952e265d278ab9712e40794571ebef6d50a2f0008`
  - Preserved Generation: `gen_1792995329794_e00c30554b4ace1c`
  - Preserved Entities:
    - `users`: 10
    - `workspaces`: 6
    - `media_records`: 88
    - `sessions`: 8
    - `workspace_history`: 726
    - `invites`: 24
    - `books`: 50, `courses`: 32, `plans`: 150, `records`: 150, `wrong`: 54, `todos`: 10, `timerSessions`: 5
  - Integrity Check: `ok`, 0 Foreign Key errors, 0 missing attachments.

### 2.2 Container & Image
- **New Image**: `kaogong-potato-app:1.2.6-20261108.09`
- **Image ID**: `sha256:7a58470acd47942014d8bf28bb070af0b2fcd17a3b5c8f106c8b7c06dccb817c`
- **Previous Container Backup**: `kaogong-potato-app-prev-1.2.6-20261108.08`

### 2.3 Public Endpoint Verification
- `https://work.ruyne.space/version.json`:
  `{"version":"1.2.6","build":"20261108.09","deployedAt":"2026-11-08T08:50:00Z",...}`
- `https://work.ruyne.space/api/health`:
  `{"ok":true,"status":"healthy","generationId":"gen_1792995329794_e00c30554b4ace1c",...}`
