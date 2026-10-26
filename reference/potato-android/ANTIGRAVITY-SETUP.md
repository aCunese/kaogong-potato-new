# Antigravity 连接 Figma 并开始本项目

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
