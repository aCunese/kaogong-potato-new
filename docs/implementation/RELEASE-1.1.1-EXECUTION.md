# 考公工作台 · Web 1.1.1 发布执行记录

- **发布内容**:
  1. 错题照片复盘自研悬浮日历：点击开始/结束日期从底部滑起半屏抽屉卡片，温润白纸质感，彻底消除系统原生绿色弹窗与按键点击音效。
  2. 点击即选即关免设置：单点任意日期直接完成筛选并自动收拢，免去多余的“设置”按钮确认步。
  3. 错题足迹小圆点与清空：有错题记录的日期下方带精致小圆点提示，顶部支持一键“清空此日期”。
- **版本标识**: Web `1.1.1` / build `20261030.01` / Schema `5`
- **基线 Commit**: `c8b4a6a` → 本次提交 `d22b8e9`
- **生产目标**: `https://work.ruyne.space`（`18.224.72.68`，`/home/ubuntu/kaogong-app`）

## 1. 验证与门禁检查

| 检查项 | 结果 |
| :--- | :--- |
| `npm run typecheck` | exit 0（TypeScript 前后端 0 错误） |
| `bun test tests/record-correction-ui.test.tsx` | 5/5 通过（含错题悬浮日历与无原生控件断言） |
| `bun test tests/release-readiness.test.ts` | 2/2 通过（断言 Web 1.1.1 与 20261030.01） |
| `npm run build` | exit 0；打包产物 `assets/index-aNUZu8nQ.js` |

## 2. 生产部署与数据安全保障（零数据丢失）

1. **部署前在线热备（100% 数据兜底）**：
   - 生产容器内热备：`/app/data/backups/backup_20261029_154436.tar.gz`（696KB，代际 `gen_1792995329794_e00c30554b4ace1c`，5 个附件与引用完全吻合）。
   - 该备份已同步下载至本地冷备：`data/prod_offsite_backups/backup_20261029_154436.tar.gz`。
2. **代码无损增量同步**：
   - rsync 严格排除 `data/` 目录，宿主机用户 SQLite 数据库文件原地不动。
3. **镜像构建与容器平滑切换**：
   - 生产镜像：`kaogong-potato:1.1.1` / `kaogong-potato-app:1.1.1-20261030.01`。
   - 保留前一版本容器 `kaogong-potato-app-prev-1.0.15` 便于随时回滚。
   - 挂载宿主机 `/home/ubuntu/kaogong-app/data` 目录启动新容器。
4. **上线后验证**：
   - 生产数据库 `PRAGMA integrity_check`：`ok`。
   - 数据基线计数核对：users 10 / workspaces 6 / media_records 5 / sessions 8 / history 235，完全吻合。
   - 代际标识保持不变，学员端无须重新登录。
   - 公网 `https://work.ruyne.space/version.json` 正常返回 `1.1.1 / 20261030.01`，首页静态资源公网 200。
