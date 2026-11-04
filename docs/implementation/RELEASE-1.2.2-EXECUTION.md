# Web 1.2.2 发布执行记录

- 发布时间：2026-11-04 19:56:50（Asia/Tokyo）；生产切换完成 `2026-11-04T10:56:50.038576+00:00`。
- 生产地址：https://work.ruyne.space
- Web：`1.2.2` / build `20261104.02`；工作区 Schema `5`。
- 功能提交：`69d95dc927ec4402af3482c1a35ce6c303d44793`，已快进合入并推送 GitHub `main`。
- 镜像：`kaogong-potato-app:1.2.2-20261104.02`。
- 不可变镜像身份：`sha256:d0bd3db5dedb41933a2286485500e7c65d1e6536324b3373c9104a3bfbf70689`。
- 本次服务器源码与执行证据：`/home/ubuntu/kaogong-releases/1.2.2-20261104.02/`。
- 持久化目录：`/home/ubuntu/kaogong-app/data` → `/app/data`，保持原挂载和既有环境配置。

## 功能结果

1. 添加日程保留类型与科目筛选，资料选择仅显示原名。按账号、本设备记住上次类型，以及题本/网课各自科目和资料；指定资料优先，删除资料后在原科目内回选首项。
2. 分析的题本学习页面在正确率图下显示每日刷题记录；跟随30/90天与全部范围，按日期和题本合并，显示刷题、正确数量与日合计。最近日期默认展开，登记修正即时更新，删除题本后的登记保留。
3. 错题图片下方左侧提供编辑，右侧显示时间；分类和笔记可反复保存或取消，保存失败保留草稿。
4. 照片通过自有服务器 Tesseract/Pillow 自动确认文字方向；新照片上传后、旧照片首次打开详情、离线照片联网同步后逐图识别。列表、详情、全屏统一摆正，原附件不改；不确定时保留原图并允许重新识别。
5. 方向结果随工作区同步、备份与恢复保留；请求和异步落盘均校验账号及图片身份。单worker、30秒期限、低置信度保守判定，tini与shutdown hook清理超时和退出时的原生后代。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| 完整单元与真实Chromium套件 | 332通过，0失败 |
| 服务端套件 | 79通过，0失败、0跳过 |
| 灾备套件 | 24通过，0失败、0跳过 |
| Python方向判定边界 | 4通过，0失败 |
| 完整 npm test | 435个JS/TS用例及4个Python用例通过，exit0 |
| 边界 / 身份隔离 / 备份恢复审计 | 12/12、14/14、13/13通过 |
| 最终代码 npm run build | 前后端TypeScript及Vite通过 |
| 手机布局 | 360/393/412宽度通过并检查截图 |
| Android未签名编译 | 编译与19项Manifest/DEX断言通过，未作为正式包发布 |
| 既有正式APK | 1.0.5/code6的Manifest/DEX、v2/v3签名、证书、字节数与SHA256匹配 |
| 独立代码审查 | 服务端及整分支复审通过，遗留问题0 |

构建保留既有Vite大于500KB的分块提示。备份恢复审计的13项全部通过；外部Restic仓库未配置，本轮未声称完成Restic远端快照验收，采用服务器归档及本机独立核验副本。

## 镜像与资源验证

待发布镜像使用临时数据、1CPU/512MiB、禁止swap，未挂载生产数据。真实中文试题四个朝向及EXIF相机方向共5项全部正确，单项18.982–23.542秒；识别期间健康检查最长27ms，普通保存最长70ms，内存峰值309792768字节（约295.4MiB）。原始图像hash均保持。

Linux默认tini入口下的进程生命周期测试7/7通过，包括超时后进程树消失、临时目录清理、任务槽释放及真实服务SIGTERM关闭。临时容器正常退出、无OOM、无自动重启。

## 数据与备份

- 在线热备：`/home/ubuntu/kaogong-app/data/backups/backup_predeploy_1.2.2_20261104_103802`；归档SHA256：`8f8552c9030f6cac7da11b788c783dd0c8fe7adab2ae5a429f5003a4e1431b20`。
- 停服最终备份：`/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.2_20261104_105644`。
- 最终归档：`/home/ubuntu/kaogong-app/data/backups/backup_stop_1.2.2_20261104_105644.tar.gz`；SHA256：`7e5ec7564605e214fd6d3d5750a6a1a1c199b317168586b3cdd5d48678212c39`。
- 两份备份均已下载到本机忽略目录 `output/release-1.2.2/backups/`，独立校验数据库完整性、外键、全部46个附件与归档hash；私密数据未提交Git。
- 切换瞬间的数据库计数、工作区摘要、46附件字节/hash及同步代际完全一致，无缺失或hash不符。
- 后续重启验收期间已有正常新增题本、网课和日程；逐项核验原有实体无缺失，新写入保留，数据库完整性与附件仍正常。

## 公网与回退

公网健康、1.2.2/20261104.02、version.json与api/version的nonce回显、Service Worker身份、JS/CSS及现有APK下载均通过。真实匿名Chromium客户端先加载1.2.1，再通过现有SKIP_WAITING协议更新至1.2.2缓存和控制器；更新后重新核验nonce与版本成功。自动化浏览器使用HTTP/1.1以避开本机HTTP/2连接超时，TLS校验保持启用；不作为Android真机安装验收。

生产容器实际重启后健康，tini入口生效，无OOM、无自动重启、无致命日志。旧容器 `kaogong-potato-app-prev-1.2.1-20261104-02`、旧镜像及所有备份保留。异常回退时切回旧代码镜像并保留当前数据目录，不以旧备份覆盖新数据。

详细机器证据位于本机 `output/release-1.2.2/` 与上述服务器发布目录，包含local-validation-summary、staging-result、resource-gate、Linux lifecycle、deployment-result、restart-acceptance、public-acceptance、browser-update-acceptance及两份本机备份验证JSON。
