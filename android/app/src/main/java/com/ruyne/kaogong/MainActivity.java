package com.ruyne.kaogong;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * 考公工作台 · Android WebView 生产宿主容器
 *
 * 安全规范：
 * 1. 严格校验 SSL 证书，严禁通过 bypass 忽略证书错误；
 * 2. 严禁允许明文 HTTP 混合加载 (MIXED_CONTENT_NEVER_ALLOW)；
 * 3. 拦截 Android 物理返回键，优先交付网页端弹窗与多级视图处理 (window.handleBack)；
 * 4. 离线依赖 Service Worker 本地持久化缓存，保障断网环境冷启动与查看。
 */
public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;
    private final static int FILECHOOSER_RESULTCODE = 101;
    private long backPressedTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        initWebViewSettings();
        initWebViewClients();

        String targetUrl = getString(R.string.cloud_url);
        webView.loadUrl(targetUrl);
    }

    private void initWebViewSettings() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // 离线优先与 Service Worker 缓存策略
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

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
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // 生产环境安全合规：严格拦截不安全证书，绝不盲目 proceed()
                handler.cancel();
                Toast.makeText(MainActivity.this, "安全提示：服务器 SSL 证书验证失败，已阻止连接", Toast.LENGTH_LONG).show();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    // 主页面加载网络异常时，由 Service Worker 接管并呈现离线缓存
                    // 此处不强制跳转非同源的本地 file scheme，以保持 IndexedDB 账号分区环境一致
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // 支持错题照片选择与头像上传
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                uploadMessage = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILECHOOSER_RESULTCODE);
                } catch (Exception e) {
                    uploadMessage = null;
                    return false;
                }
                return true;
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILECHOOSER_RESULTCODE) {
            if (uploadMessage != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    } else if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                uploadMessage.onReceiveValue(results);
                uploadMessage = null;
            }
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * 物理返回键处理规范：
     * 1. 优先调用网页端 window.handleBack() 关闭弹窗或返回上级子页；
     * 2. 若网页无弹窗且未在首页，执行 WebView 回退；
     * 3. 若已在首页，两秒内双击退出应用。
     */
    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.handleBack ? window.handleBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("true".equals(value)) {
                    // 网页端弹窗或多级视图已消费此次返回操作
                    return;
                }

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
