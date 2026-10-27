package com.ruyne.kaogong;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Android Storage Access Framework (SAF) 文档安全导出处理器
 *
 * 规范要求（Section 4.5 / Task 6 / S08）：
 * 1. 最多一个 active operation，支持分块流式写入与确认；
 * 2. 分块大小限制：<= 48KiB 原始字节 / 64KiB Base64；
 * 3. 累计体积校验 <= 声明字节数与 50MiB 硬上限；
 * 4. finish 时核验实际字节数与 SHA-256 指纹；
 * 5. UI 线程拉起 ACTION_CREATE_DOCUMENT（application/json, CATEGORY_OPENABLE, 独立请求码）；
 * 6. 后台线程安全复制至 SAF Document URI，完成后发送独立 window.__kaogongBackupExportEvent；
 * 7. 绝不覆盖 window.__kaogongAndroidEvent，绝不串改 APK 安装状态机。
 */
public class BackupExporter {
    private static final String TAG = "KaogongBackupExporter";
    public static final int BACKUP_EXPORT_REQUEST_CODE = 4401;
    public static final int BACKUP_EXPORT_PROTOCOL = 1;

    private static final long MAX_BACKUP_BYTES = 50L * 1024L * 1024L; // 50 MiB
    private static final int MAX_RAW_CHUNK_BYTES = 48 * 1024; // 48 KiB
    private static final int MAX_BASE64_CHUNK_CHARS = 64 * 1024; // 64 KiB

    private final Activity activity;
    private final Handler uiHandler;
    private WebView webView;
    private volatile boolean destroyed = false;

    // Active export state protected by lock
    private final Object lock = new Object();
    private String activeOperationId = null;
    private String expectedFilename = null;
    private String expectedMimeType = null;
    private long expectedBytes = 0;
    private String expectedSha256 = null;
    private long writtenBytes = 0;
    private int nextSequence = 0;
    private File tempFile = null;
    private FileOutputStream outputStream = null;
    private boolean isAwaitingDocumentCreation = false;

    public BackupExporter(Activity activity, Handler uiHandler, WebView webView) {
        this.activity = activity;
        this.uiHandler = uiHandler;
        this.webView = webView;
    }

    public String beginExport(String requestJson, boolean trusted) {
        synchronized (lock) {
            if (!trusted) {
                return makeErrorAck("untrusted_page", "当前页面不是官方受信页面，已拒绝备份导出");
            }
            if (destroyed) {
                return makeErrorAck("destroyed", "宿主容器已销毁");
            }

            try {
                JSONObject req = new JSONObject(requestJson == null ? "{}" : requestJson);
                String opId = req.optString("operationId", "").trim();
                String filename = req.optString("filename", "").trim();
                String mimeType = req.optString("mimeType", "").trim();
                long bytes = req.optLong("bytes", -1L);
                String sha256 = req.optString("sha256", "").trim().toLowerCase(Locale.ROOT);

                if (opId.isEmpty()) {
                    return makeErrorAck("invalid_request", "operationId 不能为空");
                }
                if (filename.isEmpty()) {
                    return makeErrorAck("invalid_request", "filename 不能为空");
                }
                if (!"application/json".equalsIgnoreCase(mimeType)) {
                    return makeErrorAck("invalid_request", "mimeType 必须为 application/json");
                }
                if (bytes <= 0 || bytes > MAX_BACKUP_BYTES) {
                    return makeErrorAck("invalid_request", "bytes 必须在 1 字节至 50MB 之间");
                }
                if (sha256.length() != 64) {
                    return makeErrorAck("invalid_request", "sha256 格式非法");
                }

                cleanupActiveExportLocked();

                File cacheDir = activity.getCacheDir();
                tempFile = new File(cacheDir, "backup_export_" + opId + ".tmp");
                if (tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
                outputStream = new FileOutputStream(tempFile);

                activeOperationId = opId;
                expectedFilename = filename;
                expectedMimeType = mimeType;
                expectedBytes = bytes;
                expectedSha256 = sha256;
                writtenBytes = 0;
                nextSequence = 0;
                isAwaitingDocumentCreation = false;

                JSONObject ack = new JSONObject();
                ack.put("ok", true);
                ack.put("operationId", opId);
                ack.put("nextSequence", 0);
                return ack.toString();
            } catch (Exception e) {
                Log.e(TAG, "beginExport failed", e);
                cleanupActiveExportLocked();
                return makeErrorAck("internal_error", "初始化备份导出失败: " + e.getMessage());
            }
        }
    }

    public String appendChunk(String operationId, int sequence, String base64Chunk, boolean trusted) {
        synchronized (lock) {
            if (!trusted) {
                return makeErrorAck("untrusted_page", "当前页面不是官方受信页面");
            }
            if (destroyed) {
                return makeErrorAck("destroyed", "宿主容器已销毁");
            }
            if (activeOperationId == null || !activeOperationId.equals(operationId)) {
                return makeErrorAck("invalid_operation_id", "operationId 不匹配或导出已终止");
            }
            if (outputStream == null) {
                return makeErrorAck("stream_closed", "临时文件写入流未打开");
            }
            if (sequence != nextSequence) {
                cleanupActiveExportLocked();
                return makeErrorAck("sequence_mismatch", "分块序号不匹配: 期望 " + nextSequence + "，收到 " + sequence);
            }
            if (base64Chunk == null || base64Chunk.length() > MAX_BASE64_CHUNK_CHARS) {
                cleanupActiveExportLocked();
                return makeErrorAck("chunk_too_large", "Base64 分块大小超出上限 (64KiB)");
            }

            try {
                byte[] data = Base64.decode(base64Chunk, Base64.DEFAULT);
                if (data == null || data.length == 0) {
                    cleanupActiveExportLocked();
                    return makeErrorAck("invalid_chunk", "Base64 解码为空");
                }
                if (data.length > MAX_RAW_CHUNK_BYTES) {
                    cleanupActiveExportLocked();
                    return makeErrorAck("chunk_too_large", "原始分块大小超出上限 (48KiB)");
                }
                if (writtenBytes + data.length > expectedBytes || writtenBytes + data.length > MAX_BACKUP_BYTES) {
                    cleanupActiveExportLocked();
                    return makeErrorAck("bytes_exceeded", "累计写入字节超出声明大小或 50MB 上限");
                }

                outputStream.write(data);
                writtenBytes += data.length;
                nextSequence++;

                JSONObject ack = new JSONObject();
                ack.put("ok", true);
                ack.put("operationId", operationId);
                ack.put("nextSequence", nextSequence);
                return ack.toString();
            } catch (Exception e) {
                Log.e(TAG, "appendChunk failed", e);
                cleanupActiveExportLocked();
                return makeErrorAck("write_error", "写入分块异常: " + e.getMessage());
            }
        }
    }

    public String finishExport(String operationId, boolean trusted) {
        final String opId;
        final String filename;
        synchronized (lock) {
            if (!trusted) {
                return makeErrorAck("untrusted_page", "当前页面不是官方受信页面");
            }
            if (destroyed) {
                return makeErrorAck("destroyed", "宿主容器已销毁");
            }
            if (activeOperationId == null || !activeOperationId.equals(operationId)) {
                return makeErrorAck("invalid_operation_id", "operationId 不匹配或导出已终止");
            }

            try {
                if (outputStream != null) {
                    outputStream.flush();
                    outputStream.close();
                    outputStream = null;
                }

                if (writtenBytes != expectedBytes) {
                    cleanupActiveExportLocked();
                    return makeErrorAck("bytes_mismatch", "写入字节数 (" + writtenBytes + ") 与声明 (" + expectedBytes + ") 不一致");
                }

                String actualSha256 = calculateSha256(tempFile);
                if (!expectedSha256.equalsIgnoreCase(actualSha256)) {
                    cleanupActiveExportLocked();
                    return makeErrorAck("sha256_mismatch", "文件 SHA-256 校验失败");
                }

                opId = activeOperationId;
                filename = expectedFilename;
                isAwaitingDocumentCreation = true;
            } catch (Exception e) {
                Log.e(TAG, "finishExport validation failed", e);
                cleanupActiveExportLocked();
                return makeErrorAck("validation_error", "校验备份临时文件异常: " + e.getMessage());
            }
        }

        // UI 线程调起 SAF 文档创建
        uiHandler.post(new Runnable() {
            @Override
            public void run() {
                if (destroyed) return;
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, filename);
                    activity.startActivityForResult(intent, BACKUP_EXPORT_REQUEST_CODE);
                } catch (Exception e) {
                    Log.e(TAG, "startActivityForResult ACTION_CREATE_DOCUMENT failed", e);
                    synchronized (lock) {
                        cleanupActiveExportLocked();
                    }
                    emitBackupFailed(opId, "saf_launch_failed", "调起系统文件选择器失败: " + e.getMessage());
                }
            }
        });

        JSONObject ack = new JSONObject();
        try {
            ack.put("ok", true);
            ack.put("operationId", operationId);
        } catch (Exception ignored) {}
        return ack.toString();
    }

    public String cancelExport(String operationId, boolean trusted) {
        synchronized (lock) {
            if (activeOperationId != null && activeOperationId.equals(operationId)) {
                cleanupActiveExportLocked();
            }
            JSONObject ack = new JSONObject();
            try {
                ack.put("ok", true);
                ack.put("operationId", operationId);
            } catch (Exception ignored) {}
            return ack.toString();
        }
    }

    public void handleSafResult(int resultCode, Intent data) {
        final String opId;
        final String filename;
        final long bytes;
        final File fileToCopy;

        synchronized (lock) {
            if (activeOperationId == null || !isAwaitingDocumentCreation) {
                return;
            }
            opId = activeOperationId;
            filename = expectedFilename;
            bytes = writtenBytes;
            fileToCopy = tempFile;

            if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
                cleanupActiveExportLocked();
                emitBackupCancelled(opId);
                return;
            }
        }

        final Uri targetUri = data.getData();
        new Thread(new Runnable() {
            @Override
            public void run() {
                InputStream in = null;
                OutputStream out = null;
                try {
                    in = new FileInputStream(fileToCopy);
                    out = activity.getContentResolver().openOutputStream(targetUri);
                    if (out == null) {
                        throw new Exception("无法打开目标文档输出流");
                    }
                    byte[] buffer = new byte[16384];
                    int len;
                    while ((len = in.read(buffer)) > 0) {
                        out.write(buffer, 0, len);
                    }
                    out.flush();

                    synchronized (lock) {
                        if (opId.equals(activeOperationId)) {
                            cleanupActiveExportLocked();
                        }
                    }
                    emitBackupSaved(opId, filename, bytes);
                } catch (Exception e) {
                    Log.e(TAG, "copy temp file to SAF document failed", e);
                    synchronized (lock) {
                        if (opId.equals(activeOperationId)) {
                            cleanupActiveExportLocked();
                        }
                    }
                    emitBackupFailed(opId, "saf_write_failed", "写入目标文档失败: " + e.getMessage());
                } finally {
                    try { if (in != null) in.close(); } catch (Exception ignored) {}
                    try { if (out != null) out.close(); } catch (Exception ignored) {}
                    if (fileToCopy != null && fileToCopy.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        fileToCopy.delete();
                    }
                }
            }
        }, "kaogong-backup-writer").start();
    }

    private void emitBackupSaved(String opId, String filename, long bytes) {
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "backup_saved");
            evt.put("operationId", opId);
            evt.put("filename", filename);
            evt.put("bytes", bytes);
        } catch (Exception ignored) {}
        emitBackupExportEvent(evt);
    }

    private void emitBackupCancelled(String opId) {
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "backup_cancelled");
            evt.put("operationId", opId);
        } catch (Exception ignored) {}
        emitBackupExportEvent(evt);
    }

    private void emitBackupFailed(String opId, String code, String message) {
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "backup_failed");
            evt.put("operationId", opId);
            evt.put("code", code);
            evt.put("message", message);
        } catch (Exception ignored) {}
        emitBackupExportEvent(evt);
    }

    public void emitBackupExportEvent(final JSONObject event) {
        if (event == null || destroyed) return;
        final String payload = event.toString();
        Runnable deliver = new Runnable() {
            @Override
            public void run() {
                if (destroyed || webView == null) return;
                try {
                    String js = "window.__kaogongBackupExportEvent && window.__kaogongBackupExportEvent("
                            + JSONObject.quote(payload) + ");";
                    webView.evaluateJavascript(js, null);
                } catch (Exception e) {
                    Log.w(TAG, "emit backup export event failed", e);
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            deliver.run();
        } else {
            uiHandler.post(deliver);
        }
    }

    public void cancelActiveExport(String reason) {
        synchronized (lock) {
            if (activeOperationId != null) {
                String opId = activeOperationId;
                cleanupActiveExportLocked();
                emitBackupCancelled(opId);
            }
        }
    }

    public void destroy() {
        destroyed = true;
        synchronized (lock) {
            cleanupActiveExportLocked();
        }
        webView = null;
    }

    private void cleanupActiveExportLocked() {
        if (outputStream != null) {
            try { outputStream.close(); } catch (Exception ignored) {}
            outputStream = null;
        }
        if (tempFile != null && tempFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            tempFile.delete();
            tempFile = null;
        }
        activeOperationId = null;
        expectedFilename = null;
        expectedMimeType = null;
        expectedBytes = 0;
        expectedSha256 = null;
        writtenBytes = 0;
        nextSequence = 0;
        isAwaitingDocumentCreation = false;
    }

    private String calculateSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream is = new FileInputStream(file);
        byte[] buffer = new byte[16384];
        int len;
        try {
            while ((len = is.read(buffer)) > 0) {
                digest.update(buffer, 0, len);
            }
        } finally {
            is.close();
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }

    private String makeErrorAck(String code, String message) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false);
            out.put("code", code);
            out.put("message", message);
        } catch (Exception ignored) {}
        return out.toString();
    }
}
