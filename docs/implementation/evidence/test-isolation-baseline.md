# 隔离测试基线证据 · test-isolation-baseline

本文件是 task-3「隔离测试环境 + 重写 verify-screens.ts + 基线证据」的交付说明。
原始输出、逐项结果与隔离证明分别保存在同目录：

- [test-isolation-baseline.log](./test-isolation-baseline.log) — 完整 stdout+stderr、RUN_ID / DATA_DIR / SERVER_URL / WEB_BUILD、构建身份、退出码、git 版本、隔离证明尾部
- [test-isolation-baseline-results.json](./test-isolation-baseline-results.json) — 163 项检查逐条结果（含耗时、失败堆栈、构建信息、source 版本、隔离证明）
- [test-isolation-baseline-isolation.json](./test-isolation-baseline-isolation.json) — 真实 `data/` 目录运行前后逐文件 fingerprint（size+mtime+sha256）与 git 指纹明细

截图产物位于仓库之外的临时目录（不会被 git 跟踪）：
`/var/folders/.../potato-isolated-run-20261026-141653-5a8b2d/verified-screens/`
（150 张 50 屏 × 3 视口截图 + 3 张登录基线 + results.json，共 154 个文件、约 14 MB）

---

## 1. 基线运行结果（唯一权威一次）

| 项目 | 值 |
|---|---|
| 命令 | `bun scripts/run-isolated-audit.ts`（等价于以隔离环境运行 `bun scripts/verify-screens.ts`） |
| 退出码 | **0** |
| 检查总数 | **163** |
| 通过 | **163** |
| 失败 | **0**（保留全部原始断言，无跳过/改名/删除） |
| 跳过 | **0** |
| 耗时 | 30.1s |
| RUN_ID | `run-20261026-141653-5a8b2d` |
| MODE | `isolated-auto`（harness 自建隔离服务器） |
| SCOPE | `all`（visual + business） |
| SERVER_URL | `http://127.0.0.1:49561` |
| DATA_DIR | `/var/folders/d4/tr90_hnx1nq_ck28d4f2fdm40000gn/T/potato-isolated-run-20261026-141653-5a8b2d-oy4JXK/data`（仓库外临时目录，运行结束已删除） |
| WEB_BUILD | `version=1.0.3 build=20261027.01 schema=3`（来源：隔离服务器 `/version.json`，非静态 dist 猜测） |
| 构建身份 | `npm run build` 全新构建：`BUILD_STRATEGY=npm-run-build`、`typecheck=true`、`npm_build_exit=0`、`vite_build_exit=0`（未复用旧 dist） |
| GIT_HEAD | `bc368b7b8ac6217b1a31ef78cf74c5d0e7ebaa9c`（`codex/prod-release-m1-m4`） |
| GIT_WORKTREE_SHA256（运行开始时的 working-tree 指纹） | `e9ab079d68834d5b9f30844038cc8117b98829cbc0722dcddc54ab879290f9e4` |
| HEAD / tracked diff 运行前后 | HEAD 不变；tracked diff sha256 `a8f0a0ed…3975e` 运行前后完全一致 → `SOURCE_CHANGED_DURING_RUN: false`（本次运行窗口内无其他 agent 改 src/server/public） |

working-tree 指纹定义：`sha256(HEAD + git status --porcelain + sha256(git diff HEAD) + 每个 untracked 文件路径:sha256)`，
由 `scripts/lib/isolated-env.ts::getGitFingerprint()` 生成，避免仅用 HEAD 掩盖未提交工作区。

## 2. 隔离证明（真实 `data/` 未被触碰）

`scripts/lib/isolated-env.ts` 在运行开始前/后对仓库 `data/` 目录做递归 fingerprint
（每个文件的 size + mtimeMs + sha256，再汇总 aggregate sha256）：

| 阶段 | 文件数 | aggregate sha256 |
|---|---|---|
| 运行前 | 11 | `5dc94c686471743760008e966176afa11ee8d3d12b9d08a2b36324c1d962bc6b` |
| 运行后 | 11 | `5dc94c686471743760008e966176afa11ee8d3d12b9d08a2b36324c1d962bc6b` |

→ **`ISOLATION_PROOF: PASS`，真实 `data/potato.db`、`-wal`、`-shm`、attachments、backups 的
size/mtime/sha256 全部不变**。`data/potato.db` 当前仍是 98304 bytes / mtime `Oct 26 15:21:15`。

隔离机制（硬约束，缺一即非零退出）：

1. `assertIsolatedDataDir()` 要求显式 `DATA_DIR` 且必须位于仓库外、不能等于/包含仓库 `data/`；`server/` 的默认 `./data` 回退路径在 harness 中没有任何调用机会。
2. 服务器以 `DATA_DIR=<tmp>/data PORT=<随机空闲端口> HOST=127.0.0.1 node --import tsx server/index.ts` 启动，health 通过后**断言 `DATA_DIR` 内已生成 `potato.db`**，否则拒绝继续。
3. 邀请码只用 `DATA_DIR=<tmp>/data node --import tsx server/cli.ts create-invite` 子进程生成，绝不启动第二条连接真实库的 CLI。
4. 结束后只 kill 自己创建的 server 进程、删除自己创建的临时 `DATA_DIR`；截图/日志留在仓库外临时目录备查。
5. 旧脚本中的 `sqlite3 data/potato.db "INSERT INTO invites ..."` 与默认 `./data` 用法已彻底移除（全文件 grep 无真实库写入引用）。

> 说明：运行期间本机存在其他 agent/历史进程持有真实 `data/potato.db`（与本 harness 无关，非本次创建）；
> 上面的 before/after 指纹一致证明它们没有在运行窗口内写入真实数据，也证明 harness 没有写入真实数据。

## 3. 检查清单（163 项，无裁剪）

### 3.1 视觉矩阵：156 项（preview=1 内存态，不做 IndexedDB 持久化断言）

- 3 视口（412×915 / 393×873 / 360×800）× 50 屏 = **150** 项：每屏断言主文案可见、
  modal 屏必须打开 `role="dialog"`、无横向溢出、导航/弹窗不超出视口、图片无 broken、
  弹窗最终操作按钮可滚动到并完全在视口内、逐屏截图。
- 3 × `normal viewport`：真实入口未登录时必须出现独立登录页（不出现 50 屏检查器、无横向溢出、登录页截图）。
- 3 × `no page errors`：每个视口整轮无 `pageerror`。

说明：视觉阶段允许保留原有 `?preview=1` 内存 DEMO_STATE（截图/布局用途）；该阶段**不读取也不断言**
原生 IndexedDB 持久化，因此不会再把 preview 内存态误当成业务落库证据。

### 3.2 真实业务链路：7 项（独立浏览器 context：原生 IndexedDB + 真实 Service Worker + 真实隔离服务器）

1. `register through UI`：UI 真实注册（邀请码来自隔离库 CLI）→ 本地 IndexedDB 与服务器 workspace 均得到 14 题本/7 网课/22 事项，服务器 revision ≥1。
2. `UI edit (add book) auto-syncs to the isolated server workspace`：UI 表单新增题本 → 轮询真实 `GET /api/workspace` 直到包含新书，验证真实自动同步链路（不拦截网络）。
3. `second device with only a valid session cookie hydrates the server workspace into indexedDB`：只带真实 session cookie、无本地缓存的新 context 冷启动，必须拉取服务器工作区并写入 IndexedDB（对应交付要求“登录成功后读取校验服务器工作区并本地缓存”）。
4. `orphan photo remains deletable and cancel preserves it`：原生 IndexedDB 快照场景，取消删除保留、确认删除生效。
5. `preview changes do not change normal snapshot`：preview 内存态保存不改变正常 IndexedDB 快照。
6. `save failure keeps book draft and shows no success`：注入 IDB 读写失败，草稿保留、不出现成功提示、不落库；恢复后重试成功。
7. `running plan completion pauses latest timer and uses recorded summary`：运行中计划登记 → 计时暂停持久化、记录唯一、总结展示、复看为只读。

第 4–7 项是“本地行为/持久化正确性”检查：注册完成后 harness 在浏览器层拦截 `**/api/workspace*`，
避免合成场景快照被当作合成云端写入或云端同步竞态影响断言；第 1–3 项不拦截，真实走服务器。

## 4. 与旧脚本的差异（修复的问题）

| 旧 `scripts/verify-screens.ts` | 新脚本 |
|---|---|
| 直接 `sqlite3 data/potato.db` 写邀请码 → 污染真实库 | 隔离 `DATA_DIR` + server CLI 生成邀请码，真实库零写入 |
| 业务测试跑在 `vite preview`（无后端）上，注册/登录全失败，失败是 harness 伪失败 | 业务测试跑在真实 Express+SQLite 隔离服务器上（真注册/真同步/真 SW） |
| 业务检查在 preview 内存态上断言人工写入 IndexedDB 的快照 → 必失败 | 视觉只做布局截图；业务用独立 context 的原生 IndexedDB 断言 |
| 无法证明真实库未被写 | 运行前后 data/ 递归 fingerprint 硬证据；失败即非零退出 |
| 只在 /tmp 输出 results.json，无来源版本信息 | 证据 log/results/isolation JSON 落 `docs/implementation/evidence/`，含 RUN_ID/DATA_DIR/URL/WEB_BUILD/构建身份/git HEAD+worktree 指纹/退出码 |
| `VERIFY_URL` 指向外部时仍可能注册写数据 | `VERIFY_URL` 默认只读（7 项业务检查显式 `skipped`，不算通过）；仅 `VERIFY_ISOLATED=1` + `VERIFY_INVITE_CODE` 才允许写 |

另：50 屏矩阵保留原有 150 屏 + 3 视口基线，无任何删减；单屏导航增加 1 次有界重试以消除慢机器
导航毛刺（若屏幕真坏，两次都失败，仍记为真实失败，不会掩盖产品问题）。

## 5. 基线失败说明（真实失败计数 = 0）

- 本轮 163/163 通过，失败 **0**。这不是通过跳过/改名测试得到：
  50 屏矩阵 156 项全部保留，业务 7 项全部真实执行（无 `skipped`）。
- 只读审计轮（157/160）中失败的 3 项业务检查（孤儿照片删除 / 写入失败保留草稿 / 计时完成总结），
  失败根因是旧 harness 用 `preview=1` 内存态 + 手工写 IndexedDB 的方式无法成立；
  本 harness 改为真实隔离服务器 + 原生 IndexedDB 后 3 项均**真实通过**，与审计“不能把那几个失败直接等同于正式业务坏掉”的边界一致。
- 开发期一次候选运行（run-20261026-141028）曾出现 1 个视觉项在 393 视口导航超时；
  原因是预览页导航/挂载毛刺，已加 1 次有界重试，正式基线（本文件）无该失败。
  若后续再出现同类失败会原样保留在结果中。
- 若在本次基线之后继续修改 `src/`、`server/`、`public/`，本基线即过期；请重跑：
  `bun scripts/run-isolated-audit.ts`，并以新 RUN_ID / worktree 指纹为准。

## 6. 复现方式

```bash
# 完整证据运行（自建隔离服务器 + 全新 npm run build + 视觉 156 + 业务 7）
bun scripts/run-isolated-audit.ts

# 只跑 harness（同样会自建隔离环境；不写 evidence 文件）
bun scripts/verify-screens.ts

# 快速只跑业务（复用现有 dist）
VERIFY_SCOPE=business VERIFY_REBUILD=0 bun scripts/verify-screens.ts

# 外部 URL 只读模式（禁止注册/写）
VERIFY_URL=https://example.invalid bun scripts/run-isolated-audit.ts
# 外部 URL 明确声明为一次性隔离服务器时才允许写：
VERIFY_URL=http://127.0.0.1:PORT VERIFY_ISOLATED=1 VERIFY_INVITE_CODE=invite_xxx bun scripts/run-isolated-audit.ts
```

退出码约定：`0` 全通过；`1` 有真实检查失败；`2` 环境/依赖/构建/隔离准备失败（fail fast）。

## 7. 本轮改动文件（均未提交 git，未触碰其他测试）

| 文件 | 说明 |
|---|---|
| `scripts/lib/isolated-env.ts` | 新增：隔离环境（临时 DATA_DIR/端口/构建/服务器/邀请码/fingerprint/清理/隔离证明） |
| `scripts/run-isolated-audit.ts` | 新增：证据运行包装器（写 log + 元数据 + 退出码 + 隔离尾部） |
| `scripts/verify-screens.ts` | 重写：视觉 156 项 + 真实隔离服务器业务 7 项，去掉真实库 sqlite3 写入与默认 data dir |
| `docs/implementation/evidence/test-isolation-baseline.log` | 新增：完整运行输出 |
| `docs/implementation/evidence/test-isolation-baseline-results.json` | 新增：163 项逐条结果 |
| `docs/implementation/evidence/test-isolation-baseline-isolation.json` | 新增：data/ 与 git 指纹明细 |
| `docs/implementation/evidence/test-isolation-baseline.md` | 新增：本说明 |

未修改：`src/`、`server/`、`android/`、`public/`、`package.json`、其他测试文件；未 git commit/checkout/stash。

## 8. 已知边界

- 视觉矩阵为 `preview=1` 内存态布局验收，不等于真实账号流程；真实流程由 7 项业务检查覆盖。
- 业务检查为 Chromium 真实 SW/IndexedDB，不是 Android WebView/真机验收；相机、APK 安装、覆盖升级、安全区不在本 harness 范围。
- 业务场景 4–7 的 `/api/workspace` 在浏览器层被拦截（见 §3.2），用于隔离纯本地行为断言；真实云端同步链路由检查 1–3 覆盖。
- 隔离服务器生成后会在 `tmp` 留下截图与服务器日志（仓库外），临时 DATA_DIR 在退出时删除；如需保留原始 DB 可自行改 `VERIFY_REBUILD`/清理逻辑（当前交付不保留含测试账号的 DB）。
