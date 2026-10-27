# 交接文档 · 考公工作台（土豆新版）— 联合上线冻结候选状态

> 权威验证明细见 [FINAL-VERIFICATION.md](./FINAL-VERIFICATION.md)。本文件保留交接与发布执行必需信息。

## 1. 环境与版本

- 项目路径：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
- 分支：`codex/joint-release-hardening`；基线 HEAD：`c118307928d0239ef7470bb4ff9af6a17c65b2f7`
- 统一发布身份 `release.json`：Web `1.0.4` / build `20261027.03` / schema 3；Android `1.0.4` / `versionCode 5`
- 技术栈保持严格稳定：React 18 + Vite、Express 5、SQLite（WAL）、IndexedDB（v3，增量迁移）、Android Java WebView
- 权威依赖锁：`package-lock.json`（已提交，Docker 两阶段采用 `npm ci` 与 `npm ci --omit=dev`）
- 生产目标：`https://work.ruyne.space`（小范围灰度试运行候选）

## 2. 本轮已关闭缺陷与修复要点 (A01–A09)

1. **A01 游客迁移防并发覆盖**：页面状态仅用于预览，执行时取得用户锁重读真实快照合并，支持 `LOCAL_CHANGED` 阻断，凭据存入 `sync_state`（`guest_migration:<userId>`）。
2. **A02 账号代次守卫贯穿整个操作**：引入 `OperationContext` 与 `authEpoch`，贯穿冲突裁决、强制上传/拉取、媒体流水线和 IDB 写入事务，迟到响应按 `AUTH_EPOCH_CHANGED` 取消，绝不污染新账号。
3. **A03 灾备恢复假成功关闭**：实现 `restoreOffline` 显式路径停服接口，全量暂存核验、代际轮换与会话撤销在暂存库完成，附件安全就位后原子替换主库，任何故障非零退出且保全原数据。
4. **A09 媒体字段精确解析**：统一纯函数精确遍历 `avatar`、`wrong.image` 与 `wrong.images`（≤9张），移除全文正则与字符串包含判断，普通文本脱敏，损坏 JSON 明确拒绝。
5. **A05 上传先去重再计配额**：秒传查询优先于配额计算，避免同图重试被错误拦截为 413；通过已验证字节自愈磁盘损坏文件。
6. **A06 管理员恢复安全闭环**：对恢复包执行与正常工作区完全相同的媒体存在性、归属及配额强校验，内嵌图片注册为稳定引用，单事务提交，CLI 失败非零退出。
7. **A07 照片导出与回灌形成闭环**：服务端与客户端导出将本地及云端图片转为完整 `data:image/...` 字节，导出切账号立即取消，三道容量边界（50MiB/10MiB/12MiB）严格受保护。
8. **A04 Service Worker 目标更新校验**：移除非目标活跃 worker 假成功，精确比对目标 build，未就绪时强制 `update()`，`controllerchange` 双重核验，单次受控刷新防死循环。
9. **A08 Android 每条安装路径终态补齐**：`MainActivity` 为 `RESULT_FIRST_USER` 及所有非预期码提供带 `operationId` 的明确终态事件并重置可重试态，版本未达标不宣称 installed，桥端缓存最近终态支持弹窗重开读取。

## 3. 全量验证命令与最新实跑结果

```bash
npm run typecheck                          # exit 0 (前后端 TypeScript 0 错误)
npm test                                   # exit 0: 173 passed (146 单元 + 21 服务端 + 6 灾备)
npm run build                              # exit 0 (1982 模块，注入 6 项 SW 资产)
npm run verify:boundaries                  # exit 0: 12/12 passed (V01-V12 全部绿灯)
npm run verify:auth                        # exit 0: 14/14 passed (身份隔离与代际守卫)
npm run verify:backup                      # exit 0: 13/13 passed (灾备隔离全流程)
npm run verify:business                    # exit 0: 38/38 passed (真实端到端业务与截图)
VERIFY_REBUILD=0 npm run verify:isolated   # exit 0: 163/163 passed (视觉矩阵与数据隔离，生产库指纹未受污染)
npm run verify:apk                         # exit 0 (v1.0.4 / code 5 编译与 19 项 DEX 断言通过)
npm run verify:apk-old                     # exit 1 (16 项断言失败，预期结果，杜绝旧包分发)
```

证据目录：`docs/implementation/evidence/`。

## 4. 联合上线放行门槛执行清单

在将状态正式从“候选”改为“上线”前，需按以下步骤完成物理现场验收：

1. **原发布证书签名**：
   在安全终端运行：`KEYSTORE_PASS='<口令>' ./scripts/build-apk.sh`
   生成正式签名包 `release/apk/kaogong-potato-v1.0.4.apk`，验证签名证书指纹为 `85:75:82:EF:D9:20:83:CC:75:E5:C5:A0:C2:0D:B3:26:25:2C:BF:80:E7:11:23:23:4B:6B:F5:9D:CD:17:36:C1`，回填其 SHA-256 与字节数至 `release.json`，置 `apkReleased: true`。
2. **真机覆盖升级验证**：
   在 Android 设备上安装旧包（如 v1.0.2），存入学习记录与错题照片后覆盖安装 v1.0.4，验证数据与登录态完整保留。
3. **生产 Docker 容器构建与卷持久化验证**：
   基于包含 `package-lock.json` 的 `Dockerfile` 构建真实镜像并启动，验证停止容器重建后挂载卷数据不丢失。
4. **Restic 异地快照与全新目录恢复**：
   触发 Restic 备份快照并在隔离目录完整恢复验证。
5. **部署授权与灰度试运行**：
   确认线上 HTTPS、CSRF 写入与媒体上传正常，执行 24 小时试运行后全面开放。
