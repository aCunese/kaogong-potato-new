# 考公工作台 · Web 1.1.5 发布执行记录

- **发布内容**:
  1. 倒数日日期选择器UI全面重构：采用应用专属温暖纸张白（`#FFFDF8`）与低饱和鼠尾草绿（`#61794F`），彻底消除系统原生绿色弹窗与按键音效。
  2. 点击即选即生效免点设置：单点任意日期直接完成目标日期回填并自动收起，免去多余的“设置”确认步。
  3. 快捷按年翻页与清除目标日期：支持 `« »` 按年快速翻页，方便直接选定明后年省考/国考，输入框右侧及日历内部均提供便捷清除操作。
- **版本标识**: Web `1.1.5` / build `20261031.02` / Schema `5`
- **基线 Commit**: `005eb60` → 本次提交
- **生产目标**: `https://work.ruyne.space`（`18.224.72.68`，`/home/ubuntu/kaogong-app`）

## 1. 验证与门禁检查

| 检查项 | 结果 |
| :--- | :--- |
| `npm run typecheck` | exit 0（TypeScript 前后端 0 错误） |
| `bun test tests/release-readiness.test.ts` | 2/2 通过（断言 Web 1.1.5 与 20261031.02） |
| `bun test tests/timer-countdown.test.tsx` | 13/13 全部通过 |
| `bun test tests/ui_interaction.test.ts` | 22/22 全部通过 |
| `npm run build` | exit 0；打包产物 `assets/index-Ddgeh8dY.js` |

## 2. 生产部署与数据安全保障（零数据丢失）

1. **部署前在线热备（100% 数据兜底）**：
   - 生产容器内热备：`/app/data/backups/backup_20261031_112326.tar.gz`（772KB，代际 `gen_1792995329794_e00c30554b4ace1c`，5 个附件与引用完全吻合）。
   - 该备份已同步下载至本地冷备：`data/prod_offsite_backups/backup_20261031_112326.tar.gz`。
2. **代码无损增量同步**：
   - rsync 严格排除 `data/` 目录与敏感凭据，宿主机用户 SQLite 数据库文件原地不动。
3. **镜像构建与容器平滑切换**：
   - 生产镜像：`kaogong-potato:1.1.5` / `kaogong-potato-app:1.1.5-20261031.02`。
   - 保留前一版本容器 `kaogong-potato-app-prev-1.1.4` 便于随时回滚。
   - 挂载宿主机 `/home/ubuntu/kaogong-app/data` 目录启动新容器。
4. **上线后验证**：
   - 生产数据库 `PRAGMA integrity_check`：`ok`。
   - 数据基线计数核对：`users: 10, workspaces: 6, media: 5, history: 321`，与部署前完全一致，零数据丢失。
   - 代际标识 `gen_1792995329794_e00c30554b4ace1c` 保持不变，学员端无须重新登录。
   - 公网 `https://work.ruyne.space/version.json` 正常返回 `1.1.5 / 20261031.02`，首页静态资源公网 200。
