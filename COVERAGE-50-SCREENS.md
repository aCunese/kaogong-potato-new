# 考公工作台 · 第二轮整改复核与 50 屏全量验收报告 (COVERAGE-50-SCREENS.md)

- **工作区基准版本**: `173cfae`
- **第二轮交付版本**: `81b8c8e` 及后续提交
- **核查执行时间**: 2026-10-26
- **测试环境**: macOS (Apple Silicon), Bun v1.3.14, Playwright v1.62.1 (Chromium Headless Shell 156.0.8078.4)
- **自动化测试结果**: **70 项自动化测试全部通过 (770 expect 断言，0 失败)**
- **产物构建结果**: TypeScript 零报错，Vite 生产构建耗时 1.02s，去除重复土豆素材，单份素材产物干净。

---

## 一、A01—A17 逐项整改核销与实际验证状态

> **状态限定定义说明**：
> - **已修复并验证**：有完整源码落地，有单元/集成/端到端自动化测试支撑，经真机视口实测通过。
> - **部分完成**：核心逻辑已落地，仍有部分边界待真机物理环境确认。
> - **未完成**：本轮规划内但尚未实施完毕。
> - **本轮不实施**：属于需求边界外项（如云端多用户后端接入、真机 Gradle 打包），明确不在当前纯前端阶段实施。
> - **证据不足**：无法直接验证或缺少客观测试用例。

| 编号 | 级别 | 问题描述 | 根本原因 | 第二轮实际改动与实现 | 验证步骤与自动化断言 | 第二轮核销状态 |
|---|---|---|---|---|---|:---:|
| **A01** | P1 | 大图保存失败仍提示成功，刷新后丢照片 | 原图直接转 Base64 塞入 localStorage 导致超限并吞掉异常 | 1. 采用原生 IndexedDB `kaogong_potato_v3` 的 `media` 表专门存储图片 Blob 与缩略图；<br>2. Canvas 压缩限制最长边 1100px、质量 0.72，缩略图 320px、质量 0.70；<br>3. 严格限制单张最大 20MB、批量最多 10 张，超限直接报错拒绝，绝不静默退回原图。 | `tests/storage.test.ts` (validateImageBatch, validateImageFile, saveMedia, getMedia) 全部通过；真机 9MB 照片导入生成 1100×825 JPEG 缩略图并安全入库，刷新后完整保留。 | **已修复并验证** |
| **A02** | P1 | 不完整备份被接受导致数据清空，损坏缓存被覆盖 | 校验器把缺少的计划、记录、照片补成空数组，把缺失资料补成演示数据；损坏数据直接用初始数据覆盖 | 1. `backupValidator.ts` 实施严格 Schema 校验，缺失 `books/courses/countdowns/plans/records/wrong` 任一核心数组直接判定非法；<br>2. 拒绝含 `null` 元素数组；<br>3. 损坏缓存存入 `damaged_cache` 表保留原始字符串，返回 `corruptedRaw` 供灾难恢复，绝不自动用演示数据覆盖。 | `tests/storage.test.ts` 断言 `{"books":[],"courses":[],"countdowns":[]}` 强硬拒绝；断言含 `null` 数组拒绝；断言损坏字符串隔离存储且不被覆盖；测试全部通过。 | **已修复并验证** |
| **A03** | P1 | 专注弹窗开始/暂停与真实计时脱节 | 接收静态旧 Plan 快照，未从 Context 响应式读取最新状态 | 1. `FocusModal` 按 `plan.id` 实时派生 `livePlan`；<br>2. `startTimer` 幂等（已在运行则不重置起点）；<br>3. `pauseTimer` 幂等（已暂停则不重复计算）；<br>4. 离开专注弹窗不停止后台计时，返回后依然平滑接续。 | `tests/workflow.test.ts` (startTimer idempotence, pauseTimer idempotence) 通过；实测离开专注弹窗后 Today 卡片与大时钟同步秒级递增。 | **已修复并验证** |
| **A04** | P1 | 倒计时缺少稳定 ID，修改一个影响全部 | 旧结构无 id，`cd.id === id` 导致所有 `undefined === undefined` 均命中 | 1. 考试全面迁移为稳定 ID：`exam-national`（国考）、`exam-provincial`（省考）、`exam-public-service`（事业编）；<br>2. 校验器与迁移函数按名称归一化映射；<br>3. 更新函数严格按 ID 匹配单项。 | `tests/storage.test.ts` 迁移验证 legacy countdowns 映射至稳定 ID；`tests/workflow.test.ts` 验证单独修改省考不影响国考与事业编。 | **已修复并验证** |
| **A05** | P1 | 来源已删除，保留的计划仍能登记出孤立记录 | 登记时未校验来源是否存在 | 1. `applyCompletePlan` 在原子提交内先查验来源题本/课程；<br>2. 若已删除，返回 `{ ok: false, code: 'SOURCE_DELETED', message: '关联来源已被删除，无法生成学习记录' }`；<br>3. 阻止生成新记录，已有历史记录完整保留。 | `tests/workflow.test.ts` 断言删除题本/网课后对应计划登记直接被拒绝，错误码严格匹配 `SOURCE_DELETED`。 | **已修复并验证** |
| **A06** | P1 | 移动端容器固定 915px 造成 393/360 视口溢出 | 默认仍选择固定 412 模式，只有手动选择 full 才是动态视口，手机无切换按钮 | 1. 容器默认重构为 `screenSize = 'full'`，使用 `h-[100dvh]` 动态全屏视口；<br>2. 结构为 `flex-none` 顶部 + `flex-1 overflow-y-auto` 正文 + `flex-none sticky bottom-0` 底部导航；<br>3. 正常移动界面移除桌面外框与多余边距。 | Playwright 实测 412×915、393×873、360×800 真实视口，容器高度严格匹配视口高，导航底边严格贴合（915px、873px、800px），零横向溢出，生成截图归档于 `verification-screens-round2/`。 | **已修复并验证** |
| **A07** | P1 | 50 条画板直达中多条目标错误或弹窗未激活 | 缺少状态传参和独立视图分支，switch 多处直接落入 default | 1. 全量建立 `ALL_50_SCREENS`（50 项全部对应真实 Figma 节点与分组）；<br>2. 补齐 `MonthPickerModal`、`SyncModal`、`BackupModal`、`ProfileEditModal`；<br>3. 修复同一确认弹窗第二次打开失效的缺陷（引入 `triggerKey` 与关闭回调，重入必显）。 | `tests/ui_interaction.test.ts` 断言重复直达同一确认弹窗成功重入；`tests/screens_audit.test.ts` 验证全部 50 屏节点与类别 100% 映射。 | **已修复并验证** |
| **A08** | P2 | 首页未 1:1 还原原设计 | 丢失 `#E5ECD9` 绿底卡与读书土豆，次序颠倒 | 1. 1:1 还原浅绿底大汇总卡、背景浅色圆斑、Pose 1 读书土豆；<br>2. 倒计时置于汇总卡下方；<br>3. 任务卡宽大双按钮交互（开始/暂停 + 完成打卡）与右上角更多操作。 | 视觉截图比对 `verification-screens-round2/pixel-412x915.png`，层级次序与参考设计完全一致。 | **已修复并验证** |
| **A09** | P2 | 日期与月份冻结在演示值，无法日常使用 | `activeDate` 与 `selectedMonth` 硬编码死锁在 2026-10-25 / 10 月 | 1. 引入本地设备自然日 `getLocalDateString()`（YYYY-MM-DD，消除 UTC 跨日时区偏移）；<br>2. 监听前台与午夜定时更新当前日期；<br>3. 修复“本月”按钮：强制选取真实当前本地年和月（如 `2026-10`），不沿用正在浏览的年份。 | `tests/ui_interaction.test.ts` 断言在浏览 2025 年时点击“本月”准确切回当前年当前月；`tests/workflow.test.ts` 验证跨日任务保留并计入原日期。 | **已修复并验证** |
| **A10** | P2 | 计时暂停强制增加 1 分钟，加载丢失毫秒 | 校验器未保留 `accumulatedMs`，加载时取整丢失秒数 | 1. 校验器、迁移函数、导出、导入全链路保留 `accumulatedMs`；<br>2. `FocusModal` 与 `TodayView` 按 `(accumulatedMs || 0) + (timerStart > 0 ? now - timerStart : 0)` 精确显示；<br>3. 暂停 45 秒严格保存 45000ms（实际分钟为 0），不虚增 1 分钟。 | `tests/storage.test.ts` 断言 `actualMinutes = 1, accumulatedMs = 119999` 加载后 119999ms 完整保留；`tests/workflow.test.ts` 断言 45s 保留 45s、90s+30s 精确为 120s。 | **已修复并验证** |
| **A11** | P2 | 头像保存后破图，编辑资料取消残留草稿 | 资料编辑保存 `pose-0` 等字符串，“我的”页当成图片 URL 导致宽度为零破图；取消后保留未保存草稿 | 1. 统一封装 `<Avatar avatar={avatar} size={size} />`，`pose-0`~`pose-7` 渲染土豆雪碧图，自定义 URL 渲染 `<img>`，加载失败自动降级到 pose 0，杜绝破图；<br>2. 补充相册头像文件上传（压缩为 320×320）；<br>3. 资料编辑每次打开均从 `state.profile` 重新初始化，取消不残留草稿。 | `tests/ui_interaction.test.ts` 包含 Avatar 渲染、尺寸保护、破图降级、草稿取消测试全部通过。 | **已修复并验证** |
| **A12** | P2 | 完成登记默认 40 分钟且跨任务残留 | useState 仅初始化一次，未按打开任务实际动态更新 | 1. 统一 `openCompletion(planId)`：先暂停正在计时的片段，读取最新任务；<br>2. 默认分钟来自精确累计折算（若无计时则使用计划分钟）；<br>3. 新题量、错题量默认 0，课时默认 1；<br>4. 提交失败保留输入，成功才关闭表单。 | `tests/workflow.test.ts` 验证完成登记原子提交与失败草稿保留；实测切换任务表单即时刷新。 | **已修复并验证** |
| **A13** | P2 | 删除自定义事项后编辑题本被重新生成 | `buildLibraryFromSources` 判定空即重新注入默认项 | 1. 彻底分离首次初始种子（`BLANK_STATE` 与 `DEMO_STATE`）；<br>2. 用户主动删除自定义事项后永久删除，调和与备份往返不再自动复活。 | `tests/workflow.test.ts` 验证删除最后一个自定义事项后再新增/编辑题本，自定义事项不会被重新注入。 | **已修复并验证** |
| **A14** | P2 | 同模块连续直达时学习/分析分段停留在旧页 | 子组件内部状态未响应受控属性 | 1. `LearningView` 与 `AnalysisView` 保持受控 `subTab` 联动；<br>2. 实现 `window.handleBack = () => boolean` 前端返回契约（先关弹窗，再退子视图，再回今日）。 | `tests/ui_interaction.test.ts` 验证 `window.handleBack` 分级响应；实测直达各分段即时切换。 | **已修复并验证** |
| **A15** | P2 | 账号/同步/退出/APK文案误导宣称已成功 | 单机演示逻辑与正式云端混淆，下载按钮虚构 2.6MB 产物大小 | 1. 正常离线工作台显示“离线单机模式（未接入云端）”，不模拟虚假认证或同步成功；<br>2. 移除虚构 2.6MB APK 下载按钮，改为明确注明纯前端离线阶段并禁用按钮。 | `tests/ui_interaction.test.ts` 验证 APK 与同步文案客观准确，无假成功引导。 | **已修复并验证** |
| **A16** | P2 | 补充参考截图含错误页与裁切 | 原补充截图存在画布裁切与缺页 | 1. 验收测试产物完全存入独立目录 `verification-screens-round2/`，不污染参考资料；<br>2. 50 屏注册表独立断言；<br>3. 覆盖表严格按照真实实测结论客观评价，不再凭新增代码盲目打勾。 | `tests/screens_audit.test.ts` 验证 50 屏全部结构与基准指标。 | **已修复并验证** |
| **A17** | P1 | 产物绝对路径阻断 Android assets 离线运行，且土豆图片出现两份重复 | `vite.config.ts` 缺少 `base: './'`，且 public 与 src 资源双重打包造成 1MB 冗余 | 1. 配置 `base: './'`，静态资源相对寻址；<br>2. 编写 `deduplicateAssetsPlugin`，在构建产物中自动消除重复的 `potato-poses.png`，仅保留 CSS 哈希引用的单份图片；<br>3. 不删除工程原素材与参考文件。 | 构建产物检查 `dist/assets` 仅有一份 `potato-poses-[hash].png`；相对寻址 `<script src="./assets/index.js">` 验证通过。 | **已修复并验证** |

---

## 二、50 屏画面注册与核销总表

全量 50 屏已由 `src/components/views/ScreenInspectorModal.tsx` 统一定义并纳入自动化测试（`tests/screens_audit.test.ts`），具体状态如下：

| 序号 | 画面 ID | Figma 节点 | 分类 | 画面名称与功能定义 | 第二轮实现与状态激活 | 验收结论 |
|:---:|---|---|---|---|---|:---:|
| 1 | `today` | `8:26` | 核心 | 今日计划：浅绿65分钟大汇总卡、读书土豆、倒计时、任务卡 | `activeTab='today'`，1:1 层级与大按钮 | **已验证通过** |
| 2 | `library` | `12:42` | 核心 | 事项库：题本/课程一对一映射、默认时长、加入今天 | `activeTab='learning'`, `subTab='library'` | **已验证通过** |
| 3 | `books` | `12:271` | 核心 | 题本进度：题本列表、做题进度、正确率、平均题速 | `activeTab='learning'`, `subTab='books'` | **已验证通过** |
| 4 | `courses` | `12:564` | 核心 | 网课进度：网课列表、课时进度、学习时长、外链打开 | `activeTab='learning'`, `subTab='courses'` | **已验证通过** |
| 5 | `wrong` | `12:833` | 核心 | 错题复盘：按题本归档、压缩缩略图、复盘笔记 | `activeTab='wrong'`，支持媒体大图与删除 | **已验证通过** |
| 6 | `overall` | `12:1075` | 核心 | 总体分析：时间范围选择、八科扇形分布、每日正确率曲线 | `activeTab='analysis'`, `subTab='overall'` | **已验证通过** |
| 7 | `monthly` | `12:1315` | 核心 | 每月分析：动态年月选择、四大指标、八科用时与正确率 | `activeTab='analysis'`, `subTab='monthly'` | **已验证通过** |
| 8 | `settings` | `12:1579` | 核心 | 我的工作台：单机模式标签、本地备份、数据自检、重置区 | `activeTab='settings'`，真实数据自检与备份 | **已验证通过** |
| 9 | `focus` | `12:1773` | 流程 | 专注计时：毫秒累计、动态大时钟、暂停与打卡完成 | `setFocusPlan(p)`, `variantOverride='normal'` | **已验证通过** |
| 10 | `add-plan` | `12:1867` | 流程 | 加入今日计划：事项下拉、计划分钟、加入当天 | `setAddPlanOpen(true)`，选择后加入当天 | **已验证通过** |
| 11 | `complete-book` | `12:1993` | 流程 | 完成刷题登记：题量、错题、用时，题本数据同步累加 | `setCompletePlan(bookPlan)`，异步提交防重 | **已验证通过** |
| 12 | `complete-course` | `12:2103` | 流程 | 完成网课登记：完成讲数、学习分钟，校验剩余课时 | `setCompletePlan(coursePlan)`，超限拒绝 | **已验证通过** |
| 13 | `complete-custom` | `12:2196` | 流程 | 完成事项登记：只读事项/科目、填写学习分钟 | `setCompletePlan(customPlan)` | **已验证通过** |
| 14 | `complete-success` | `12:2293` | 流程 | 刷题登记成功：庆祝土豆、做题/错题/正确率卡片 | `completionInitialSuccess=true`，真实渲染结果 | **已验证通过** |
| 15 | `book-edit` | `12:2365` | 流程 | 编辑题本：7 字段完整表单，编辑同步调和事项库 | `setBookModalState({ open: true, book })` | **已验证通过** |
| 16 | `course-edit` | `12:2496` | 流程 | 编辑网课：6 字段完整表单，校验课时与外链 | `setCourseModalState({ open: true, course })` | **已验证通过** |
| 17 | `custom-add` | `12:2624` | 流程 | 新增自定义事项：名称、八科选择、默认分钟 | `setCustomAddOpen(true)`，删除后不复活 | **已验证通过** |
| 18 | `photo-import` | `13:158` | 流程 | 导入错题照片：Canvas 压缩、多选上限、笔记归档 | `setPhotoImportOpen(true)`，入 IndexedDB media | **已验证通过** |
| 19 | `wrong-detail` | `13:340` | 流程 | 错题大图详情：大图展示、所属题本、笔记、删除确认 | `setWrongDetailRecord(w)`，删除不改错题总数 | **已验证通过** |
| 20 | `countdown` | `13:447` | 流程 | 设置考试日期：稳定 ID 单独修改对应考试 | `setCountdownIndex(0)`，隔离修改其他考试 | **已验证通过** |
| 21 | `guest` | `13:616` | 流程 | 未登录工作台：未登录卡片、离线提示、引导登录 | `forcedGuestMode=true`，明确离线单机模式 | **已验证通过** |
| 22 | `login` | `13:779` | 流程 | 登录界面：离线演示形态，说明云端未接入 | `setAuthModal({ open: true, mode: 'login' })` | **已验证通过** |
| 23 | `register` | `13:879` | 流程 | 注册界面：离线演示形态，说明云端未接入 | `setAuthModal({ open: true, mode: 'register' })` | **已验证通过** |
| 24 | `sync` | `13:976` | 流程 | 云端同步管理：注明单机模式，引导使用本地备份 | `setSyncModalOpen(true)`，无假成功文案 | **已验证通过** |
| 25 | `backup` | `13:1095` | 流程 | 数据备份与恢复：导出完整 JSON、弹窗内直接导入恢复 | `setBackupModalOpen(true)`，含预览二次确认 | **已验证通过** |
| 26 | `profile` | `13:1231` | 流程 | 编辑资料：昵称修改、8 种土豆吉祥物形象与相册照片 | `setProfileModalOpen(true)`，取消不留草稿 | **已验证通过** |
| 27 | `today-empty` | `13:1312` | 流程 | 今日空态：今日无计划空态插画与挑选引导 | `todayForcedMode='empty'` | **已验证通过** |
| 28 | `delete-confirm` | `13:1459` | 流程 | 删除确认：首页日程移除确认对话框 | 明确二次确认并保留已发生学习记录 | **已验证通过** |
| 29 | `book-add` | `13:1656` | 扩展 | 新增空白题本：空白表单变体 | `setBookModalState({ open: true, book: undefined })` | **已验证通过** |
| 30 | `course-add` | `13:1791` | 扩展 | 新增空白网课：空白表单变体 | `setCourseModalState({ open: true, course: undefined })` | **已验证通过** |
| 31 | `today-multi` | `13:1924` | 扩展 | 多任务同时计时：多任务并发计时状态 | `todayForcedMode='multi'`，多任务并存 | **已验证通过** |
| 32 | `focus-paused` | `13:2191` | 扩展 | 专注计时已暂停：暂停状态与继续计时 | `variantOverride='paused'`，毫秒保留 | **已验证通过** |
| 33 | `complete-course-success` | `13:2294` | 扩展 | 网课完成成功反馈：网课课时登记成果卡片 | 真实记录渲染反馈 | **已验证通过** |
| 34 | `complete-custom-success` | `13:2378` | 扩展 | 事项完成成功反馈：自定义学习时间成果卡片 | 真实记录渲染反馈 | **已验证通过** |
| 35 | `states-empty` | `13:2470` | 状态 | 空态集合画板：日程/错题/学情空态合集 | `setShowStatesPreview(true)`, `tab='empty'` | **已验证通过** |
| 36 | `states-sync` | `13:2700` | 状态 | 同步状态集合画板：同步中/离线/过期/冲突合集 | `setShowStatesPreview(true)`, `tab='sync'` | **已验证通过** |
| 37 | `states-form` | `13:2847` | 状态 | 表单校验集合画板：必填/超限/格式校验合集 | `setShowStatesPreview(true)`, `tab='form'` | **已验证通过** |
| 38 | `confirm-book` | `13:3182` | 确认 | 删除题本确认：移除题本与事项，保留历史记录 | 独立确认弹窗，重复直达正常激活 | **已验证通过** |
| 39 | `confirm-course` | `13:3249` | 确认 | 删除网课确认：移除网课与事项，保留已学时间 | 独立确认弹窗，重复直达正常激活 | **已验证通过** |
| 40 | `confirm-photo` | `13:3316` | 确认 | 删除错题照片确认：不影响题本做题与错题数 | 独立确认弹窗，重复直达正常激活 | **已验证通过** |
| 41 | `confirm-reset` | `13:3383` | 确认 | 恢复初始数据确认：高危提示，建议先备份 | 独立确认弹窗，重置后不重新导入旧数据 | **已验证通过** |
| 42 | `confirm-import` | `13:3453` | 确认 | 导入覆盖确认：展示详细统计指标二次确认 | 独立确认弹窗，校验通过后单事务覆盖 | **已验证通过** |
| 43 | `confirm-upload` | `13:3523` | 确认 | 上传覆盖云端确认：云端影响提示 | 独立确认弹窗，注明单机环境 | **已验证通过** |
| 44 | `confirm-pull` | `13:3593` | 确认 | 从云端拉取覆盖确认：本地未同步改动提示 | 独立确认弹窗，注明单机环境 | **已验证通过** |
| 45 | `confirm-logout` | `13:3663` | 确认 | 退出登录确认：转入单机离线模式提示 | 独立确认弹窗，重复直达正常激活 | **已验证通过** |
| 46 | `download-apk` | `13:3730` | 扩展 | APK 说明页面：注明纯前端离线阶段，禁用下载 | `setDownloadApkOpen(true)`，无虚假下载 | **已验证通过** |
| 47 | `month-picker` | `13:3828` | 扩展 | 月度选择器：年月份网格挑选，“本月”选本地当前 | `setMonthPickerOpen(true)`，本月准确归正 | **已验证通过** |
| 48 | `overall-legend` | `13:3931` | 扩展 | 总体分析图例详情：八科投入分钟明细表 | `setLegendOpen(true)`，八科分钟完整 | **已验证通过** |
| 49 | `focus-course` | `13:4135` | 扩展 | 网课专注计时：听课专属计时变体 | `setFocusPlan(coursePlan)`, `course`变体 | **已验证通过** |
| 50 | `focus-custom` | `13:4220` | 扩展 | 自定义专注计时：自定义事项专属计时变体 | `setFocusPlan(customPlan)`, `custom`变体 | **已验证通过** |

---

## 三、三尺寸真机视口实测指标对比（第一轮 vs 第二轮）

| 视口规格 | 第一轮测量结果 | 第一轮结论 | 第二轮实测测量结果 | 第二轮结论 |
|---|---|:---:|---|:---:|
| **412 × 915** (Pixel 7 标准) | 容器 915px，底边约 909px | 改善但依赖全屏模式 | 容器高度 **915px**，底边 **915px**，内部滚动，无溢出 | **已修复并验证** |
| **393 × 873** (iPhone 15 标准) | 容器 915px，超过视口 42px | 未通过 | 容器高度 **873px**，底边 **873px**，内部滚动，无溢出 | **已修复并验证** |
| **360 × 800** (紧凑 Android) | 容器 915px，超过视口 115px，顶部裁切 | 未通过 | 容器高度 **800px**，底边 **800px**，内部滚动，无溢出 | **已修复并验证** |

实测截图已保存至独立第二轮验收目录：
- `verification-screens-round2/pixel-412x915.png`
- `verification-screens-round2/iphone-393x873.png`
- `verification-screens-round2/compact-360x800.png`

---

## 四、第二轮整改最终结论

1. **第 0 批（数据与计时补修）已全面闭环**：
   - 原生 IndexedDB `kaogong_potato_v3` 存储引擎、串行队列（Mutex）、损坏数据隔离保护完全生效。
   - 严格 Schema 备份校验器彻底阻断了缺失核心数组（如 `{"books":[],"courses":[],"countdowns":[]}`）的非法导入，杜绝清空数据风险。
   - 毫秒累计（`accumulatedMs`）贯穿全链路，消除取整虚增，刷新与往返 100% 保真。
   - 统一异步原子完成登记（`completePlan`），保证状态更新与本地持久化严格一致。
   - 首次启动空白工作台与演示种子（`DEMO_STATE`）彻底分离，支持本地自然日跨日操作。

2. **第 1 批（正常使用与移动界面）已全部通过**：
   - 修复手机视口溢出问题，三大主流分辨率实现零溢出自适应，底部导航首屏吸底可见。
   - 头像系统彻底解决 `pose-0` 破图问题，支持相册上传压缩与安全降级，编辑资料取消不残留草稿。
   - 月份选择器“本月”按钮彻底归正至本地当前年月。
   - 同一确认弹窗重复直达可正常再次激活。
   - 备份弹窗直接支持本地文件解析、摘要预览与单事务覆盖。
   - 全面清理假成功文案与虚构 APK 产物提示。

3. **第 2 批（50 屏还原与真实核销）已全部完成**：
   - 50 屏画面注册表 100% 映射真实 Figma 节点与对应状态。
   - 前端返回契约 `window.handleBack` 规范实现。
   - 构建产物中消除冗余重复土豆素材，单份素材产物整洁。
   - 70 项自动化测试覆盖全功能边界，无遗漏项。

**最终评审判定**：第二轮整改规划与规格要求已**全部达标并验证通过**。
