#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 考公工作台 · Android Release APK 独立构建与签名脚本
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

ANDROID_SDK_ROOT="${ANDROID_HOME:-${HOME}/.android-sdk}"
BUILD_TOOLS="${ANDROID_SDK_ROOT}/build-tools/34.0.0"
ANDROID_JAR="${ANDROID_SDK_ROOT}/platforms/android-34/android.jar"

if [ ! -f "${ANDROID_JAR}" ] || [ ! -f "${BUILD_TOOLS}/aapt2" ]; then
    echo "❌ 错误: 未检测到 Android SDK 34 工具链，请确认 ${BUILD_TOOLS} 与 ${ANDROID_JAR} 存在"
    exit 1
fi

JAVA_BIN="$(which javac || true)"
if [ -z "${JAVA_BIN}" ]; then
    if [ -x "/opt/homebrew/opt/openjdk@17/bin/javac" ]; then
        JAVA_BIN="/opt/homebrew/opt/openjdk@17/bin/javac"
    else
        echo "❌ 错误: 未找到 javac 编译器"
        exit 1
    fi
fi

WORK_DIR="$(mktemp -d /tmp/apk_build_XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

RES_DIR="${ROOT_DIR}/android/app/src/main/res"
MANIFEST_FILE="${ROOT_DIR}/android/app/src/main/AndroidManifest.xml"
SRC_JAVA="${ROOT_DIR}/android/app/src/main/java/com/ruyne/kaogong/MainActivity.java"
OUT_APK_DIR="${ROOT_DIR}/release/apk"
mkdir -p "${OUT_APK_DIR}"
FINAL_APK="${OUT_APK_DIR}/kaogong-potato-v1.0.1.apk"

echo "========================================================================"
echo " [ANDROID BUILD] 开始编译考公工作台 Android Release 安装包 (v1.0.1)"
echo "========================================================================"

# 1. 编译 XML 资源与图标
echo "--> 1. 正在调用 aapt2 编译资源文件..."
mkdir -p "${WORK_DIR}/compiled_res"
"${BUILD_TOOLS}/aapt2" compile --dir "${RES_DIR}" -o "${WORK_DIR}/compiled_res.zip"

# 2. 链接生成 R.java 与基础包 (base.apk)
echo "--> 2. 正在链接资源并生成 R.java..."
mkdir -p "${WORK_DIR}/gen"
"${BUILD_TOOLS}/aapt2" link \
    -I "${ANDROID_JAR}" \
    --manifest "${MANIFEST_FILE}" \
    --min-sdk-version 24 \
    --target-sdk-version 34 \
    --version-code 2 \
    --version-name "1.0.1" \
    "${WORK_DIR}/compiled_res.zip" \
    --java "${WORK_DIR}/gen" \
    --auto-add-overlay \
    -o "${WORK_DIR}/base.apk"

# 3. 编译 Java 源码
echo "--> 3. 正在编译 Java 源码 (MainActivity.java)..."
mkdir -p "${WORK_DIR}/classes"
"${JAVA_BIN}" \
    -cp "${ANDROID_JAR}" \
    -d "${WORK_DIR}/classes" \
    "${WORK_DIR}/gen/com/ruyne/kaogong/R.java" \
    "${SRC_JAVA}"

# 4. 调用 d8 生成 classes.dex
echo "--> 4. 正在调用 d8 生成 classes.dex..."
mkdir -p "${WORK_DIR}/dex"
"${BUILD_TOOLS}/d8" \
    --lib "${ANDROID_JAR}" \
    --release \
    --output "${WORK_DIR}/dex" \
    "${WORK_DIR}/classes/com/ruyne/kaogong/"*.class

# 5. 将 classes.dex 打入 APK
echo "--> 5. 正在将 dex 注入 APK..."
cd "${WORK_DIR}/dex"
zip -uj "${WORK_DIR}/base.apk" classes.dex
cd "${ROOT_DIR}"

# 6. zipalign 字节对齐
echo "--> 6. 正在执行 zipalign 4 字节对其..."
"${BUILD_TOOLS}/zipalign" -f -v -p 4 "${WORK_DIR}/base.apk" "${WORK_DIR}/aligned.apk" > /dev/null

# 7. 签名 Release APK
echo "--> 7. 正在对 APK 进行 Release 正式签名与 V2/V3 校验码签发..."
KEYSTORE_FILE="${KEYSTORE_FILE:-${ROOT_DIR}/release/kaogong-release.keystore}"
KEYSTORE_PASS="${KEYSTORE_PASS:-PotatoRelease2026!}"
KEY_ALIAS="${KEY_ALIAS:-kaogong}"

if [ ! -f "${KEYSTORE_FILE}" ]; then
    echo "   生成专用 Release Keystore: ${KEYSTORE_FILE}"
    mkdir -p "$(dirname "${KEYSTORE_FILE}")"
    keytool -genkeypair -v \
        -keystore "${KEYSTORE_FILE}" \
        -alias "${KEY_ALIAS}" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -storepass "${KEYSTORE_PASS}" \
        -keypass "${KEYSTORE_PASS}" \
        -dname "CN=KaogongPotato, OU=Mobile, O=RuyneSpace, L=Hangzhou, ST=Zhejiang, C=CN"
fi

"${BUILD_TOOLS}/apksigner" sign \
    --ks "${KEYSTORE_FILE}" \
    --ks-key-alias "${KEY_ALIAS}" \
    --ks-pass "pass:${KEYSTORE_PASS}" \
    --key-pass "pass:${KEYSTORE_PASS}" \
    --out "${FINAL_APK}" \
    "${WORK_DIR}/aligned.apk"

# 8. 校验签名完整性
echo "--> 8. 正在执行 apksigner 签名完整性验证..."
VERIFY_OUT="$("${BUILD_TOOLS}/apksigner" verify --verbose "${FINAL_APK}")"
echo "${VERIFY_OUT}"

echo "========================================================================"
echo " [SUCCESS] Android Release 安装包构建完成！"
echo " 产物路径: ${FINAL_APK} ($(du -h "${FINAL_APK}" | cut -f1))"
echo " SHA-256:  $(shasum -a 256 "${FINAL_APK}" | cut -d' ' -f1)"
echo "========================================================================"
