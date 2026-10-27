# Implementation Status · 考公工作台（土豆新版）

> 本文件为联合上线冻结候选进度快照；详细验证明细与证据索引见 [FINAL-VERIFICATION.md](./FINAL-VERIFICATION.md)。

## 1. 基线与环境

- 仓库：`/Users/ruyne./Library/Mobile Documents/com~apple~CloudDocs/落地项目/考公工作台-土豆新版`
- 分支：`codex/joint-release-hardening`；基线：`codex/prod-release-m1-m4@c118307`
- 发布身份（`release.json`）：Web `1.0.4` / build `20261027.03`；Android `1.0.4` / `versionCode 5`；包名 `com.ruyne.kaogong`
- 生产目标：`https://work.ruyne.space`（本轮保持候选，待生产授权后部署）

## 2. 架构与约束（严格保持）

React 18 + Vite、Express 5、SQLite WAL、IndexedDB v3、Android Java WebView；手动计划/学习记录/错题照片/学情统计定位；无题库/判题/播放器/AI；生产依赖以 `package-lock.json` 为准，Docker 两阶段分别使用 `npm ci` 和 `npm ci --omit=dev`。

## 3. 本轮 9 项核心缺陷修复验收（A01–A09 全部关闭）

| 缺陷编号 | 核心修复点 | 验收状态 | 证明证据 |
|---|---|---|---|
| **A01** (P1) | 游客迁移基于最新持久化快照与互斥锁合并，检测 `LOCAL_CHANGED`，凭据写入 `sync_state` | ✅ 已关闭 | `repro/kaogong-guest-race-review.ts` 并发写入被安全拦截并保留数据 |
| **A02** (P1) | 账号代次守卫贯穿整个异步操作，`OperationContext` 贯穿网络与 IDB，旧响应不污染新账号 | ✅ 已关闭 | `repro/kaogong-sync-review.ts` 切号迟到响应终止于 `AUTH_EPOCH_CHANGED` |
| **A03** (P1) | 灾备停服恢复 `restoreOffline`：全量暂存核验、附件就位后原子替换主库，失败非零退出 | ✅ 已关闭 | `npm run test:dr` 6/6（故障注入全退出非零，原库保全）+ `verify:backup` 13/13 |
| **A09** (P2) | 统一纯函数解析媒体引用，只读 `avatar`、`wrong.image`、`wrong.images`（≤9张），脱敏普通文本 | ✅ 已关闭 | `repro/kaogong-media-review.mts` `FALSE_MEDIA` 恢复通过，删除保护精准生效 |
| **A05** (P2) | 上传先去重再计配额，同图重试不误报 413，已验证字节自愈损坏磁盘附件 | ✅ 已关闭 | `repro/kaogong-media-review.mts` `DEDUPE` 200，`CORRUPTION` 自动修复通过 |
| **A06** (P2) | 管理员恢复执行媒体归属与大小强校验，内嵌图片注册为稳定引用，单事务原子提交 | ✅ 已关闭 | `repro/kaogong-media-review.mts` `ADMIN_INVALID_AVATAR` 拒绝，CLI 失败非零 |
| **A07** (P2) | 照片导出转为 data URL 展开字节，回灌闭环形成，严格遵循 50MiB/10MiB/12MiB 边界 | ✅ 已关闭 | `repro/kaogong-media-review.mts` `ACTUAL_EXPORT_ROUNDTRIP` 导出回灌成功 |
| **A04** (P2) | SW 更新校验目标 build 精确身份，controllerchange 双重核实，共享刷新上限防止死循环 | ✅ 已关闭 | `repro/sw-check.mjs` 旧 worker 触发 updateCalls 并拒绝假激活 |
| **A08** (P2) | Android 安装状态机补齐终态事件（含 `RESULT_FIRST_USER`），目标未达标不宣称 installed | ✅ 已关闭 | Java Harness 全部通过，`npm run verify:apk` 19/19 断言通过 |

## 4. 自动化验证数字（全量最新实跑）

- `npm run typecheck`：**exit 0**（前后端 TypeScript 0 错误）
- `npm test`：**173/173 通过**（146 单元 + 21 服务端 + 6 灾备），exit 0
- `npm run build`：**exit 0**（1982 模块，注入 6 项资源，无冗余未哈希文件）
- `npm run verify:boundaries`：**12/12 通过**（含 V06 503 配置断言、V08 删除拦截/附件缺失断言、V12 Java 状态机执行断言）
- `npm run verify:auth`：**14/14 通过**
- `npm run verify:backup`：**13/13 通过**（Docker/Restic 标记未验收）
- `npm run verify:business`：**38/38 通过**（含 16 张真实业务视口截图）
- `npm run verify:isolated`：**163/163 通过**（150 视觉矩阵 + 6 入口错误 + 7 真实业务，生产 DB 指纹 100% 保持未改）
- `npm run verify:apk`：**exit 0**（v1.0.4 / versionCode 5 未签名编译校验通过）
- `npm run verify:apk-old`：**exit 1**（16 项断言失败，历史包确实不包含最新修复，符合预期）

## 5. 产物与哈希

- Web 构建产物：`dist/`（版本 `1.0.4`，构建号 `20261027.03`）
- Android 未签名验证包：`android/build/verify/kaogong-potato-v1.0.4-UNSIGNED-NOT-FOR-DISTRIBUTION.apk`（SHA-256: `9b5741be4e90257ac9bcaed0a321cd09300e31697a6408b21f5069bfcc9919fc`）
- 依赖锁定文件：权威 `package-lock.json`（新增提交）与 `bun.lock`
- 证据记录：`docs/implementation/evidence/`

## 6. 联合上线门槛与发布状态

当前处于：**高质量代码已关闭、全量自动化验证全绿的冻结候选状态**。
按联合发布门槛，正式上线前尚需：
1. 提供生产发布证书口令，生成正式签名 APK 并验证指纹及下载元数据；
2. 在 Android 物理真机上完成安装升级全链路回归；
3. 在 Linux 生产环境执行 Docker 容器重建与持久化卷验证；
4. 执行 Restic 远程快照与隔离灾备恢复演练。
未完成上述外部物理环境验收前，继续保持候选保护状态。
