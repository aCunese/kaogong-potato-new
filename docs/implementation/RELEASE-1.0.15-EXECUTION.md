# 考公工作台 · Web 1.0.15 发布执行记录

- **发布内容**:
  1. 学习登记记录独立界面：进入全屏二级独立视图，顶部带 `‹ 返回今日`，保留底部悬浮主导航。
  2. 微信/待办同款月历与日期直达：彻底移除 `<input type="date">` 消除系统点击声与“设置”确认步；有记录的日期正常显示加粗，空白日期淡化，点击直达当日日程与登记详情。
  3. 全新悬浮胶囊底部主导航：严格还原设计图 3 & 4（大圆角悬浮胶囊卡片、微阴影、选中项正上方精致深绿色小圆点、安全区自适应）。
- **版本标识**: Web `1.0.15` / build `20261029.05` / Schema `5`
- **基线 Commit**: `847b7b4` → 本次提交 `c8b4a6a`
- **生产目标**: `https://work.ruyne.space`（`18.224.72.68`，`/home/ubuntu/kaogong-app`）

## 1. 验证与门禁检查

| 检查项 | 结果 |
| :--- | :--- |
| `npm run typecheck` | exit 0（TypeScript 前后端 0 错误） |
| `bun test tests/record-correction-ui.test.tsx` | 3/3 通过（含消除原生日期控件与月历断言） |
| `npm test` | unit (284) + server (68) + dr (24) = 376 项全部通过 |
| `npm run build` | exit 0；打包产物 `assets/index-B4iuATFu.js` |

## 2. 生产部署与数据安全保障（零数据丢失）

1. **部署前在线热备（100% 数据兜底）**：
   - 生产容器内热备：`/app/data/backups/backup_20261029_150812.tar.gz`（696KB，代际 `gen_1792995329794_e00c30554b4ace1c`，5 个附件与引用完全吻合）。
   - 该备份已同步下载至本地冷备：`data/prod_offsite_backups/backup_20261029_150812.tar.gz`。
2. **代码无损增量同步**：
   - rsync 严格排除 `data/` 目录，宿主机用户 SQLite 数据库文件原地不动。
3. **镜像构建与容器平滑切换**：
   - 生产镜像：`kaogong-potato:1.0.15` / `kaogong-potato-app:1.0.15-20261029.05`。
   - 保留前一版本容器 `kaogong-potato-app-prev-1.0.14` 便于随时回滚。
   - 挂载宿主机 `/home/ubuntu/kaogong-app/data` 目录启动新容器。
4. **上线后验证**：
   - 生产数据库 `PRAGMA integrity_check`：`ok`。
   - 数据基线计数核对：users 10 / workspaces 6 / media_records 5 / sessions 8 / workspace_history 231，完全吻合。
   - 代际标识保持不变，学员端无须重新登录。
   - 公网 `https://work.ruyne.space/version.json` 正常返回 `1.0.15 / 20261029.05`，首页静态资源公网 200。
