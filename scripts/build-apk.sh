#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 考公工作台 · Android Release APK 独立构建 / 签名 / 强校验脚本
#
# 三种模式：
#   1) 正式签名模式（默认，分发用）：
#        KEYSTORE_PASS='<口令>' ./scripts/build-apk.sh
#      产物：release/apk/kaogong-potato-v<versionName>.apk + .sha256
#      要求：release/kaogong-release.keystore 存在且证书指纹与预期完全一致；
#            绝不允许静默生成新密钥、绝不降级 debug 签名（F09 约束保留）。
#
#   2) 编译校验模式（本机无签名口令时使用，非分发产物）：
#        ./scripts/build-apk.sh --unsigned-verify
#      产物：android/build/verify/kaogong-potato-v<versionName>-UNSIGNED-NOT-FOR-DISTRIBUTION.apk
#      内容：aapt2 link + javac + d8 + zipalign + Manifest/DEX 断言，不签名。
#
#   3) 既有 APK 复核模式（R14 回归守卫）：
#        ./scripts/build-apk.sh --verify-apk release/apk/kaogong-potato-v1.0.2.apk
#      对任意 APK 执行 Manifest/DEX 断言，用于证明交付包确实来自包含最新修复的源码。
#      旧的无强校验 APK 会在此模式下失败（预期行为，杜绝 R14 再次发生）。
#
# 版本号唯一来源：android/app/build.gradle（versionCode / versionName / minSdk / targetSdk）
# 包名唯一来源：android/app/build.gradle（namespace）
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

ANDROID_SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${HOME}/.android-sdk}}"
BUILD_TOOLS="${ANDROID_SDK_ROOT}/build-tools/34.0.0"
ANDROID_JAR="${ANDROID_SDK_ROOT}/platforms/android-34/android.jar"
GRADLE_FILE="${ROOT_DIR}/android/app/build.gradle"
MANIFEST_FILE="${ROOT_DIR}/android/app/src/main/AndroidManifest.xml"
RES_DIR="${ROOT_DIR}/android/app/src/main/res"
SRC_JAVA_DIR="${ROOT_DIR}/android/app/src/main/java/com/ruyne/kaogong"
VERIFY_OUT_DIR="${ROOT_DIR}/android/build/verify"
OUT_APK_DIR="${ROOT_DIR}/release/apk"

# 官方正式发布证书 SHA-256 指纹（大写冒号格式，与 /version.json apkCertFingerprint 对齐）
EXPECTED_CERT_SHA256="85:75:82:EF:D9:20:83:CC:75:E5:C5:A0:C2:0D:B3:26:25:2C:BF:80:E7:11:23:23:4B:6B:F5:9D:CD:17:36:C1"

MODE="sign"
VERIFY_APK_PATH=""
case "${1:-}" in
    "" )
        MODE="sign" ;;
    --unsigned-verify )
        MODE="unsigned" ;;
    --verify-apk )
        MODE="verify-apk"
        VERIFY_APK_PATH="${2:-}"
        if [ -z "${VERIFY_APK_PATH}" ]; then
            echo "❌ 用法: $0 --verify-apk <path/to/app.apk>"
            exit 2
        fi ;;
    -h|--help )
        sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
        exit 0 ;;
    * )
        echo "❌ 未知参数: $1（支持: 无参数签名模式 / --unsigned-verify / --verify-apk <path> / --help）"
        exit 2 ;;
esac

fail() {
    echo "========================================================================"
    echo " ❌ [FAIL] $1"
    echo "========================================================================"
    exit 1
}

# ------------------------------------------------------------------------------
# 工具链与版本解析
# ------------------------------------------------------------------------------
if [ ! -f "${ANDROID_JAR}" ] || [ ! -x "${BUILD_TOOLS}/aapt2" ]; then
    fail "未检测到 Android SDK 34 工具链，请确认 ${BUILD_TOOLS} 与 ${ANDROID_JAR} 存在"
fi

JAVAC_BIN="${JAVA_HOME:+${JAVA_HOME}/bin/javac}"
if [ -z "${JAVAC_BIN}" ] || [ ! -x "${JAVAC_BIN}" ]; then
    JAVAC_BIN="$(command -v javac || true)"
fi
if [ -z "${JAVAC_BIN}" ] || [ ! -x "${JAVAC_BIN}" ]; then
    for candidate in /opt/homebrew/opt/openjdk@17/bin/javac /usr/local/opt/openjdk@17/bin/javac; do
        if [ -x "${candidate}" ]; then
            JAVAC_BIN="${candidate}"
            break
        fi
    done
fi

if [ ! -f "${GRADLE_FILE}" ]; then
    fail "未找到 ${GRADLE_FILE}，无法解析版本号"
fi

# 确保 java/keytool 可被 apksigner 等工具找到（签名模式使用）
if [ -n "${JAVAC_BIN}" ] && [ -x "${JAVAC_BIN}" ]; then
    JAVA_BIN_DIR="$(dirname "${JAVAC_BIN}")"
    case ":${PATH}:" in
        *":${JAVA_BIN_DIR}:"*) ;;
        *) export PATH="${JAVA_BIN_DIR}:${PATH}" ;;
    esac
    KEYTOOL_BIN="${JAVA_BIN_DIR}/keytool"
else
    KEYTOOL_BIN=""
fi
if [ -z "${KEYTOOL_BIN}" ] || [ ! -x "${KEYTOOL_BIN}" ]; then
    KEYTOOL_BIN="$(command -v keytool || true)"
fi

file_size() {
    if stat -f%z "$1" >/dev/null 2>&1; then
        stat -f%z "$1"
    else
        stat -c%s "$1"
    fi
}

read_gradle_value() {
    local key="$1"
    grep -E "^[[:space:]]*${key}[[:space:]]" "${GRADLE_FILE}" | head -n 1 | sed -E 's/^[^"]*"([^"]+)".*$/\1/' | tr -d "'" | tr -d ' '
}

VERSION_CODE="$(grep -E '^[[:space:]]*versionCode[[:space:]]' "${GRADLE_FILE}" | head -n 1 | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
VERSION_NAME="$(read_gradle_value versionName)"
MIN_SDK="$(grep -E '^[[:space:]]*minSdk[[:space:]]' "${GRADLE_FILE}" | head -n 1 | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
TARGET_SDK="$(grep -E '^[[:space:]]*targetSdk[[:space:]]' "${GRADLE_FILE}" | head -n 1 | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
APP_ID="$(read_gradle_value applicationId)"
if [ -z "${APP_ID}" ]; then
    APP_ID="$(read_gradle_value namespace)"
fi
for value in "${VERSION_CODE}" "${VERSION_NAME}" "${MIN_SDK}" "${TARGET_SDK}" "${APP_ID}"; do
    if [ -z "${value}" ]; then
        fail "无法从 ${GRADLE_FILE} 解析版本/包名信息（versionCode=${VERSION_CODE:-} versionName=${VERSION_NAME:-} minSdk=${MIN_SDK:-} targetSdk=${TARGET_SDK:-} appId=${APP_ID:-}）"
    fi
done

echo "========================================================================"
echo " [ANDROID BUILD] 考公工作台 Android 构建 / 强校验"
echo " 模式        : ${MODE}"
echo " 包名        : ${APP_ID}"
echo " versionCode : ${VERSION_CODE}   versionName: ${VERSION_NAME}"
echo " SDK         : min=${MIN_SDK} target=${TARGET_SDK} compile=34"
echo " 构建工具    : ${BUILD_TOOLS}"
echo " 版本来源    : android/app/build.gradle（唯一来源）"
echo "========================================================================"

# ------------------------------------------------------------------------------
# 断言工具（Manifest / DEX）
# ------------------------------------------------------------------------------
ASSERT_FAILURES=0
assert_contains() {
    local haystack="$1" needle="$2" label="$3"
    if printf '%s' "${haystack}" | grep -qF -- "${needle}"; then
        echo "  ✅ ${label}"
    else
        echo "  ❌ ${label}  (未找到: ${needle})"
        ASSERT_FAILURES=$((ASSERT_FAILURES + 1))
    fi
}
assert_dex_literal_present() {
    local dex="$1" literal="$2" label="$3"
    if strings -a "${dex}" | grep -qF -- "${literal}"; then
        echo "  ✅ ${label}"
    else
        echo "  ❌ ${label}  (DEX 缺少字面量: ${literal})"
        ASSERT_FAILURES=$((ASSERT_FAILURES + 1))
    fi
}
assert_dex_literal_absent() {
    local dex="$1" literal="$2" label="$3"
    if strings -a "${dex}" | grep -qF -- "${literal}"; then
        echo "  ❌ ${label}  (DEX 仍包含禁止字面量: ${literal})"
        ASSERT_FAILURES=$((ASSERT_FAILURES + 1))
    else
        echo "  ✅ ${label}"
    fi
}

# 对任意 APK 运行 Manifest + DEX 断言（R14 回归守卫）
verify_apk_contents() {
    local apk_path="$1"
    local work_dir="$2"
    local label="$3"
    mkdir -p "${work_dir}"

    echo "--> [${label}] 校验 APK: ${apk_path}"
    if [ ! -f "${apk_path}" ]; then
        fail "APK 不存在: ${apk_path}"
    fi

    local badging
    badging="$("${BUILD_TOOLS}/aapt2" dump badging "${apk_path}" 2>/dev/null || true)"
    if [ -z "${badging}" ]; then
        fail "aapt2 无法解析 APK（文件损坏或非 APK）: ${apk_path}"
    fi
    assert_contains "${badging}" "package: name='${APP_ID}'" "Manifest 包名为 ${APP_ID}"
    assert_contains "${badging}" "versionCode='${VERSION_CODE}'" "Manifest versionCode=${VERSION_CODE}"
    assert_contains "${badging}" "versionName='${VERSION_NAME}'" "Manifest versionName=${VERSION_NAME}"
    assert_contains "${badging}" "targetSdkVersion:'${TARGET_SDK}'" "Manifest targetSdk=${TARGET_SDK}"
    assert_contains "${badging}" "sdkVersion:'${MIN_SDK}'" "Manifest minSdk=${MIN_SDK}"
    assert_contains "${badging}" "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'" "Manifest 声明 REQUEST_INSTALL_PACKAGES（R15）"
    if printf '%s' "${badging}" | grep -qF "application-debuggable"; then
        echo "  ❌ 禁止项：APK 为 debuggable 调试包"
        ASSERT_FAILURES=$((ASSERT_FAILURES + 1))
    else
        echo "  ✅ 非 debuggable 调试包"
    fi

    # 提取 classes.dex
    local dex_file="${work_dir}/classes.dex"
    rm -f "${dex_file}"
    if ! unzip -p "${apk_path}" classes.dex > "${dex_file}" 2>/dev/null || [ ! -s "${dex_file}" ]; then
        fail "无法从 APK 提取 classes.dex: ${apk_path}"
    fi

    echo "  -- DEX 强校验能力断言（R13/R14/R15）"
    assert_dex_literal_present "${dex_file}" "bridgeProtocol" "桥协议字段 bridgeProtocol（区分新/旧桥，R13）"
    assert_dex_literal_present "${dex_file}" "installApkVerified" "强校验安装入口 installApkVerified（R14）"
    assert_dex_literal_present "${dex_file}" "getInstallPermissionStatus" "安装未知应用权限查询（R15）"
    assert_dex_literal_present "${dex_file}" "android.settings.MANAGE_UNKNOWN_APP_SOURCES" "安装未知应用授权页跳转（R15）"
    assert_dex_literal_present "${dex_file}" "canRequestPackageInstalls" "canRequestPackageInstalls 运行时检查（R15）"
    assert_dex_literal_present "${dex_file}" "getPackageArchiveInfo" "APK 资产包解析 getPackageArchiveInfo（R14）"
    assert_dex_literal_present "${dex_file}" "verified-kaogong-update.apk" "内部已验证 APK 固定文件名（R14 TOCTOU）"
    assert_dex_literal_present "${dex_file}" "certFingerprint" "签名证书指纹字段（R14）"
    assert_dex_literal_present "${dex_file}" "verification_failed" "校验失败事件回传（R14）"
    assert_dex_literal_present "${dex_file}" "download_progress" "下载真实进度事件（R15）"
    assert_dex_literal_present "${dex_file}" "installer_launched" "系统安装器已调起事件（R15）"

    echo "  -- DEX SAF 备份导出能力断言（S08 / Task 6）"
    assert_dex_literal_present "${dex_file}" "backupExportProtocol" "备份导出能力字段 backupExportProtocol（S08）"
    assert_dex_literal_present "${dex_file}" "beginBackupExport" "备份分块导出入口 beginBackupExport（S08）"
    assert_dex_literal_present "${dex_file}" "appendBackupExport" "备份分块追加入口 appendBackupExport（S08）"
    assert_dex_literal_present "${dex_file}" "finishBackupExport" "备份分块完成入口 finishBackupExport（S08）"
    assert_dex_literal_present "${dex_file}" "__kaogongBackupExportEvent" "备份专用事件通道 __kaogongBackupExportEvent（S08）"

    # R13 关键回归守卫：桥接代码绝不允许直接引用 WebView.getUrl
    local dex_dump="${work_dir}/dexdump.txt"
    "${BUILD_TOOLS}/dexdump" -d "${dex_file}" > "${dex_dump}" 2>/dev/null || true
    if grep -qF "Landroid/webkit/WebView;.getUrl" "${dex_dump}"; then
        echo "  ❌ R13 回归：DEX 仍存在 WebView.getUrl 直接调用（JavascriptInterface 线程违规风险）"
        ASSERT_FAILURES=$((ASSERT_FAILURES + 1))
    else
        echo "  ✅ R13：DEX 不存在 WebView.getUrl 直接调用"
    fi
    assert_dex_literal_absent "${dex_file}" "kaogong-potato-update.apk" "旧版固定文件残留路径已移除"

    if [ "${ASSERT_FAILURES}" -ne 0 ]; then
        fail "[${label}] 断言失败 ${ASSERT_FAILURES} 项：APK 内容与最新源码不符（R14 阻断）"
    fi
    echo "--> [${label}] APK 内容断言全部通过"
}

# ------------------------------------------------------------------------------
# 模式 3：既有 APK 复核（R14）
# ------------------------------------------------------------------------------
if [ "${MODE}" = "verify-apk" ]; then
    WORK_DIR="$(mktemp -d /tmp/apk_verify_XXXXXX)"
    trap 'rm -rf "${WORK_DIR}"' EXIT
    verify_apk_contents "${VERIFY_APK_PATH}" "${WORK_DIR}" "既有APK复核"
    echo "  APK SHA-256 : $(shasum -a 256 "${VERIFY_APK_PATH}" | cut -d' ' -f1)"
    echo "  APK 大小    : $(du -h "${VERIFY_APK_PATH}" | cut -f1)"
    echo "========================================================================"
    echo " ✅ [SUCCESS] 该 APK 与当前源码的强校验能力断言一致"
    echo "========================================================================"
    exit 0
fi

if [ -z "${JAVAC_BIN}" ] || [ ! -x "${JAVAC_BIN}" ]; then
    fail "未找到 javac 编译器（可设置 JAVA_HOME）"
fi

WORK_DIR="$(mktemp -d /tmp/apk_build_XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

# ------------------------------------------------------------------------------
# 1-2. 资源编译 + 链接（生成 R.java 与 base.apk）
# ------------------------------------------------------------------------------
echo "--> 1. aapt2 编译资源文件..."
mkdir -p "${WORK_DIR}/compiled_res"
"${BUILD_TOOLS}/aapt2" compile --dir "${RES_DIR}" -o "${WORK_DIR}/compiled_res.zip"

echo "--> 2. aapt2 链接资源并生成 R.java..."
mkdir -p "${WORK_DIR}/gen"
"${BUILD_TOOLS}/aapt2" link \
    -I "${ANDROID_JAR}" \
    --manifest "${MANIFEST_FILE}" \
    --min-sdk-version "${MIN_SDK}" \
    --target-sdk-version "${TARGET_SDK}" \
    --version-code "${VERSION_CODE}" \
    --version-name "${VERSION_NAME}" \
    "${WORK_DIR}/compiled_res.zip" \
    --java "${WORK_DIR}/gen" \
    --auto-add-overlay \
    -o "${WORK_DIR}/base.apk"

# ------------------------------------------------------------------------------
# 3. Java 编译
# ------------------------------------------------------------------------------
echo "--> 3. 编译 Java 源码 (MainActivity.java, KaogongFileProvider.java)..."
mkdir -p "${WORK_DIR}/classes"
"${JAVAC_BIN}" \
    -encoding UTF-8 \
    -Xlint:all \
    -Xlint:-deprecation \
    -Xlint:-serial \
    -cp "${ANDROID_JAR}" \
    -d "${WORK_DIR}/classes" \
    "${WORK_DIR}/gen/com/ruyne/kaogong/R.java" \
    "${SRC_JAVA_DIR}/"*.java 2> "${WORK_DIR}/javac.log" || {
        cat "${WORK_DIR}/javac.log"
        fail "Java 编译失败"
    }
if [ -s "${WORK_DIR}/javac.log" ]; then
    echo "  javac 警告（不阻断构建）:"
    sed 's/^/    /' "${WORK_DIR}/javac.log"
fi
if [ -z "$(find "${WORK_DIR}/classes" -name '*.class' -print -quit)" ]; then
    fail "Java 编译未产生 class 文件"
fi

# ------------------------------------------------------------------------------
# 4. d8 -> classes.dex
# ------------------------------------------------------------------------------
echo "--> 4. d8 生成 classes.dex..."
mkdir -p "${WORK_DIR}/dex"
# 当前工程所有类均在单一包目录下（含内部类），直接 glob 传入
"${BUILD_TOOLS}/d8" \
    --lib "${ANDROID_JAR}" \
    --release \
    --min-api "${MIN_SDK}" \
    --output "${WORK_DIR}/dex" \
    "${WORK_DIR}/classes/com/ruyne/kaogong/"*.class
if [ ! -s "${WORK_DIR}/dex/classes.dex" ]; then
    fail "d8 未生成 classes.dex"
fi

# ------------------------------------------------------------------------------
# 5. 注入 dex + 6. zipalign
# ------------------------------------------------------------------------------
echo "--> 5. 将 classes.dex 注入 APK..."
( cd "${WORK_DIR}/dex" && zip -q -uj "${WORK_DIR}/base.apk" classes.dex )

echo "--> 6. zipalign 4 字节对齐..."
"${BUILD_TOOLS}/zipalign" -f -p 4 "${WORK_DIR}/base.apk" "${WORK_DIR}/aligned-unsigned.apk"

# ------------------------------------------------------------------------------
# 7. APK 内容断言（构建产物自检，R14 回归守卫）
# ------------------------------------------------------------------------------
verify_apk_contents "${WORK_DIR}/aligned-unsigned.apk" "${WORK_DIR}/verify-build" "构建产物自检"

# 证书一致性预检（仅签名模式）
KEYSTORE_FILE="${KEYSTORE_FILE:-${ROOT_DIR}/release/kaogong-release.keystore}"
KEY_ALIAS="${KEY_ALIAS:-kaogong}"

normalize_fingerprint() {
    printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -d ' :'
}

# ------------------------------------------------------------------------------
# 8. 编译校验模式输出（无签名口令时的合法验证路径，非分发产物）
# ------------------------------------------------------------------------------
if [ "${MODE}" = "unsigned" ]; then
    mkdir -p "${VERIFY_OUT_DIR}"
    UNSIGNED_APK="${VERIFY_OUT_DIR}/kaogong-potato-v${VERSION_NAME}-UNSIGNED-NOT-FOR-DISTRIBUTION.apk"
    cp "${WORK_DIR}/aligned-unsigned.apk" "${UNSIGNED_APK}"
    UNSIGNED_SHA="$(shasum -a 256 "${UNSIGNED_APK}" | cut -d' ' -f1)"
    {
        echo "mode=unsigned-verify"
        echo "versionName=${VERSION_NAME}"
        echo "versionCode=${VERSION_CODE}"
        echo "package=${APP_ID}"
        echo "sha256=${UNSIGNED_SHA}"
        echo "sizeBytes=$(file_size "${UNSIGNED_APK}")"
        echo "signed=false"
        echo "distribution=false"
        echo "note=无签名口令，仅编译与内容断言验证；不可安装分发"
    } > "${UNSIGNED_APK}.verify.txt"
    echo "========================================================================"
    echo " ✅ [UNSIGNED VERIFY OK] 编译 + Manifest/DEX 断言全部通过（未签名，不可分发）"
    echo " 产物: ${UNSIGNED_APK}"
    echo " SHA-256: ${UNSIGNED_SHA}"
    echo " 校验清单: ${UNSIGNED_APK}.verify.txt"
    echo " 说明: 本模式不生成新密钥、不降级 debug 签名；正式分发必须提供 KEYSTORE_PASS。"
    echo "========================================================================"
    exit 0
fi

# ------------------------------------------------------------------------------
# 9. 正式签名模式（F09：必须提供 KEYSTORE_PASS + 证书指纹严格匹配）
# ------------------------------------------------------------------------------
echo "--> 7. 正式 Release 签名..."
if [ -z "${KEYSTORE_PASS:-}" ]; then
    echo "========================================================================"
    echo " ❌ [SECURITY ERROR] 安全拦截：必须通过环境变量提供 KEYSTORE_PASS，严禁在脚本中硬编码密钥！"
    echo " 运行示例: KEYSTORE_PASS='<你的密钥库口令>' ./scripts/build-apk.sh"
    echo " 无签名口令时请使用: ./scripts/build-apk.sh --unsigned-verify"
    echo "========================================================================"
    exit 1
fi
if [ ! -f "${KEYSTORE_FILE}" ]; then
    echo "========================================================================"
    echo " ❌ [CRITICAL ERROR] 发布签名密钥库缺失: ${KEYSTORE_FILE}"
    echo " 依据 Android 发布规范：严禁静默生成新密钥库或使用 debug key，避免覆盖升级失败！"
    echo " 请恢复 release/kaogong-release.keystore 或配置 KEYSTORE_FILE 后重试。"
    echo "========================================================================"
    exit 1
fi

ACTUAL_CERT_SHA256="$("${KEYTOOL_BIN}" -list -v -keystore "${KEYSTORE_FILE}" -storepass "${KEYSTORE_PASS}" -alias "${KEY_ALIAS}" 2>/dev/null \
    | grep -i "SHA256:" | head -n 1 | awk '{print $2}' || true)"
if [ -z "${ACTUAL_CERT_SHA256}" ] \
    || [ "$(normalize_fingerprint "${ACTUAL_CERT_SHA256}")" != "$(normalize_fingerprint "${EXPECTED_CERT_SHA256}")" ]; then
    fail "Keystore 证书指纹不匹配或提取失败！预期=${EXPECTED_CERT_SHA256} 实际=${ACTUAL_CERT_SHA256:-<未能获取>}"
fi
echo "  ✅ Keystore 证书指纹与预期一致"

FINAL_APK="${OUT_APK_DIR}/kaogong-potato-v${VERSION_NAME}.apk"
mkdir -p "${OUT_APK_DIR}"

"${BUILD_TOOLS}/apksigner" sign \
    --ks "${KEYSTORE_FILE}" \
    --ks-key-alias "${KEY_ALIAS}" \
    --ks-pass "pass:${KEYSTORE_PASS}" \
    --key-pass "pass:${KEYSTORE_PASS}" \
    --out "${FINAL_APK}" \
    "${WORK_DIR}/aligned-unsigned.apk"

echo "--> 8. apksigner 签名完整性验证..."
VERIFY_OUT="$("${BUILD_TOOLS}/apksigner" verify --verbose --print-certs "${FINAL_APK}")"
echo "${VERIFY_OUT}" | sed 's/^/    /'
if ! printf '%s' "${VERIFY_OUT}" | grep -q "Verified using v2 scheme (APK Signature Scheme v2): true"; then
    fail "apksigner 校验未确认 v2 签名方案有效"
fi
SIGNED_CERT_LINE="$(printf '%s' "${VERIFY_OUT}" | grep -i "Signer #1 certificate SHA-256 digest:" | head -n 1 | awk -F': ' '{print $2}' || true)"
if [ -z "${SIGNED_CERT_LINE}" ] \
    || [ "$(normalize_fingerprint "${SIGNED_CERT_LINE}")" != "$(normalize_fingerprint "${EXPECTED_CERT_SHA256}")" ]; then
    fail "签名后 APK 证书指纹与预期不一致！实际=${SIGNED_CERT_LINE:-<未能获取>}"
fi

echo "--> 9. 对签名后正式 APK 复核内容断言（R14 回归守卫）..."
verify_apk_contents "${FINAL_APK}" "${WORK_DIR}/verify-signed" "正式签名包复核"

echo "--> 10. 生成 SHA-256 校验文件..."
APK_SHA256="$(shasum -a 256 "${FINAL_APK}" | cut -d' ' -f1)"
echo "${APK_SHA256}  $(basename "${FINAL_APK}")" > "${FINAL_APK}.sha256"

echo "========================================================================"
echo " [SUCCESS] Android Release 安装包构建完成！"
echo " 产物路径: ${FINAL_APK} ($(du -h "${FINAL_APK}" | cut -f1))"
echo " SHA-256:  ${APK_SHA256}"
echo " 大小字节: $(file_size "${FINAL_APK}")"
echo " 校验文件: ${FINAL_APK}.sha256"
echo "========================================================================"
