# 真实截图清单（隔离环境，非 mock 预览）

生成脚本：`bun scripts/business-e2e-audit.ts`（独立临时 DATA_DIR + 独立服务端口 + 独立浏览器 context，真实 Express/SQLite/IndexedDB/Service Worker/media upload）。
结果：`docs/implementation/evidence/business-e2e-results.json`（38/38 通过）、服务端日志 `business-e2e-server.log`。

| 文件 | 内容 | 说明 |
|---|---|---|
| `login-412x915.png` | 登录页 | 未登录独立入口，无业务导航；三视口 412/393/360 |
| `login-393x873.png` | 登录页 | 同上 |
| `login-360x800.png` | 登录页 | 同上 |
| `library-412x915.png` / `library-393x873.png` / `library-360x800.png` | 学习资料库（题本进度） | 注册后真实服务器种子 14/7/22 |
| `settings-412x915.png` / `settings-393x873.png` / `settings-360x800.png` | 「我的」 | 紧凑结构、同步状态、检查更新、账号与数据设置 |
| `conflict-412x915.png` / `conflict-393x873.png` / `conflict-360x800.png` | 真实版本冲突弹窗 | 双设备分叉产生，显示双方 revision 摘要与明确选择 |
| `update-failed-412x915.png` / `update-failed-393x873.png` / `update-failed-360x800.png` | 更新弹窗（503 失败态） | 证明失败时不误报“当前已是最新版本”，提供重新核验 |
| `offline-reconnected-412x915.png` | 离线重连后 | 真实 SW 控制下离线冷启动 → 联网自动恢复会话/CSRF 并补传成功 |

## 未包含（诚实说明）

- **真机 / 模拟器截图**：本机无 adb/设备/模拟器，缺少 Android 系统级截图（来源授权、相机、安装确认、安全区）。
- 150 张 50 屏 × 3 视口视觉矩阵截图由 `scripts/verify-screens.ts` 生成在临时目录（`/var/folders/.../potato-isolated-run-*`，运行结束按设计清理）；其通过结果见 `test-isolation-baseline-results.json`（156/156 visual + 7/7 business 中的视觉部分）。
