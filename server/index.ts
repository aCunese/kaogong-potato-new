import fs from 'node:fs';
import app, { getReleaseValidation } from './app';
import { getDb, getCurrentGenerationId, getDataDir, closeDb } from './db';
import { acquireDataDirectoryLock, DataDirectoryLock } from './dataLock';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 验证发布身份配置 (release.json)，若缺失或非法则拒绝监听并退出
const releaseStatus = getReleaseValidation();
if (!releaseStatus.valid || !releaseStatus.config) {
  console.error('❌ [RELEASE_CONFIG_INVALID] Release configuration missing or invalid:', releaseStatus.error);
  process.exit(1);
}

// 1. 在碰 DB 与监听前，取得共享维护锁
const dataDir = getDataDir();
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
}

let lock: DataDirectoryLock;
try {
  lock = await acquireDataDirectoryLock(dataDir, 'shared');
} catch (err: any) {
  const errMsg = err?.message || String(err);
  console.error('❌ [DATA_LOCK_FATAL] Failed to acquire data directory lock:', errMsg);
  process.exit(err?.code === 'DATA_LOCK_BUSY' || errMsg.includes('DATA_LOCK_BUSY') ? 2 : 1);
}

// 2. 监听意外丢锁：helper 意外死亡时，必须立即停止写服务并以非零退出
lock.lost.catch((err) => {
  console.error('❌ [FATAL] Data directory maintenance lock lost:', err?.message || err);
  process.exit(1);
});

// 3. Ensure DB is initialized
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

// 4. 平稳关闭：先停止监听请求 -> 等待在途连接 -> 关闭数据库 -> 释放维护锁 -> 退出
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`收到 ${signal} 信号，正在平稳关闭服务...`);

  if (typeof (server as any).closeIdleConnections === 'function') {
    (server as any).closeIdleConnections();
  }

  const forceTimeout = setTimeout(() => {
    console.error('关闭超时，强制终止。');
    try { closeDb(); } catch {}
    lock.release().finally(() => process.exit(1));
  }, 10000);
  forceTimeout.unref?.();

  server.close(async (err) => {
    clearTimeout(forceTimeout);
    if (err) {
      console.error('关闭 HTTP 服务异常:', err);
    }
    try {
      closeDb();
    } catch (dbErr) {
      console.error('关闭数据库异常:', dbErr);
    }
    try {
      await lock.release();
    } catch (lockErr) {
      console.error('释放数据目录锁异常:', lockErr);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
