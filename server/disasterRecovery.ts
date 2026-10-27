import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export interface RestoreOfflineOptions {
  sourceDir: string;
  dataDir: string;
  offlineConfirmed: boolean;
  skipPreBackup?: boolean;
}

export interface RestoreOfflineResult {
  ok: boolean;
  generationId: string;
  databasePath: string;
  attachmentsRestored: number;
  safetyBackupDir?: string;
  corruptBackupDir?: string;
}

interface MediaRecordRow {
  id: string;
  user_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
}

function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 核心停服灾难恢复接口：
 * 1. 显式路径入参，脱离全局 DB 单例
 * 2. 仅支持停服恢复（确认 offlineConfirmed、独占锁、检查目标服务占用）
 * 3. 保持 DATA_DIR 挂载目录不变，在同一文件系统内建立暂存区 (.restore_staging_...)
 * 4. 完整复制数据库与附件，并对暂存区进行完整性、归属记录、文件大小与 SHA-256 逐项核验
 * 5. 在暂存库内执行代际轮换 (server_meta + workspaces) 与会话撤销，flush/truncate WAL
 * 6. 先将附件就位并复核，同名不同内容直接拒绝；旧无关附件不清理
 * 7. 保存可验证旧库安全快照（若损坏则仅标记现场副本 pre_restore_corrupt_...）
 * 8. 以数据库主文件原子替换 (fs.renameSync) 作为恢复提交点，清理旧 wal/shm
 */
export function restoreOffline(options: RestoreOfflineOptions): RestoreOfflineResult {
  if (options.offlineConfirmed !== true) {
    throw new Error('OFFLINE_NOT_CONFIRMED: restoreOffline 仅支持停服恢复。必须显式确认 offlineConfirmed: true。');
  }

  if (!options.sourceDir || typeof options.sourceDir !== 'string') {
    throw new Error('INVALID_SOURCE_DIR: 必须指定备份来源目录 sourceDir');
  }
  if (!options.dataDir || typeof options.dataDir !== 'string') {
    throw new Error('INVALID_DATA_DIR: 必须指定数据目标目录 dataDir');
  }

  const resolvedSource = path.resolve(options.sourceDir);
  const resolvedDataDir = path.resolve(options.dataDir);

  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
    throw new Error(`INVALID_SOURCE_DIR: 备份来源目录不存在或非目录: ${resolvedSource}`);
  }

  const sourceDbFile = path.join(resolvedSource, 'potato.db');
  if (!fs.existsSync(sourceDbFile)) {
    throw new Error(`MISSING_SOURCE_DB: 备份来源缺少 potato.db: ${resolvedSource}`);
  }

  // 确保目标数据目录存在（Docker 挂载目录保持不变）
  if (!fs.existsSync(resolvedDataDir)) {
    fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });
  }

  // 1. 取得恢复独占锁，并确认所有使用该数据目录的服务已停止
  const serverPidFile = path.join(resolvedDataDir, 'server.pid');
  const serverLockFile = path.join(resolvedDataDir, '.server.lock');
  for (const lockPath of [serverPidFile, serverLockFile]) {
    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, 'utf8').trim();
        const pid = parseInt(raw, 10) || (JSON.parse(raw)?.pid);
        if (pid && typeof pid === 'number' && pid !== process.pid) {
          try {
            process.kill(pid, 0);
            throw new Error(`SERVER_RUNNING: 检测到活跃的服务进程 (PID: ${pid}) 正在占用数据目录。恢复必须在停服状态下执行。`);
          } catch (e: any) {
            if (e.message?.includes('SERVER_RUNNING')) throw e;
            // 进程不存在，锁文件为陈旧残留
          }
        }
      } catch (e: any) {
        if (e.message?.includes('SERVER_RUNNING')) throw e;
      }
    }
  }

  const targetDbFile = path.join(resolvedDataDir, 'potato.db');
  if (fs.existsSync(targetDbFile)) {
    try {
      const probeDb = new Database(targetDbFile, { timeout: 100 });
      try {
        probeDb.pragma('busy_timeout = 100');
        probeDb.exec('BEGIN EXCLUSIVE; ROLLBACK;');
      } finally {
        probeDb.close();
      }
    } catch (err: any) {
      if (err?.code === 'SQLITE_BUSY' || (err?.message && (err.message.includes('locked') || err.message.includes('busy')))) {
        throw new Error(`DATABASE_LOCKED: 目标数据库 ${targetDbFile} 正在被其他服务进程独占或活跃占用。必须停止所有服务后方可恢复。`);
      }
    }
  }

  const restoreLockFile = path.join(resolvedDataDir, '.restore.lock');
  if (fs.existsSync(restoreLockFile)) {
    try {
      const raw = fs.readFileSync(restoreLockFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.pid && parsed.pid !== process.pid) {
        try {
          process.kill(parsed.pid, 0);
          throw new Error(`RESTORE_IN_PROGRESS: 另一个恢复进程 (PID: ${parsed.pid}) 正在对该数据目录执行恢复。`);
        } catch (e: any) {
          if (e.message?.includes('RESTORE_IN_PROGRESS')) throw e;
          // 陈旧残留恢复锁，移除
          try { fs.unlinkSync(restoreLockFile); } catch {}
        }
      }
    } catch (e: any) {
      if (e.message?.includes('RESTORE_IN_PROGRESS')) throw e;
      try { fs.unlinkSync(restoreLockFile); } catch {}
    }
  }

  fs.writeFileSync(restoreLockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
  let lockAcquired = true;
  let stagingDirToClean: string | null = null;

  try {
    // 2. 严格核验源备份完整性、数据库引用附件与校验和
    const manifestPath = path.join(resolvedSource, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.database?.sha256) {
        const srcDbBuf = fs.readFileSync(sourceDbFile);
        const computedHash = crypto.createHash('sha256').update(srcDbBuf).digest('hex');
        if (computedHash !== manifest.database.sha256) {
          throw new Error(`SOURCE_DB_HASH_MISMATCH: 备份数据库校验和不匹配! 期望: ${manifest.database.sha256}, 计算: ${computedHash}`);
        }
      }
    }

    const sourceDb = new Database(sourceDbFile, { readonly: true });
    let requiredMedia: MediaRecordRow[] = [];
    try {
      const check = sourceDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!check || check[0]?.integrity_check !== 'ok') {
        throw new Error(`SOURCE_INTEGRITY_CHECK_FAILED: 备份数据库 PRAGMA integrity_check 失败: ${JSON.stringify(check)}`);
      }

      const hasMediaTable = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_records'").get() !== undefined;
      if (hasMediaTable) {
        const mediaCols = (sourceDb.pragma('table_info(media_records)') as Array<{ name: string }>).map(c => c.name);
        const hasUserId = mediaCols.includes('user_id');
        const hasUsersTable = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get() !== undefined;
        const rawRows = sourceDb.prepare('SELECT * FROM media_records').all() as any[];
        requiredMedia = rawRows.map(r => ({
          id: String(r.id || ''),
          user_id: String(r.user_id || ''),
          filename: String(r.filename || ''),
          original_name: String(r.original_name || r.filename || ''),
          mime_type: String(r.mime_type || 'application/octet-stream'),
          byte_size: Number(r.byte_size || 0),
          sha256: String(r.sha256 || ''),
        }));

        const srcAttDir = path.join(resolvedSource, 'attachments');
        for (const item of requiredMedia) {
          const safeName = path.basename(item.filename);
          if (safeName !== item.filename || item.filename.includes('..') || path.isAbsolute(item.filename)) {
            throw new Error(`SECURITY_PATH_TRAVERSAL_DETECTED: 媒体记录文件名非法: ${item.filename}`);
          }

          if (hasUserId && hasUsersTable && item.user_id) {
            const user = sourceDb.prepare('SELECT id FROM users WHERE id = ?').get(item.user_id);
            if (!user) {
              throw new Error(`ORPHAN_MEDIA_RECORD: 媒体记录缺失所属用户: ${item.id} (user_id: ${item.user_id})`);
            }
          }

          const attFile = path.join(srcAttDir, item.filename);
          if (!fs.existsSync(attFile)) {
            throw new Error(`恢复校验失败: 数据库引用的媒体文件在备份中缺失: ${item.filename} (ID: ${item.id})`);
          }

          const stat = fs.statSync(attFile);
          if (item.byte_size > 0 && stat.size !== item.byte_size) {
            throw new Error(`恢复校验失败: 附件大小不匹配: ${item.filename} (期望: ${item.byte_size}, 实际: ${stat.size})`);
          }

          if (item.sha256) {
            const hash = computeFileSha256(attFile);
            if (hash !== item.sha256) {
              throw new Error(`恢复校验失败: 附件校验和不匹配: ${item.filename} (期望: ${item.sha256}, 实际: ${hash})`);
            }
          }
        }
      }
    } finally {
      sourceDb.close();
    }

    // 3. 切换前必须保存可验证旧库安全副本；损坏现场只能标记为现场副本
    let safetyBackupDir: string | undefined;
    let corruptBackupDir: string | undefined;

    if (!options.skipPreBackup && fs.existsSync(targetDbFile)) {
      let isTargetHealthy = false;
      let targetSize = 0;
      let targetHash = '';
      try {
        const buf = fs.readFileSync(targetDbFile);
        targetSize = buf.length;
        targetHash = crypto.createHash('sha256').update(buf).digest('hex');
        const testDb = new Database(targetDbFile, { readonly: true, timeout: 500 });
        const check = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        if (check && check[0]?.integrity_check === 'ok') {
          isTargetHealthy = true;
        }
        testDb.close();
      } catch {
        isTargetHealthy = false;
      }

      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
      const backupsBase = path.join(resolvedDataDir, 'backups');
      fs.mkdirSync(backupsBase, { recursive: true, mode: 0o700 });

      if (isTargetHealthy) {
        safetyBackupDir = path.join(backupsBase, `pre_restore_safety_${timestamp}`);
        fs.mkdirSync(safetyBackupDir, { recursive: true, mode: 0o700 });
        const safetyDbFile = path.join(safetyBackupDir, 'potato.db');
        fs.copyFileSync(targetDbFile, safetyDbFile);

        if (fs.existsSync(targetDbFile + '-wal')) {
          fs.copyFileSync(targetDbFile + '-wal', path.join(safetyBackupDir, 'potato.db-wal'));
        }
        if (fs.existsSync(targetDbFile + '-shm')) {
          fs.copyFileSync(targetDbFile + '-shm', path.join(safetyBackupDir, 'potato.db-shm'));
        }

        const targetAttDir = path.join(resolvedDataDir, 'attachments');
        if (fs.existsSync(targetAttDir)) {
          const safetyAttDir = path.join(safetyBackupDir, 'attachments');
          fs.mkdirSync(safetyAttDir, { recursive: true, mode: 0o700 });
          for (const file of fs.readdirSync(targetAttDir)) {
            const src = path.join(targetAttDir, file);
            if (fs.statSync(src).isFile()) {
              fs.copyFileSync(src, path.join(safetyAttDir, file));
            }
          }
        }

        // 校验安全快照的完整性与哈希一致性
        const copiedBuf = fs.readFileSync(safetyDbFile);
        const copiedHash = crypto.createHash('sha256').update(copiedBuf).digest('hex');
        if (copiedHash !== targetHash || copiedBuf.length !== targetSize) {
          throw new Error('SAFETY_BACKUP_VERIFICATION_FAILED: 安全快照复制校验和不一致');
        }
        const verifySafetyDb = new Database(safetyDbFile, { readonly: true });
        const safetyCheck = verifySafetyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        verifySafetyDb.close();
        if (!safetyCheck || safetyCheck[0]?.integrity_check !== 'ok') {
          throw new Error('SAFETY_BACKUP_INTEGRITY_FAILED: 安全快照数据库完整性校验失败');
        }
      } else {
        corruptBackupDir = path.join(backupsBase, `pre_restore_corrupt_${timestamp}`);
        fs.mkdirSync(corruptBackupDir, { recursive: true, mode: 0o700 });
        fs.copyFileSync(targetDbFile, path.join(corruptBackupDir, 'potato.db'));
        if (fs.existsSync(targetDbFile + '-wal')) {
          fs.copyFileSync(targetDbFile + '-wal', path.join(corruptBackupDir, 'potato.db-wal'));
        }
        if (fs.existsSync(targetDbFile + '-shm')) {
          fs.copyFileSync(targetDbFile + '-shm', path.join(corruptBackupDir, 'potato.db-shm'));
        }
        fs.writeFileSync(path.join(corruptBackupDir, 'manifest.json'), JSON.stringify({
          recordedAt: new Date().toISOString(),
          type: 'corrupt_scene_preservation',
          note: '旧数据库在恢复前已处于损坏状态，仅作为现场副本标记留存，不视为可验证安全快照',
        }, null, 2));
      }
    }

    // 4. 在同一文件系统内建立隔离暂存区（dataDir 下 .restore_staging_...）
    const stagingDir = path.join(resolvedDataDir, `.restore_staging_${Date.now()}_${process.pid}_${crypto.randomBytes(4).toString('hex')}`);
    stagingDirToClean = stagingDir;
    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    const stagingDbFile = path.join(stagingDir, 'potato.db');
    fs.copyFileSync(sourceDbFile, stagingDbFile);

    const stagingAttDir = path.join(stagingDir, 'attachments');
    fs.mkdirSync(stagingAttDir, { recursive: true, mode: 0o700 });
    for (const item of requiredMedia) {
      const srcFile = path.join(resolvedSource, 'attachments', item.filename);
      const destFile = path.join(stagingAttDir, item.filename);
      fs.copyFileSync(srcFile, destFile);
    }

    // 5. 对暂存数据库和全部媒体逐项核验 SQLite 完整性、归属记录、文件大小及 SHA-256
    const stagingDb = new Database(stagingDbFile);
    let nextGenId: string;
    try {
      const check = stagingDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!check || check[0]?.integrity_check !== 'ok') {
        throw new Error(`STAGING_INTEGRITY_CHECK_FAILED: 暂存数据库 integrity_check 校验失败: ${JSON.stringify(check)}`);
      }

      for (const item of requiredMedia) {
        const stagingFile = path.join(stagingAttDir, item.filename);
        if (!fs.existsSync(stagingFile)) {
          throw new Error(`恢复校验失败: 数据库引用的媒体文件在暂存区缺失: ${item.filename}`);
        }
        const stat = fs.statSync(stagingFile);
        if (item.byte_size > 0 && stat.size !== item.byte_size) {
          throw new Error(`恢复校验失败: 暂存区附件大小不匹配: ${item.filename}`);
        }
        if (item.sha256) {
          const hash = computeFileSha256(stagingFile);
          if (hash !== item.sha256) {
            throw new Error(`恢复校验失败: 暂存区附件校验和不匹配: ${item.filename}`);
          }
        }
      }

      // 6. 在暂存数据库中完成代际轮换与会话撤销，flush/truncate WAL
      nextGenId = `gen_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      const hasServerMeta = stagingDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='server_meta'").get() !== undefined;
      const hasWorkspaces = stagingDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get() !== undefined;
      const hasSessions = stagingDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get() !== undefined;

      if (hasServerMeta) {
        stagingDb.prepare("INSERT OR REPLACE INTO server_meta (key, value) VALUES ('generation_id', ?)").run(nextGenId);
      }
      if (hasWorkspaces) {
        stagingDb.prepare("UPDATE workspaces SET generation_id = ?").run(nextGenId);
      }
      if (hasSessions) {
        stagingDb.prepare("DELETE FROM sessions").run();
      }

      stagingDb.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      stagingDb.close();
    }

    // 确保主文件不依赖 WAL（清理暂存区残留空 wal/shm）
    try { fs.unlinkSync(stagingDbFile + '-wal'); } catch {}
    try { fs.unlinkSync(stagingDbFile + '-shm'); } catch {}

    // 7. 先将已校验附件安全就位，再次确认暂存库引用均可读取；同名不同内容直接拒绝；旧的无关附件暂不清理
    const targetAttDir = path.join(resolvedDataDir, 'attachments');
    if (!fs.existsSync(targetAttDir)) {
      fs.mkdirSync(targetAttDir, { recursive: true, mode: 0o700 });
    }

    for (const item of requiredMedia) {
      const targetFile = path.join(targetAttDir, item.filename);
      if (fs.existsSync(targetFile)) {
        const existingHash = computeFileSha256(targetFile);
        if (existingHash !== item.sha256) {
          throw new Error(`ATTACHMENT_CONFLICT: 目标附件已存在但内容不符: ${item.filename} (已有哈希: ${existingHash}, 预期: ${item.sha256})。直接拒绝恢复。`);
        }
      } else {
        const stagingFile = path.join(stagingAttDir, item.filename);
        const tmpTarget = path.join(targetAttDir, `.${item.filename}.tmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
        fs.copyFileSync(stagingFile, tmpTarget);
        fs.renameSync(tmpTarget, targetFile);
      }
    }

    // 再次确认暂存库所有引用在目标附件目录中均可安全读取且哈希一致
    for (const item of requiredMedia) {
      const targetFile = path.join(targetAttDir, item.filename);
      if (!fs.existsSync(targetFile)) {
        throw new Error(`ATTACHMENT_MISSING_AFTER_PLACEMENT: 附件就位后无法读取: ${item.filename}`);
      }
      const stat = fs.statSync(targetFile);
      if (stat.size !== item.byte_size) {
        throw new Error(`ATTACHMENT_SIZE_MISMATCH: 目标附件大小不匹配: ${item.filename}`);
      }
      const hash = computeFileSha256(targetFile);
      if (hash !== item.sha256) {
        throw new Error(`ATTACHMENT_HASH_MISMATCH: 目标附件哈希不匹配: ${item.filename}`);
      }
    }

    // 8. 恢复提交点：最后原子替换主数据库 (fs.renameSync) 并安全清理旧 wal/shm
    fs.renameSync(stagingDbFile, targetDbFile);

    // 清理旧目标 WAL/SHM，确保新主库不受旧 WAL 干扰
    try { fs.unlinkSync(targetDbFile + '-wal'); } catch {}
    try { fs.unlinkSync(targetDbFile + '-shm'); } catch {}

    // 清理暂存目录
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    stagingDirToClean = null;

    // 最终数据库完整性复核
    const finalDb = new Database(targetDbFile, { readonly: true });
    try {
      const check = finalDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!check || check[0]?.integrity_check !== 'ok') {
        throw new Error(`FINAL_DB_INTEGRITY_CHECK_FAILED: 恢复后主数据库 integrity_check 校验失败: ${JSON.stringify(check)}`);
      }
    } finally {
      finalDb.close();
    }

    return {
      ok: true,
      generationId: nextGenId,
      databasePath: targetDbFile,
      attachmentsRestored: requiredMedia.length,
      safetyBackupDir,
      corruptBackupDir,
    };
  } finally {
    if (stagingDirToClean && fs.existsSync(stagingDirToClean)) {
      try { fs.rmSync(stagingDirToClean, { recursive: true, force: true }); } catch {}
    }
    if (lockAcquired && fs.existsSync(restoreLockFile)) {
      try { fs.unlinkSync(restoreLockFile); } catch {}
    }
  }
}
