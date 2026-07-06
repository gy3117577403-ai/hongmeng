package com.factory.workorder.webapp;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
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
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
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
import java.util.List;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int CAMERA_PERMISSION_REQUEST = 1002;
    private static final int MEDIA_PERMISSION_REQUEST = 1003;
    private static final long EXIT_INTERVAL_MS = 2000L;

    private WebView webView;
    private View loadingOverlay;
    private View errorOverlay;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermissionRequest;
    private Uri cameraImageUri;
    private String[] pendingAcceptTypes;
    private boolean pendingAllowMultiple;
    private long lastBackPressedAt;

    private String startUrl;
    private String allowedHost;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        lockLandscape();
        startUrl = getString(R.string.web_url);
        allowedHost = getString(R.string.allowed_host);
        configureWindow();
        createLayout();
        configureWebView();
        showLoading(true);
        webView.loadUrl(startUrl);
    }

    private void configureWindow() {
        lockLandscape();
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

    private void lockLandscape() {
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
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
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
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
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
    }

    private DownloadListener createDownloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri uri = resolveDownloadUri(url);
            if (!isAllowedUri(uri)) {
                confirmExternalOpen(uri);
                return;
            }

            try {
                DownloadManager.Request request = new DownloadManager.Request(uri);
                String fileName = URLUtil.guessFileName(uri.toString(), contentDisposition, mimeType);
                String cookies = CookieManager.getInstance().getCookie(uri.toString());
                request.setTitle(fileName);
                request.setDescription("工单资料库文件下载");
                if (mimeType != null && mimeType.length() > 0) {
                    request.setMimeType(mimeType);
                }
                request.addRequestHeader("User-Agent", userAgent != null && userAgent.length() > 0 ? userAgent : webView.getSettings().getUserAgentString());
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

    private Uri resolveDownloadUri(String url) {
        Uri uri = Uri.parse(url);
        if (uri.getScheme() != null) {
            return uri;
        }
        Uri base = Uri.parse(startUrl);
        Uri relative = Uri.parse(url.startsWith("/") ? url : "/" + url);
        return base.buildUpon()
            .encodedPath(relative.getEncodedPath())
            .encodedQuery(relative.getEncodedQuery())
            .encodedFragment(relative.getEncodedFragment())
            .build();
    }

    private boolean isAllowedUri(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
            && allowedHost.equalsIgnoreCase(host);
    }

    private void injectWebViewFlag(WebView view) {
        String script = "window.__HONGMENG_WEBVIEW__=true;"
            + "window.__HONGMENG_APK_CAPABILITIES__=window.AndroidBridge&&window.AndroidBridge.getCapabilities?window.AndroidBridge.getCapabilities():'';";
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
            String target = uri.toString().toLowerCase();
            String message = target.contains("pdf") ? "未找到可打开 PDF 的应用，请先下载文件。" : "未找到可打开链接的应用";
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        }
    }

    private void showLoading(boolean visible) {
        loadingOverlay.setVisibility(visible ? View.VISIBLE : View.GONE);
    }

    private void showError(boolean visible) {
        errorOverlay.setVisibility(visible ? View.VISIBLE : View.GONE);
    }

    private boolean hasCamera() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
    }

    private String safeJson(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void copyText(String text) {
            if (text == null) {
                return;
            }
            runOnUiThread(() -> {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("工单资料库", text));
                    Toast.makeText(MainActivity.this, "已复制", Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(MainActivity.this, "剪贴板不可用，请手动复制", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String getCapabilities() {
            String userAgent = webView != null ? webView.getSettings().getUserAgentString() : "";
            return "{"
                + "\"fileChooser\":true,"
                + "\"webView\":true,"
                + "\"cameraCapture\":" + (hasCamera() ? "true" : "false") + ","
                + "\"getUserMediaPermission\":true,"
                + "\"downloadManager\":true,"
                + "\"clipboard\":true,"
                + "\"speech\":false,"
                + "\"userAgent\":\"" + safeJson(userAgent) + "\""
                + "}";
        }
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
            pendingAcceptTypes = fileChooserParams.getAcceptTypes();
            pendingAllowMultiple = fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;

            boolean wantsImage = acceptsImage(pendingAcceptTypes);
            boolean captureOnly = fileChooserParams.isCaptureEnabled() && wantsImage;
            if (captureOnly && launchCameraOrRequestPermission()) {
                return true;
            }

            return launchFileChooser(pendingAcceptTypes, pendingAllowMultiple, wantsImage);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handleWebPermissionRequest(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingPermissionRequest == request) {
                pendingPermissionRequest = null;
            }
        }
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        if (!isAllowedUri(request.getOrigin())) {
            request.deny();
            return;
        }

        String[] resources = request.getResources();
        if (resources == null || resources.length == 0) {
            request.deny();
            return;
        }
        boolean needsVideo = false;
        boolean needsAudio = false;
        boolean unsupported = false;
        for (String resource : resources) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                needsVideo = true;
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                needsAudio = true;
            } else {
                unsupported = true;
            }
        }

        if (unsupported) {
            request.deny();
            return;
        }

        if (needsAudio) {
            request.deny();
            Toast.makeText(this, "当前 App 壳暂不支持语音输入，请使用键盘输入。", Toast.LENGTH_LONG).show();
            return;
        }

        if (needsVideo && !hasCamera()) {
            request.deny();
            Toast.makeText(this, "未检测到可用相机，请使用上传图片。", Toast.LENGTH_LONG).show();
            return;
        }

        if (needsVideo && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (pendingPermissionRequest != null) {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, MEDIA_PERMISSION_REQUEST);
            return;
        }

        request.grant(resources);
    }

    private boolean launchCameraOrRequestPermission() {
        if (!hasCamera()) {
            Toast.makeText(this, "未检测到可用相机，请选择本地图片", Toast.LENGTH_SHORT).show();
            return false;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
                return true;
            }
        }
        Intent cameraIntent = createCameraIntent();
        if (cameraIntent == null) {
            Toast.makeText(this, "相机不可用，请选择本地图片", Toast.LENGTH_SHORT).show();
            return false;
        }
        try {
            startActivityForResult(cameraIntent, FILE_CHOOSER_REQUEST);
            return true;
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, "相机不可用，请选择本地图片", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    private boolean launchFileChooser(String[] acceptTypes, boolean allowMultiple, boolean includeCamera) {
        Intent contentIntent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT
            ? new Intent(Intent.ACTION_OPEN_DOCUMENT)
            : new Intent(Intent.ACTION_GET_CONTENT);
        contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
        contentIntent.setType(resolveMimeType(acceptTypes));
        String[] mimeTypes = mimeTypesFor(acceptTypes);
        if (mimeTypes.length > 0) {
            contentIntent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        }
        contentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple);
        contentIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        Intent chooser = new Intent(Intent.ACTION_CHOOSER);
        chooser.putExtra(Intent.EXTRA_INTENT, contentIntent);
        chooser.putExtra(Intent.EXTRA_TITLE, "选择工单资料");

        ArrayList<Intent> initialIntents = new ArrayList<>();
        if (includeCamera) {
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
            return true;
        } catch (ActivityNotFoundException exception) {
            releaseFileCallback(null);
            Toast.makeText(this, "未找到文件选择器", Toast.LENGTH_SHORT).show();
            return false;
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

    private String[] mimeTypesFor(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) {
            return new String[0];
        }
        ArrayList<String> types = new ArrayList<>();
        for (String type : acceptTypes) {
            if (type == null || type.length() == 0 || "*/*".equals(type)) {
                return new String[0];
            }
            if ("image/*".equals(type) || "application/pdf".equals(type)) {
                types.add(type);
            }
        }
        return types.toArray(new String[0]);
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
            List<ResolveInfo> activities = getPackageManager().queryIntentActivities(cameraIntent, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo activity : activities) {
                grantUriPermission(activity.activityInfo.packageName, cameraImageUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            }
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

    private void releaseFileCallback(Uri[] results) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(results);
        }
        fileCallback = null;
        cameraImageUri = null;
        pendingAcceptTypes = null;
        pendingAllowMultiple = false;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        lockLandscape();
        hideSystemBars();
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

        releaseFileCallback(results);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        lockLandscape();
        hideSystemBars();
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                if (!launchCameraOrRequestPermission()) {
                    launchFileChooser(pendingAcceptTypes, pendingAllowMultiple, true);
                }
            } else {
                releaseFileCallback(null);
                Toast.makeText(this, "摄像头权限被拒绝，请在系统设置中开启权限或使用上传图片。", Toast.LENGTH_LONG).show();
            }
            return;
        }

        if (requestCode == MEDIA_PERMISSION_REQUEST) {
            PermissionRequest request = pendingPermissionRequest;
            pendingPermissionRequest = null;
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (request == null) {
                return;
            }
            if (granted) {
                request.grant(request.getResources());
            } else {
                request.deny();
                Toast.makeText(this, "摄像头权限被拒绝，请在系统设置中开启或使用上传图片。", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt > EXIT_INTERVAL_MS) {
            lastBackPressedAt = now;
            Toast.makeText(this, "再按一次退出工单资料库", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            lockLandscape();
            hideSystemBars();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        lockLandscape();
        hideSystemBars();
        if (webView != null) {
            webView.onResume();
        }
    }
}
