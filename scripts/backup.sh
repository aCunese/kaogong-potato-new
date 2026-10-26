#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 考公工作台 · 自动化热备份与 Restic 灾备归档脚本
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

DATA_DIR="${DATA_DIR:-${ROOT_DIR}/data}"
BACKUP_BASE_DIR="${DATA_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
TARGET_BACKUP_DIR="${BACKUP_BASE_DIR}/backup_${TIMESTAMP}"

echo "========================================================================"
echo " [BACKUP] 开始执行考公工作台热备份: ${TIMESTAMP}"
echo "========================================================================"

mkdir -p "${BACKUP_BASE_DIR}"

# 1. 调用 CLI 进行 SQLite 在线热备及附件清点
echo "--> 1. 正在调用 SQLite 在线热备 API 并计算附件校验码..."
node --import tsx "${ROOT_DIR}/server/cli.ts" hot-backup "${TARGET_BACKUP_DIR}"

if [ ! -f "${TARGET_BACKUP_DIR}/potato.db" ] || [ ! -f "${TARGET_BACKUP_DIR}/manifest.json" ]; then
    echo "❌ 备份失败: 目标文件未正确生成！"
    exit 1
fi

echo "--> 2. 验证备份数据库完整性..."
node -e "
const Database = require('better-sqlite3');
const target = process.argv[1];
const db = new Database(target + '/potato.db', { readonly: true });
const check = db.pragma('integrity_check');
if (!check || check[0].integrity_check !== 'ok') {
  console.error('❌ SQLite 完整性检查失败:', check);
  process.exit(1);
}
console.log('✅ SQLite PRAGMA integrity_check 通过');
db.close();
" "${TARGET_BACKUP_DIR}"

# 3. 归档压缩当前备份
echo "--> 3. 正在生成独立归档压缩包..."
TAR_FILE="${BACKUP_BASE_DIR}/backup_${TIMESTAMP}.tar.gz"
tar -czf "${TAR_FILE}" -C "${BACKUP_BASE_DIR}" "backup_${TIMESTAMP}"
echo "✅ 归档生成: ${TAR_FILE} ($(du -h "${TAR_FILE}" | cut -f1))"

# 4. 执行本地保留策略（保留最新 24 小时内的所有备份，以及保留近 30 天每日、近 8 周每周备份）
echo "--> 4. 执行本地保留策略检查与清理 (24小时全量 / 30天每日 / 8周每周)..."
node -e "
const fs = require('fs');
const path = require('path');
const baseDir = process.argv[1];

if (!fs.existsSync(baseDir)) process.exit(0);

const files = fs.readdirSync(baseDir)
  .filter(f => f.startsWith('backup_') && f.endsWith('.tar.gz'))
  .map(f => {
    const filePath = path.join(baseDir, f);
    const stat = fs.statSync(filePath);
    return { name: f, path: filePath, mtime: stat.mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime); // Newest first

const now = Date.now();
const ONE_HOUR = 3600 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;

const kept = new Set();
const seenDays = new Set();
const seenWeeks = new Set();

for (const file of files) {
  const age = now - file.mtime;

  // 1. 保留 24 小时内所有备份
  if (age <= 24 * ONE_HOUR) {
    kept.add(file.path);
    continue;
  }

  const d = new Date(file.mtime);
  const dayKey = d.toISOString().slice(0, 10);
  // 计算周起始日（周一），避免日跨月归为同一周的缺陷 (Defect F11)
  const dayOfWeek = d.getUTCDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(d.getTime() - diffToMonday * 86400000);
  const weekKey = 'W-' + monday.toISOString().slice(0, 10);

  // 2. 30 天内保留每日首个备份
  if (age <= 30 * ONE_DAY) {
    if (!seenDays.has(dayKey)) {
      seenDays.add(dayKey);
      kept.add(file.path);
    }
    continue;
  }

  // 3. 8 周内保留每周首个备份
  if (age <= 56 * ONE_DAY) {
    if (!seenWeeks.has(weekKey)) {
      seenWeeks.add(weekKey);
      kept.add(file.path);
    }
    continue;
  }

  // 其余淘汰
}

for (const file of files) {
  if (!kept.has(file.path)) {
    console.log('   [Prune Local] 清理过期归档:', file.name);
    try { fs.unlinkSync(file.path); } catch {}
  }
}

// 清理超过 24 小时的解压临时目录（tar.gz 已安全留存）
const dirs = fs.readdirSync(baseDir)
  .filter(f => f.startsWith('backup_') && !f.endsWith('.tar.gz'))
  .map(f => path.join(baseDir, f))
  .filter(p => fs.statSync(p).isDirectory());

for (const dir of dirs) {
  const stat = fs.statSync(dir);
  if (now - stat.mtimeMs > 24 * ONE_HOUR) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
" "${BACKUP_BASE_DIR}"

# 5. 若配置了 Restic，自动推送至外部持久化快照存储
if command -v restic &>/dev/null && [ -n "${RESTIC_REPOSITORY:-}" ]; then
    echo "--> 5. 检测到 Restic 环境，正在同步外部快照..."
    export RESTIC_REPOSITORY
    if ! restic snapshots &>/dev/null; then
        echo "   初始化 Restic 仓库: ${RESTIC_REPOSITORY}"
        restic init
    fi
    # 维护固定 latest 镜像路径，便于外部查看与引用
    LATEST_LINK="${BACKUP_BASE_DIR}/latest"
    ln -sfn "${TARGET_BACKUP_DIR}" "${LATEST_LINK}"

    # 关键修复 (Defect F10)：Restic 必须备份真实目标目录，不能只备份符号链接，否则只会备份 0 字节的 symlink
    restic backup "${TARGET_BACKUP_DIR}" \
        --tag "kaogong" \
        --tag "automated" \
        --tag "v1.0.1" \
        --exclude="*.wal" \
        --exclude="*.shm"
    echo "   应用 Restic 遗忘修剪策略 (24h/30d/8w)..."
    restic forget --tag "kaogong" --group-by "tags,host" --keep-hourly 24 --keep-daily 30 --keep-weekly 8 --prune
    echo "✅ Restic 灾备快照同步成功"
else
    echo "--> 5. 提示: 未配置 RESTIC_REPOSITORY 外部备份仓库或未安装 restic。已完成本地热备安全归档 (${TAR_FILE})。"
fi

echo "========================================================================"
echo " [SUCCESS] 备份任务全部顺利完成！"
echo " 备份目录: ${TARGET_BACKUP_DIR}"
echo " 压缩归档: ${TAR_FILE}"
echo "========================================================================"
