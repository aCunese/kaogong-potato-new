# 服务端契约与防护证据：R06 / R18 / R10 / 版本 nonce（server-contracts / task-1）

- **Owner**: server-contracts（Teammate）
- **日期**: 2026-10-26（Asia/Tokyo）
- **仓库**: `/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
- **基线**: 工作区（`codex/prod-release-m1-m4` 工作树，HEAD `bc368b7`）；本任务**未做任何 git commit/checkout/stash**。
- **写作用域**: `server/**`、`tests/server.test.ts`、`docs/implementation/evidence/server-*.md`（真实 `data/`、`src/`、`android/`、`scripts/` 未触碰）。
- **测试隔离**: `tests/server.test.ts` 顶部在 import 前设置 `process.env.DATA_DIR = /tmp/potato-test-<时间戳>-<随机>`，`after()` 中 `closeDb()` 并 `rmSync` 临时目录；全程不使用真实 `data/potato.db`。

---

## 1. R-item 状态表（实现 vs 验证）

| 项 | 服务器侧状态 | 验证方式 | 剩余依赖（非本任务写作用域） |
|---|---|---|---|
| **R06** 错题照片/头像阻塞整个账号同步 | **已实现** | `npm run test:server` 新增用例 4/5 通过：`WrongRecord.image`、旧版 `images[]`、`avatar` 旧版 data URL 均 200 同步；`/api/media/<id>`、`media:<id>` 归属校验；未知/跨账号 → 400 `INVALID_MEDIA_REF`；`blob:`/`file:`/非图片 `data:`/未知相对路径 → 400；单图 data URL > 3,000,000 字符 / 头像 > 2,000,000 字符 → 400 | 前端仍需把新照片改为「先 `POST /api/media/upload` 拿稳定引用再提交工作区」，才能真正实现跨设备照片补传（`src/` 属其他任务）；服务器已同时兼容旧版 data URL（有界），正常错题照片/头像不再导致整账号 400 |
| **R18** schema 非法计划遗漏 + 工作区历史无界放大 | **已实现** | 新增用例 6/7/9 通过：非法 `plan.type`、`timerStart` 字符串/负数、负 `accumulatedMs`、非有限数、非法日期、超长字符串、未知根字段 → 400；`state.version` 存在且 ≠3 → 400；工作区 JSON > 12 MiB → 结构化 **413 `WORKSPACE_TOO_LARGE`**；历史保留策略与幂等保留策略有界化 | 无（服务器侧完成）。生产历史数据未做任何离线清理；策略只在新写入时惰性裁剪 >7 天旧快照 |
| **R10** 旧空库初始化选择只存 localStorage | 服务器侧**已实现**（持久化 + 合并 + 幂等） | 新增用例 3 通过：`GET /api/workspace` 返回 `needsInitChoice`/`initChoice`（判定仅依据服务端 `seed_version`/`init_choice`/books/courses，不看设备 localStorage）；`POST /api/workspace/init-choice` 需登录+CSRF；`default` 事务内按稳定 seed ID 合并 14/7/22 且保留自定义事项/改名/defaultMinutes/题本进度/plans/profile，revision+1、seed_version=1；重复调用 `alreadyApplied: true` 不二次 bump；`blank` 保留原状态、revision+1；非法枚举 400 | 前端 `EmptyLibraryChoiceModal`/`AppContext` 改为调用该端点并应用返回 state（`src/` 属其他任务）；服务器契约已就绪 |
| **F12**（审查结论「已增强但图片字段契约错误且核心计划字段遗漏」） | 服务器侧**已修复** | `validateWorkspacePayload` 现已覆盖 `state.version`、plan/record 的 type 枚举与有限非负数值、YYYY-MM-DD 日期、全字符串上限、`wrong.image`/`images`/`avatar` 统一图片契约；`tests/defects-f01-f12-regression.test.ts` F12 用例仍通过（`npm run test:unit`：F12 pass） | 无 |
| **R16 服务端配合**（版本新鲜度证明） | **已实现** | `GET /version.json?nonce=…` / `GET /api/version?nonce=…` 回显 `nonce`（最长截断 64 字符）并新增 `servedAt` ISO 时间；无 nonce 时不下发该字段；既有字段（version/build/schemaVersion/apk*）全部保留；新增用例 1 通过 | 客户端 `versionCheck.ts`/SW 缓存策略改造属 android-update 任务，需实际消费 `nonce`/`servedAt` |

**结论**：本任务范围内的服务器契约项（R06 服务端、R18、R10 服务端、版本 nonce、媒体秒传、contentHash）已实现并经真实 HTTP 测试验证；R06/R10 的「客户端完成」仍需前端任务接线，不能仅凭本证据宣称端到端照片补传或初始化弹窗已完成。

---

## 2. 按 Lead 契约 A–I 的实现对照

| 契约 | 实现位置 | 行为 |
|---|---|---|
| **A** 错题照片统一契约 | `server/workspace.ts` `validateImageRef` / `parseMediaRef` / `validateMediaRefsOwnership` | 允许 `''`、`/^pose-[0-7]$/`、`/branding/…`（禁 `..`，≤256）、`/api/media/<id>`、`media:<id>`（归属校验）、旧版 `data:image/(jpeg\|jpg\|png\|webp);base64,`（≤3,000,000 字符）、旧版 `https://`（≤512）；拒绝 `blob:`、`file:`、非白名单 data:、未知相对路径。`wrong[].images` 沿用同一元素规则（≤9 个）。未知/跨账号媒体 ID → **400 `INVALID_MEDIA_REF`** |
| **B** profile.avatar | 同上 | 同一形式集；旧版 data URL ≤2,000,000 字符；https ≤512；空串允许 |
| **C** `GET /api/workspace` 新字段 | `server/app.ts` + `getUserWorkspace` | 保留既有字段，新增 `contentHash`（`sha256(stored state_json)`，无 row 为 null）、`needsInitChoice`、`initChoice`。`needsInitChoice = row 存在 && seed_version===0 && init_choice IS NULL && books.length===0 && courses.length===0`；不读取 localStorage/设备状态 |
| **D** `POST /api/workspace` 响应字段 | `syncUserWorkspace` | 200：新增 `contentHash`（新写入 state_json 的 sha256；幂等重试返回原 payload hash）。409 `REVISION_CONFLICT` / `GENERATION_MISMATCH`：新增 `contentHash`、`serverContentHash`、`snapshotGenerationId`；保留 `serverState`/`serverRevision`/`generationId`/code |
| **E** `POST /api/workspace/init-choice` | `server/app.ts` 路由 + `applyWorkspaceInitChoice` / `mergeDefaultSeedIntoState` | 登录+CSRF；`workspaces.init_choice` 列迁移；`default`：事务内按稳定 seed ID 合并 14/7/22（已存在同 ID 项保留进度/改名/defaultMinutes，自定义项全保留，只补缺失默认项；plans/records/wrong/profile/countdowns 保留），revision+1、seed_version=1；`blank`：状态不变，revision+1、seed_version=1；响应 `{ok,revision,generationId,contentHash,state,seedVersion,initChoice,alreadyApplied}`；已选择过 → `ok:true, alreadyApplied:true` 且不再 bump |
| **F** 媒体上传幂等 | `server/media.ts` `saveUserMedia` + `server/app.ts` 上传响应 | 同 user + 同 sha256 命中既有记录 → 返回同 `media.id`、`url:'/api/media/<id>'`、`deduplicated:true`；不新增 `media_records` 行、不重复累计配额；磁盘文件缺失时按本次内容自愈补齐。既有 500MB/账号配额逻辑保持不变 |
| **G** 工作区上限与保留策略 | `server/workspace.ts` 常量 + `server/retention.ts` | 序列化 state > **12 MiB** → 413 `{ok:false,code:'WORKSPACE_TOO_LARGE',message}`；历史：最近 **7 天**快照无条件保留，只裁剪 >7 天的旧快照，使其满足「整账号历史 ≤30 行 且 state_json 总量 ≤8 MiB」；幂等表：只保留最近 **30 天**且每账号最多 **200** 行（仅写入时惰性裁剪） |
| **H** 校验规则 | `validateWorkspacePayload` | `state.version` 存在时必须 `number === 3`（缺失按 Lead 决策兼容旧版）；`plan.type`/`record.type` 存在时必须在 `{book,course,custom}`；`timerStart`/`accumulatedMs`/`plannedMinutes`/`actualMinutes`/`targetMinutes`/`questions`/`errors`/`lessons` 存在时必须 `Number.isFinite` 且 ≥0；日期 `^\d{4}-\d{2}-\d{2}$`（countdown 允许 `''`）；id ≤128、book/course/library name ≤120、plan name ≤200、note ≤2000、countdown name ≤40、url ≤2048；缺失的旧版 plan 字段容错放行（存储不改写） |
| **I** 版本 nonce | `server/app.ts` | 见 R16 行；`Cache-Control: no-cache, no-store, must-revalidate` 保持；nonce 仅字符串参数，超过 64 字符截断，不伪造 |

---

## 3. 明示常量（可审计）

| 常量 | 值 | 位置 |
|---|---|---|
| `MAX_WORKSPACE_PAYLOAD_BYTES` | `12 * 1024 * 1024`（12 MiB） | `server/workspace.ts` |
| `MAX_WRONG_IMAGE_DATA_URL_CHARS` | `3_000_000` | `server/workspace.ts` |
| `MAX_AVATAR_DATA_URL_CHARS` | `2_000_000` | `server/workspace.ts` |
| `MAX_LEGACY_HTTPS_URL_CHARS` | `512` | `server/workspace.ts` |
| `MAX_UNIQUE_MEDIA_REFS` | `5000`（单次同步去重后媒体引用上限） | `server/workspace.ts` |
| `WORKSPACE_STRING_LIMITS` | id 128 / book·course·library name 120 / plan name 200 / note 2000 / countdown name 40 / url 2048 / storagePath 256 | `server/workspace.ts` |
| `WORKSPACE_HISTORY_KEEP_ROWS` | `30` | `server/retention.ts` |
| `WORKSPACE_HISTORY_MAX_BYTES` | `8 * 1024 * 1024`（8 MiB） | `server/retention.ts` |
| `WORKSPACE_HISTORY_RECENT_WINDOW_MS` | `7 * 24 * 60 * 60 * 1000`（7 天） | `server/retention.ts` |
| `SYNC_IDEMPOTENCY_MAX_ROWS` | `200` | `server/retention.ts` |
| `SYNC_IDEMPOTENCY_TTL_MS` | `30 * 24 * 60 * 60 * 1000`（30 天） | `server/retention.ts` |
| `MAX_USER_QUOTA_BYTES`（既有） | 500 MB / 账号 | `server/media.ts` |

---

## 4. 命令与结果（本轮真实执行，含 exit code）

```bash
# 1) 服务端 TypeScript 类型检查
npx tsc --project tsconfig.server.json --noEmit
# exit 0（无输出）

# 2) 服务端接口/安全 + 本任务新增契约套件
npm run test:server   # node --import tsx --test tests/server.test.ts
# exit 0
# # tests 17
# # pass 17
# # fail 0
# # duration_ms ≈ 3631（含 12MiB 级 payload 用例）

# 3) 灾备恢复套件（独立 tmp DATA_DIR；确认 R18 改动未破坏 DR）
npm run test:dr
# exit 0
# # tests 3 / # pass 3 / # fail 0

# 4) 前端相关单测（非本任务写作用域；当前工作区有其它 teammate 并发修改 src/）
npm run test:unit
# exit 1
# 100 pass / 2 fail（详见 §7，均为 src/ 并发改动引起，与本任务 server/** 无关）
```

**`npm run test:server` 用例清单（17）**

1. GET /version.json and GET /api/health return structured system telemetry
2. Single-use invitation registration, Argon2id hashing and uniqueness
3. Login failure rate limiting and CSRF protection
4. Workspace revision sync, idempotency, and 409 conflict detection
5. Multi-user isolation: User A cannot read User B media attachments
6. Admin password reset, session revocation, single-user restore, and generation rotation
7. User backup export, history tracking, and history restore endpoints (/api/backups/*)
8. Concurrent double-spend protection for invite codes and password resets (Defect H)
9. **I)** version endpoints echo `?nonce=`（≤64）并新增 `servedAt`，既有字段保留
10. **C/D)** GET `contentHash`/`needsInitChoice`/`initChoice`；POST 200/409 增加 `contentHash`，409 增加 `serverContentHash`/`snapshotGenerationId`
11. **E/R10)** init-choice：default 合并保留自定义项/进度/改名/plans，一次性幂等，blank 分支，CSRF + 枚举守卫
12. **A/B/R06)** 前端 `WrongRecord.image` + 有界旧版 avatar data URL 正常同步；`images[]` 旧形态兼容；超限 data URL 400
13. **A/R06)** 媒体引用归属校验：合法 `/api/media/<id>`、`media:<id>`（含 `images[]`）；未知/跨账号 → 400 `INVALID_MEDIA_REF`；`blob:`/`file:`/非图片 data:/未知路径 → 400
14. **H/R18)** 非法值严格 400（version/plan.type/timerStart/accumulatedMs/日期/超长字符串/负数/未知根字段），缺失旧版字段容忍（Lead 决策）
15. **G/R18)** payload >12 MiB → 413 `WORKSPACE_TOO_LARGE`；<12 MiB 仍接受
16. **F)** 媒体上传按 (user_id, sha256) 秒传：稳定 id、`deduplicated`、稳定 url、不重复配额、不新增行
17. **G/R18)** 保留策略：7 天窗口内历史永不裁剪；>7 天旧行裁剪至 ≤30 行/≤8 MiB；幂等行 ≤200 行且清理 >30 天旧行

---

## 5. 本轮改动文件

| 文件 | 改动 |
|---|---|
| `server/db.ts` | 迁移：`workspaces.init_choice TEXT`；新增索引 `idx_media_user_sha`、`idx_history_user_created`、`idx_idempotency_user_created` |
| `server/retention.ts` | **新增**：历史/幂等保留策略常量与惰性裁剪函数（`pruneWorkspaceHistory`、`pruneSyncIdempotency`、`getRetentionPolicy`） |
| `server/workspace.ts` | R18 全字段强类型校验；R06 图片/头像统一契约 + 媒体归属校验；12 MiB 载荷上限；`contentHash`；`needsInitChoice`/`initChoice`；`POST init-choice` 服务端合并与幂等；同步/恢复路径接入保留策略 |
| `server/media.ts` | 上传按 (user_id, sha256) 秒传、`withMediaUrl`、`deduplicated` 标记、磁盘缺失自愈；既有配额逻辑保留 |
| `server/app.ts` | 版本端点回显 nonce + `servedAt`；新增 `POST /api/workspace/init-choice`；上传响应加 `url`/`deduplicated`；body 上限仅对精确 `/api/workspace` 放行 50MB（`init-choice` 回到 64KB）；注册事务写入 `init_choice='default'` |
| `server/admin.ts` | 单用户恢复写入历史后接入保留策略 |
| `tests/server.test.ts` | 新增 9 个契约用例（17 总用例全通过），全部使用隔离 tmp `DATA_DIR` |
| `docs/implementation/evidence/server-contracts.md` | 本证据文件 |

未修改：`src/**`、`android/**`、`scripts/**`、`tests/disaster-recovery.test.ts`、真实 `data/**`。未执行 git commit/push/checkout/stash。

---

## 6. 真实数据未被触碰的证据

```text
$ ls -la data/
data/potato.db       mtime=Oct 26 15:21:15 2026  size=98304
data/potato.db-wal   mtime=Oct 26 22:22:47 2026  size=622152
data/potato.db-shm   mtime=Oct 26 21:52:01 2026  size=32768
```

- 上述 mtime 均早于本任务测试执行时间（22:45+）；`tests/server.test.ts` 在 import app 前设置 `DATA_DIR=/tmp/potato-test-*`，`after()` 删除临时目录。
- 未对生产/真实数据库执行任何迁移、清理、删除或重建；`init_choice` 列迁移只在服务启动 `getDb()` 时按 `ALTER TABLE` 幂等执行（与既有 `seed_version` 迁移同模式）。
- 本任务**没有**清理任何真实生产历史数据；保留策略仅在任何「新写入」事务内惰性裁剪 >7 天旧快照。

---

## 7. 剩余风险 / 阻塞项（如实说明，未验证的不宣称）

1. **端到端 R06 尚未闭环**：服务器已验收「旧版 data URL 不再 400 + 媒体引用归属校验 + 上传秒传」，但前端仍无「照片上传队列 → 稳定媒体引用 → 工作区提交」接线（`src/` 属其他任务）。在接线完成前，用户错题照片仍以完整 data URL 快照同步（已有界，不再阻塞账号），跨设备照片补传不能宣称完成。
2. **R10 端到端未闭环**：`EmptyLibraryChoiceModal` 目前仍写 localStorage/本地 mutation，尚未调用 `POST /api/workspace/init-choice` 并应用返回 state；服务器契约与持久化已就绪，需前端任务接线后才能宣称「换设备不再重复询问」。
3. **R16 新鲜度证明未闭环**：服务端已回显 `nonce`/`servedAt`；`versionCheck.ts` 与 Service Worker 改造（android-update 任务）尚未见消费该字段的验证。
4. **`npm run test:unit` 当前 exit 1（100 pass / 2 fail），与本任务改动无关**：
   - `Defect Regression Suite (F01) ... GENERATION_MISMATCH`：`src/utils/db.ts`/`src/types/index.ts` 中 `OutboxRecord` 契约已被并发修改（测试仍用旧 `type/clientMutationId/baseRevision/payload` 字段），失败点在 `getPendingOutbox` 返回 0；
   - `Milestone 3 ... DownloadApkModal ... v1.0.1 info`：`src/components/views/DownloadApkModal.tsx` 正在被 android-update 任务修改。
   - 本任务未触碰 `src/**`；`tests/defects-f01-f12-regression.test.ts` 的 F12（服务器校验）用例通过。最终 `npm test` 需待前端任务完成后由 Lead 复核。
5. **保留策略语义边界（按 Lead 契约）**：只裁剪 `created_at` 早于 7 天窗口的旧快照；7 天内高频写入不受 30 行/8 MiB 限制（单次写入受 12 MiB 载荷上限约束）。极端高频写入仍可能在 7 天窗口内累积磁盘，建议后续增加运维告警/定时清理任务（本任务未对生产执行）。
6. **旧版非法状态应用 init-choice 的边缘情况**：若某账号云端 state 本身违反新严格校验（历史上被旧版宽松 validator 接受），`default` 合并后会再次校验并返回 400；不影响新注册/正常账号，但极端旧数据需人工迁移。未对生产数据做抽样验证（避免触碰真实 DB）。
7. **未运行客户端 `npm run typecheck`**：`src/` 正被其他 teammate 并发修改，客户端类型检查结果不能归因于本任务；本任务只保证 `tsconfig.server.json` 通过。
