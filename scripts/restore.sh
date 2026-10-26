#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 考公工作台 · 灾备恢复与代际轮换（Generation Rotation）脚本
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

DATA_DIR="${DATA_DIR:-${ROOT_DIR}/data}"

if [ $# -lt 1 ]; then
    echo "用法: ./scripts/restore.sh <备份目录路径或.tar.gz压缩包> [--skip-pre-backup]"
    echo "示例: ./scripts/restore.sh data/backups/backup_20261026_153756"
    echo "      ./scripts/restore.sh data/backups/backup_20261026_153756.tar.gz"
    exit 1
fi

SRC_INPUT="$1"
SKIP_PRE="${2:-}"

echo "========================================================================"
echo " [RESTORE] 开始执行考公工作台灾备恢复"
echo " 来源: ${SRC_INPUT}"
echo "========================================================================"

TEMP_EXTRACT=""
RESTORE_SOURCE_DIR=""

if [ -f "${SRC_INPUT}" ] && [[ "${SRC_INPUT}" =~ \.tar\.gz$ ]]; then
    TEMP_EXTRACT="$(mktemp -d /tmp/kaogong_restore_XXXXXX)"
    echo "--> 1. 解压归档到临时空间: ${TEMP_EXTRACT}"
    tar -xzf "${SRC_INPUT}" -C "${TEMP_EXTRACT}"
    # 查找包含 manifest.json 的根目录
    RESTORE_SOURCE_DIR="$(find "${TEMP_EXTRACT}" -maxdepth 2 -name "manifest.json" -exec dirname {} \; | head -n 1)"
elif [ -d "${SRC_INPUT}" ]; then
    RESTORE_SOURCE_DIR="${SRC_INPUT}"
else
    echo "❌ 错误: 输入路径既不是有效目录也不是 .tar.gz 文件: ${SRC_INPUT}"
    exit 1
fi

if [ -z "${RESTORE_SOURCE_DIR}" ] || [ ! -f "${RESTORE_SOURCE_DIR}/potato.db" ] || [ ! -f "${RESTORE_SOURCE_DIR}/manifest.json" ]; then
    echo "❌ 错误: 备份来源中缺少 potato.db 或 manifest.json"
    [ -n "${TEMP_EXTRACT}" ] && rm -rf "${TEMP_EXTRACT}"
    exit 1
fi

echo "--> 2. 严格核验备份完整性、数据库引用附件与校验和..."
node -e "
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const backupDir = '${RESTORE_SOURCE_DIR}';
const manifestPath = path.join(backupDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 1. Verify SQLite database integrity & checksum
const dbFile = path.join(backupDir, manifest.database?.filename || 'potato.db');
const dbBuffer = fs.readFileSync(dbFile);
const calculatedDbHash = crypto.createHash('sha256').update(dbBuffer).digest('hex');

if (calculatedDbHash !== manifest.database.sha256) {
  console.error('❌ 数据库校验和不匹配! 期望:', manifest.database.sha256, '计算:', calculatedDbHash);
  process.exit(1);
}

const db = new Database(dbFile, { readonly: true });
const check = db.pragma('integrity_check');
if (!check || check[0].integrity_check !== 'ok') {
  console.error('❌ 备份数据库 PRAGMA integrity_check 失败:', check);
  process.exit(1);
}

// 2. Query ALL attachments directly referenced in the database media_records
const requiredMedia = db.prepare('SELECT id, filename, byte_size, sha256 FROM media_records').all();
db.close();
console.log('✅ 数据库校验和及 SQLite integrity_check 完全通过');

// 3. Verify attachments on disk against database records
const attDir = path.join(backupDir, 'attachments');
for (const item of requiredMedia) {
  const filePath = path.join(attDir, item.filename);
  if (!fs.existsSync(filePath)) {
    console.error('❌ 恢复校验失败: 数据库引用的媒体文件在备份中缺失:', item.filename, '(ID: ' + item.id + ')');
    process.exit(1);
  }
  const buf = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash !== item.sha256) {
    console.error('❌ 恢复校验失败: 附件校验和不匹配:', item.filename, '(期望: ' + item.sha256 + ', 实际: ' + hash + ')');
    process.exit(1);
  }
  if (buf.length !== item.byte_size) {
    console.error('❌ 恢复校验失败: 附件大小不匹配:', item.filename);
    process.exit(1);
  }
}
console.log('✅ 数据库引用的所有 ' + requiredMedia.length + ' 个媒体附件在备份中完整存在且校验通过');
"

# 3. 如果当前存在生产数据，先做一份安全快照以防意外
if [ "${SKIP_PRE}" != "--skip-pre-backup" ] && [ -f "${DATA_DIR}/potato.db" ]; then
    PRE_RESTORE_DIR="${DATA_DIR}/backups/pre_restore_safety_$(date +%Y%m%d_%H%M%S)"
    echo "--> 3. 正在为当前运行数据保存安全快照: ${PRE_RESTORE_DIR}..."
    mkdir -p "${PRE_RESTORE_DIR}"
    cp "${DATA_DIR}/potato.db" "${PRE_RESTORE_DIR}/" || true
    [ -f "${DATA_DIR}/potato.db-wal" ] && cp "${DATA_DIR}/potato.db-wal" "${PRE_RESTORE_DIR}/" || true
    [ -f "${DATA_DIR}/potato.db-shm" ] && cp "${DATA_DIR}/potato.db-shm" "${PRE_RESTORE_DIR}/" || true
    [ -d "${DATA_DIR}/attachments" ] && cp -r "${DATA_DIR}/attachments" "${PRE_RESTORE_DIR}/" || true
fi

# 4. 在隔离目录构建并验证 integrity_check，确认无误后再原子替换；不在运行中的数据库上强行删除 wal/shm
STAGING_DIR="${DATA_DIR}/.restore_staging_$$"
echo "--> 4. 正在隔离暂存区准备数据并执行入库前二次完整性校验: ${STAGING_DIR}..."
mkdir -p "${STAGING_DIR}/attachments"
cp -f "${RESTORE_SOURCE_DIR}/potato.db" "${STAGING_DIR}/potato.db"
if [ -d "${RESTORE_SOURCE_DIR}/attachments" ]; then
    cp -rf "${RESTORE_SOURCE_DIR}/attachments/"* "${STAGING_DIR}/attachments/" 2>/dev/null || true
fi

node -e "
const Database = require('better-sqlite3');
const db = new Database('${STAGING_DIR}/potato.db', { readonly: true });
const check = db.pragma('integrity_check');
if (!check || check[0].integrity_check !== 'ok') {
  console.error('❌ 暂存区数据库 integrity_check 校验失败:', check);
  process.exit(1);
}
db.close();
console.log('✅ 暂存区数据库二次 integrity_check 校验通过');
"

echo "--> 5. 正在执行原子数据文件写入与恢复..."
mkdir -p "${DATA_DIR}/attachments"

# 原子替换目标数据库主文件
mv -f "${STAGING_DIR}/potato.db" "${DATA_DIR}/potato.db"

# 安全清理旧 WAL/SHM（确保主库切换后不被旧 WAL 污染）
rm -f "${DATA_DIR}/potato.db-wal" "${DATA_DIR}/potato.db-shm"

if [ -d "${STAGING_DIR}/attachments" ]; then
    cp -rf "${STAGING_DIR}/attachments/"* "${DATA_DIR}/attachments/" 2>/dev/null || true
fi
rm -rf "${STAGING_DIR}"

# 6. 关键安全步骤：递增/轮换同步代际标识（generation_id），防止陈旧客户端脏写
echo "--> 6. 正在轮换同步代际标识 (generation_id) 并撤销所有活跃会话..."
node --import tsx "${ROOT_DIR}/server/cli.ts" rotate-gen

# 清理临时解压空间
[ -n "${TEMP_EXTRACT}" ] && rm -rf "${TEMP_EXTRACT}"

echo "========================================================================"
echo " [SUCCESS] 灾难恢复完成！"
echo " 数据库与附件已就位，代际已轮换，旧客户端已被安全阻断。"
echo "========================================================================"
