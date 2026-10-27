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
echo " 目标: ${DATA_DIR}"
echo "========================================================================"

TEMP_EXTRACT=""
cleanup() {
    if [ -n "${TEMP_EXTRACT}" ] && [ -d "${TEMP_EXTRACT}" ]; then
        rm -rf "${TEMP_EXTRACT}"
    fi
}
trap cleanup EXIT

RESTORE_SOURCE_DIR=""

if [ -f "${SRC_INPUT}" ] && [[ "${SRC_INPUT}" =~ \.tar\.gz$ ]]; then
    TEMP_EXTRACT="$(mktemp -d /tmp/kaogong_restore_XXXXXX)"
    echo "--> 1. 解压归档到临时空间: ${TEMP_EXTRACT}"
    tar -xzf "${SRC_INPUT}" -C "${TEMP_EXTRACT}"
    # 查找包含 potato.db 的根目录
    RESTORE_SOURCE_DIR="$(find "${TEMP_EXTRACT}" -maxdepth 2 -name "potato.db" -exec dirname {} \; | head -n 1)"
elif [ -d "${SRC_INPUT}" ]; then
    RESTORE_SOURCE_DIR="${SRC_INPUT}"
else
    echo "❌ 错误: 输入路径既不是有效目录也不是 .tar.gz 文件: ${SRC_INPUT}"
    exit 1
fi

if [ -z "${RESTORE_SOURCE_DIR}" ] || [ ! -f "${RESTORE_SOURCE_DIR}/potato.db" ]; then
    echo "❌ 错误: 备份来源中缺少 potato.db"
    exit 1
fi

echo "--> 2. 执行停服核心暂存、全量校验与原子切换恢复..."
CLI_ARGS=("restore-offline" "${RESTORE_SOURCE_DIR}" "${DATA_DIR}" "--offline-confirmed")
if [ "${SKIP_PRE}" = "--skip-pre-backup" ]; then
    CLI_ARGS+=("--skip-pre-backup")
fi

node --import tsx "${ROOT_DIR}/server/cli.ts" "${CLI_ARGS[@]}"
