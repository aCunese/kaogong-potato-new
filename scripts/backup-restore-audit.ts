/**
 * 备份/恢复真实性验证（隔离环境）：
 *   真实数据写入 -> backup.sh -> .tar.gz 归档 -> 全新隔离目录 restore.sh -> 启动服务
 *   -> 读取工作区 + 附件图片字节 + SQLite 完整性 + 会话清除 + 代际轮换。
 * 环境缺 Docker / Restic / 远程凭据时，明确记录“未验收”，不冒充异地灾备。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const RUN_ID = `backup_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const TMP = fs.mkdtempSync('/tmp/potato-backup-audit-');
const SEED_DATA = path.join(TMP, 'seed-data');
const RESTORE_DATA = path.join(TMP, 'restore-data');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'implementation', 'evidence');
const results: { name: string; passed: boolean; detail?: unknown }[] = [];
const spawnedServers: ReturnType<typeof spawn>[] = [];
const check = (name: string, passed: boolean, detail?: unknown) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealth(url: string) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${url}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`health check timeout: ${url}`);
}

function startServer(dataDir: string, port: number, logPath: string) {
  const fd = fs.openSync(logPath, 'a');
  const proc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', fd, fd],
  });
  spawnedServers.push(proc);
  return proc;
}

function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const tb = Buffer.from(type); const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data]))); return Buffer.concat([len, tb, data, cb]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { const rs = y * (width * 3 + 1); for (let x = 0; x < width; x++) { const i = rs + 1 + x * 3; raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2]; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class ApiClient {
  cookie = '';
  csrf = '';
  constructor(public baseUrl: string) {}
  async request(pathname: string, init: RequestInit = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
    if (this.cookie) headers['cookie'] = this.cookie;
    if (this.csrf && init.method && init.method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(`${this.baseUrl}${pathname}`, { ...init, headers });
    const setCookies = (res.headers as any).getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const match = String(cookie).match(/potato_session=([^;]+)/);
      if (match) this.cookie = `potato_session=${match[1]}`;
    }
    return res;
  }
}

async function main() {
  await fsp.mkdir(EVIDENCE_DIR, { recursive: true });
  const png = makePng(64, 64, [40, 120, 200]);
  const pngSha = crypto.createHash('sha256').update(png).digest('hex');

  // 1. 真实数据：注册 + 上传附件 + 同步工作区
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverLog = path.join(TMP, 'seed-server.log');
  let server = startServer(SEED_DATA, port, serverLog);
  await waitHealth(baseUrl);
  const invite = (execFileSync('node', ['--import', 'tsx', 'server/cli.ts', 'create-invite'], { cwd: ROOT, env: { ...process.env, DATA_DIR: SEED_DATA }, encoding: 'utf-8' }).match(/invite_[a-z0-9]+/i) || [])[0];
  const api = new ApiClient(baseUrl);
  const reg = await api.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'backup_user', password: 'Password123!', nickname: '备份验收', inviteCode: invite }) });
  const regJson: any = await reg.json();
  api.csrf = regJson.csrfToken;
  check('backup: isolated registration succeeds', reg.ok && Boolean(api.cookie), { status: reg.status });

  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'backup-photo.png');
  const upload = await api.request('/api/media/upload', { method: 'POST', body: form, headers: { 'x-csrf-token': api.csrf } });
  const uploadJson: any = await upload.json();
  check('backup: real attachment uploaded', upload.ok && Boolean(uploadJson.media?.id), { status: upload.status, id: uploadJson.media?.id });

  const ws1: any = await (await api.request('/api/workspace')).json();
  const state = ws1.state;
  state.profile.name = '备份验收工作区';
  state.wrong = [{ id: 'wrong-backup-1', date: '2026-10-27', bookId: state.books[0].id, note: '备份与恢复验收照片', image: `/api/media/${uploadJson.media.id}` }];
  const push = await api.request('/api/workspace', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: ws1.revision, requestId: `req_backup_${Date.now()}`, schemaVersion: 3, generationId: ws1.generationId, state, reason: 'backup_audit' }),
  });
  const pushJson: any = await push.json();
  check('backup: workspace synced with media reference', push.ok, { status: push.status, revision: pushJson.revision });
  const generationBefore = ws1.generationId;
  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));

  // 2. backup.sh -> 归档
  const backupOut = execFileSync('bash', ['scripts/backup.sh'], { cwd: ROOT, env: { ...process.env, DATA_DIR: SEED_DATA }, encoding: 'utf-8' });
  console.log(backupOut.split('\n').slice(-6).join('\n'));
  const archive = (backupOut.match(/备份归档已生成:\s*(\S+)/) || backupOut.match(/(\S+\.tar\.gz)/) || [])[1];
  const backupDirs = fs.readdirSync(path.join(SEED_DATA, 'backups')).filter(f => f.startsWith('backup_'));
  const archivePath = archive || path.join(SEED_DATA, 'backups', backupDirs.filter(f => f.endsWith('.tar.gz')).sort().pop()!);
  const archiveStat = fs.statSync(archivePath);
  check('backup: backup.sh produced a tar.gz archive', fs.existsSync(archivePath) && archiveStat.size > 0, { archivePath, size: archiveStat.size });

  // 3. restore.sh -> 全新隔离目录
  const restoreOut = execFileSync('bash', ['scripts/restore.sh', archivePath], { cwd: ROOT, env: { ...process.env, DATA_DIR: RESTORE_DATA }, encoding: 'utf-8' });
  console.log(restoreOut.split('\n').slice(-8).join('\n'));
  check('restore: restore.sh executed on a fresh isolated directory', fs.existsSync(path.join(RESTORE_DATA, 'potato.db')));
  const restoredAttachments = fs.existsSync(path.join(RESTORE_DATA, 'attachments')) ? fs.readdirSync(path.join(RESTORE_DATA, 'attachments')) : [];
  check('restore: attachment files restored', restoredAttachments.length >= 1, { files: restoredAttachments });
  // better-sqlite3 is a Node-ABI native module: inspect via a node subprocess, not in Bun.
  const integrity = (() => {
    const script = `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { readonly: true });
      const rows = db.pragma('integrity_check');
      const ws = db.prepare('SELECT revision, generation_id, state_json, seed_version FROM workspaces').all();
      const media = db.prepare('SELECT COUNT(*) as cnt FROM media_records').get();
      const sessions = db.prepare('SELECT COUNT(*) as cnt FROM sessions').get();
      db.close();
      console.log(JSON.stringify({ integrity: rows[0] && rows[0].integrity_check, workspaces: ws.length, revision: ws[0] && ws[0].revision, seedVersion: ws[0] && ws[0].seed_version, mediaCount: media.cnt, sessions: sessions.cnt, generation: ws[0] && ws[0].generation_id }));
    `;
    const out = execFileSync('node', ['-e', script, path.join(RESTORE_DATA, 'potato.db')], { encoding: 'utf-8' });
    return JSON.parse(out.trim().split('\n').pop() as string);
  })();
  check('restore: SQLite integrity_check ok', integrity.integrity === 'ok', integrity);
  check('restore: workspace data restored', integrity.workspaces >= 1 && integrity.revision >= 2, integrity);

  // 4. 启动恢复后的服务，登录并读取工作区 + 实际照片字节
  const port2 = await freePort();
  const baseUrl2 = `http://127.0.0.1:${port2}`;
  serverLog = path.join(TMP, 'restore-server.log');
  server = startServer(RESTORE_DATA, port2, serverLog);
  await waitHealth(baseUrl2);
  const api2 = new ApiClient(baseUrl2);
  const login = await api2.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'backup_user', password: 'Password123!' }) });
  const loginJson: any = await login.json();
  api2.csrf = loginJson.csrfToken;
  check('restore: login works after restore (user rows preserved)', login.ok, { status: login.status });
  const ws2: any = await (await api2.request('/api/workspace')).json();
  const wrong = ws2.state?.wrong?.[0];
  check('restore: workspace content readable after restore (profile + wrong photo reference)', ws2.state?.profile?.name === '备份验收工作区' && Boolean(wrong?.image?.startsWith('/api/media/')), { revision: ws2.revision, image: wrong?.image?.slice(0, 60) });
  check('restore: generation rotated after restore', ws2.generationId !== generationBefore, { before: generationBefore, after: ws2.generationId });
  const mediaRes = await api2.request(wrong.image);
  const mediaBytes = mediaRes.ok ? Buffer.from(await mediaRes.arrayBuffer()) : Buffer.alloc(0);
  const mediaSha = crypto.createHash('sha256').update(mediaBytes).digest('hex');
  check('restore: actual photo bytes match the original upload', mediaRes.ok && mediaSha === pngSha && mediaBytes.length === png.length, { bytes: mediaBytes.length, shaMatches: mediaSha === pngSha });

  // 5. 服务器重启后持久化仍在
  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  const port3 = await freePort();
  const baseUrl3 = `http://127.0.0.1:${port3}`;
  server = startServer(RESTORE_DATA, port3, path.join(TMP, 'restart-server.log'));
  await waitHealth(baseUrl3);
  const api3 = new ApiClient(baseUrl3);
  const login3 = await api3.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'backup_user', password: 'Password123!' }) });
  const login3Json: any = await login3.json();
  api3.csrf = login3Json.csrfToken;
  const ws3: any = await (await api3.request('/api/workspace')).json();
  check('restore: data + attachments persist across a server restart', ws3.state?.profile?.name === '备份验收工作区' && Boolean(ws3.state?.wrong?.[0]?.image), { revision: ws3.revision });

  // 6. 环境能力（缺工具时明确未验收，不冒充已启用）
  const hasDocker = (() => { try { execFileSync('docker', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();
  const hasRestic = (() => { try { execFileSync('restic', ['version'], { stdio: 'pipe' }); return true; } catch { return false; } })();
  const environmentGaps = [
    { item: 'Docker 容器重建验收', available: hasDocker, note: hasDocker ? '已具备执行条件' : '环境未安装 Docker：容器重建/持久卷挂载验收未执行，不得宣称已验收' },
    { item: 'Restic 异地灾备仓库快照与隔离恢复', available: hasRestic, note: hasRestic ? '已具备执行条件' : '环境未安装 restic 且无远程仓库凭据：远程快照与异地隔离恢复未验收' },
  ];
  for (const gap of environmentGaps) {
    console.log(`NOT_VERIFIED ${gap.item} :: ${gap.note}`);
  }

  const passed = results.filter(r => r.passed).length;
  const output = {
    runId: RUN_ID,
    checkedAt: new Date().toISOString(),
    seedDataDir: SEED_DATA,
    restoreDataDir: RESTORE_DATA,
    archivePath,
    archiveSize: archiveStat.size,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim(),
    integrity,
    dockerAvailable: hasDocker,
    resticAvailable: hasRestic,
    environmentGaps,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
  await fsp.writeFile(path.join(EVIDENCE_DIR, 'backup-restore-results.json'), JSON.stringify(output, null, 2), 'utf-8');
  await fsp.copyFile(path.join(ROOT, 'scripts', 'backup.sh'), path.join(EVIDENCE_DIR, 'backup-script-snapshot.sh')).catch(() => {});
  console.log(`\n==== 备份/恢复验收: ${passed}/${results.length} 通过 ====`);
  if (passed !== results.length) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  check('backup/restore audit harness completed', false, String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const proc of spawnedServers) {
    try { proc.kill('SIGKILL'); } catch {}
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
