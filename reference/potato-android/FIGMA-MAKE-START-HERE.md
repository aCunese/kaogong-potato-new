# 从当前 Figma Make 空白页开始

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
