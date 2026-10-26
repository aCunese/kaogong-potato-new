# 考公工作台 · 50 屏全界面覆盖与验收矩阵 (COVERAGE-50-SCREENS.md)

本表对应 Figma Section `29:420`（`Android · 全部50个界面与状态`），记录 React + TypeScript + Vite 独立工程的逐屏实现进度与验收状态。

- **工程路径**: `/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
- **基准规格**: 412 × 915（同时校核 393 × 873、360 × 800），响应式安全区适配
- **视觉主题**: 奶油白 `#F4F3EB`、纸白表面 `#FFFDF8`、鼠尾草绿 `#61794F`、土豆黄 `#E6B957`
- **数据隔离**: 本地存储键 `potato_study_v2`，不污染原生产数据

---

## 50 屏完整覆盖清单

| # | 画面 ID | Figma 节点 | 分组 | 画面名称与功能说明 | UI 实现 | 演示交互 | 真实接口衔接状态 | 视觉参考截图 |
|---|---|---|---|---|---|---|---|---|
| 1 | `today` | `8:26` | 核心 | **今日计划**：三倒计时横排、任务列表、概览卡片、打招呼土豆 | ✅ 已完成 | ✅ 正向计时/暂停/完成/添加 | 准备就绪 (同步至 state.plans) | `screens/01-today.png` |
| 2 | `library` | `12:42` | 核心 | **事项库**：题本/网课自动同步映射、默认时长、加入今天 | ✅ 已完成 | ✅ 默认时长即时保存/一键加今日 | 准备就绪 (1对1映射校验) | `screens/02-library.png` |
| 3 | `books` | `12:271` | 核心 | **题本进度**：14本题本、做题进度条、正确率、平均题速 | ✅ 已完成 | ✅ 编辑数据/删除联动/科目筛选 | 准备就绪 (数据隔离持久化) | `screens/03-books.png` |
| 4 | `courses` | `12:564` | 核心 | **网课进度**：7门课程、已听课时/总课时、外链协议打开 | ✅ 已完成 | ✅ 课时进度条/课程链接校验 | 准备就绪 (不设内置播放器) | `screens/04-courses.png` |
| 5 | `wrong` | `12:833` | 核心 | **错题复盘**：按题本归类、缩略图、复盘原因笔记 | ✅ 已完成 | ✅ 多选导入预览/大图查看/删除 | 准备就绪 (前端压缩保存) | `screens/05-wrong.png` |
| 6 | `overall` | `12:1075` | 核心 | **总体分析**：30/90/全部范围、八科时间扇形环图、每日正确率曲线 | ✅ 已完成 | ✅ 矢量SVG/日期加权/无题量说明 | 准备就绪 (仅聚合 records) | `screens/06-overall.png` |
| 7 | `monthly` | `12:1315` | 核心 | **每月分析**：总时长、做题量、错误数、加权正确率、八科条目 | ✅ 已完成 | ✅ 加权算法校验/无题量标明 | 准备就绪 (1260m/420q/84e/80%) | `screens/07-monthly.png` |
| 8 | `settings` | `12:1579` | 核心 | **我的工作台**：APK入口、多用户同步、JSON备份、自检、重置区 | ✅ 已完成 | ✅ 导入导出/数据自检/状态检查 | 准备就绪 (兼容 Node server.js) | `screens/08-settings.png` |
| 9 | `focus` | `12:1773` | 流程 | **专注计时**：大数字正向计时、计划vs实际、暂停/完成 | ✅ 已完成 | ✅ 毫秒级正向累计/后台时戳计算 | 准备就绪 | `screens/09-focus.png` |
| 10 | `add-plan` | `12:1867` | 流程 | **加入今日计划**：事项下拉、计划分钟、加入当天 | ✅ 已完成 | ✅ 自动继承事项默认时长 | 准备就绪 | `screens/10-add-plan.png` |
| 11 | `complete-book` | `12:1993` | 流程 | **完成刷题登记**：本次做题数、错题数、实际学习分钟 | ✅ 已完成 | ✅ 错题<=做题校验/必填定位 | 准备就绪 (原子生成 record) | `screens/11-complete-book.png` |
| 12 | `complete-course` | `12:2103` | 流程 | **完成网课登记**：本次完成课时、实际学习分钟 | ✅ 已完成 | ✅ 课时累加/时间计入总分钟 | 准备就绪 | `screens/12-complete-course.png` |
| 13 | `complete-custom` | `12:2196` | 流程 | **完成事项登记**：只读事项/科目、实际学习分钟 | ✅ 已完成 | ✅ 不计入题量/计入时间分布 | 准备就绪 | `screens/13-complete-custom.png` |
| 14 | `complete-success` | `12:2293` | 流程 | **刷题登记成功**：庆祝土豆、本次成果总结卡片、返回今日 | ✅ 已完成 | ✅ 总结卡片生成/跳转闭环 | 准备就绪 | `screens/14-complete-success.png` |
| 15 | `book-edit` | `12:2365` | 流程 | **编辑题本**：7字段完整表单（名称/科目/总题/页数/已做/错题/时间） | ✅ 已完成 | ✅ 字段合法性校验/不伪造记录 | 准备就绪 | `screens/15-book-edit.png` |
| 16 | `course-edit` | `12:2496` | 流程 | **编辑网课**：6字段完整表单（名称/科目/总课时/已完成/用时/外链） | ✅ 已完成 | ✅ http/https协议校验 | 准备就绪 | `screens/16-course-edit.png` |
| 17 | `custom-add` | `12:2624` | 流程 | **新增自定义事项**：名称、八科选择、默认分钟 | ✅ 已完成 | ✅ 加入事项库/默认值保持 | 准备就绪 | `screens/17-custom-add.png` |
| 18 | `photo-import` | `13:158` | 流程 | **导入错题照片**：所属题本、相册多选、复盘原因笔记 | ✅ 已完成 | ✅ 多选预览/前端压缩/批量归档 | 准备就绪 | `screens/18-photo-import.png` |
| 19 | `wrong-detail` | `13:340` | 流程 | **错题大图详情**：大图展示、题本标签、时间、详细笔记 | ✅ 已完成 | ✅ 缩放预览/原题本解绑状态保护 | 准备就绪 | `screens/19-wrong-detail.png` |
| 20 | `countdown` | `13:447` | 流程 | **设置考试日期**：国考/省考/事业编日期编辑弹窗 | ✅ 已完成 | ✅ 本地自然日计算天数 | 准备就绪 | `screens/20-countdown.png` |
| 21 | `guest` | `13:616` | 流程 | **未登录工作台**：未登录身份卡片、离线提示、引导登录 | ✅ 已完成 | ✅ 离线单机可用/引导注册 | 准备就绪 | `screens/21-guest.png` |
| 22 | `login` | `13:779` | 流程 | **登录界面**：用户名、密码、转小写兼容 | ✅ 已完成 | ✅ 本地演示登录/接口契约对齐 | 预留 POST /api/auth/login | `screens/22-login.png` |
| 23 | `register` | `13:879` | 流程 | **注册界面**：用户名>=2字符、密码>=4字符 | ✅ 已完成 | ✅ 格式校验/防连点 | 预留 POST /api/auth/register | `screens/23-register.png` |
| 24 | `sync` | `13:976` | 流程 | **同步管理**：最近同步时间、上传覆盖、拉取覆盖 | ✅ 已完成 | ✅ 上传与拉取模拟及二次确认 | 预留 GET/POST /api/data/sync | `screens/24-sync.png` |
| 25 | `backup` | `13:1095` | 流程 | **数据备份**：导出JSON、导入恢复校验 | ✅ 已完成 | ✅ JSON校验/自动重建映射 | 准备就绪 (纯客户端闭环) | `screens/25-backup.png` |
| 26 | `profile` | `13:1231` | 流程 | **编辑资料**：显示昵称修改、头像选择 | ✅ 已完成 | ✅ 本地状态更新 | 准备就绪 | `screens/26-profile.png` |
| 27 | `today-empty` | `13:1312` | 流程 | **今日空态**：今日无日程时的空态插画与挑选引导 | ✅ 已完成 | ✅ 引导按钮一键打开事项库 | 准备就绪 | `screens/27-today-empty.png` |
| 28 | `delete-confirm` | `13:1459` | 流程 | **删除确认**：通用删除确认交互 | ✅ 已完成 | ✅ 区分对象影响说明 | 准备就绪 | `screens/28-delete-confirm.png` |
| 29 | `book-add` | `13:1656` | 扩展 | **新增空白题本**：空白题本表单变体 | ✅ 已完成 | ✅ 7字段默认初始值 | 准备就绪 | `supplementary/29-book-add.png` |
| 30 | `course-add` | `13:1791` | 扩展 | **新增空白网课**：空白网课表单变体 | ✅ 已完成 | ✅ 6字段默认初始值 | 准备就绪 | `supplementary/30-course-add.png` |
| 31 | `today-multi` | `13:1924` | 扩展 | **多任务同时计时**：多任务并发计时状态展示 | ✅ 已完成 | ✅ 允许多任务独立运行 | 准备就绪 | `supplementary/31-today-multi.png` |
| 32 | `focus-paused` | `13:2191` | 扩展 | **专注计时已暂停**：计时暂停状态与继续操作 | ✅ 已完成 | ✅ 保持已累计时长/随时接续 | 准备就绪 | `supplementary/32-focus-paused.png` |
| 33 | `complete-course-success` | `13:2294` | 扩展 | **网课完成成功反馈**：网课课时登记成功反馈 | ✅ 已完成 | ✅ 成果展示/返回今日 | 准备就绪 | `supplementary/33-complete-course-success.png` |
| 34 | `complete-custom-success` | `13:2378` | 扩展 | **事项完成成功反馈**：自定义学习时间登记成功 | ✅ 已完成 | ✅ 成果展示/返回今日 | 准备就绪 | `supplementary/34-complete-custom-success.png` |
| 35 | `states-empty` | `13:2470` | 状态 | **空态集合画板**：日程/错题/学情空态合集 | ✅ 已完成 | ✅ 3类空态统一展示 | 准备就绪 | `supplementary/35-states-empty.png` |
| 36 | `states-sync` | `13:2700` | 状态 | **同步状态集合画板**：同步中/离线/过期/冲突状态合集 | ✅ 已完成 | ✅ 4类同步状态直观模拟 | 准备就绪 | `supplementary/36-states-sync.png` |
| 37 | `states-form` | `13:2847` | 状态 | **表单校验集合画板**：必填/超限/格式校验合集 | ✅ 已完成 | ✅ 4类错误反馈与定位 | 准备就绪 | `supplementary/37-states-form.png` |
| 38 | `confirm-book` | `13:3182` | 弹窗 | **删除题本确认**：说明移除题本与对应事项，保留历史记录 | ✅ 已完成 | ✅ 明确告知历史记录不被删除 | 准备就绪 | `supplementary/38-confirm-book.png` |
| 39 | `confirm-course` | `13:3249` | 弹窗 | **删除网课确认**：说明移除网课与对应事项 | ✅ 已完成 | ✅ 明确告知事项库变动 | 准备就绪 | `supplementary/39-confirm-course.png` |
| 40 | `confirm-photo` | `13:3316` | 弹窗 | **删除错题照片确认**：说明不影响题本做题与错题总数 | ✅ 已完成 | ✅ 强调照片不影响数值错题 | 准备就绪 | `supplementary/40-confirm-photo.png` |
| 41 | `confirm-reset` | `13:3383` | 弹窗 | **恢复初始数据确认**：高危提示导出备份，说明恢复默认 | ✅ 已完成 | ✅ 红色警告/备份建议 | 准备就绪 | `supplementary/41-confirm-reset.png` |
| 42 | `confirm-import` | `13:3453` | 弹窗 | **导入覆盖确认**：校验后覆盖提醒 | ✅ 已完成 | ✅ 告知覆盖范围 | 准备就绪 | `supplementary/42-confirm-import.png` |
| 43 | `confirm-upload` | `13:3523` | 弹窗 | **上传覆盖云端确认**：云端覆盖影响提示 | ✅ 已完成 | ✅ 避免无意覆盖云端 | 准备就绪 | `supplementary/43-confirm-upload.png` |
| 44 | `confirm-pull` | `13:3593` | 弹窗 | **从云端拉取覆盖确认**：本地未同步数据被覆盖提示 | ✅ 已完成 | ✅ 提醒先做本地备份 | 准备就绪 | `supplementary/44-confirm-pull.png` |
| 45 | `confirm-logout` | `13:3663` | 弹窗 | **退出登录确认**：转入离线单机模式提示 | ✅ 已完成 | ✅ 说明本地数据仍保留 | 准备就绪 | `supplementary/45-confirm-logout.png` |
| 46 | `download-apk` | `13:3730` | 扩展 | **APK 下载页面**：专属安卓安装包介绍与下载 | ✅ 已完成 | ✅ 说明2.6MB离线特性 | 准备就绪 | `supplementary/46-download-apk.png` |
| 47 | `month-picker` | `13:3828` | 扩展 | **月度选择器**：月度切换弹窗 | ✅ 已完成 | ✅ 快速按年月切换分析 | 准备就绪 | `supplementary/47-month-picker.png` |
| 48 | `overall-legend` | `13:3931` | 扩展 | **总体分析图例详情**：八科投入分钟明细表 | ✅ 已完成 | ✅ 详细比例与数值表 | 准备就绪 | `supplementary/48-overall-legend.png` |
| 49 | `focus-course` | `13:4135` | 扩展 | **网课专注计时**：网课听课专注计时变体 | ✅ 已完成 | ✅ 听课状态与课时记录联动 | 准备就绪 | `supplementary/49-focus-course.png` |
| 50 | `focus-custom` | `13:4220` | 扩展 | **自定义专注计时**：自定义事项专注计时变体 | ✅ 已完成 | ✅ 阅读/笔记专注计时 | 准备就绪 | `supplementary/50-focus-custom.png` |
