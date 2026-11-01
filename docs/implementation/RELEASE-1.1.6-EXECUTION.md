# 考公工作台 · Web 1.1.6 发布执行记录

- **发布内容**:
  1. **错题照片复盘九大科目分类收纳**：将原有的按题本分组全面升级为八大科目 + 其他共 9 类收纳；历史无显式分类的错题自动按关联题本科目归类（已删除题本归入「其他」），零数据丢失。
  2. **错题页筛选卡片下拉一键定位 + 上下双向快捷上传 + 防卡死分页/视图切换**：
     - 筛选卡片内置土豆风格「所属分类（选择即定位）」下拉框，选中分类（如「数量关系」）即刻自动定位并展开该分类；
     - 每个分类卡片顶部右侧提供 `+ 添加照片`，展开列表底部提供 `+ 快速添加【分类名】错题照片` 虚线大按钮，点击自动预填对应分类；
     - 新增 `2列 / 列表 / 3列` 浏览密度切换与 `PAGE_SIZE = 12` 页码分页器，配合缩略图 `loading="lazy" decoding="async"` 彻底解决图片过多时的长列表卡顿。
  3. **单次多图合入同一道错题**：单次上传多张照片（最多 9 张）自动归纳为 **1 条错题记录**（保存于 `images` 数组），列表显示 `共 N 张` 角标，详情弹窗支持多图左右翻页与缩略图切换。
  4. **错题记录时间精确到小时**：新增 `createdAt` 毫秒时间戳，界面统一展示为 `YYYY.M.D-HH时`（如 `2026.11.1-14时`），旧记录平滑回退显示日期。
  5. **图片打开秒加载与服务端磁盘/内存性能优化**：
     - 移除 `server/workspace.ts` 每次同步时对所有附件执行同步 `fs.readFileSync` 全文件读取与 SHA-256 重算的阻塞逻辑，改为轻量级 `fs.existsSync` + `stat.size` 校验；
     - 在生产 Nginx 配置中为 `/api/media/media_` 增设独立长效私密缓存路由（`Cache-Control: private, max-age=31536000, immutable` + `proxy_buffering on`），修复原先被 `/api/ -> no-store` 覆盖导致每次打开重复拉取原图的问题。
  6. **全站原生选择器美化**：全面替换全站 9 处系统原生 `<select>` 与原生日期选择器为应用专属纸张米白与鼠尾草绿风格的 `SubjectCapsuleGrid`、`CustomSelect` 与 `FloatingDatePicker`。
- **版本标识**: Web `1.1.6` / build `20261101.01` / Schema `5`
- **生产目标**: `https://work.ruyne.space`（`18.224.72.68`，`/home/ubuntu/kaogong-app`）

## 1. 验证与门禁检查

| 检查项 | 结果 |
| :--- | :--- |
| `npm run typecheck` | exit 0（TypeScript 前后端 0 错误） |
| `npm run test:unit` | 287/287 全部通过（含 9 分类归属、多图合入单条错题、小时级时间戳、UI 断言及 `release-readiness` 1.1.6 校验） |
| `npm run test:server` | 68/68 全部通过 |
| `npm run build` | exit 0；打包产物 `assets/index-O1WWnE13.js` |

## 2. 生产部署与数据安全保障（零数据丢失）

1. **部署前在线热备（100% 数据兜底）**：
   - 生产容器内热备：`/app/data/backups/backup_20261101_084858.tar.gz`（1.6MB，数据库 `5240.0 KB`，代际 `gen_1792995329794_e00c30554b4ace1c`，16 个媒体附件与数据库引用完全吻合）。
   - 异地冷备已同步下载至本地：`data/prod_offsite_backups/backup_20261101_084858.tar.gz`（SHA-256: `f2cb5294f9c6295a8256ceb3dbfc23f09f8fb5d1b4daa358ee3b39edff2e5974`）。
2. **代码无损增量同步与 Nginx 缓存优化**：
   - `rsync` 严格排除 `data/` 目录与敏感凭据，宿主机用户 SQLite 数据库文件与附件目录原地不动。
   - 生产 Nginx 新增 `location ^~ /api/media/media_` 强缓存规则，`nginx -t` 通过并平滑 `reload`。
3. **镜像构建与容器平滑切换**：
   - 生产镜像：`kaogong-potato:1.1.6` / `kaogong-potato-app:1.1.6-20261101.01`。
   - 保留前一版本容器 `kaogong-potato-app-prev-1.1.5` 便于随时回滚。
   - 挂载宿主机 `/home/ubuntu/kaogong-app/data` 目录启动新容器。
4. **上线后验证**：
   - 生产数据库 `PRAGMA integrity_check`：`ok`。
   - 数据基线计数核对：`users: 10, workspaces: 6, media_records: 16, workspace_history: 375`，与部署前完全一致，零数据丢失。
   - 代际标识 `gen_1792995329794_e00c30554b4ace1c` 保持不变，学员端无须重新登录。
   - 公网 `https://work.ruyne.space/version.json` 正常返回 `1.1.6 / 20261101.01`。
