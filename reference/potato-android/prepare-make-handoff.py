from pathlib import Path
b=Path(__file__).parent
source=(b/'FIGMA-REBUILD-PROMPT.md').read_text()
header='''# Figma Make 执行指令：考公工作台 Android UI 与可导出前端源码

你正在 Figma Make 的 Build 模式中工作。请以我通过 Add context 附加的 Figma Frame、附加的土豆图片，以及下面的完整需求为依据，生成可以运行和导出源码的移动端应用前端。

## 当前输出形式与工程约束（优先执行）

1. 生成 React + TypeScript + Vite 项目，交付可以在本地继续开发的移动端网页 UI。后续由现有 Java Android WebView 承载。当前输出是前端工程，不是原生 Kotlin/Java UI、React Native 工程或已经打包完成的 APK。
2. 先建立共享 token、组件、导航和演示状态，完成八个主模块，再按下方 50 个画面/状态清单补齐表单、详情、确认和异常。可以分阶段实现，但必须维护完整清单，不能在只完成首页时宣布全部完成；当前阶段已完成与待完成项要明确。
3. 使用附加的原生 Frame 尽量准确还原颜色、字重、间距、圆角和信息层级。没有附加到上下文的画面，依据完整需求和统一设计系统实现，不要声称已读取。Figma URL 是索引；普通聊天文本中的 URL 不代表已经读到了设计。无法访问的设计要列出，并可继续使用已提供的附件和文字实现。
4. 实际 App 的底部导航固定为「今日、学习、错题、分析、我的」。主模块有独立路由/视图，二级表单与详情可返回。画板图库和页面编号只用于交付检查，正常应用默认进入今日计划，不把 50 屏总览当成用户首页。
5. 设计基准 412×915，适配 360×800、393×873。布局采用响应式宽度、动态视口与安全区变量，不能把整个产品固定为宽 412、高 915 的一张海报。桌面预览可以居中窄容器，手机实际使用占满可用屏幕。设计稿中的系统状态栏和手势条为参考占位，生产 WebView 内不重复绘制一套系统栏。
6. 颜色沿用奶油白 #F4F3EB、纸白 #FFFDF8、鼠尾草绿 #61794F、深灰绿 #343C2F 和土豆黄 #E6B957。沿用参考土豆形象。附加 potato-poses.png 是 4列×2行的八动作图集，左到右、上到下依次为挥手、读书、听课、查错、图表、电脑、庆祝、写字；可裁成独立资源或按图集准确裁切，不能拉伸或把整张八动作图当成一个头像。文字、表单、图表用真实 DOM/矢量绘制。
7. 页面、共享组件、类型、业务状态、API service 和存储适配器分开组织。提供本地演示数据，新增、编辑、删除、添加今日任务、正向计时、三类完成登记、照片预览、月切换、统计和确认弹窗要有实际演示响应。缺少真实后端的操作明确标注为演示，不弹出虚假的生产登录或云端同步成功。
8. 沿用现有项目的后端方向：Node 自建用户名认证与整份状态同步。保留接口适配点 POST /api/auth/register、POST /api/auth/login、GET /api/auth/me、GET/POST /api/data/sync；同步上传协议为 {state, updatedAt, version} 并使用 Bearer 认证。具体返回字段在后续接入原 server.js 时校对，不要猜测后宣称兼容。当前不调用真实生产服务，不新增 Supabase、Firebase、手机号或邮箱认证，不创建新的后端数据库。
9. 原业务状态顶层包含 profile、countdowns、books、courses、library、plans、records、wrong、version。演示数据使用独立存储命名空间；为原 JSON 备份格式与本机数据预留适配器，不能未经真实格式验证就覆盖旧数据或声称无损迁移。照片较大，避免把所有照片无上限塞进少量 localStorage；存储层可以替换，错误要可见。
10. API 基址集中配置；支持部署在 /kaogong/ 子路径。静态资源兼容子路径，Vite 资源基址可使用相对路径。路由采用适合静态部署和 WebView 的方案，例如 hash 路由。不得把 localhost、127.0.0.1、当前 Make 预览域名或秘密凭证写成生产配置。
11. 导出工程必须包含 package.json、依赖声明、src、public 或等价资源目录、构建配置与 npm run dev / npm run build / npm run preview 脚本。土豆等资源随工程导出，本地运行不得依赖 Figma 登录态或过期临时图片 URL。说明实际 Node 环境要求和启动方式；README 列明构建产物、API 适配位置、存储适配位置、已模拟和待接入能力。
12. 在 Make 能执行的范围内验证构建，检查三种尺寸、导航与完整业务链路。不能执行的检查要注明。交付 SCREEN-COVERAGE.md，对应下方 50 个画面/状态；不能仅凭几个相似页面宣称全覆盖。原生 Android WindowInsets、系统返回、图片选择、可靠文件落盘、离线数据一致性和正式 APK 签名在导出后接入现有 Android 工程时单独验收。

本次在 Make 中优先交付可运行前端与可导出工程。下方出现的 Figma Design 组件/画板要求用于理解设计规范；当前不需要重新创建一份 Design 文件。涉及真实后端、原生 Android 或原实现缺陷修复的条款，当前先给出准确 UI、演示状态和接入边界，不伪造已经完成生产接入。

## 执行次序

第一阶段：共享设计 token、组件和导航；完整呈现今日、事项库、题本、网课、错题、总体、月度、我的八个主模块。首屏保持参考风格，完成页面切换和合理演示数据。
第二阶段：三类登记、题本/网课新增编辑、自定义事项、照片导入与详情、考试日期、个人资料、认证与同步演示；按来源正确联动状态。
第三阶段：补齐多任务/暂停、空态/错误/离线、图例、月份选择、删除/覆盖/重置确认；逐项对齐 50 屏清单并检查源码导出完整性。
始终在同一个 Make 文件与同一套共享代码上继续，不因为分阶段新建重复工程。

以下是完整产品功能、视觉与验收需求，作为全过程依据：

---

'''
(b/'FIGMA-MAKE-FULL-PROMPT.txt').write_text(header+source)
start='''请按附件 FIGMA-MAKE-FULL-PROMPT.txt 实现「考公工作台·土豆陪伴版」。以通过 Add context 附加的设计 Frame 为视觉基准，使用附加的 potato-poses.png 土豆素材。

请保持 Build 模式，直接开始创建 React + TypeScript + Vite 移动端前端工程。目标是可运行、可导出、后续接回现有 Node API 并由 Android WebView 承载。

先完成共享设计系统、五个底部入口和八个原功能模块，接着在同一工程里补齐全部 50 个画面与状态。请按完整需求逐项记录覆盖情况。所有演示操作有实际反馈，真实云端能力明确待接入。

优先还原附件中的奶油白、鼠尾草绿、暖黄土豆风格。基准 412×915，同时适配 360 和 393 宽度。保持字段完整，特别保留题本七字段、网课六字段、三类完成登记、多任务计时、八科统计、照片复盘、同步覆盖确认和 JSON 备份。

请输出前端工程与预览，保证能导出完整源码；构建、资源路径和部署要求均按附件执行。现在从第一阶段开始实现，不停在计划说明。'''
(b/'FIGMA-MAKE-FIRST-MESSAGE.txt').write_text(start+'\n')
readme='''# 从当前 Figma Make 空白页开始

1. 保持输入框下方 Build。
2. 点击左下角 + → Add context，把首页 Frame 链接粘进弹窗并附加：
   https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=8-26
   也可在 Figma Design 中选中完整首页 Frame，Command+C，再在 Make 输入框 Command+V。先看到设计附件卡片，再发消息。普通聊天中的链接不会自动读取设计。
3. + → Upload files，添加同目录 FIGMA-MAKE-FULL-PROMPT.txt 和 assets/potato-poses.png。也可将完整 prompt 全文复制到输入框；不要只复制需求标题。
4. 粘贴 FIGMA-MAKE-FIRST-MESSAGE.txt 的内容，点击右侧向上箭头开始。
5. 后续每轮附加 1–2 个对应 Frame，继续同一 Make 文件。待八主模块风格一致后补齐其余表单、状态与流程。
6. 完成后打开 Files；如未显示，Add tab → Files；在 File actions → Download code 下载完整 ZIP。旧界面可能在 Code 视图右上角显示下载入口。
7. 导出的是网页前端工程。后续本地检查、接原 API、构建 dist、调整服务器静态资源和 Android WebView、完成真机验收后再签名生成 APK。

## 设计入口

- 首页：https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=8-26
- 五类总览：https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=16-26
- 全部画板：https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=4-264

## 官方操作依据

- 添加附件：https://help.figma.com/hc/en-us/articles/31304529835671-Attach-files-to-a-prompt-in-the-Figma-agent-and-Figma-Make
- URL 与设计附件的区别：https://help.figma.com/hc/en-us/articles/31722591905559-Figma-Make-FAQs
- 下载源码：https://help.figma.com/hc/en-us/articles/33649966245783-Edit-the-code-of-a-functional-prototype-or-web-app
'''
(b/'FIGMA-MAKE-START-HERE.md').write_text(readme)
p=b/'FIGMA-MAKE-FULL-PROMPT.txt';value=p.read_text()
assert len(value)<50000
assert all(s in value for s in ['book-add','course-add','focus-course','focus-custom','页数','累计分钟','三类','/kaogong/','npm run build'])
print(f'Make full prompt: {len(value)} characters; first message and start guide saved.')
