package com.ruyne.kaogong;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;
import java.util.Locale;

/**
 * 考公工作台 · 原生安全文件共享 Provider
 *
 * 安全保证（R15 审查项加固）：
 * 1. 只有固定名称的“已完成全部校验”的安装包 (verified-kaogong-update.apk) 可被外部安装器读取，
 *    其它任意 .apk 一律拒绝，且 APK 永远禁止写模式打开（防止外部组件篡改安装包）；
 * 2. 文件名一律经 File.getName() 归一化并拒绝 ".." 穿越，实际文件只解析到应用私有 cache / external-files 根目录；
 * 3. 相机拍照等需要新建文件的场景仅允许 cache 目录下符合安全字符集的文件名；
 * 4. 与 Android 7.0+ (API 24+) FileUriExposedException 规范兼容，通过 content:// + 临时 URI 授权使用。
 */
public class KaogongFileProvider extends ContentProvider {
    public static final String AUTHORITY = "com.ruyne.kaogong.fileprovider";
    /** 与 MainActivity.VERIFIED_APK_FILENAME 保持一致 */
    private static final String VERIFIED_APK_NAME = "verified-kaogong-update.apk";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (uri == null || uri.getPath() == null) {
            throw new FileNotFoundException("无效的 URI 请求");
        }
        String rawPath = uri.getPath();
        if (rawPath.contains("..")) {
            throw new SecurityException("安全拦截：非法路径穿越请求");
        }
        String fileName = new File(rawPath).getName(); // 防御目录穿越
        if (fileName.isEmpty() || ".".equals(fileName) || "..".equals(fileName)) {
            throw new FileNotFoundException("非法文件名");
        }

        boolean wantsWrite = mode != null && mode.contains("w");
        boolean isApk = fileName.toLowerCase(Locale.US).endsWith(".apk");

        if (isApk) {
            // 关键防御：只有内部已完成强校验的固定安装包可读，且永远只读
            if (wantsWrite) {
                throw new SecurityException("安全拦截：禁止对 APK 安装包请求写入权限");
            }
            if (!VERIFIED_APK_NAME.equals(fileName)) {
                throw new SecurityException("安全拦截：仅允许系统安装器读取已校验的官方更新包");
            }
            File verified = new File(getContext().getCacheDir(), fileName);
            if (!verified.isFile()) {
                throw new FileNotFoundException("安装包文件不存在: " + fileName);
            }
            return ParcelFileDescriptor.open(verified, ParcelFileDescriptor.MODE_READ_ONLY);
        }

        File cacheFile = new File(getContext().getCacheDir(), fileName);
        File extFile = new File(getContext().getExternalFilesDir(null), fileName);

        if (cacheFile.isFile()) {
            int pfdMode = ParcelFileDescriptor.MODE_READ_ONLY;
            if (wantsWrite) {
                pfdMode = ParcelFileDescriptor.MODE_READ_WRITE;
            }
            return ParcelFileDescriptor.open(cacheFile, pfdMode);
        }

        if (extFile.isFile()) {
            // 外部私有 files 目录只读开放
            return ParcelFileDescriptor.open(extFile, ParcelFileDescriptor.MODE_READ_ONLY);
        }

        // 允许相机拍摄等受控场景在 cache 目录新建安全文件名
        if (wantsWrite && isSafeWritableName(fileName)) {
            return ParcelFileDescriptor.open(
                    cacheFile,
                    ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_READ_WRITE);
        }

        throw new FileNotFoundException("文件不存在: " + fileName);
    }

    private static boolean isSafeWritableName(String name) {
        if (name == null || name.length() > 120) return false;
        if (!name.matches("^[A-Za-z0-9._-]+$")) return false;
        return !name.toLowerCase(Locale.US).endsWith(".apk");
    }

    @Override
    public String getType(Uri uri) {
        if (uri == null) return "application/octet-stream";
        String path = uri.getPath();
        if (path == null) return "application/octet-stream";
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".apk")) return "application/vnd.android.package-archive";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        if (uri == null || uri.getPath() == null) return 0;
        String rawPath = uri.getPath();
        if (rawPath.contains("..")) return 0;
        String fileName = new File(rawPath).getName();
        if (fileName.toLowerCase(Locale.US).endsWith(".apk")) {
            // APK 删除权仅保留给应用自身，不向外部 URI 调用者开放
            return 0;
        }
        File file = new File(getContext().getCacheDir(), fileName);
        if (file.isFile() && file.delete()) return 1;
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
