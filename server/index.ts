import app, { getReleaseValidation } from './app';
import { getDb, getCurrentGenerationId } from './db';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 验证发布身份配置 (release.json)，若缺失或非法则拒绝监听并退出
const releaseStatus = getReleaseValidation();
if (!releaseStatus.valid || !releaseStatus.config) {
  console.error('❌ [RELEASE_CONFIG_INVALID] Release configuration missing or invalid:', releaseStatus.error);
  process.exit(1);
}

// Ensure DB is initialized
getDb();
const genId = getCurrentGenerationId();

const server = app.listen(PORT, HOST, () => {
  console.log(`\n========================================`);
  console.log(`🥔 考公工作台 · 后端服务已启动`);
  console.log(`🌐 访问地址: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  console.log(`📦 版本身份: v${releaseStatus.config!.webVersion} (build ${releaseStatus.config!.webBuild})`);
  console.log(`🔄 同步代际 ID: ${genId}`);
  console.log(`========================================\n`);
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在平稳关闭服务...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在平稳关闭服务...');
  server.close(() => {
    process.exit(0);
  });
});
