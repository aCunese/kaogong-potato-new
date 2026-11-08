# 土豆新版资料保存修复与正式上线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 如果当前执行器没有这些技能，按本文相同顺序实现、独立审查与验证，不因技能缺失跳过工作。

**Goal:** 修复资料保存、导入、附件、恢复、备份交付和升级的已知缺陷，完成单实例生产部署，让本人和朋友能开始使用。

**Architecture:** 保留现有 React/IndexedDB/Express/SQLite/Java WebView。通过短事务 CAS、冻结 outbox、贯穿身份 scope、原子恢复点和内核维护锁修复数据边界；用已有页面接通备份和冲突入口。生产使用不可变镜像与既有真实数据卷，全量切换，不做灰度。

**Tech Stack:** React 18、TypeScript、Vite、IndexedDB、Express、better-sqlite3、Bun/Playwright、Python3 fcntl、Docker Compose、Android Java17/WebView/SAF。

**Spec:** [2026-10-27-personal-release-repair-design.md](../specs/2026-10-27-personal-release-repair-design.md)。本文与该设计一并交给实施 AI；下面已列出全部执行要求，不依赖聊天记录或 /tmp 探针。

## Global Constraints

- 项目：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`。原项目“考公工作台”只读。
- 已审基线 `codex/joint-release-hardening@bd31cd4c9bf6b3a3b51f2c2d3b9106152e3ea2bd`；开始先确认是否有后续改动，不能覆盖。
- 执行分支建议 `codex/personal-release-fixes`，从最新已确认基线隔离工作。保留现有 evidence、未跟踪报告、签名产物和用户修改。
- 本人和少量朋友使用；不做灰度、集群、流量分组、大规模压测、云平台迁移或智能双向合并。
- 不新增 npm 生产依赖。维护锁复用镜像当前构建时已安装的 python3，改为在 runner 保留它。
- IndexedDB `kaogong_potato_v3`、旧命名空间、Schema3、包名 `com.ruyne.kaogong` 保持；不清库、清浏览器数据、删近7天历史或换签名密钥。
- 最近7天全部工作区历史保留。旧归档24小时全部/30天每日/8周每周保持；不用容量停写/删图来掩盖问题。
- 50MiB JSON、10MiB 单图、默认500MiB媒体配额保持，UTF-8实际字节判定。
- 正式路径、SSH主机、镜像、签名口令只从现有可信配置确认，不猜测、不在聊天/日志/命令历史暴露。
- 每个源码任务：先失败回归 → 最小实现 → 窄测试通过 → 审查 diff → 独立提交。每阶段只提交该阶段文件，不 `git add .`。
- 所有自动测试使用独立临时 DATA_DIR、附件、端口、浏览器 context。重任务不要同时争用 dist/或证据输出。
- 新增测试与 fixture 必须受版本控制；不能依赖 ignored output/、本机旧包、/tmp 探针或历史 commit 必须可取。
- 生产资料不能被本地data覆盖。禁止 `down -v`、volume prune、同步本地数据库、自动生产恢复、自动清历史。
- Web与APK分开验收。签名/设备缺失时Web可独立发布，但不能称APK已完成；`apkReleased=false` 保持到正式包真正可用。

## Review Focus

1. 同步准备、claim、媒体映射和HTTP提交期间继续编辑/另页编辑，旧请求重试与新任务均不能丢失或换body。归属任务1。
2. A→B、A→游客、A退出再登录A，以及媒体probe忽略abort的迟到响应，不能重新获得新身份继续旧导入。归属任务2、6。
3. 磁盘满、权限/rename失败、helper死亡、SIGKILL、两个恢复进程以及不同容器同卷，必须明确失败且保住原资料。归属任务3、4、5。
4. 老版本已有脏快照、旧备份/多图、外链、中文UTF-8容量边界、超长题图和旧APK缺备份能力，必须保数据并给可执行提示。归属任务1、5、6、8。
5. 线上实际数据路径不同、旧SW会话、后台计时、未同步记录、同名低build回滚和旧签名覆盖，不能用清数据/换空卷/重装绕过。归属任务9、10、11。

---

## 准备：建立隔离执行基线

**Files:** 读根目录/local AGENTS、package.json、Dockerfile、docker-compose.yml、deploy/、src/types/index.ts及设计文档；新增 `docs/implementation/PERSONAL-RELEASE-EXECUTION.md`。

**Produces:** 独立工作分支/目录；基线commit、原工作区状态、真实data内容指纹、执行检查表；不复制真实data到测试。

- [ ] 读取适用项目约定，核对branch/HEAD/status与相关diff。发现后续修改先逐项保留并调整落点，不重置。
- [ ] 使用可用原生worktree能力隔离；若用git fallback，从已核验commit创建上述codex分支。文档可读回原目录，不把用户未提交内容无差别复制。
- [ ] 记录真实data目录文件清单、大小、SHA；不输出用户正文、账号隐私、token。测试前后以内容指纹比较；mtime单独记录。
- [ ] 确认bun/node/python3/Java17/Android SDK34；缺Docker/真机/原签名口令单独记缺口，不把它们当已通过。
- [ ] 在隔离目录运行当前 `npm test` 和 `npm run build` 建基线；如果V12依赖ignored harness或V10依赖旧Git对象，记录为测试输入缺陷，在任务9修复后完整重跑，不能删断言。
- [ ] 建立执行表：每任务commit、测试命令/exit、证据路径、PASS/FAIL/未完成。源码任务开始后按顺序推进，不停在只给建议。

## Task 1：同步事务、冻结请求与旧脏快照保护

**Files:** Modify `src/types/index.ts`、`src/utils/db.ts`、`src/utils/syncClient.ts`、必要的`src/utils/mediaSync.ts`；Test `tests/sync-core-regressions.test.ts`、`tests/storage-regressions.test.ts`，复用`tests/fixtures/sync-harness.ts`。

**Interfaces:**

```ts
interface WorkspacePushPayload {
  requestId: string;
  expectedRevision: number;
  expectedContentHash?: string;
  schemaVersion: 3;
  generationId: string;
  state: AppState;
  reason: string;
}
interface PreparedOutboxCompaction {
  targetTaskId: string;
  observedTaskIds: string[];
  snapshotToken: { revision: number; contentHash: string };
  state: AppState;
  expectedRevision: number;
  generationId: string;
}
compactOutboxForFlush(userId: string, prepared: PreparedOutboxCompaction,
  options?: { context?: OperationContext }): Promise<OutboxRecord | null>;
ensureSnapshotHasOutbox(userId: string,
  options?: { context?: OperationContext }): Promise<'clean' | 'queued' | 'conflict'>;
```

**Consumes:** 现有SnapshotRecord、SyncBaseline、OutboxRecord、OperationContext与lease/fence。
**Produces:** 新编辑不丢、重试body冻结、dirty local不会被普通pull覆盖的同步链路。

- [ ] 写失败回归：真实IDB/Web Locks，compaction异步准备barrier暂停，期间commit B；同页与同context双页均覆盖。断言HTTP未完成前B可提交，第一次只发A时B必须仍排队，后续云端推进C也不能静默覆盖B。
- [ ] 写失败回归：服务器提交A后丢响应，期间编辑B；failed及过期in_flight重试A的requestId/body字节不变，服务器revision只推进一次，B用新requestId提交。加入claim准备期间内容漂移、媒体映射期间确认删除任务、不复活旧任务测试。
- [ ] 写旧脏快照回归：可信baseline hash=A，snapshot=B，outbox空；初始hydrate/普通pull先保护B。现存用户资料无可信baseline时转持久冲突；禁止把B当干净缓存覆盖。另测无local snapshot、首次空白、服务端已核实初始化、注册默认14/7/22和空库选择仍正常，不能把新账号堵进永久冲突。
- [ ] Run `bun test tests/sync-core-regressions.test.ts tests/storage-regressions.test.ts --timeout 60000`，确认新增断言在旧代码失败并保存输出。
- [ ] 压缩用snapshots/outbox/sync_state短readwrite事务，重读revision+hash、基线和observed任务集合。准备token不匹配仅取消重试，不删不写。仅合并从未投递且被当前快照覆盖的任务；不按时间戳推断、不删准备后新增任务。
- [ ] 任一frozenRequest/sentAt/attemptFence>0表示曾投递：payload不得重写。首次claim事务外准备完整JSON/hash，事务内比较当前语义payload未变再冻结；HTTP body实际使用frozenRequest。新内容一律新requestId。兼容旧冻结格式只补可证明默认字段；无法证明的记录保留并转待处理，不丢弃。
- [ ] applyMediaRefMappings保留已冻结任务；新媒体映射内容产生新pending/requestId。事务内重读未冻结任务，已确认删除任务不得重新put。维护原snapshot/outbox/media原子性。
- [ ] ensureSnapshotHasOutbox在受scope保护的事务中只为“可信baseline存在、local hash不同且无对应任务”补新任务；基线不明建立持久冲突。在hydrate/pull前及成功判定前调用或复用同一检查。实际安装server state的事务再次CAS本地token并确认无未决任务，挡住检查后的新编辑。
- [ ] 只有snapshot hash=confirmed baseline hash、无未决任务/冲突才synced；否则保留pending/conflict并触发后续处理。hash/fetch不放进活跃IDB事务。
- [ ] 重跑窄测试与 `npm run test:unit`、`npm run typecheck`；审查后提交 `fix(sync): preserve concurrent edits and immutable retry payloads`。

## Task 2：导入身份scope与原子恢复点

**Files:** Modify `src/context/AppContext.tsx`、`src/utils/db.ts`、必要的`src/types/index.ts`；Create `tests/import-scope-regressions.test.ts`，接入test:unit；复用真实AppProvider fixture。

**Interfaces:**

```ts
interface ExecuteMutationOptions {
  context?: OperationContext;
  recoveryBeforeWrite?: boolean;
}
// 内部 executeMutation 增加第三参数；CommitOptions同名透传
executeMutation<T>(mutator: (draft: AppState) => Promise<MutatorReturn<T>> | MutatorReturn<T>, reason?: string,
  options?: ExecuteMutationOptions): Promise<MutationResult<T>>;
```

**Produces:** 导入开始的同一context贯穿网络、恢复点、写入及UI效果；恢复点与替换一起提交。

- [ ] 失败测试：A导入暂停media probe，logout/login B、logout转guest、退出再登录同A；返回迟到200且mock忽略AbortSignal。都须AUTH_EPOCH_CHANGED，B/guest快照和outbox/recovery/UI无导入内容，无B身份POST。
- [ ] 失败测试：导入准备时同账号编辑X，最终恢复点包含实际被覆盖X；注入recovery/outbox put失败，原数据、恢复点和任务全部回滚。
- [ ] Run `bun test tests/import-scope-regressions.test.ts --timeout 60000`，确认旧实现失败。
- [ ] importBackup入口在任何await之前创建scope/context，账号分区只用scope.userId；probe传同abortSignal，每个await后复核。catch优先识别身份取消。
- [ ] executeMutation接收context时直接复用，绝不重取当前user创建新scope。没有传context的既有调用保持行为；owner、outbox、UI及triggerSync都绑定该context。
- [ ] recoveryBeforeWrite在已有snapshot/outbox/media写事务中，从CAS后实际current snapshot保存恢复点，再写导入内容；不在事务内调用另开事务的saveRecoverySnapshot，不先保存到旧账号再写新账号。
- [ ] 对备份文件读取/二次确认同样记录选择时user/epoch；切号清pendingBackup和Reader回调，不能把A选好的文件留给B一键确认。
- [ ] 重跑目标、unit及typecheck，提交 `fix(backup): bind imports and recovery points to the original auth scope`。

## Task 3：附件落盘失败传播

**Files:** Modify `server/media.ts`、`server/admin.ts`、必要HTTP错误映射；Test `tests/server.test.ts`。

**Interface:** 保留ensureAttachmentFile(filename,buffer,attachmentsDir,expectedSha256?):void，成功保证最终size/SHA正确；失败抛带code的错误，外层返回MEDIA_PERSISTENCE_FAILED/5xx，不附可用media URL。

- [ ] 失败测试：旧媒体缺文件/错size/同size错SHA；精准注入write和rename失败。覆盖去重自愈、新上传已有同名坏文件、管理员内嵌图片恢复。
- [ ] Run `npm run test:server`，确认失败点；故障注入放独立child process或串行作用域，不能污染其他测试。
- [ ] 合并新上传/自愈的文件成功语义：唯一temp写入、temp校验、rename、最终校验；失败清本次temp并传播，不把“目标存在”当成功。
- [ ] 失败不增加media记录/配额/workspace/history，管理员恢复不中途提交。补偿不删其他账号或旧记录仍引用文件。
- [ ] 解除故障重试：同账号同图返回原ID、只计一次配额、最终文件SHA正确；客户端保留本地图片与可重试任务。
- [ ] 跑server/typecheck，提交 `fix(media): reject uploads and restores when attachment persistence fails`。

## Task 4：跨容器维护锁与服务生命周期

**Files:** Create `server/dataLock.ts`、`scripts/lib/data-lock.py`、`tests/data-lock.test.ts`；Modify `server/index.ts`、`server/cli.ts`、`server/disasterRecovery.ts`、`server/db.ts`、`Dockerfile`、package test scripts与所有restoreOffline调用方。

**Interfaces:**

```ts
interface DataDirectoryLock {
  release(): Promise<void>; // 幂等
  lost: Promise<Error>;     // 非主动释放时意外丢锁
}
acquireDataDirectoryLock(dataDir: string,
  mode: 'shared' | 'exclusive'): Promise<DataDirectoryLock>;
restoreOffline(options: RestoreOfflineOptions): Promise<RestoreOfflineResult>;
```

**Produces:** Mac/Linux同一fcntl实现；shared服务/CLI/备份与exclusive恢复互斥；不依赖容器PID一致。

- [ ] 使用真实子进程写红测试：idle实际server拒绝restore；exclusive持有时server/写CLI在碰DB前拒绝；两restore竞争；两个shared holder释放一个不影响另一个；SIGKILL后可重入；helper被杀服务非零退出；路径别名同锁；缺python/目录不可写/握手失败均明确失败。
- [ ] 测试脚本接入 `test:server`，运行 `node --import tsx --test tests/data-lock.test.ts` 记录失败。
- [ ] helper以O_CREAT|O_RDWR/0600打开canonical数据目录固定 `.data-maintenance.lock`，LOCK_SH/EX|LOCK_NB，成功输出READY并flush，等stdin EOF。固定锁inode永不unlink/rename，不以PID、TTL或陈旧文件猜可用。
- [ ] Node握手前不打开DB/监听；stderr/退出码区分DATA_LOCK_BUSY、DATA_LOCK_UNAVAILABLE、DATA_LOCK_LOST。helper意外退出时服务停止写入并非零退出，不能继续工作。
- [ ] server全生命周期shared；CLI普通DB命令与hot-backup shared。restore命令仅exclusive，不先shared再升级；锁覆盖校验、安全备份、暂存、就位、rename、最终检查。restoreOffline取得锁，并用try/finally释放；内部模块复用锁而非嵌套取得exclusive。
- [ ] 关闭顺序：停止接收请求、完成在途操作、closeDb、release。启动失败和信号路径都释放；更新所有调用方await，包括灾备测试和备份审计脚本。
- [ ] Docker runner保留python3，复制helper及源码，保持非root；不装npm锁依赖、不启用privileged/共享PID namespace。
- [ ] 本地server/dr/typecheck通过后提交 `fix(recovery): coordinate server and restore with kernel data locks`。跨容器同卷验证在任务10，不得用Mac通过替代Linux容器证据。

## Task 5：恢复前应用schema、manifest和引用校验

**Files:** Modify `server/disasterRecovery.ts`、必要纯校验helper；Test `tests/disaster-recovery.test.ts`、`scripts/backup-restore-audit.ts`。

**Interface:** `validateRestoreDatabase(db, phase:'source'|'staging'|'final')` 返回已验证所需媒体清单；不调用getDb建表。

- [ ] 红测试：合法SQLite空库/marker-only、缺表/必要列/关键约束、损坏或未来schema manifest、坏workspace/history JSON、外键错、跨账号/缺失媒体、坏size/SHA。每次失败原目标逻辑内容/generation/sessions/附件清单不变。
- [ ] Run `npm run test:dr` 确认旧行为失败。修改旧测试的手工假schema fixture为真实应用初始化后的临时库，不削弱故障断言。
- [ ] manifest必须存在且database.filename/hash/byteSize、schemaVersion、attachments字段格式合法；源DB integrity_check全部ok、foreign_key_check无记录。
- [ ] 明确验证server_meta/users/invites/sessions/reset_codes/workspaces/sync_idempotency/media_records/workspace_history的必要列和关键约束。state_json复用现有纯数据validator，媒体引用从真实字段提取。拒绝不支持结构，不根据PRAGMA user_version单值放行。
- [ ] 若旧受支持Schema3缺少后来补列，仅在staging显式迁移并验证；不改source/live，不把未知库补成空库。源manifest/file hash先核验，迁移后重新算staging状态。
- [ ] 校验workspace/history→同user媒体记录→真实附件，size/SHA与路径均核实。历史合法数据不裁剪。staging轮换generation、撤销sessions后再校验，再进入已有安全备份/原子替换。
- [ ] 注入复制、rename、最终校验失败：返回失败且保存现场/安全快照，不自动启动服务；保持明确提交点，不能最终检查失败仍打印SUCCESS。
- [ ] 合法恢复后用户/工作区/历史/照片完整，generation变化、sessions清空、重新登录可读，恢复后可继续同步。
- [ ] 跑dr/server/typecheck，提交 `fix(recovery): validate application backups before replacing live data`。

## Task 6：正式备份入口与Android真实文件保存

**Files:** Modify `SettingsView.tsx`、`App.tsx`、`BackupModal.tsx`、`AppContext.tsx`、`src/types/index.ts`；Create `src/utils/backupExport.ts`、必要`android/.../BackupExporter.java`、`tests/backup-export-regressions.test.ts`；Modify MainActivity.java与APK断言。

**Interfaces:**

```ts
type BackupExportReceipt =
 | {status:'saved';destination:'android-document';filename:string;bytes:number}
 | {status:'download_requested';destination:'browser';filename:string;bytes:number}
 | {status:'cancelled';destination:'android-document'};
exportBackup(): Promise<MutationResult<BackupExportReceipt>>;
saveBackupFile(blob: Blob, filename: string,
  context: OperationContext): Promise<BackupExportReceipt>;
SettingsViewProps.onOpenBackup: () => void;
```

**Native capability:** getAppInfo增加backupExportProtocol:1，原bridgeProtocol保持。四方法beginBackupExport(requestJson)、appendBackupExport(operationId,sequence,base64Chunk)、finishBackupExport(operationId)、cancelBackupExport(operationId)。JSON request含operationId/filename/mimeType固定application/json/bytes/sha256。原生ack含ok/operationId/nextSequence或code/message。

**Produces:** 正式页面可用、结果可信、原APK更新链路不被备份功能覆盖。

- [ ] 红测试：非preview正式设置点击打开备份；browser/native saved/cancelled/failed反馈分别准确。缺/旧桥、非可信页、错误ack、旧operationId、重复终态、切号/卸载不假成功。
- [ ] 新增并接入unit脚本；运行 `bun test tests/backup-export-regressions.test.ts --timeout 60000`。浏览器真实download验文件，不能只检查a.click调用。
- [ ] 正式设置新增“数据备份与恢复”，App接已有BackupModal；去掉产品界面中的Figma节点号，修正“未备份无法找回”为实际恢复点行为。
- [ ] Web复用任务2的原context，准备最新快照与照片、按UTF-8校验，交给保存适配。browser仅返回download_requested；旧APK无capability明确提示更新或用系统浏览器导出，不再blob假成功。
- [ ] 新建备份专用 `window.__kaogongBackupExportEvent` 与Java emitBackupExportEvent，事件backup_saved/backup_cancelled/backup_failed；不要覆盖__kaogongAndroidEvent，不把备份终态写进APK安装状态。
- [ ] 原生begin建私有cache临时文件；每块最多48KiB原始字节/64KiB Base64，严格sequence，append成功ack后JS才发送下一块。累计不得超申报值及50MiB，不构造整包Java String。每步检查operationId/page epoch/可信页，JS每块检查原账号scope。
- [ ] finish验证字节数/SHA并关闭temp流，UI线程ACTION_CREATE_DOCUMENT/CATEGORY_OPENABLE/application-json/EXTRA_TITLE，独立请求码；返回URI后后台流式复制并关闭成功，才发saved。用户取消发cancelled；错误或空URI按定义失败；尽力清本次未完成文档，终态清temp。文件选择期间不设短硬超时。
- [ ] 页面导航/Activity销毁/切号取消当前导出；桥线程不读取WebView对象，选择器/evaluateJavascript只在UI线程。安装权限、相册、系统返回码维持原状态机。
- [ ] 导入在readAsText前检查file.size≤50MiB，pendingBackup绑定选择时scope。格式/媒体失败留在弹窗，不清原资料。
- [ ] unit/typecheck/build及unsigned APK通过；Java harness覆盖乱序/重复/缺块/超限/写失败/取消/旧回调。提交 `feat(backup): expose backup settings and save Android JSON through SAF`。真机保留到任务10。

## Task 7：冲突暂缓与可恢复动线

**Files:** Modify `src/App.tsx`、`ConflictModal.tsx`、`SettingsView.tsx`；Test `tests/ui_interaction.test.ts`及`scripts/business-e2e-audit.ts`。

**Interfaces:** App维护dismissedConflictKey，key由userId+serverGenerationId+serverRevision+serverContentHash构成；SettingsView增加onOpenConflict；冲突处理回调返回Promise<MutationResult<void>>。

- [ ] 红测试：真实两设备形成冲突后断网，关闭/“稍后处理”可返回本地；继续登记与拍照可保存；normal sync不覆盖云端；updateGuard仍阻止更新；设置/常驻提示能重开。
- [ ] 同冲突重复网络返回不反复弹，新冲突与重新登录可再提醒；刷新后提醒一次可接受。
- [ ] 隐藏只改变UI，不清conflictData/IDB冲突/outbox/恢复点；不调用discardConflictRecord，不偷选任一方。
- [ ] 两个裁决按钮等待期间禁重复提交，错误留在弹窗；会话失效可暂缓后重新登录。仍使用原reviewed revision/generation/hash和本地CAS。
- [ ] 成功裁决才清冲突；暂缓仍有明显待处理标记，不能显示全部已同步。
- [ ] 跑unit和新增E2E目标，提交 `fix(conflict): allow deferral without dropping conflict protection`。

## Task 8：容量、照片可读性与小范围动线完善

**Files:** Modify `BackupModal.tsx`、`src/utils/db.ts`、`server/workspace.ts`、`imageCompressor.ts`、`EditModals.tsx`、`CompletionModal.tsx`、`ConflictModal.tsx`、App/context；Create必要小纯函数与 `tests/backup-photo-regressions.test.ts`，接入unit。

**Interfaces:** `countWrongAttachments(wrong:WrongRecord[]):number`每笔记内image/images去重后累加；`PhotoImportModal.initialTarget?:{bookId:string;date:string}`；`addWrongRecords(bookId,note,images,date?:string)`缺省沿用activeDate。

- [ ] 红测试UTF-8 JSON恰好50MiB与超1字节、中文/emoji；超限整体失败不缺图“成功”；40MiB起提醒，界面说明50MiB JSON与500MiB云端不同；不把估计体积当实际字节。
- [ ] 内部图片全部内联；历史https外链客户端仅经正常CORS读取并内联，无凭据泄露；失败明确提示记录位置并拒绝完整离线导出。服务端不新增任意URL抓取，不能保留外链还称完全自包含。
- [ ] 真实Canvas测试普通图、1080×6000长图、1080×10000超长图、小图、透明/损坏/超20MiB原文件；不只测缩放公式。
- [ ] 非长图保持1200×1200/quality0.75；长短边比>2的错题图使用长边4096、短边1200包围盒，不放大，短边不得低于min(原短边,720)，无法满足就提示裁剪分段。头像不改，服务端4096/10MiB边界不提高。
- [ ] 复用validateImageBatch限制单批10张/单文件20MiB，避免无限Promise.all解码；一张失败不能清掉已成功预览，具体提示失败项。不自动删原图/降低已有照片质量。
- [ ] 冲突卡片显示全部日程/记录/错题条目/附图数，去掉普通用户不理解的Rev主文案但保留可选版本信息。共享照片计数函数与备份概览。
- [ ] 登记成功且book记录errors>0、题本仍存在时显示“拍下错题”；先关成功弹窗再打开现有拍照弹窗，预选record.sourceId与record.date。取消拍照不撤销登记，不重复累加统计，不加新数据关系。
- [ ] 跑新增unit、workflow/ui相关测试、typecheck/build，提交 `fix(ux): clarify backup limits and preserve readable wrong-question photos`。

## Task 9：可复现测试、版本封板、生产配置和SOP

**Files:** Modify `package.json`、`package-lock.json`（仅确需版本元数据）、`release.json`、`public/version.json`、`public/sw.js`、`android/app/build.gradle`、`src/App.tsx`、`src/context/AppContext.tsx`、`scripts/lib/boundary-checks.ts`、`scripts/build-apk.sh`、备份脚本、SOP；Create `tests/fixtures/android-install/Harness.template.java`、`tests/fixtures/sw/legacy-sw.js`、`deploy/compose.prod.yml`、`deploy/release.env.example`。

**Produces:** 新检出可运行套件；统一候选版本；不可变镜像生产模板与正确上线/恢复/回滚流程。

- [ ] 红测试/复现：无output/、无旧Git对象环境V10/V12不能运行。将所需旧SW与Java模板纳入tests/fixtures并记录来源；Java模板每次注入当前源码对应方法，不能测试旧拷贝当现实现。
- [ ] 新增测试文件全部接默认npm test。产物检查统计读取实际输出，不硬编码173/19等旧计数；保留原有效断言。
- [ ] 读取线上version.json和既有已分发APK最大code，仅收版本信息。目标候选1.0.5/code6/build20261027.04；已有相同/更高时统一递增，跨日用执行日新build。Schema仍3、包名不变。
- [ ] release.json单一发布身份，public/version.json用version/build字段；package/gradle/source SW与构建SW/precache一致。APK暂false/hash空/size0，实际签名后才回填；不能将unsigned SHA写成正式包。
- [ ] 补更新保护的明确落点：AppContext增加 `registerUpdateBlocker(id:string,reason:string):()=>void`，用ref保存活动阻断项，注销幂等；App在登记、题本/课程/自定义事项、资料编辑、拍照和备份导入导出等数据编辑窗口开启时注册，关闭/卸载清理。不把更新弹窗自己注册为阻断。`updateGuard`检查计时、持久冲突、pendingSyncCount>0及活动编辑阻断，在激活前后都复核。测试窗口已开及激活等待中才打开窗口两种情况，输入保持、无reload；关闭编辑并同步完成后可更新。首次可用/回前台/online/手动检查沿用，无新增强刷或轮询承诺。
- [ ] 生产Compose使用image:${APP_IMAGE:?required}与绝对${PROD_DATA_DIR:?required}:/app/data，保持service/container/loopback/非root/healthcheck/log rotation。移除生产宿主scripts/APK旧内容覆盖，产物随镜像交付；开发compose可保留。
- [ ] 明确python3 runtime、helper镜像路径；镜像不含data、keystore、.env。CLI hot-backup/恢复脚本环境显式，恢复命令不默认猜生产目录。
- [ ] 修SOP：删除灰度/集群；统一Compose服务名/实际卷；停容器后用一次性容器恢复；不承诺30分钟后台刷新、掉电零丢失、固定秒数恢复、恢复后无需登录。
- [ ] 备份用已完成热备目录而非活跃data原始复制；Restic若已配置则用固定标签/固定分组，版本写manifest；网络/鉴权失败不能自动restic init，异机失败单独失败。没有Restic允许安全取回tar，不能假称异机已通过。维护前后备份与小时定时任务流程写清。
- [ ] Web回滚保持资料，仅发布兼容旧行为+更高build；数据恢复单独停服、留现场、指定精确备份且告知备份后变更范围。APK只更高code/原签名修复，不卸载降级。
- [ ] 跑新版unit/server/dr/typecheck，审查生产模板解析（Docker可用时docker compose config，不打印凭据），提交 `chore(release): seal reproducible tests and personal production runbook`。

## Task 10：最终回归、Linux镜像、恢复和正式APK验收

**Files:** 执行已有verify脚本，在隔离输出记录；必要扩展验证脚本只增加真实检查，不削弱断言；更新执行表。

**Consumes:** 任务1–9全部代码；Produce最终候选commit、镜像digest、Web与APK各自证据。

- [ ] 在新的源码导出/检出目录（不拷ignored output、不带真实data）安装锁文件依赖并运行下列命令；顺序执行构建/会改同一证据的套件，逐项记录exit和计数。

```bash
npm run typecheck
npm test
npm run build
npm run verify:boundaries
npm run verify:auth
npm run verify:backup
npm run verify:business
VERIFY_REBUILD=0 npm run verify:isolated
npm run verify:apk
```

- [ ] 不用preview内存成功替代真实持久化，不把HTTP mock接受跨账号内容称真实server接受。新增同步/导入测试同时有真实IDB和真实隔离server契约验证。
- [ ] 最终Docker镜像Linux实构建，空临时卷启动、旧版本测试数据副本升级、容器删除重建后同卷资料不丢；UID1000可写，SQLite/Argon2 native模块正常，镜像不夹带真实data。
- [ ] 两个不同PID namespace容器挂同一临时卷，验证shared/exclusive、idle server拒恢复、SIGKILL释锁、helper死亡退出。不能用本机Python锁测试替代。
- [ ] 用测试用户、带主图/多图/中文/计时记录的热备，取到第二位置后恢复至全新临时目录；验manifest/SHA、账户/工作区/历史/照片、generation变化、sessions撤销及重新登录。错误schema/故障注入仍拒绝，目标内容不变。
- [ ] 浏览器真实旧SW A→新B：保留IDB/cookie/outbox；有计时/冲突/未同步/未保存输入时暂缓；安全时手动检查和更新，页面/controller/API build一致；断网显示无法核验，不能“已最新”。旧页面更新不清资料。
- [ ] unsigned APK仅验证编译内容。若交付正式APK，在受保护交互终端输入原keystore口令，避免把实际值写命令/聊天/日志；原脚本签名，不生成替代key。验证官方证书、包名、code/版本，实算SHA/bytes回填release/public元数据，再完整build与相关发布断言。
- [ ] 一台真机从实际在用旧签名APK覆盖安装：登录、历史学习记录、计时、错题照片保持；安装授权/拒绝/取消/失败/重试、SAF中文文件保存/取消/写失败/近50MiB、系统文件管理器找到并另一设备导入均通过。不得卸载/清缓存完成验收。
- [ ] 无原口令/设备则标APK未完成、false保留；合格Web可继续生产上线，不能把“Web已上”写成“全部APK已上”。
- [ ] 最终独立审查任务1–9全部diff；发现新缺陷先写失败回归修复，再重跑受影响检查；无新变化不重复全套。冻结候选commit并记录镜像digest，测试通过不等于已经部署。

## Task 11：单实例生产上线与客户端更新

**这部分由实际获得生产操作授权的执行AI完成；本任务书本身不证明SSH可达或已上线。缺主机/凭据时先完成全部本地与镜像工作，只询问缺失访问条件，不编造服务器。**

**Files:** 生产实际目录下冻结部署文件与release.env；更新执行表。保持真实data路径不变。

### 11.1 只读确认生产事实

- [ ] 从用户已有SSH配置/部署资料定位实际主机与项目目录，读回容器service/image/mount；不默认用户名ubuntu或任何/opt路径。只输出必要版本/路径，禁止完整打印Config.Env或密钥。

```bash
docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker inspect --format '{{json .Mounts}}' VERIFIED_CONTAINER_ID
docker inspect --format '{{.Image}}' VERIFIED_CONTAINER_ID
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
curl --fail --silent --show-error 'https://work.ruyne.space/version.json?nonce=UNIQUE_VALUE'
```

- [ ] 从/app/data挂载Source得到PROD_DATA_DIR，确认存在原DB和附件、UID/GID/磁盘空间；记录原账户/工作区/媒体/历史数量及字节，不输出用户内容。保存旧镜像ID/digest、Compose配置、旧版本；配置备份排除凭据输出。
- [ ] 在维护窗口前构建/传输/拉取最终已验证不可变镜像，不把本地data、keystore或.env传到生产。优先部署完整镜像；需要传源码仅白名单tar/rsync，不带--delete和data。

### 11.2 备份与切换

- [ ] 用当前线上可用的hot-backup能力生成明确predeploy备份ID，核验manifest和文件SHA；取回异机并验证可读。若旧镜像没有该CLI，使用已在旧数据副本验证的只读SQLite Online Backup工具，不裸复制活跃potato.db。
- [ ] 准备新生产compose与release.env：APP_IMAGE为冻结tag/digest，PROD_DATA_DIR为上述真实绝对目录。执行compose config校验，无路径猜测/空卷创建。
- [ ] 进入短维护窗口，暂停backup/自动重启竞争作业，让本人和朋友先完成本机同步并暂停录入；无法同步的本机数据保持待处理，不清站点数据。
- [ ] 停旧实例后，对同卷再完成最终备份并取回，以覆盖前次热备之后的写入；仍保持旧资料原位。旧版到新版之间不执行额外真实DB迁移/恢复；本方案生产结构不变。
- [ ] 确认最终备份通过后切APP_IMAGE，新镜像挂同一源目录。下列命令须在实际部署目录且使用确认过的env文件；service固定kaogong-app。
- [ ] 若现场核对发现生产schema需要本方案之外的迁移，先在备份副本完成迁移与回滚验证，给出具体变更和影响，再遵守项目约定取得生产迁移授权；不能把未知迁移夹在启动命令里执行。

```bash
docker compose --env-file release.env -f compose.prod.yml stop -t 30 kaogong-app
docker compose --env-file release.env -f compose.prod.yml up -d \
  --no-deps --no-build --wait --wait-timeout 120 kaogong-app
```

- [ ] 旧服务停止后不能docker exec。最终停服备份/任何恢复用一次性容器；镜像和挂载已验证，不创建新的目标路径。禁止down -v。
- [ ] 检查新容器实际Mount Source等于切换前，image digest正确，health/版本/code/hash/nonce正确，旧资料计数无异常下降；HTTPS/SW/version无错误缓存，Nginx改动先nginx -t再平滑reload。
- [ ] 用专用测试账号在电脑+手机验：登录、登记、同步期间编辑、断网编辑、照片、另一端读取、冲突暂缓/处理、JSON导出导入。绝不把演示/故障注入数据写入真实用户。
- [ ] 旧浏览器/旧APK WebView保留会话与本地存档，回前台或设置手动检查更新；安全时更新到新build，不清站点数据。原生SAF新能力只在新APK可用，不能因网页已更新就宣称旧壳已获得原生修复。
- [ ] APK已签名且设备通过时才开放下载，实下载计算SHA/bytes/签名与metadata一致；未完成保持false，给朋友Web/PWA地址即可开始。
- [ ] 恢复维护前的定时备份，执行一次新版本热备及异机副本；没有周期任务则配置每小时热备，日志失败可见。保留原归档策略，不静默自动init Restic或清近期恢复点。
- [ ] 验收通过后结束维护并全量使用；无需24小时灰度或10%流量。上线后查看实际错误日志与备份结果即可，不把普通401/409/APK未发布404当全部成功或致命故障。

### 11.3 出错时的具体回滚

- [ ] 代码问题、资料正常：保持DB不恢复；使用已验证兼容的旧行为修复分支，保留本轮数据保护修复，分配更高Web build重新构建发布。紧急直接启旧镜像仅限已经验证兼容，并明确旧会话可能不自动降级。
- [ ] 资料确实损坏：保持维护并停全部共享卷服务/作业，保留现场及恢复前安全备份；选精确有效备份，在同一个已验证目标卷离线恢复。记录备份时间之后可能未包含的服务端变更，不能承诺零丢失。
- [ ] 恢复使用一次性容器，不改目标目录inode，不加--skip-pre-backup，不绕过exclusive锁。下列变量必须由真实环境填定并test存在后才能执行；不是可盲贴默认值。

```bash
test -d "${PROD_DATA_DIR}"
test -f "${RESTORE_SOURCE}/potato.db"
test -f "${RESTORE_SOURCE}/manifest.json"
docker run --rm --network none \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=bind,src=${PROD_DATA_DIR},dst=/app/data" \
  --mount "type=bind,src=${RESTORE_SOURCE},dst=/restore-source,readonly" \
  -e DATA_DIR=/app/data "${RECOVERY_IMAGE}" \
  node --import tsx server/cli.ts restore-offline \
  /restore-source /app/data --offline-confirmed
```

- [ ] 恢复失败保持停服/维护，不自动开应用；成功后先核验generation、sessions撤销、数量与图片，再启动兼容镜像、重新登录验收。
- [ ] APK问题：撤回apkReleased与下载，旧已安装包不通过降code/卸载“回滚”；修复后原证书更高code发布。

## Task 12：收尾交付与完成判定

**Files:** `docs/implementation/PERSONAL-RELEASE-EXECUTION.md`、必要发布说明；不覆盖用户已有原报告。

- [ ] S01–S12逐项给出代码commit、回归名称、命令exit、证据路径；测试数量来自新输出。
- [ ] 记录生产域名、实际Web build、image digest、部署UTC时间、数据卷源、部署前后计数、精确备份ID和异机位置；不输出凭据/私人正文。
- [ ] Web与APK分开写：本地完成、镜像已验、线上已验、签名已验、真机已验。缺任何必要项明确未完成和最短补验步骤，不能写“全部闭环”。
- [ ] 列出用户实际操作：工作台地址、旧页面更新入口、备份文件位置/上限、冲突暂缓入口、朋友注册邀请流程。邀请代码/重置码只在受保护终端交付，不写公开文档。
- [ ] 用真实公网读取及已完成验收证明部署成功；若没有生产访问权限，交付已冻结镜像/脚本和需要的真实主机信息，明确尚未上线，不伪造完成。
- [ ] 给出独立阶段commit与可执行回滚版本、最终未解决项；未解决影响资料正确性的问题不能转成文案或“个人使用问题不大”后放行。
- [ ] 全程不要求灰度。任务终点是可使用的Web发布，以及有条件完成的正式Android发布，不是停在修复方案或本地测试绿灯。

## 交付给实施AI的运行原则

按准备→任务1–12执行。不同文件的阅读/测试设计可并行，涉及同一个AppContext/db、版本封板和生产数据的写入必须串行。失败先复现定位，不反复盲跑。发现范围内相邻同类缺陷可补最小回归修复；超出本需求的新功能不扩张。每完成阶段更新执行表，最终读回真实状态后再宣布完成。

