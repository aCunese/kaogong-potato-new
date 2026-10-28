import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  createInviteCode,
  listUsers,
  setUserActiveStatus,
  createPasswordResetCode,
  resetPasswordWithCode,
  restoreUserWorkspace,
} from './admin';
import {
  rotateGenerationId,
  getCurrentGenerationId,
  backupDatabaseOnline,
  getAttachmentsDir,
  closeDb,
  restoreOffline,
  getDataDir,
} from './db';
import { acquireDataDirectoryLock, DataDirectoryLock } from './dataLock';
import { auditMediaStorage } from './media';
import { getReleaseValidation } from './app';

const [,, command, ...args] = process.argv;

async function run() {
  switch (command) {
    case 'create-invite': {
      const code = createInviteCode('cli');
      console.log(`\n🎉 新注册邀请码已生成:\n${code}\n（一次性使用，注册后自动绑定作废）\n`);
      break;
    }

    case 'list-users': {
      const users = listUsers();
      console.log(`\n📋 当前系统用户列表 (${users.length} 个账号):`);
      console.table(users.map(u => ({
        ID: u.id,
        用户名: u.username,
        昵称: u.nickname,
        角色: u.role,
        状态: u.is_active ? '✅ 启用' : '🚫 停用',
        云端修订号: u.revision,
        媒体占用: `${(u.mediaBytes / 1024 / 1024).toFixed(2)} MB`,
        注册时间: u.created_at.slice(0, 16).replace('T', ' '),
      })));
      break;
    }

    case 'disable-user': {
      const userId = args[0];
      if (!userId) { console.error('用法: bun server/cli.ts disable-user <userId>'); process.exit(1); }
      const ok = setUserActiveStatus(userId, false);
      console.log(ok ? `✅ 用户 ${userId} 已停用，所有活跃会话已撤销。` : `❌ 用户 ${userId} 不存在。`);
      break;
    }

    case 'enable-user': {
      const userId = args[0];
      if (!userId) { console.error('用法: bun server/cli.ts enable-user <userId>'); process.exit(1); }
      const ok = setUserActiveStatus(userId, true);
      console.log(ok ? `✅ 用户 ${userId} 已恢复启用。` : `❌ 用户 ${userId} 不存在。`);
      break;
    }

    case 'reset-code': {
      const userId = args[0];
      if (!userId) { console.error('用法: bun server/cli.ts reset-code <userId>'); process.exit(1); }
      const result = createPasswordResetCode(userId, 'cli');
      if (!result) { console.error(`❌ 用户 ${userId} 不存在。`); process.exit(1); }
      console.log(`\n🔑 一次性密码重置码 (30分钟有效):\n${result.code}\n有效期至: ${result.expiresAt}\n`);
      break;
    }

    case 'reset-password': {
      const [code, newPass] = args;
      if (!code || !newPass) { console.error('用法: bun server/cli.ts reset-password <code> <newPassword>'); process.exit(1); }
      const result = await resetPasswordWithCode(code, newPass);
      console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case 'rotate-gen': {
      const oldGen = getCurrentGenerationId();
      const newGen = rotateGenerationId();
      console.log(`\n🔄 同步代际已轮换并撤销所有会话:\n旧代际: ${oldGen}\n新代际: ${newGen}\n`);
      break;
    }

    case 'restore-offline': {
      const flags = new Set(args.filter(a => a.startsWith('--')));
      const positional = args.filter(a => !a.startsWith('--'));
      const sourceDir = positional[0];
      const targetDataDir = positional[1] || process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
      const offlineConfirmed = flags.has('--offline-confirmed') || process.env.OFFLINE_CONFIRMED === 'true';
      const skipPreBackup = flags.has('--skip-pre-backup');

      if (!sourceDir) {
        console.error('用法: bun server/cli.ts restore-offline <sourceDir> [dataDir] [--offline-confirmed] [--skip-pre-backup]');
        process.exit(1);
      }

      try {
        const result = await restoreOffline({
          sourceDir,
          dataDir: targetDataDir,
          offlineConfirmed,
          skipPreBackup,
        });
        console.log(`\n========================================================================`);
        console.log(` [SUCCESS] 灾难恢复完成！`);
        console.log(` 数据库与附件已就位，代际已轮换 (${result.generationId})，旧客户端已被安全阻断。`);
        if (result.safetyBackupDir) {
          console.log(` 旧库安全快照已保存: ${result.safetyBackupDir}`);
        }
        if (result.corruptBackupDir) {
          console.log(` 损坏现场副本已保存: ${result.corruptBackupDir}`);
        }
        console.log(`========================================================================\n`);
      } catch (err: any) {
        console.error(`\n❌ [RESTORE_FAILED] 灾难恢复失败:`, err.message || err);
        process.exit(1);
      }
      break;
    }

    case 'restore-user': {
      const [userId, backupFile] = args;
      if (!userId || !backupFile) { console.error('用法: bun server/cli.ts restore-user <userId> <backupJsonFile>'); process.exit(1); }
      const resolved = path.resolve(backupFile);
      if (!fs.existsSync(resolved)) { console.error(`❌ 文件不存在: ${resolved}`); process.exit(1); }
      const content = fs.readFileSync(resolved, 'utf-8');
      const result = restoreUserWorkspace(userId, content, 'cli_restore');
      if (!result.ok) {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
      console.log(`✅ ${result.message}`);
      break;
    }

    case 'hot-backup': {
      const targetDir = args[0]
        ? path.resolve(args[0])
        : path.resolve(process.cwd(), 'data', 'backups', `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`);
      
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      }

      console.log(`\n📦 开始热备份到: ${targetDir}`);
      const dbFile = path.join(targetDir, 'potato.db');
      await backupDatabaseOnline(dbFile);

      // 1. Verify integrity of the backup db file
      const backupDb = new Database(dbFile, { readonly: true });
      const check = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!check || check[0]?.integrity_check !== 'ok') {
        backupDb.close();
        fs.rmSync(targetDir, { recursive: true, force: true });
        throw new Error(`热备数据库完整性检查失败: ${JSON.stringify(check)}`);
      }

      // 2. Query all required attachments from media_records in the backup DB
      const records = backupDb.prepare('SELECT id, filename, byte_size, sha256 FROM media_records').all() as Array<{
        id: string;
        filename: string;
        byte_size: number;
        sha256: string;
      }>;
      backupDb.close();

      console.log(`🔍 备份数据库中引用了 ${records.length} 个媒体附件，开始一致性校验与复制...`);

      const srcAttDir = getAttachmentsDir();
      const destAttDir = path.join(targetDir, 'attachments');
      if (!fs.existsSync(destAttDir)) {
        fs.mkdirSync(destAttDir, { recursive: true, mode: 0o700 });
      }

      const attachmentsManifest: Array<{ filename: string; sha256: string; byteSize: number }> = [];

      for (const rec of records) {
        // 安全防御：严格防止路径穿越与宿主机任意文件读取逃逸 (Root Cron Privilege Escalation)
        const safeFilename = path.basename(rec.filename);
        if (safeFilename !== rec.filename || rec.filename.includes('..') || path.isAbsolute(rec.filename)) {
          console.error(`🚨 [SECURITY ALERT] 检测到恶意附件路径伪造: ${rec.filename}`);
          fs.rmSync(targetDir, { recursive: true, force: true });
          throw new Error(`SECURITY_PATH_TRAVERSAL_DETECTED: ${rec.filename}`);
        }

        const srcFilePath = path.join(srcAttDir, safeFilename);
        if (!fs.existsSync(srcFilePath)) {
          console.error(`❌ 热备中止: 数据库引用的媒体文件在磁盘上缺失: ${safeFilename} (ID: ${rec.id})`);
          fs.rmSync(targetDir, { recursive: true, force: true });
          throw new Error(`CRITICAL_ATTACHMENT_MISSING: ${safeFilename}`);
        }

        const destFilePath = path.join(destAttDir, safeFilename);
        fs.copyFileSync(srcFilePath, destFilePath);
        const content = fs.readFileSync(destFilePath);
        const actualHash = crypto.createHash('sha256').update(content).digest('hex');

        if (actualHash !== rec.sha256) {
          console.error(`❌ 热备中止: 附件校验和不匹配: ${rec.filename} (期望: ${rec.sha256}, 实际: ${actualHash})`);
          fs.rmSync(targetDir, { recursive: true, force: true });
          throw new Error(`ATTACHMENT_HASH_MISMATCH: ${rec.filename}`);
        }

        attachmentsManifest.push({
          filename: rec.filename,
          sha256: actualHash,
          byteSize: content.length,
        });
      }

      // Compute database hash
      const dbBuffer = fs.readFileSync(dbFile);
      const dbHash = crypto.createHash('sha256').update(dbBuffer).digest('hex');
      const genId = getCurrentGenerationId();

      const releaseStatus = getReleaseValidation();
      const releaseConfig = releaseStatus.config || ({} as any);
      const manifest = {
        version: String(releaseConfig.webVersion || 'unknown'),
        build: String(releaseConfig.webBuild || 'unknown'),
        // Database backup format is independent of each workspace schema version.
        schemaVersion: 3,
        createdAt: new Date().toISOString(),
        generationId: genId,
        database: {
          filename: 'potato.db',
          sha256: dbHash,
          byteSize: dbBuffer.length,
        },
        attachmentsCount: attachmentsManifest.length,
        attachments: attachmentsManifest,
      };

      fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      console.log(`✅ 热备份完成:`);
      console.log(`   - 数据库文件: ${dbFile} (${(dbBuffer.length / 1024).toFixed(1)} KB)`);
      console.log(`   - 附件数量: ${attachmentsManifest.length} 个（与数据库引用完全吻合）`);
      console.log(`   - 代际标识: ${genId}`);
      console.log(`   - 清单文件: ${path.join(targetDir, 'manifest.json')}\n`);
      break;
    }

    case 'audit-media': {
      const report = auditMediaStorage();
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    default:
      console.log(`
考公工作台 · 管理员维护命令行工具

可用命令:
  create-invite                         生成新的一次性注册邀请码
  list-users                            查看所有已注册用户及其存储配额
  disable-user <userId>                 停用用户并撤销所有在线登录
  enable-user <userId>                  重新启用用户
  reset-code <userId>                   为用户生成30分钟一次性密码重置码
  reset-password <code> <newPassword>   使用重置码设置新密码
  rotate-gen                            轮换同步代际（整机灾备恢复后使用）
  restore-offline <src> [dataDir]       执行停服灾难恢复与代际轮换（原子提交点）
  restore-user <userId> <backupPath>    针对单个用户安全执行备份快照恢复
  hot-backup [targetDir]                执行在线热备份并导出校验清单
  audit-media                           审计媒体存储（孤儿、缺失、损坏及暂存残留）
`);
  }
}

async function main() {
  const DB_COMMANDS = new Set([
    'create-invite',
    'list-users',
    'disable-user',
    'enable-user',
    'reset-code',
    'reset-password',
    'rotate-gen',
    'restore-user',
    'hot-backup',
    'audit-media',
  ]);

  let lock: DataDirectoryLock | null = null;
  try {
    if (command && DB_COMMANDS.has(command)) {
      const dataDir = getDataDir();
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      }
      lock = await acquireDataDirectoryLock(dataDir, 'shared');
    }
    await run();
  } catch (err: any) {
    if (err?.code === 'DATA_LOCK_BUSY' || String(err).includes('DATA_LOCK_BUSY')) {
      console.error(`\n❌ [DATA_LOCK_BUSY] 数据目录正被独占维护或其它进程占用，无法执行命令: ${err.message || err}`);
      process.exit(2);
    }
    if (err?.code === 'DATA_LOCK_UNAVAILABLE' || String(err).includes('DATA_LOCK_UNAVAILABLE')) {
      console.error(`\n❌ [DATA_LOCK_UNAVAILABLE] 数据目录锁不可用: ${err.message || err}`);
      process.exit(3);
    }
    throw err;
  } finally {
    closeDb();
    if (lock) {
      await lock.release();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
