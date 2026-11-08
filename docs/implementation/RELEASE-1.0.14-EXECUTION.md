# 考公工作台 · Web 1.0.14 发布执行记录

- **发布内容**:
  1. 待办独立两级导航重构：入口置于今天右侧（药丸胶囊 `[📅 历史月历 ❯]`）、未完成提示条下移到今天卡片下方；二级独立全屏月历、三级独立单日待办详情页（支持直接为历史日期补记待办并补勾）。
  2. 全类型日程时长修改：自定义日程解除限制开放修改登记；题目、网课、自定义全部支持修改实际学习时长（分钟），支持退格删空并做有效性校验，同步校正学情分析与累计时长。
  3. 持久化记录今日只看未完成：使用 localStorage 记住用户的过滤状态，不再单次重置。
- **版本标识**: Web `1.0.14` / build `20261029.04` / Schema `5`
- **基线 Commit**: `de834e9` → 本次提交 `847b7b4`
- **生产目标**: `https://work.ruyne.space`（`18.224.72.68`，`/home/ubuntu/kaogong-app`）

## 1. 验证与门禁检查

| 检查项 | 结果 |
| :--- | :--- |
| `npm run typecheck` | exit 0（TypeScript 前后端 0 错误） |
| `bun test tests/experience-ui.test.ts` | 11/11 通过（含历史月历胶囊入口、顺延、自定义时长修改验证） |
| `bun test tests/record-correction-ui.test.tsx` | 2/2 通过（时长可编辑断言通过） |
| `npm test` | unit (283) + server (68) + dr (24) = 375 项全部通过 |
| `npm run build` | exit 0；打包产物 `assets/index-D6v8qcTi.js` |

## 2. 生产部署与数据安全保障（零数据丢失）

1. **部署前在线热备（100% 数据兜底）**：
   - 生产容器内热备：`/app/data/backups/backup_20261029_103710.tar.gz`（672KB，代际 `gen_1792995329794_e00c30554b4ace1c`，5 个附件与引用完全吻合）。
   - 该备份已同步下载至本地冷备：`data/prod_offsite_backups/backup_20261029_103710.tar.gz`。
2. **代码无损增量同步**：
   - rsync 严格排除 `data/` 目录，宿主机用户 SQLite 数据库文件原地不动。
3. **镜像构建与容器平滑切换**：
   - 生产镜像：`kaogong-potato:1.0.14` / `kaogong-potato-app:1.0.14-20261029.04`。
   - 保留前一版本容器 `kaogong-potato-app-prev-1.0.13` 便于随时回滚。
   - 挂载宿主机 `/home/ubuntu/kaogong-app/data` 目录启动新容器。
4. **上线后验证**：
   - 生产数据库 `PRAGMA integrity_check`：`ok`。
   - 数据基线计数核对：users 10 / workspaces 6 / media_records 5 / sessions 8 / workspace_history 209，完全吻合。
   - 代际标识保持不变，学员端无须重新登录。
   - 公网 `https://work.ruyne.space/version.json` 正常返回 `1.0.14 / 20261029.04`，首页静态资源公网 200。
