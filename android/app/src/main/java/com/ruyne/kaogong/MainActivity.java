package com.ruyne.kaogong;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.database.Cursor;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 考公工作台 · Android WebView 生产宿主容器
 *
 * 本文件针对只读审查 R13 / R14 / R15 做了以下真实修复（非仅注释）：
 *
 * R13（WebView 线程约束）：
 *  - 所有受信 URL 状态只由 WebViewClient 回调（UI 线程）写入 volatile 缓存字段 cachedPageTrusted / cachedPageUrl；
 *  - JavascriptInterface 方法运行在 WebView 私有后台线程，这些方法【绝不调用】WebView.getUrl()/getSettings()/getTitle()
 *    等任何 WebView API，只读取 volatile 缓存并校验；
 *  - 需要 UI 线程的操作全部 runOnUiThread() 投递；
 *  - 桥版本号 BRIDGE_PROTOCOL=2，供 Web 端区分“新桥 / 旧桥 / 桥异常”。
 *
 * R14（安装包强校验）：
 *  - 下载 URL 必须与官方 origin 精确匹配（scheme+host+port 全量校验，禁止前缀绕过、禁止 userinfo、禁止协议相对路径）；
 *  - 下载前强制 SHA-256 指纹格式校验；
 *  - 下载完成后按 DownloadManager 最终状态判定成功/失败（不只看广播）；
 *  - 文件 SHA-256、文件大小（若元数据提供）、APK 资产包 packageName、versionCode（必须大于已安装版本、且等于元数据声明）、
 *    签名证书 SHA-256（必须与当前已安装应用签名证书一致、且等于元数据指纹）逐项校验；
 *  - 校验通过的 APK 复制进应用私有内部 cache 目录（0600）并二次哈希（TOCTOU 防御）后才交给系统安装器；
 *  - 全部失败路径给出可读原因并删除不可信文件。
 *
 * R15（覆盖更新与拍照流程）：
 *  - Manifest 已声明 REQUEST_INSTALL_PACKAGES；Android 8.0+ 走 canRequestPackageInstalls() 检查，
 *    未授权时打开“安装未知应用”授权页，授权返回后自动续跑（下载前/安装前两处）；
 *  - 相机 + 相册统一通过 Intent.createChooser(...)+EXTRA_INITIAL_INTENTS 组合，取消分支真实回传 null；
 *  - DownloadManager 轮询真实进度、失败原因、取消、重试；固定残留文件在每次新下载前清理；
 *  - FileProvider 只向系统安装器/相机授予最小 URI 权限，APK 文件禁止写模式打开。
 */
public class MainActivity extends Activity {
    private static final String TAG = "KaogongNative";

    /** 桥协议版本：2 = 受信缓存 + 强校验安装 + 权限流程 + 进度事件 */
    public static final int BRIDGE_PROTOCOL = 2;
    /** 官方正式安装包证书 SHA-256 指纹（大写冒号格式，与 /version.json apkCertFingerprint 对齐） */
    private static final String OFFICIAL_CERT_SHA256_COLON =
            "85:75:82:EF:D9:20:83:CC:75:E5:C5:A0:C2:0D:B3:26:25:2C:BF:80:E7:11:23:23:4B:6B:F5:9D:CD:17:36:C1";
    /** 内部已验证 APK 固定文件名（FileProvider 只允许读取该名称的 apk） */
    private static final String VERIFIED_APK_FILENAME = "verified-kaogong-update.apk";
    private static final String UPDATES_DIR = "updates";
    private static final String CAMERA_PREFIX = "camera_photo_";

    private static final int FILECHOOSER_RESULTCODE = 101;
    private static final int INSTALL_PERMISSION_RESULTCODE = 102;
    private static final int INSTALL_ACTIVITY_REQUEST_CODE = 1003;

    private static final int STATE_IDLE = 0;
    private static final int STATE_NEEDS_PERMISSION = 1;
    private static final int STATE_DOWNLOADING = 2;
    private static final int STATE_VERIFYING = 3;
    private static final int STATE_READY = 4;
    private static final int STATE_INSTALLER_OPEN = 5;
    private static final int STATE_INSTALLED = 6;
    private static final int STATE_CANCELLED = 7;
    private static final int STATE_FAILED = 8;
    private static final int STATE_UNCONFIRMED = 9;
    private static final int STATE_INTERRUPTED = 10;
    // 兼容状态别名（STATE_INSTALLING 与 STATE_INSTALLER_OPEN 等价）
    private static final int STATE_INSTALLING = STATE_INSTALLER_OPEN;

    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;
    private Uri cameraPhotoUri;
    private File cameraPhotoFile;
    private long backPressedTime = 0;

    private BroadcastReceiver downloadReceiver;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private Runnable progressRunnable;
    private long activeDownloadId = -1L;
    private boolean downloadCompletionHandled = false;
    private volatile boolean destroyed = false;
    private int nativeUpdateState = STATE_IDLE;
    private long installerLaunchTime = 0L;

    // R13：受信页面状态缓存。仅由 UI 线程（WebViewClient 回调）写入，JavascriptInterface 线程只读。
    private volatile String cachedPageUrl = null;
    private volatile boolean cachedPageTrusted = false;

    // 待处理安装请求（由 JS 桥提交，UI 线程状态机消费）
    private volatile JSONObject pendingInstallRequest = null;
    private JSONObject pendingVerifiedMeta = null;
    private File pendingVerifiedApk = null;
    private String pendingDownloadFilename = null;
    private boolean resumeInstallAfterPermission = false;
    private volatile JSONObject lastTerminalEvent = null;

    // 已安装应用自身签名证书 SHA-256 缓存（小写十六进制）
    private String selfCertSha256 = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(false);

        webView = new WebView(this);
        setContentView(webView);

        initWebViewSettings();
        initWebViewClients();
        initNativeBridge();
        cleanupStaleCameraFiles();
        deleteUpdateArtifacts();

        webView.loadUrl(getString(R.string.cloud_url));
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        stopProgressPolling();
        unregisterDownloadReceiver();
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ==================================================================================
    // WebView 基础配置
    // ==================================================================================

    private void initWebViewSettings() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSaveFormData(false);

        // 严格安全策略：禁止明文混合内容加载
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        // 禁止未授权的本地文件读取跨域访问
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
    }

    private void initWebViewClients() {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                // R13：UI 线程写入受信缓存，JS 桥线程后续只读该缓存，绝不调用 WebView API
                updateTrustedPageState(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                updateTrustedPageState(url);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                updateTrustedPageState(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return true;
                Uri uri = request.getUrl();
                if (request.isForMainFrame()) {
                    if (isTrustedNavigationUrl(uri)) {
                        return false; // 官方来源继续在容器内加载
                    }
                    // 非受信来源一律不进入 WebView，转系统浏览器，避免钓鱼页面取得桥接能力
                    openInSystemBrowser(uri);
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // 生产环境安全合规：严格拦截不安全证书，绝不盲目 proceed()
                handler.cancel();
                toast("安全提示：服务器 SSL 证书验证失败，已阻止连接");
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    // 主页面加载网络异常时，由 Service Worker 接管并呈现离线缓存
                    Log.w(TAG, "main frame load error, SW offline shell will take over");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // R15：相机 + 相册通过 ACTION_CHOOSER 稳定组合，单选/多选/取消全部真实回传
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                return openImageSourceChooser(filePathCallback, fileChooserParams);
            }
        });

        // R15：页面内 APK 链接不交给系统浏览器裸下载，统一引导到应用内强校验更新流程
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                if (mimetype != null && mimetype.contains("android.package-archive")) {
                    toast("请通过应用内“检查更新”入口下载并安装官方安装包");
                    JSONObject evt = new JSONObject();
                    try {
                        evt.put("type", "download_needs_bridge");
                        evt.put("url", url);
                        evt.put("message", "页面内 APK 下载已被安全策略拦截，请使用应用内更新入口");
                    } catch (Exception ignored) {
                    }
                    emitBridgeEvent(evt);
                    return;
                }
                try {
                    Uri uri = Uri.parse(url);
                    if (isTrustedNavigationUrl(uri)) {
                        openInSystemBrowser(uri);
                    } else {
                        Log.w(TAG, "blocked untrusted download url");
                    }
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** R13：唯一受信缓存写入口，必须在 UI 线程调用。 */
    private void updateTrustedPageState(String url) {
        cachedPageUrl = url;
        boolean trusted = false;
        if (url != null) {
            try {
                trusted = isTrustedNavigationUrl(Uri.parse(url));
            } catch (Exception ignored) {
                trusted = false;
            }
        }
        cachedPageTrusted = trusted;
        Log.i(TAG, "trusted page state updated: trusted=" + trusted);
    }

    private void openInSystemBrowser(Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (scheme == null) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            toast("当前设备没有可打开该链接的应用");
        } catch (Exception e) {
            Log.w(TAG, "open external link failed", e);
        }
    }

    // ==================================================================================
    // 官方来源 / URL 强校验（R14）
    // ==================================================================================

    private Uri getCloudUri() {
        try {
            return Uri.parse(getString(R.string.cloud_url).trim());
        } catch (Exception e) {
            return null;
        }
    }

    private String getOfficialHost() {
        Uri cloud = getCloudUri();
        String host = cloud == null ? null : cloud.getHost();
        return host == null ? "work.ruyne.space" : host;
    }

    /** 仅当 cloud_url 本身指向本机开发地址时，才允许 localhost/127.0.0.1 作为开发来源 */
    private boolean isDevCloudConfigured() {
        String host = getOfficialHost();
        return "127.0.0.1".equals(host) || "localhost".equals(host);
    }

    private boolean isTrustedHost(String host) {
        if (host == null) return false;
        if (host.equalsIgnoreCase(getOfficialHost())) return true;
        if (isDevCloudConfigured()) {
            return "127.0.0.1".equals(host) || "localhost".equals(host);
        }
        return false;
    }

    /** 主框架导航受信校验：scheme + host 精确匹配（不做后缀/前缀/包含匹配） */
    private boolean isTrustedNavigationUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return false;
        if (uri.getUserInfo() != null) return false;
        if ("https".equalsIgnoreCase(scheme)) {
            return isTrustedHost(host);
        }
        if ("http".equalsIgnoreCase(scheme)) {
            // 仅在开发环境（cloud_url 即本机）下允许 http 明文本机地址
            return isDevCloudConfigured()
                    && ("127.0.0.1".equals(host) || "localhost".equals(host));
        }
        return false;
    }

    /**
     * 解析并校验安装包下载地址：
     *  - 相对地址（以单个 "/" 开头）补全为官方 origin 绝对地址；
     *  - 绝对地址必须 scheme/host 精确匹配官方来源；
     *  - 禁止 userinfo、协议相对地址、反斜杠、控制字符、非默认端口（开发本机除外）。
     */
    private String resolveAndValidateDownloadUrl(String rawUrl) {
        if (rawUrl == null) return null;
        String raw = rawUrl.trim();
        if (raw.isEmpty()) return null;
        if (raw.contains("\\") || raw.contains("\n") || raw.contains("\r") || raw.contains("\t")) return null;
        if (raw.startsWith("//")) return null; // 协议相对地址拒绝

        String officialUrl = getString(R.string.cloud_url).trim();
        String full;
        if (raw.startsWith("/")) {
            String base = officialUrl.endsWith("/") ? officialUrl.substring(0, officialUrl.length() - 1) : officialUrl;
            full = base + raw;
        } else {
            full = raw;
        }

        try {
            Uri uri = Uri.parse(full);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return null;
            if (uri.getUserInfo() != null) return null;
            if (!isTrustedNavigationUrl(uri)) return null;

            int port = uri.getPort();
            if (port != -1) {
                boolean defaultHttps = "https".equalsIgnoreCase(scheme) && port == 443;
                boolean devPort = isDevCloudConfigured()
                        && ("127.0.0.1".equals(host) || "localhost".equals(host));
                if (!defaultHttps && !devPort) return null;
            }

            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) return null;
            return uri.toString();
        } catch (Exception e) {
            Log.w(TAG, "invalid download url", e);
            return null;
        }
    }

    // ==================================================================================
    // 相机 / 相册（R15）
    // ==================================================================================

    private boolean openImageSourceChooser(ValueCallback<Uri[]> filePathCallback, WebChromeClient.FileChooserParams params) {
        // 释放上一次次未完成回调，避免回调泄漏
        if (uploadMessage != null) {
            uploadMessage.onReceiveValue(null);
            uploadMessage = null;
        }
        uploadMessage = filePathCallback;
        cleanupStaleCameraFiles();
        cleanupCameraPhotoFile();

        Intent contentIntent;
        try {
            contentIntent = params != null
                    ? params.createIntent()
                    : new Intent(Intent.ACTION_GET_CONTENT);
        } catch (Exception e) {
            contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            contentIntent.setType("*/*");
        }
        try {
            if (params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                contentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
        } catch (Exception ignored) {
        }

        Intent cameraIntent = createCameraCaptureIntent();

        // ACTION_CHOOSER + EXTRA_INITIAL_INTENTS：相机与文件选择器在同一选择面板稳定呈现
        Intent chooserIntent = Intent.createChooser(contentIntent, "选择错题照片来源");
        chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (cameraIntent != null) {
            chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
        }

        try {
            startActivityForResult(chooserIntent, FILECHOOSER_RESULTCODE);
            return true;
        } catch (ActivityNotFoundException e) {
            // 极端机型无任何选择器时，退化为直接相册选择
            try {
                startActivityForResult(contentIntent, FILECHOOSER_RESULTCODE);
                return true;
            } catch (Exception inner) {
                failFileChooser("当前设备没有可用的照片选择器");
                return true;
            }
        } catch (Exception e) {
            failFileChooser("打开照片选择器失败");
            return true;
        }
    }

    private Intent createCameraCaptureIntent() {
        try {
            File cacheDir = getCacheDir();
            cameraPhotoFile = File.createTempFile(CAMERA_PREFIX, ".jpg", cacheDir);
            cameraPhotoUri = Uri.parse("content://" + KaogongFileProvider.AUTHORITY + "/" + cameraPhotoFile.getName());

            Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
            takePictureIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // 部分相机应用需要 ClipData 才能正确继承写权限
            takePictureIntent.setClipData(ClipData.newRawUri("photo", cameraPhotoUri));

            if (takePictureIntent.resolveActivity(getPackageManager()) == null) {
                cleanupCameraPhotoFile();
                return null;
            }
            return takePictureIntent;
        } catch (Exception e) {
            Log.w(TAG, "create camera intent failed", e);
            cleanupCameraPhotoFile();
            return null;
        }
    }

    private void failFileChooser(String message) {
        if (uploadMessage != null) {
            uploadMessage.onReceiveValue(null);
            uploadMessage = null;
        }
        toast(message);
    }

    private void cleanupCameraPhotoFile() {
        if (cameraPhotoFile != null && cameraPhotoFile.exists()) {
            //noinspection ResultOfMethodCallIgnored
            cameraPhotoFile.delete();
        }
        cameraPhotoFile = null;
        cameraPhotoUri = null;
    }

    /** 清理历史遗留相机临时文件（超过 1 小时且不是本次拍摄的文件） */
    private void cleanupStaleCameraFiles() {
        try {
            File[] files = getCacheDir().listFiles();
            if (files == null) return;
            long now = System.currentTimeMillis();
            for (File f : files) {
                if (!f.isFile() || !f.getName().startsWith(CAMERA_PREFIX)) continue;
                if (cameraPhotoFile != null && f.getAbsolutePath().equals(cameraPhotoFile.getAbsolutePath())) continue;
                if (now - f.lastModified() > 60L * 60L * 1000L) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        } catch (Exception ignored) {
        }
    }

    // ==================================================================================
    // 原生桥（R13：桥线程绝不调用 WebView API）
    // ==================================================================================

    private void initNativeBridge() {
        webView.addJavascriptInterface(new KaogongBridge(), "AndroidBridge");
    }

    private final class KaogongBridge {
        /**
         * 返回应用真实信息 + 桥协议 + 受信状态。
         * 注意：本方法运行在 WebView 的 JavascriptInterface 私有后台线程，
         * 因此绝不调用 webView.getUrl()/getSettings() 等受线程约束的 WebView API。
         */
        @JavascriptInterface
        public String getAppInfo() {
            JSONObject out = new JSONObject();
            try {
                out.put("bridgeProtocol", BRIDGE_PROTOCOL);
                out.put("sdkInt", Build.VERSION.SDK_INT);
                if (!cachedPageTrusted) {
                    out.put("available", false);
                    out.put("trusted", false);
                    out.put("reason", "untrusted_page");
                    return out.toString();
                }
                out.put("available", true);
                out.put("trusted", true);
                out.put("pageUrl", cachedPageUrl == null ? "" : cachedPageUrl);
                out.put("packageName", getPackageName());
                out.put("versionCode", getInstalledVersionCode());
                out.put("versionName", getInstalledVersionName());
                String cert = getSelfCertSha256();
                out.put("certSha256", cert == null ? "" : cert);
                out.put("certFingerprint", cert == null ? "" : toColonFingerprint(cert));
                out.put("officialHost", getOfficialHost());
                out.put("installPermission", describeInstallPermission());
                out.put("state", describeState(nativeUpdateState));
                String activeOpId = pendingInstallRequest != null ? pendingInstallRequest.optString("operationId", "") : "";
                out.put("activeOperationId", activeOpId);
                if (lastTerminalEvent != null) {
                    out.put("lastTerminalEvent", lastTerminalEvent);
                } else {
                    out.put("lastTerminalEvent", JSONObject.NULL);
                }
                return out.toString();
            } catch (Exception e) {
                Log.e(TAG, "getAppInfo failed", e);
                JSONObject fallback = new JSONObject();
                try {
                    fallback.put("bridgeProtocol", BRIDGE_PROTOCOL);
                    fallback.put("available", false);
                    fallback.put("trusted", false);
                    fallback.put("reason", "internal_error");
                } catch (Exception ignored) {
                }
                return fallback.toString();
            }
        }

        @JavascriptInterface
        public String getInstallPermissionStatus() {
            JSONObject out = new JSONObject();
            try {
                if (!cachedPageTrusted) {
                    out.put("available", false);
                    out.put("granted", false);
                    out.put("reason", "untrusted_page");
                    return out.toString();
                }
                out.put("available", true);
                out.put("granted", hasInstallPermission());
                out.put("sdkInt", Build.VERSION.SDK_INT);
                return out.toString();
            } catch (Exception e) {
                return "{\"available\":false,\"granted\":false,\"reason\":\"internal_error\"}";
            }
        }

        @JavascriptInterface
        public String getLastTerminalEvent() {
            if (!cachedPageTrusted || lastTerminalEvent == null) return "";
            return lastTerminalEvent.toString();
        }

        /** 打开“安装未知应用”授权页；授权返回后自动续跑 */
        @JavascriptInterface
        public void requestInstallPermission() {
            final boolean trusted = cachedPageTrusted;
            uiHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (!trusted) {
                        emitBridgeError("untrusted_page", "当前页面不是官方受信页面，已拒绝安装授权请求");
                        return;
                    }
                    resumeInstallAfterPermission = true;
                    openInstallPermissionSettings();
                }
            });
        }

        /** 兼容旧协议的安装入口（v1.0.2 及更早 Web 端调用）：只接受 url + sha256 */
        @JavascriptInterface
        public void installApk(final String downloadUrl, final String expectedSha256) {
            final boolean trusted = cachedPageTrusted;
            uiHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (!trusted) {
                        emitBridgeError("untrusted_page", "当前页面不是官方受信页面，已拒绝安装请求");
                        return;
                    }
                    JSONObject req = new JSONObject();
                    try {
                        req.put("url", downloadUrl);
                        req.put("sha256", expectedSha256);
                    } catch (Exception e) {
                        emitBridgeError("invalid_request", "安装请求参数非法");
                        return;
                    }
                    handleInstallRequest(req);
                }
            });
        }

        /**
         * 新版强校验安装入口（BRIDGE_PROTOCOL=2）。
         * requestJson: { url, sha256, sizeBytes?, packageName?, versionCode?, certFingerprint? }
         */
        @JavascriptInterface
        public void installApkVerified(final String requestJson) {
            final boolean trusted = cachedPageTrusted;
            uiHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (!trusted) {
                        emitBridgeError("untrusted_page", "当前页面不是官方受信页面，已拒绝安装请求");
                        return;
                    }
                    JSONObject req;
                    try {
                        req = new JSONObject(requestJson == null ? "{}" : requestJson);
                    } catch (Exception e) {
                        emitBridgeError("invalid_request", "安装请求 JSON 解析失败");
                        return;
                    }
                    handleInstallRequest(req);
                }
            });
        }

        @JavascriptInterface
        public void cancelApkDownload() {
            final boolean trusted = cachedPageTrusted;
            uiHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (!trusted) {
                        emitBridgeError("untrusted_page", "当前页面不是官方受信页面，已拒绝取消请求");
                        return;
                    }
                    cancelActiveDownload();
                }
            });
        }
    }

    // ==================================================================================
    // 安装权限（R15）
    // ==================================================================================

    private boolean hasInstallPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                return getPackageManager().canRequestPackageInstalls();
            } catch (Exception e) {
                return false;
            }
        }
        // Android 7.x 前由系统“未知来源”全局开关控制，尝试安装时系统会给出明确引导
        return true;
    }

    private String describeInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "unknown";
        return hasInstallPermission() ? "granted" : "denied";
    }

    private void openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            emitBridgeError("permission_unsupported",
                    "当前系统版本无需单独授权，请直接在系统弹窗中允许安装");
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + getPackageName()));
        try {
            startActivityForResult(intent, INSTALL_PERMISSION_RESULTCODE);
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "install_permission_required");
                evt.put("reason", "opened_settings");
                evt.put("sdkInt", Build.VERSION.SDK_INT);
                if (pendingInstallRequest != null) {
                    evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                }
                evt.put("message", "请在系统页面允许“安装未知应用”，返回后会自动继续安装");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
        } catch (ActivityNotFoundException e) {
            try {
                startActivityForResult(new Intent(Settings.ACTION_SECURITY_SETTINGS), INSTALL_PERMISSION_RESULTCODE);
                toast("请在系统安全设置中允许安装未知应用后重试");
            } catch (Exception inner) {
                emitBridgeError("permission_settings_unavailable",
                        "无法打开安装授权页面，请前往系统设置 -> 安全 -> 安装未知应用 手动允许");
            }
        } catch (Exception e) {
            emitBridgeError("permission_settings_unavailable", "打开安装授权页面失败：" + e.getMessage());
        }
    }

    // ==================================================================================
    // 安装请求状态机（UI 线程）
    // ==================================================================================

    private void handleInstallRequest(JSONObject req) {
        if (destroyed) return;
        try {
            // 1) 并发保护：下载/校验/安装器打开期间不接受重复请求
            if (nativeUpdateState == STATE_DOWNLOADING
                    || nativeUpdateState == STATE_VERIFYING
                    || nativeUpdateState == STATE_INSTALLER_OPEN) {
                JSONObject evt = new JSONObject();
                evt.put("type", "update_busy");
                evt.put("message", "已有更新任务正在进行，请稍候");
                emitBridgeEvent(evt);
                return;
            }

            // 2) 归一化 + 本地校验（URL / SHA-256 / 包名 / versionCode / 证书指纹）
            JSONObject normalized = normalizeInstallRequest(req);
            if (normalized == null) return;

            pendingInstallRequest = normalized;
            lastTerminalEvent = null;

            // 3) Android 8+ 安装未知应用权限检查
            if (!hasInstallPermission()) {
                nativeUpdateState = STATE_NEEDS_PERMISSION;
                resumeInstallAfterPermission = true;
                openInstallPermissionSettings();
                return;
            }

            startVerifiedDownload(normalized);
        } catch (Exception e) {
            Log.e(TAG, "handleInstallRequest failed", e);
            nativeUpdateState = STATE_FAILED;
            emitBridgeError("internal_error", "安装请求处理失败：" + e.getMessage());
        }
    }

    /** 返回归一化后的请求；校验失败时发出 bridge 事件并返回 null。 */
    private JSONObject normalizeInstallRequest(JSONObject req) {
        String operationId = req != null ? req.optString("operationId", "") : "";
        try {
            if (req == null) {
                emitBridgeError("invalid_request", "安装请求为空", operationId);
                return null;
            }
            String rawUrl = req.optString("url", "");
            String fullUrl = resolveAndValidateDownloadUrl(rawUrl);
            if (fullUrl == null) {
                emitBridgeError("untrusted_download_url",
                        "安全拦截：安装包地址不是官方受信 HTTPS 来源，已拒绝下载", operationId);
                return null;
            }

            String sha256 = req.optString("sha256", "").trim();
            if (!sha256.matches("^[a-fA-F0-9]{64}$")) {
                emitBridgeError("invalid_sha256",
                        "安全拦截：缺少合法的 64 位 SHA-256 完整性指纹，已拒绝下载", operationId);
                return null;
            }

            String expectedPackage = req.optString("packageName", getPackageName());
            if (!getPackageName().equals(expectedPackage)) {
                emitBridgeError("package_mismatch",
                        "安全拦截：安装包目标包名与当前应用不一致，已拒绝下载", operationId);
                return null;
            }

            int installedCode = getInstalledVersionCode();
            int declaredCode = req.optInt("versionCode", -1);
            if (declaredCode != -1 && declaredCode <= installedCode) {
                emitBridgeError("version_not_incremented",
                        "安全拦截：云端安装包 versionCode(" + declaredCode + ") 未高于当前安装版本(" + installedCode + ")", operationId);
                return null;
            }

            String certFingerprint = req.optString("certFingerprint", "").trim();
            if (!certFingerprint.isEmpty()) {
                String declaredCert = normalizeHexFingerprint(certFingerprint);
                String selfCert = getSelfCertSha256();
                if (declaredCert == null || selfCert == null || !declaredCert.equalsIgnoreCase(selfCert)) {
                    emitBridgeError("cert_mismatch",
                            "安全拦截：云端声明的签名证书与当前已安装应用证书不一致，已拒绝下载", operationId);
                    return null;
                }
            }

            if (operationId.isEmpty()) {
                operationId = "op_" + System.currentTimeMillis();
            }
            JSONObject out = new JSONObject();
            out.put("operationId", operationId);
            out.put("url", fullUrl);
            out.put("sha256", sha256.toLowerCase(Locale.US));
            out.put("packageName", expectedPackage);
            out.put("versionCode", declaredCode);
            out.put("versionName", req.optString("versionName", ""));
            out.put("certFingerprint", certFingerprint);
            long sizeBytes = req.optLong("sizeBytes", -1L);
            if (sizeBytes > 0) out.put("sizeBytes", sizeBytes);
            return out;
        } catch (Exception e) {
            Log.e(TAG, "normalizeInstallRequest failed", e);
            emitBridgeError("invalid_request", "安装请求校验异常：" + e.getMessage(), operationId);
            return null;
        }
    }

    // ==================================================================================
    // 下载（R15：DownloadManager + 真实进度/失败原因/取消/重试）
    // ==================================================================================

    private void startVerifiedDownload(JSONObject req) {
        try {
            final DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                emitBridgeError("download_manager_unavailable", "系统下载服务不可用，请稍后重试");
                nativeUpdateState = STATE_FAILED;
                return;
            }

            // 清理上一轮下载与残留文件，避免固定文件名残留阻塞新下载
            if (activeDownloadId >= 0) {
                try {
                    dm.remove(activeDownloadId);
                } catch (Exception ignored) {
                }
            }
            stopProgressPolling();
            unregisterDownloadReceiver();
            deleteUpdateArtifacts();

            String url = req.getString("url");
            String opId = req.optString("operationId", "op_" + System.currentTimeMillis());
            pendingDownloadFilename = "update_" + opId + ".apk";
            File externalUpdatesDir = new File(getExternalFilesDir(null), UPDATES_DIR);
            //noinspection ResultOfMethodCallIgnored
            externalUpdatesDir.mkdirs();

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("考公工作台更新");
            request.setDescription("正在经官方加密通道下载并校验安装包");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(this, null, UPDATES_DIR + "/" + pendingDownloadFilename);

            activeDownloadId = dm.enqueue(request);
            downloadCompletionHandled = false;
            nativeUpdateState = STATE_DOWNLOADING;
            registerDownloadReceiver();
            startProgressPolling();

            JSONObject evt = new JSONObject();
            evt.put("type", "download_started");
            evt.put("downloadId", activeDownloadId);
            evt.put("operationId", opId);
            evt.put("message", "已开始安全下载更新包");
            emitBridgeEvent(evt);
        } catch (Exception e) {
            Log.e(TAG, "start download failed", e);
            nativeUpdateState = STATE_FAILED;
            emitBridgeError("download_enqueue_failed", "启动安装包下载失败：" + e.getMessage());
        }
    }

    private void registerDownloadReceiver() {
        unregisterDownloadReceiver();
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (id == activeDownloadId) {
                    handleDownloadFinished(id);
                }
            }
        };
        try {
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(downloadReceiver, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "register download receiver failed", e);
            downloadReceiver = null;
        }
    }

    private void unregisterDownloadReceiver() {
        if (downloadReceiver != null) {
            try {
                unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {
            }
            downloadReceiver = null;
        }
    }

    private void startProgressPolling() {
        stopProgressPolling();
        progressRunnable = new Runnable() {
            @Override
            public void run() {
                if (destroyed || activeDownloadId < 0) return;
                boolean finished = false;
                Cursor cursor = null;
                try {
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm == null) return;
                    cursor = dm.query(new DownloadManager.Query().setFilterById(activeDownloadId));
                    if (cursor == null || !cursor.moveToFirst()) return;
                    int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                    if (statusIdx < 0) return;
                    int status = cursor.getInt(statusIdx);
                    if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED) {
                        finished = true;
                    } else {
                        long downloaded = readLongColumn(cursor, DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                        long total = readLongColumn(cursor, DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
                        JSONObject evt = new JSONObject();
                        evt.put("type", "download_progress");
                        evt.put("downloaded", downloaded);
                        evt.put("total", total);
                        evt.put("percent", total > 0 ? Math.min(100, (int) (downloaded * 100L / total)) : 0);
                        emitBridgeEvent(evt);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "download progress query failed", e);
                } finally {
                    if (cursor != null) {
                        try {
                            cursor.close();
                        } catch (Exception ignored) {
                        }
                    }
                }
                if (finished) {
                    handleDownloadFinished(activeDownloadId);
                    return;
                }
                if (!destroyed && activeDownloadId >= 0) {
                    uiHandler.postDelayed(this, 600L);
                }
            }
        };
        uiHandler.postDelayed(progressRunnable, 600L);
    }

    private void stopProgressPolling() {
        if (progressRunnable != null) {
            uiHandler.removeCallbacks(progressRunnable);
            progressRunnable = null;
        }
    }

    private long readLongColumn(Cursor cursor, String columnName) {
        int idx = cursor.getColumnIndex(columnName);
        if (idx < 0) return -1L;
        return cursor.getLong(idx);
    }

    /** R15：广播只作为触发，必须再查询 DownloadManager 最终状态与失败原因。 */
    private void handleDownloadFinished(long downloadId) {
        if (downloadId != activeDownloadId || downloadCompletionHandled) return;
        downloadCompletionHandled = true;
        stopProgressPolling();
        unregisterDownloadReceiver();

        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        int status = -1;
        int reason = -1;
        String localUri = null;
        Cursor cursor = null;
        try {
            if (dm == null) throw new IllegalStateException("下载服务不可用");
            cursor = dm.query(new DownloadManager.Query().setFilterById(downloadId));
            if (cursor != null && cursor.moveToFirst()) {
                int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                int reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
                int uriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                if (statusIdx >= 0) status = cursor.getInt(statusIdx);
                if (reasonIdx >= 0) reason = cursor.getInt(reasonIdx);
                if (uriIdx >= 0) localUri = cursor.getString(uriIdx);
            }
        } catch (Exception e) {
            Log.e(TAG, "query final download status failed", e);
        } finally {
            if (cursor != null) {
                try {
                    cursor.close();
                } catch (Exception ignored) {
                }
            }
        }

        long finishedDownloadId = activeDownloadId;
        activeDownloadId = -1L;

        if (status != DownloadManager.STATUS_SUCCESSFUL) {
            nativeUpdateState = STATE_FAILED;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "download_failed");
                evt.put("reasonCode", reason);
                evt.put("reason", mapDownloadFailureReason(reason));
                evt.put("retryable", true);
                if (pendingInstallRequest != null) {
                    evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                }
                evt.put("message", "安装包下载失败：" + mapDownloadFailureReason(reason));
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            deleteUpdateArtifacts();
            try {
                if (dm != null && finishedDownloadId >= 0) dm.remove(finishedDownloadId);
            } catch (Exception ignored) {
            }
            pendingInstallRequest = null;
            return;
        }

        File apkFile = resolveDownloadedApk(localUri);
        if (apkFile == null || !apkFile.exists() || apkFile.length() <= 0) {
            nativeUpdateState = STATE_FAILED;
            String opId = pendingInstallRequest != null ? pendingInstallRequest.optString("operationId", "") : "";
            emitBridgeError("downloaded_file_missing", "下载完成但未找到安装包文件，请重试", opId);
            deleteUpdateArtifacts();
            pendingInstallRequest = null;
            return;
        }

        nativeUpdateState = STATE_VERIFYING;
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "verification_started");
            if (pendingInstallRequest != null) {
                evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
            }
            evt.put("message", "下载完成，正在校验安装包完整性、包名、版本号与签名证书");
        } catch (Exception ignored) {
        }
        emitBridgeEvent(evt);

        final File toVerify = apkFile;
        final JSONObject request = pendingInstallRequest;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final JSONObject verdict = verifyDownloadedApk(toVerify, request);
                uiHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        onVerificationFinished(verdict);
                    }
                });
            }
        }, "kaogong-apk-verify").start();
    }

    private File resolveDownloadedApk(String localUri) {
        try {
            // 1) 优先生成预期路径（下载目标由本应用指定，路径可预测）
            if (pendingDownloadFilename != null) {
                File expected = new File(new File(getExternalFilesDir(null), UPDATES_DIR), pendingDownloadFilename);
                if (expected.exists() && expected.length() > 0) return expected;
            }
            if (localUri == null || localUri.isEmpty()) return null;
            Uri uri = Uri.parse(localUri);
            if ("file".equalsIgnoreCase(uri.getScheme())) {
                File f = new File(uri.getPath() == null ? "" : uri.getPath());
                if (f.exists() && f.length() > 0) return f;
                return null;
            }
            // 2) content:// 场景：复制到内部 cache 再校验
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            File outFile = new File(getCacheDir(), "downloaded-update.apk");
            OutputStream out = new FileOutputStream(outFile);
            copyStream(in, out);
            //noinspection ResultOfMethodCallIgnored
            outFile.deleteOnExit();
            return outFile.exists() && outFile.length() > 0 ? outFile : null;
        } catch (Exception e) {
            Log.e(TAG, "resolve downloaded apk failed", e);
            return null;
        }
    }

    private static void copyStream(InputStream in, OutputStream out) throws Exception {
        try {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) > 0) {
                out.write(buffer, 0, len);
            }
            out.flush();
        } finally {
            try {
                in.close();
            } catch (Exception ignored) {
            }
            try {
                out.close();
            } catch (Exception ignored) {
            }
        }
    }

    private String mapDownloadFailureReason(int reason) {
        switch (reason) {
            case DownloadManager.ERROR_CANNOT_RESUME:
                return "无法续传（网络或存储状态异常）";
            case DownloadManager.ERROR_DEVICE_NOT_FOUND:
                return "存储设备不可用";
            case DownloadManager.ERROR_FILE_ALREADY_EXISTS:
                return "目标文件已存在";
            case DownloadManager.ERROR_FILE_ERROR:
                return "文件写入失败";
            case DownloadManager.ERROR_HTTP_DATA_ERROR:
                return "网络传输数据错误";
            case DownloadManager.ERROR_INSUFFICIENT_SPACE:
                return "设备存储空间不足";
            case DownloadManager.ERROR_TOO_MANY_REDIRECTS:
                return "下载重定向次数过多（下载源异常）";
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE:
                return "下载服务器返回异常状态码";
            case DownloadManager.ERROR_UNKNOWN:
                return "未知下载错误";
            default:
                return "下载失败（错误码 " + reason + "）";
        }
    }

    // ==================================================================================
    // 安装包强校验（R14：SHA-256 + packageName + versionCode + 签名证书 + TOCTOU）
    // ==================================================================================

    /** 在后台线程执行；返回 verdict JSON（含 ok / errorCode / verifiedPath 等）。 */
    private JSONObject verifyDownloadedApk(File apkFile, JSONObject request) {
        JSONObject verdict = new JSONObject();
        try {
            verdict.put("ok", false);
            if (apkFile == null || !apkFile.exists() || apkFile.length() <= 0) {
                verdict.put("errorCode", "file_missing");
                verdict.put("message", "安装包文件不存在或为空");
                return verdict;
            }

            String expectedSha = request == null ? "" : request.optString("sha256", "");
            long expectedSize = request == null ? -1L : request.optLong("sizeBytes", -1L);
            int declaredVersionCode = request == null ? -1 : request.optInt("versionCode", -1);
            String expectedCertHex = request == null ? null : normalizeHexFingerprint(request.optString("certFingerprint", ""));
            String expectedPackage = request == null ? getPackageName() : request.optString("packageName", getPackageName());

            // 1) 文件大小校验（元数据提供时）
            if (expectedSize > 0 && apkFile.length() != expectedSize) {
                verdict.put("errorCode", "size_mismatch");
                verdict.put("message", "安装包大小与云端元数据不一致（预期 " + expectedSize + " 字节，实际 " + apkFile.length() + " 字节）");
                deleteFileQuietly(apkFile);
                return verdict;
            }

            // 2) 文件 SHA-256 校验
            String actualSha = calculateFileSha256(apkFile);
            if (expectedSha == null || !expectedSha.matches("^[a-fA-F0-9]{64}$")
                    || !expectedSha.equalsIgnoreCase(actualSha)) {
                verdict.put("errorCode", "hash_mismatch");
                verdict.put("message", "安装包 SHA-256 校验失败，文件可能被篡改，已删除");
                deleteFileQuietly(apkFile);
                return verdict;
            }

            // 3) 解析 APK 资产包：包名 / versionCode / 签名证书
            PackageManager pm = getPackageManager();
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? PackageManager.GET_SIGNING_CERTIFICATES
                    : PackageManager.GET_SIGNATURES;
            PackageInfo archive = pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
            if (archive == null) {
                verdict.put("errorCode", "invalid_apk");
                verdict.put("message", "无法解析安装包（可能不是有效 APK），已删除");
                deleteFileQuietly(apkFile);
                return verdict;
            }
            if (!expectedPackage.equals(archive.packageName)) {
                verdict.put("errorCode", "package_mismatch");
                verdict.put("message", "安装包包名不匹配（预期 " + expectedPackage + "，实际 " + archive.packageName + "）");
                deleteFileQuietly(apkFile);
                return verdict;
            }

            long archiveVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? archive.getLongVersionCode()
                    : (long) archive.versionCode;
            int installedCode = getInstalledVersionCode();
            if (archiveVersionCode <= installedCode) {
                verdict.put("errorCode", "version_not_incremented");
                verdict.put("message", "安装包 versionCode(" + archiveVersionCode + ") 未高于当前版本(" + installedCode + ")，系统将拒绝覆盖升级");
                deleteFileQuietly(apkFile);
                return verdict;
            }
            if (declaredVersionCode != -1 && archiveVersionCode != declaredVersionCode) {
                verdict.put("errorCode", "version_mismatch");
                verdict.put("message", "安装包 versionCode(" + archiveVersionCode + ") 与云端元数据声明(" + declaredVersionCode + ") 不一致");
                deleteFileQuietly(apkFile);
                return verdict;
            }

            // 4) 签名证书校验：必须与当前已安装应用证书一致；若元数据声明指纹则还需一致
            Signature[] archiveSigs = extractSignatures(archive);
            if (archiveSigs == null || archiveSigs.length == 0) {
                verdict.put("errorCode", "signature_missing");
                verdict.put("message", "安装包缺少签名信息，已拒绝安装");
                deleteFileQuietly(apkFile);
                return verdict;
            }
            String selfCert = getSelfCertSha256();
            String matchedCert = null;
            boolean sameAsInstalled = false;
            for (Signature sig : archiveSigs) {
                String sha = sha256Hex(sig.toByteArray());
                if (expectedCertHex != null && expectedCertHex.equalsIgnoreCase(sha)) {
                    matchedCert = sha;
                }
                if (selfCert != null && selfCert.equalsIgnoreCase(sha)) {
                    sameAsInstalled = true;
                }
            }
            if (!sameAsInstalled) {
                verdict.put("errorCode", "cert_mismatch");
                verdict.put("message", "安装包签名证书与当前已安装应用不一致，无法覆盖升级");
                deleteFileQuietly(apkFile);
                return verdict;
            }
            if (expectedCertHex != null && !expectedCertHex.equalsIgnoreCase(matchedCert == null ? "" : matchedCert)) {
                verdict.put("errorCode", "cert_metadata_mismatch");
                verdict.put("message", "安装包证书指纹与云端元数据声明不一致");
                deleteFileQuietly(apkFile);
                return verdict;
            }
            String signerCert = selfCert;

            // 5) TOCTOU 防御：复制到内部私有 cache + 复制后二次哈希
            String opId = request == null ? "" : request.optString("operationId", "");
            String safeApkName = opId.isEmpty() ? "update_verified.apk" : ("update_" + opId + ".apk");
            File safeApk = new File(getCacheDir(), safeApkName);
            deleteFileQuietly(safeApk);
            InputStream in = new FileInputStream(apkFile);
            OutputStream out = new FileOutputStream(safeApk);
            copyStream(in, out);
            String safeSha = calculateFileSha256(safeApk);
            if (!actualSha.equalsIgnoreCase(safeSha)) {
                verdict.put("errorCode", "toctou_hash_mismatch");
                verdict.put("message", "安装包复制到安全目录后哈希不一致，已终止安装");
                deleteFileQuietly(safeApk);
                deleteFileQuietly(apkFile);
                return verdict;
            }
            if (safeApk.length() != apkFile.length()) {
                verdict.put("errorCode", "toctou_size_mismatch");
                verdict.put("message", "安装包复制到安全目录后大小不一致，已终止安装");
                deleteFileQuietly(safeApk);
                deleteFileQuietly(apkFile);
                return verdict;
            }
            deleteFileQuietly(apkFile);

            verdict.put("ok", true);
            verdict.put("sha256", actualSha);
            verdict.put("sizeBytes", safeApk.length());
            verdict.put("packageName", archive.packageName);
            verdict.put("versionCode", archiveVersionCode);
            verdict.put("versionName", archive.versionName == null ? "" : archive.versionName);
            verdict.put("certSha256", signerCert == null ? "" : signerCert);
            verdict.put("certFingerprint", signerCert == null ? "" : toColonFingerprint(signerCert));
            verdict.put("verifiedPath", safeApk.getAbsolutePath());
            if (!opId.isEmpty()) {
                verdict.put("operationId", opId);
            }
            return verdict;
        } catch (Exception e) {
            Log.e(TAG, "verify downloaded apk failed", e);
            try {
                verdict.put("ok", false);
                verdict.put("errorCode", "verification_exception");
                verdict.put("message", "安装包校验异常：" + e.getMessage());
            } catch (Exception ignored) {
            }
            deleteFileQuietly(apkFile);
            return verdict;
        }
    }

    private void onVerificationFinished(JSONObject verdict) {
        if (destroyed) return;
        if (verdict == null || !verdict.optBoolean("ok", false)) {
            nativeUpdateState = STATE_FAILED;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "verification_failed");
                evt.put("errorCode", verdict == null ? "verification_failed" : verdict.optString("errorCode", "verification_failed"));
                evt.put("message", verdict == null ? "安装包校验失败" : verdict.optString("message", "安装包校验失败"));
                evt.put("retryable", true);
                if (pendingInstallRequest != null) {
                    evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                }
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            deleteUpdateArtifacts();
            pendingInstallRequest = null;
            return;
        }

        pendingVerifiedMeta = verdict;
        pendingVerifiedApk = new File(verdict.optString("verifiedPath", ""));
        nativeUpdateState = STATE_READY;

        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "install_ready");
            evt.put("versionCode", verdict.optLong("versionCode", 0L));
            evt.put("versionName", verdict.optString("versionName", ""));
            evt.put("packageName", verdict.optString("packageName", ""));
            evt.put("certFingerprint", verdict.optString("certFingerprint", ""));
            evt.put("sha256", verdict.optString("sha256", ""));
            if (pendingInstallRequest != null) {
                evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
            }
            evt.put("message", "安装包完整性、包名、版本号与签名证书校验全部通过");
        } catch (Exception ignored) {
        }
        emitBridgeEvent(evt);

        // 安装前二次确认权限（用户可能在下载期间关闭授权）
        if (!hasInstallPermission()) {
            nativeUpdateState = STATE_NEEDS_PERMISSION;
            resumeInstallAfterPermission = true;
            openInstallPermissionSettings();
            return;
        }
        launchSystemInstaller(pendingVerifiedApk);
    }

    private void launchSystemInstaller(File verifiedApk) {
        if (verifiedApk == null || !verifiedApk.exists() || verifiedApk.length() <= 0) {
            nativeUpdateState = STATE_FAILED;
            emitBridgeError("verified_file_missing", "已验证安装包不存在，请重新下载");
            return;
        }
        // 固定 FileProvider 名称，防止任意文件被外部安装器读取
        File target = new File(getCacheDir(), VERIFIED_APK_FILENAME);
        if (!target.getAbsolutePath().equals(verifiedApk.getAbsolutePath())) {
            deleteFileQuietly(target);
            try {
                InputStream in = new FileInputStream(verifiedApk);
                OutputStream out = new FileOutputStream(target);
                copyStream(in, out);
            } catch (Exception e) {
                nativeUpdateState = STATE_FAILED;
                emitBridgeError("verified_file_copy_failed", "安装包就绪失败：" + e.getMessage());
                return;
            }
        }

        Uri apkUri = Uri.parse("content://" + KaogongFileProvider.AUTHORITY + "/" + VERIFIED_APK_FILENAME);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        installIntent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
        installIntent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);

        try {
            startActivityForResult(installIntent, INSTALL_ACTIVITY_REQUEST_CODE);
            nativeUpdateState = STATE_INSTALLER_OPEN;
            installerLaunchTime = System.currentTimeMillis();
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "installer_launched");
                if (pendingInstallRequest != null) {
                    evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                }
                evt.put("message", "已调起系统安装程序，请按系统提示确认覆盖安装（不会清除本地数据与账号缓存）");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
        } catch (ActivityNotFoundException e) {
            try {
                Intent fallbackIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
                fallbackIntent.setData(apkUri);
                fallbackIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                fallbackIntent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
                startActivityForResult(fallbackIntent, INSTALL_ACTIVITY_REQUEST_CODE);
                nativeUpdateState = STATE_INSTALLER_OPEN;
                installerLaunchTime = System.currentTimeMillis();
                JSONObject evt = new JSONObject();
                try {
                    evt.put("type", "installer_launched");
                    if (pendingInstallRequest != null) {
                        evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                    }
                    evt.put("message", "已调起系统安装程序，请按系统提示确认覆盖安装（不会清除本地数据与账号缓存）");
                } catch (Exception ignored) {
                }
                emitBridgeEvent(evt);
            } catch (Exception e2) {
                nativeUpdateState = STATE_FAILED;
                emitBridgeError("installer_unavailable", "未找到系统安装程序，请在系统文件管理器中手动安装");
            }
        } catch (Exception e) {
            nativeUpdateState = STATE_FAILED;
            emitBridgeError("installer_launch_failed", "调起系统安装程序失败：" + e.getMessage());
        }
    }

    private void cancelActiveDownload() {
        if (activeDownloadId >= 0) {
            try {
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) dm.remove(activeDownloadId);
            } catch (Exception ignored) {
            }
        }
        String opId = pendingInstallRequest != null ? pendingInstallRequest.optString("operationId", "") : "";
        stopProgressPolling();
        unregisterDownloadReceiver();
        activeDownloadId = -1L;
        downloadCompletionHandled = false;
        pendingInstallRequest = null;
        nativeUpdateState = STATE_IDLE;
        deleteUpdateArtifacts();
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "cancelled");
            if (!opId.isEmpty()) {
                evt.put("operationId", opId);
            }
            evt.put("message", "已取消更新下载");
        } catch (Exception ignored) {
        }
        emitBridgeEvent(evt);
    }

    private void deleteUpdateArtifacts() {
        try {
            File updatesDir = new File(getExternalFilesDir(null), UPDATES_DIR);
            File[] files = updatesDir.listFiles();
            if (files != null) {
                for (File f : files) deleteFileQuietly(f);
            }
        } catch (Exception ignored) {
        }
        try {
            File[] cacheFiles = getCacheDir().listFiles();
            if (cacheFiles != null) {
                for (File f : cacheFiles) {
                    if (f.isFile() && f.getName().startsWith("update_") && f.getName().endsWith(".apk")) {
                        deleteFileQuietly(f);
                    }
                }
            }
            File downloaded = new File(getCacheDir(), "downloaded-update.apk");
            deleteFileQuietly(downloaded);
            File verified = new File(getCacheDir(), VERIFIED_APK_FILENAME);
            deleteFileQuietly(verified);
        } catch (Exception ignored) {
        }
    }

    private static void deleteFileQuietly(File file) {
        if (file == null) return;
        try {
            if (file.exists() && !file.delete()) {
                Log.w(TAG, "delete file failed: " + file.getName());
            }
        } catch (Exception ignored) {
        }
    }

    // ==================================================================================
    // 签名证书工具
    // ==================================================================================

    private String getSelfCertSha256() {
        if (selfCertSha256 != null) return selfCertSha256;
        try {
            PackageManager pm = getPackageManager();
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? PackageManager.GET_SIGNING_CERTIFICATES
                    : PackageManager.GET_SIGNATURES;
            PackageInfo info = pm.getPackageInfo(getPackageName(), flags);
            Signature[] sigs = extractSignatures(info);
            if (sigs != null && sigs.length > 0) {
                if (sigs.length == 1) {
                    selfCertSha256 = sha256Hex(sigs[0].toByteArray());
                } else {
                    // 多签名包取签名证书集合的确定性指纹（排序后逐个哈希）
                    List<String> hashes = new ArrayList<>();
                    for (Signature sig : sigs) {
                        hashes.add(sha256Hex(sig.toByteArray()));
                    }
                    java.util.Collections.sort(hashes);
                    selfCertSha256 = hashes.get(0);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "read self cert failed", e);
        }
        return selfCertSha256;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] extractSignatures(PackageInfo info) {
        if (info == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signingInfo = info.signingInfo;
            if (signingInfo != null) {
                if (signingInfo.hasMultipleSigners()) {
                    return signingInfo.getApkContentsSigners();
                }
                Signature[] history = signingInfo.getSigningCertificateHistory();
                if (history != null && history.length > 0) return history;
                return signingInfo.getApkContentsSigners();
            }
        }
        return info.signatures;
    }

    private static String sha256Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data);
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format(Locale.US, "%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String calculateFileSha256(File file) {
        FileInputStream fis = null;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            fis = new FileInputStream(file);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = fis.read(buffer)) > 0) {
                digest.update(buffer, 0, read);
            }
            byte[] hash = digest.digest();
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format(Locale.US, "%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "calculate sha256 failed", e);
            return "";
        } finally {
            if (fis != null) {
                try {
                    fis.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /** 冒号分隔的大写 SHA-256 指纹 -> 小写无分隔十六进制；非法返回 null */
    private static String normalizeHexFingerprint(String fingerprint) {
        if (fingerprint == null) return null;
        String hex = fingerprint.replace(":", "").replace(" ", "").trim();
        if (!hex.matches("^[a-fA-F0-9]{64}$")) return null;
        return hex.toLowerCase(Locale.US);
    }

    /** 小写十六进制 -> 大写冒号指纹 */
    private static String toColonFingerprint(String hex) {
        if (hex == null || hex.length() != 64) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < hex.length(); i += 2) {
            if (sb.length() > 0) sb.append(':');
            sb.append(hex.substring(i, i + 2).toUpperCase(Locale.US));
        }
        return sb.toString();
    }

    // ==================================================================================
    // 已安装版本信息
    // ==================================================================================

    private int getInstalledVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) info.getLongVersionCode();
            }
            //noinspection deprecation
            return info.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private String getInstalledVersionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    // ==================================================================================
    // 事件回传（仅 UI 线程调用 webView.evaluateJavascript）
    // ==================================================================================

    private static String describeState(int state) {
        switch (state) {
            case STATE_NEEDS_PERMISSION:
                return "needs_permission";
            case STATE_DOWNLOADING:
                return "downloading";
            case STATE_VERIFYING:
                return "verifying";
            case STATE_READY:
                return "ready";
            case STATE_INSTALLER_OPEN:
                return "installer_open";
            case STATE_INSTALLED:
                return "installed";
            case STATE_CANCELLED:
                return "cancelled";
            case STATE_FAILED:
                return "failed";
            case STATE_UNCONFIRMED:
                return "unconfirmed";
            case STATE_INTERRUPTED:
                return "interrupted";
            case STATE_IDLE:
            default:
                return "idle";
        }
    }

    private void emitBridgeError(String code, String message) {
        String opId = pendingInstallRequest != null ? pendingInstallRequest.optString("operationId", "") : "";
        emitBridgeError(code, message, opId);
    }

    private void emitBridgeError(String code, String message, String operationId) {
        JSONObject evt = new JSONObject();
        try {
            evt.put("type", "bridge_error");
            evt.put("errorCode", code);
            evt.put("message", message);
            if (operationId != null && !operationId.isEmpty()) {
                evt.put("operationId", operationId);
            }
        } catch (Exception ignored) {
        }
        emitBridgeEvent(evt);
        toast(message);
    }

    private static boolean isTerminalEventType(String type) {
        if (type == null) return false;
        switch (type) {
            case "installed":
            case "install_cancelled":
            case "install_failed":
            case "cancelled":
            case "download_failed":
            case "verification_failed":
            case "install_permission_denied":
            case "bridge_error":
                return true;
            default:
                return false;
        }
    }

    private void emitBridgeEvent(final JSONObject event) {
        if (event == null || destroyed) return;
        String type = event.optString("type", "");
        if (isTerminalEventType(type)) {
            lastTerminalEvent = event;
        }
        final String payload = event.toString();
        Runnable deliver = new Runnable() {
            @Override
            public void run() {
                if (destroyed || webView == null) return;
                try {
                    String js = "window.__kaogongAndroidEvent && window.__kaogongAndroidEvent("
                            + JSONObject.quote(payload) + ");";
                    webView.evaluateJavascript(js, new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            // no-op
                        }
                    });
                } catch (Exception e) {
                    Log.w(TAG, "emit bridge event failed", e);
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            deliver.run();
        } else {
            uiHandler.post(deliver);
        }
    }

    private void toast(final String message) {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                try {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                } catch (Exception ignored) {
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            r.run();
        } else {
            uiHandler.post(r);
        }
    }

    // ==================================================================================
    // Activity 生命周期与回调
    // ==================================================================================

    @Override
    protected void onResume() {
        super.onResume();
        if (destroyed) return;

        // 1) 权限设置返回兜底恢复（防止系统未触发 onActivityResult）
        if (nativeUpdateState == STATE_NEEDS_PERMISSION || resumeInstallAfterPermission) {
            if (hasInstallPermission()) {
                if (resumeInstallAfterPermission && pendingInstallRequest != null) {
                    resumeInstallAfterPermission = false;
                    if (pendingVerifiedApk != null && pendingVerifiedApk.exists()) {
                        nativeUpdateState = STATE_READY;
                        launchSystemInstaller(pendingVerifiedApk);
                    } else {
                        handleInstallRequest(pendingInstallRequest);
                    }
                }
            } else {
                nativeUpdateState = STATE_IDLE;
                resumeInstallAfterPermission = false;
                JSONObject evt = new JSONObject();
                try {
                    evt.put("type", "install_permission_denied");
                    evt.put("reason", "denied_by_user");
                    if (pendingInstallRequest != null) {
                        evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                    }
                    evt.put("message", "未授予“安装未知应用”权限，无法完成覆盖更新。可稍后在系统设置中开启后重试");
                } catch (Exception ignored) {
                }
                emitBridgeEvent(evt);
                pendingInstallRequest = null;
            }
            return;
        }

        // 2) 安装器返回兜底恢复与版本校验（防止取消安装后常驻 busy）
        if (nativeUpdateState == STATE_INSTALLER_OPEN || nativeUpdateState == STATE_DOWNLOADING) {
            int currentVersion = getInstalledVersionCode();
            int targetVersion = -1;
            if (pendingInstallRequest != null) {
                targetVersion = pendingInstallRequest.optInt("versionCode", -1);
            }
            if (targetVersion > 0 && currentVersion >= targetVersion) {
                nativeUpdateState = STATE_INSTALLED;
                JSONObject evt = new JSONObject();
                try {
                    evt.put("type", "installed");
                    evt.put("versionCode", currentVersion);
                    if (pendingInstallRequest != null) {
                        evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                    }
                    evt.put("message", "应用已成功安装更新");
                } catch (Exception ignored) {
                }
                emitBridgeEvent(evt);
                deleteUpdateArtifacts();
                pendingInstallRequest = null;
                return;
            }

            if (nativeUpdateState == STATE_INSTALLER_OPEN) {
                long elapsed = System.currentTimeMillis() - installerLaunchTime;
                if (elapsed >= 1000L) {
                    nativeUpdateState = STATE_IDLE;
                    JSONObject evt = new JSONObject();
                    try {
                        evt.put("type", "install_cancelled");
                        if (pendingInstallRequest != null) {
                            evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                        }
                        evt.put("message", "已返回应用，安装流程已重置就绪");
                    } catch (Exception ignored) {
                    }
                    emitBridgeEvent(evt);
                    pendingInstallRequest = null;
                }
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILECHOOSER_RESULTCODE) {
            handleFileChooserResult(resultCode, data);
        } else if (requestCode == INSTALL_PERMISSION_RESULTCODE) {
            handleInstallPermissionResult();
        } else if (requestCode == INSTALL_ACTIVITY_REQUEST_CODE) {
            handleInstallActivityResult(resultCode, data);
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void handleFileChooserResult(int resultCode, Intent data) {
        if (uploadMessage == null) return;
        Uri[] results = null;
        boolean usedCamera = false;
        if (resultCode == Activity.RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                List<Uri> uris = new ArrayList<>();
                for (int i = 0; i < count; i++) {
                    Uri uri = data.getClipData().getItemAt(i).getUri();
                    if (uri != null) uris.add(uri);
                }
                if (!uris.isEmpty()) results = uris.toArray(new Uri[0]);
            } else if (data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            } else if (cameraPhotoUri != null && cameraPhotoFile != null
                    && cameraPhotoFile.exists() && cameraPhotoFile.length() > 0) {
                // 相机拍摄成功时系统返回 data 为 null，输出已在 EXTRA_OUTPUT 指定的 URI
                results = new Uri[]{cameraPhotoUri};
                usedCamera = true;
            }
        }
        uploadMessage.onReceiveValue(results);
        uploadMessage = null;
        if (!usedCamera) {
            cleanupCameraPhotoFile();
        } else {
            // 文件已被 Web 端消费索引，保留本次拍摄文件，清空引用避免下次误删
            cameraPhotoFile = null;
            cameraPhotoUri = null;
        }
    }

    private void handleInstallActivityResult(int resultCode, Intent data) {
        Log.i(TAG, "install activity result: resultCode=" + resultCode);
        if (pendingInstallRequest == null) {
            Log.i(TAG, "ignoring install activity result: no pending install request or already cancelled");
            return;
        }

        String operationId = pendingInstallRequest.optString("operationId", "");
        int targetVersionCode = pendingInstallRequest.optInt("versionCode", -1);
        int currentCode = getInstalledVersionCode();

        // 只有实际安装版本达到目标 (currentCode >= targetVersionCode)，才能声明 installed
        if (targetVersionCode > 0 && currentCode >= targetVersionCode) {
            nativeUpdateState = STATE_INSTALLED;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "installed");
                evt.put("versionCode", currentCode);
                if (!operationId.isEmpty()) {
                    evt.put("operationId", operationId);
                }
                evt.put("message", "应用已成功安装更新");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            deleteUpdateArtifacts();
            pendingInstallRequest = null;
        } else if (resultCode == Activity.RESULT_CANCELED) {
            nativeUpdateState = STATE_IDLE;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "install_cancelled");
                evt.put("resultCode", resultCode);
                if (!operationId.isEmpty()) {
                    evt.put("operationId", operationId);
                }
                evt.put("message", "用户已取消安装或系统安装未完成");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            pendingInstallRequest = null;
        } else if (resultCode == Activity.RESULT_OK) {
            // resultCode 为 RESULT_OK 但实际版本未达到目标，作为安装未完成/失败处理
            nativeUpdateState = STATE_IDLE;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "install_failed");
                evt.put("code", "install_failed_result");
                evt.put("resultCode", resultCode);
                if (!operationId.isEmpty()) {
                    evt.put("operationId", operationId);
                }
                evt.put("retryable", true);
                evt.put("message", "系统安装返回成功但版本未更新至目标版本(" + targetVersionCode + ")");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            pendingInstallRequest = null;
        } else {
            // RESULT_FIRST_USER 或其他非预期返回码，发送明确失败事件并重置为可重试状态
            nativeUpdateState = STATE_IDLE;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "install_failed");
                evt.put("code", "install_failed_result");
                evt.put("resultCode", resultCode);
                if (!operationId.isEmpty()) {
                    evt.put("operationId", operationId);
                }
                evt.put("retryable", true);
                evt.put("message", "系统安装失败（返回码: " + resultCode + "）");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            pendingInstallRequest = null;
        }
    }

    private void handleInstallPermissionResult() {
        boolean granted = hasInstallPermission();
        Log.i(TAG, "install permission result: granted=" + granted);
        if (!granted) {
            resumeInstallAfterPermission = false;
            nativeUpdateState = STATE_IDLE;
            JSONObject evt = new JSONObject();
            try {
                evt.put("type", "install_permission_denied");
                evt.put("reason", "denied_by_user");
                if (pendingInstallRequest != null) {
                    evt.put("operationId", pendingInstallRequest.optString("operationId", ""));
                }
                evt.put("message", "未授予“安装未知应用”权限，无法完成覆盖更新。可稍后在系统设置中开启后重试");
            } catch (Exception ignored) {
            }
            emitBridgeEvent(evt);
            emitBridgeError("install_permission_denied",
                    "未授予“安装未知应用”权限，无法完成覆盖更新。可稍后在系统设置中开启后重试");
            pendingInstallRequest = null;
            return;
        }
        if (resumeInstallAfterPermission && pendingInstallRequest != null) {
            resumeInstallAfterPermission = false;
            if (pendingVerifiedApk != null && pendingVerifiedApk.exists()) {
                nativeUpdateState = STATE_READY;
                launchSystemInstaller(pendingVerifiedApk);
            } else {
                handleInstallRequest(pendingInstallRequest);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("window.handleBack ? window.handleBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("true".equals(value)) {
                    // 网页端弹窗或多级视图已消费此次返回操作
                    return;
                }
                if (webView == null) return;
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                if (System.currentTimeMillis() - backPressedTime > 2000) {
                    Toast.makeText(MainActivity.this, "再按一次退出考公工作台", Toast.LENGTH_SHORT).show();
                    backPressedTime = System.currentTimeMillis();
                } else {
                    finish();
                }
            }
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
