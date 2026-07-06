package com.factory.workorder.webapp;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int CAMERA_PERMISSION_REQUEST = 1002;

    private WebView webView;
    private View loadingOverlay;
    private View errorOverlay;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraImageUri;

    private String startUrl;
    private String allowedHost;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startUrl = getString(R.string.web_url);
        allowedHost = getString(R.string.allowed_host);
        configureWindow();
        createLayout();
        configureWebView();
        showLoading(true);
        webView.loadUrl(startUrl);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        hideSystemBars();
    }

    private void hideSystemBars() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void createLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(255, 247, 237));

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        loadingOverlay = createMessageOverlay("工单资料库", "加载中...");
        root.addView(loadingOverlay);

        errorOverlay = createErrorOverlay();
        errorOverlay.setVisibility(View.GONE);
        root.addView(errorOverlay);

        setContentView(root);
    }

    private View createMessageOverlay(String title, String message) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.rgb(255, 247, 237));

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.rgb(31, 41, 55));
        titleView.setTextSize(26);
        titleView.setGravity(Gravity.CENTER);

        TextView messageView = new TextView(this);
        messageView.setText(message);
        messageView.setTextColor(Color.rgb(113, 63, 18));
        messageView.setTextSize(16);
        messageView.setGravity(Gravity.CENTER);
        messageView.setPadding(0, 18, 0, 0);

        box.addView(titleView);
        box.addView(messageView);
        return box;
    }

    private View createErrorOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.rgb(255, 247, 237));

        TextView titleView = new TextView(this);
        titleView.setText("网络不可用");
        titleView.setTextColor(Color.rgb(31, 41, 55));
        titleView.setTextSize(24);
        titleView.setGravity(Gravity.CENTER);

        TextView messageView = new TextView(this);
        messageView.setText("网络不可用，请检查连接或稍后重试");
        messageView.setTextColor(Color.rgb(113, 63, 18));
        messageView.setTextSize(16);
        messageView.setGravity(Gravity.CENTER);
        messageView.setPadding(0, 16, 0, 24);

        Button retryButton = new Button(this);
        retryButton.setText("重新加载");
        retryButton.setTextColor(Color.WHITE);
        retryButton.setBackgroundColor(Color.rgb(255, 106, 0));
        retryButton.setOnClickListener(view -> {
            showError(false);
            showLoading(true);
            webView.reload();
        });

        box.addView(titleView);
        box.addView(messageView);
        box.addView(retryButton);
        return box;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        String baseUserAgent = settings.getUserAgentString();
        if (baseUserAgent == null) {
            baseUserAgent = "";
        }
        if (!baseUserAgent.contains("HongmengWorkorderWebView")) {
            settings.setUserAgentString(baseUserAgent + " HongmengWorkorderWebView/1.0");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new SafeWebViewClient());
        webView.setWebChromeClient(new UploadChromeClient());
        webView.setDownloadListener(createDownloadListener());
    }

    private DownloadListener createDownloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri uri = Uri.parse(url);
            if (!isAllowedUri(uri)) {
                confirmExternalOpen(uri);
                return;
            }

            try {
                DownloadManager.Request request = new DownloadManager.Request(uri);
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                String cookies = CookieManager.getInstance().getCookie(url);
                request.setTitle(fileName);
                request.setDescription("工单资料库文件下载");
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                if (cookies != null) {
                    request.addRequestHeader("Cookie", cookies);
                }
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) {
                    manager.enqueue(request);
                    Toast.makeText(this, "已开始下载", Toast.LENGTH_SHORT).show();
                } else {
                    openExternal(uri);
                }
            } catch (Exception exception) {
                Toast.makeText(this, "下载无法启动，将尝试使用系统浏览器", Toast.LENGTH_SHORT).show();
                openExternal(uri);
            }
        };
    }

    private boolean isAllowedUri(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
            && allowedHost.equalsIgnoreCase(host);
    }

    private void injectWebViewFlag(WebView view) {
        String script = "window.__HONGMENG_WEBVIEW__=true;";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            view.evaluateJavascript(script, null);
        } else {
            view.loadUrl("javascript:" + script);
        }
    }

    private void confirmExternalOpen(Uri uri) {
        new AlertDialog.Builder(this)
            .setTitle("打开外部链接")
            .setMessage("此链接不属于工单资料库，是否使用系统浏览器打开？")
            .setPositiveButton("打开", (dialog, which) -> openExternal(uri))
            .setNegativeButton("取消", null)
            .show();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, "未找到可打开链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private void showLoading(boolean visible) {
        loadingOverlay.setVisibility(visible ? View.VISIBLE : View.GONE);
    }

    private void showError(boolean visible) {
        errorOverlay.setVisibility(visible ? View.VISIBLE : View.GONE);
    }

    private final class SafeWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAllowedUri(uri)) {
                return false;
            }
            confirmExternalOpen(uri);
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isAllowedUri(uri)) {
                return false;
            }
            confirmExternalOpen(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            showError(false);
            injectWebViewFlag(view);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            injectWebViewFlag(view);
            showLoading(false);
            hideSystemBars();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame()) {
                showLoading(false);
                showError(true);
            }
        }
    }

    private final class UploadChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(null);
            }
            fileCallback = filePathCallback;

            Intent contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            contentIntent.setType(resolveMimeType(fileChooserParams.getAcceptTypes()));

            Intent chooser = new Intent(Intent.ACTION_CHOOSER);
            chooser.putExtra(Intent.EXTRA_INTENT, contentIntent);
            chooser.putExtra(Intent.EXTRA_TITLE, "选择工单资料");

            ArrayList<Intent> initialIntents = new ArrayList<>();
            if (acceptsImage(fileChooserParams.getAcceptTypes())) {
                Intent cameraIntent = createCameraIntent();
                if (cameraIntent != null) {
                    initialIntents.add(cameraIntent);
                }
            }

            if (!initialIntents.isEmpty()) {
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, initialIntents.toArray(new Intent[0]));
            }

            try {
                startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
            } catch (ActivityNotFoundException exception) {
                fileCallback = null;
                Toast.makeText(MainActivity.this, "未找到文件选择器", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    private String resolveMimeType(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) {
            return "*/*";
        }
        boolean imageOnly = false;
        boolean pdfOnly = false;
        for (String type : acceptTypes) {
            if (type == null || type.length() == 0 || "*/*".equals(type)) {
                return "*/*";
            }
            if (type.startsWith("image/")) {
                imageOnly = true;
            } else if ("application/pdf".equals(type)) {
                pdfOnly = true;
            } else {
                return "*/*";
            }
        }
        if (imageOnly && !pdfOnly) {
            return "image/*";
        }
        if (pdfOnly && !imageOnly) {
            return "application/pdf";
        }
        return "*/*";
    }

    private boolean acceptsImage(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) {
            return true;
        }
        for (String type : acceptTypes) {
            if (type == null || type.length() == 0 || "*/*".equals(type) || type.startsWith("image/")) {
                return true;
            }
        }
        return false;
    }

    private Intent createCameraIntent() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
            }
            return null;
        }

        Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (cameraIntent.resolveActivity(getPackageManager()) == null) {
            return null;
        }

        try {
            File imageFile = createImageFile();
            cameraImageUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", imageFile);
            cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraImageUri);
            cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return cameraIntent;
        } catch (IOException exception) {
            Toast.makeText(this, "相机临时文件创建失败", Toast.LENGTH_SHORT).show();
            return null;
        }
    }

    private File createImageFile() throws IOException {
        File directory = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (directory == null) {
            directory = getCacheDir();
        }
        return File.createTempFile("workorder-camera-", ".jpg", directory);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) {
            return;
        }

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (data == null || data.getData() == null) {
                if (cameraImageUri != null) {
                    results = new Uri[]{cameraImageUri};
                }
            } else if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else {
                results = new Uri[]{data.getData()};
            }
        }

        fileCallback.onReceiveValue(results);
        fileCallback = null;
        cameraImageUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Toast.makeText(this, granted ? "相机权限已允许，请重新选择拍照上传" : "未授予相机权限，可继续选择本地文件", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }
}
