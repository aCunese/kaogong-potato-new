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
const db = new Database('${TARGET_BACKUP_DIR}/potato.db', { readonly: true });
const check = db.pragma('integrity_check');
if (!check || check[0].integrity_check !== 'ok') {
  console.error('❌ SQLite 完整性检查失败:', check);
  process.exit(1);
}
console.log('✅ SQLite PRAGMA integrity_check 通过');
db.close();
"

# 3. 归档压缩当前备份
echo "--> 3. 正在生成独立归档压缩包..."
TAR_FILE="${BACKUP_BASE_DIR}/backup_${TIMESTAMP}.tar.gz"
tar -czf "${TAR_FILE}" -C "${BACKUP_BASE_DIR}" "backup_${TIMESTAMP}"
echo "✅ 归档生成: ${TAR_FILE} ($(du -h "${TAR_FILE}" | cut -f1))"

# 4. 执行本地保留策略（保留最新 24 小时内的所有备份，以及保留近 30 天每日、近 8 周每周备份）
echo "--> 4. 执行本地保留策略检查与清理..."
# 删除超过 30 天的单个目录（保留 tar.gz 视策略而定，此处删除 30 天前的旧目录）
find "${BACKUP_BASE_DIR}" -mindepth 1 -maxdepth 1 -type d -name "backup_*" -mtime +30 -exec rm -rf {} + 2>/dev/null || true
find "${BACKUP_BASE_DIR}" -mindepth 1 -maxdepth 1 -type f -name "backup_*.tar.gz" -mtime +60 -exec rm -f {} + 2>/dev/null || true

# 5. 若配置了 Restic，自动推送至外部持久化快照存储
if command -v restic &>/dev/null && [ -n "${RESTIC_REPOSITORY:-}" ]; then
    echo "--> 5. 检测到 Restic 环境，正在同步外部快照..."
    export RESTIC_REPOSITORY
    if ! restic snapshots &>/dev/null; then
        echo "   初始化 Restic 仓库: ${RESTIC_REPOSITORY}"
        restic init
    fi
    restic backup "${TARGET_BACKUP_DIR}" \
        --tag "kaogong" \
        --tag "automated" \
        --tag "v1.0.0" \
        --exclude="*.wal" \
        --exclude="*.shm"
    echo "   应用 Restic 遗忘修剪策略 (24h/30d/8w)..."
    restic forget --tag "kaogong" --keep-hourly 24 --keep-daily 30 --keep-weekly 8 --prune
    echo "✅ Restic 灾备快照同步成功"
else
    echo "--> 5. 未设置 RESTIC_REPOSITORY 或未安装 restic，跳过外部推流（本地热备仍完整保存）。"
fi

echo "========================================================================"
echo " [SUCCESS] 备份任务全部顺利完成！"
echo " 备份目录: ${TARGET_BACKUP_DIR}"
echo " 压缩归档: ${TAR_FILE}"
echo "========================================================================"
