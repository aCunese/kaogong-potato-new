from pathlib import Path
import json
b=Path(__file__).parent
s=json.loads((b/'figma/section-handoff.json').read_text())
source=(b/'FIGMA-REBUILD-PROMPT.md').read_text()
header='''# Antigravity 执行交接：从 Figma 实现考公工作台 Android UI

## 当前任务与输出形式

你正在 Antigravity 中维护本机「考公工作台」项目。请通过已连接的 Figma MCP 读取下方设计，并根据当前源码实现移动端界面。交付为本地可运行、可继续开发的源码与预览，后续由当前 Android WebView 承载；本任务不要求回到 Figma Make 导出代码。

先检查项目 AGENTS.md、Git状态、index.html、server.js、android_project 和现有构建方式，保留用户改动。现有项目采用单文件 HTML/JavaScript 前端、Node API、Java Android WebView，不要仅因为设计上下文返回 React 示例就强行迁移整个项目。优先保留现有架构；如果为隔离UI创建独立 React + TypeScript + Vite 前端，先说明它与当前部署的衔接，不能同时复制一套新后端或丢掉原业务。

## Figma 读取入口

完整 Section（包含全部50个画板）：
https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=29-420

fileKey: qRhJ6ENSWrQZFIrK6y7PZy
Section nodeId: 29:420
页面 nodeId: 4:264

首页独立 Frame：
https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=8-26

五类界面总览，仅用于视觉参考：
https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=16-26

完整需求文字 Frame：
https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=16-1015

先读取 Section 的结构，列出其50个 Screen/* Frame；若不能遍历 Section，直接使用下方已知的独立节点ID，不要反复让我手工找链接。逐个/分批获取高保真设计上下文和截图，截图作为视觉验收目标，不作为整屏图片贴进实现。若上下文被截断或稀疏，缩小到子节点后重读，不能仅根据几个总览示例宣称读取完整。

如果 MCP 未连接、权限不足或超出限额，说明具体工具/节点/错误，区分“无法访问”和“文件没有设计”，不声称已经看过。停止依赖缺失设计的猜测性修改，但可以继续审查本地源码、完善类型和整理接入计划。

## 实现边界

- 最新风格为奶油白、鼠尾草绿、暖黄土豆。主尺寸412×915，同时校核360×800和393×873。真实界面采用响应式宽度和动态视口，处理安全区、键盘、表单滚动、底部按钮与导航。
- 复用设计变量、图标和土豆图片，按设计位置与比例使用资源。下载并保存实际静态资源到工程内，不能保留过期的Figma临时URL。已有土豆图集位于 output/design/potato-android/assets/potato-poses.png，4列×2行。字体使用可用的Android兼容中文字体回退。
- 原生状态栏和系统手势条由系统/Android壳处理，不能在生产WebView里再绘制一套假系统栏。
- 页面、共享UI、状态逻辑、API适配与存储逻辑保持清楚边界。已有业务逻辑能复用就复用；新增演示只使用独立命名空间，不覆盖原资料。禁止擅自调用真实上传、拉取、重置、导入等会覆盖数据的操作进行测试。
- 沿用现有 Node 用户名认证与整份状态同步，不添加 Supabase、Firebase 或新认证系统。核对真实 server.js 的 POST /api/auth/register、POST /api/auth/login、GET /api/auth/me、GET/POST /api/data/sync；同步上传为 {state, updatedAt, version} 并使用 Bearer 认证。禁止输出、硬编码或索取生产密钥。
- 原状态顶层 profile/countdowns/books/courses/library/plans/records/wrong/version、旧JSON备份、已有累计与记录口径均须保留。不能把照片条数当作数值错题数，也不能把未完成计时计入完成记录。
- 当前 Dockerfile 不会自动包含新前端的构建资源；若引入构建流程，要给出完整产物交付方案，支持 /kaogong/ 子路径及 Android 内置资源路径。不要只覆盖index.html后宣称部署完成。
- Android工程有原有定制逻辑。不要直接重跑 generate_android_project.py，它会删除并重建 android_project。WindowInsets、系统返回、图片选择、文件导出落盘、离线数据统一与正式APK签名属于后续单独验收范围，不把网页UI完成写成APK已可发布。
- 原项目暴露的账号隔离、同步竞态、离线与文件问题若超出本轮UI范围，记录为待修复项，不冒称已经解决；若为完成UI业务链路确需修改，先定位并保持改动范围清楚。

## 分阶段执行与验证

先读取设计和现有实现，形成50屏覆盖清单，然后直接开始共享样式/组件与首页实现；在浏览器里按对应Figma截图核对。随后完成其余七个主模块与导航，接着补齐三类登记、编辑详情、确认和状态。可以分批开发，不因分批丢掉完整需求，也不要仅停在口头计划。

先运行最窄的相关检查。设计比较至少覆盖首页、列表、完整表单、图表、确认弹窗和三种手机宽度。记录构建/检查的实际结果及未验证项。完成后给出可打开的本地预览、改动文件、功能覆盖表和部署衔接说明。不得自动推送、合并、覆盖线上或发布安装包。

当前任务是实现源码；下方通用需求中的 Figma Design 组件/画板交付条款用于理解设计体系，落实为可复用前端组件，不要求重新创建Design文件。若发生输出形式冲突，以本文件顶部的Antigravity源码交付约束为准。

## 已核实的50个独立画板节点

'''
manifest='\n'.join(f'- {n["name"].replace("Screen/","")}: `{n["id"]}`' for n in s['frames'])
text=header+manifest+'\n\n独立Frame链接规则：使用同一fileKey，把node-id的冒号改为横线，例如 https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=12-564 。\n\n---\n\n## 完整产品功能、视觉与验收需求\n\n'+source
(b/'ANTIGRAVITY-FIGMA-HANDOFF.md').write_text(text)
setup='''# Antigravity 连接 Figma 并开始本项目

## 首选：MCP Store

Antigravity IDE：Agent侧栏上方 … → MCP Servers → 搜索 Figma / Figma Dev Mode MCP → Install，按安装页提示连接或授权。
Antigravity App：Settings → Customizations → Installed MCP Servers → Add MCP → 搜索并添加 Figma。

Google官方将 Figma Dev Mode MCP 列入支持的商店集成。商店条目的连接方式以实际安装页为准；安装完成不等于已经验证读取成功。

## 备用：Figma Desktop 本地 MCP

若商店安装不可用，可在有相应Figma权限时使用桌面服务器：
1. 打开 Figma桌面版与本设计文件。
2. 切换 Dev Mode，在MCP server区域启用desktop MCP server。
3. Antigravity IDE … → MCP Servers → Manage MCP Servers → View raw config。
4. 合并下面条目到现有mcpServers中，保留其他服务器配置：

```json
{
  "mcpServers": {
    "figma-desktop": {
      "serverUrl": "http://127.0.0.1:3845/mcp"
    }
  }
}
```

5. 保存、刷新服务器，在 Figma桌面版保持打开时验证可列出设计读取工具。

Figma官方对desktop MCP列有付费计划及Dev/Full席位要求；没有这些权限时不能假设桌面方法可用。Figma远程服务器有受支持客户端要求，不把仅添加远程URL视作Antigravity已经认证成功。

## 首次读取验证

发送：

请通过Figma MCP读取首页Frame https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=8-26 ，返回实际节点ID、尺寸、标题、主要颜色并获取截图。再读取Section https://www.figma.com/design/qRhJ6ENSWrQZFIrK6y7PZy?node-id=29-420 的子Frame清单。只验证读取，暂不改源码；失败时报告具体工具和错误。

## 开始开发

在Antigravity打开「考公工作台」项目根目录，发送：

请先读取 output/design/potato-android/ANTIGRAVITY-FIGMA-HANDOFF.md 的全文，按其中Section链接、50个节点ID和完整功能要求实现App UI。先检查现有代码与Git状态，保留原Node API、业务数据和Android WebView。直接开始分阶段实现并提供本地预览；不要把Figma总览的几个示例当作全部页面。

## 官方操作依据

- Antigravity MCP：https://www.antigravity.google/docs/mcp
- Figma MCP连接：https://help.figma.com/hc/en-us/articles/39216419318551-Get-started-with-the-Figma-MCP-server
- Figma远程客户端限制：https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
'''
(b/'ANTIGRAVITY-SETUP.md').write_text(setup)
assert len(s['frames'])==50
assert all(v in text for v in ['29:420','页数','网课进度','wrong-detail','focus-custom','JSON','Android'])
print('Antigravity full handoff and setup guide saved; 50 node IDs included. Global MCP configuration unchanged.')
