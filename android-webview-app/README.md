# 工单资料库 Android WebView 壳

## 项目用途

该工程用于生成 Android APK。APK 安装到支持 Android 应用的鸿蒙平板后，以全屏 WebView 打开现有 Web 系统，减少浏览器地址栏和标签栏干扰。

该工程不是 DevEco ArkTS / ArkUI 原生工程，也不是 Web 后端替代品。

## 默认 Web 地址

```text
https://qdowqencjyph.sealoshzh.site/dashboard
```

白名单域名：

```text
qdowqencjyph.sealoshzh.site
```

## 如何构建 APK

推荐使用 Android Studio：

1. 打开 `android-webview-app/`。
2. 等待 Gradle Sync 完成。
3. 执行 `Build > Build Bundle(s) / APK(s) > Build APK(s)`。
4. 生成文件通常位于：

```text
android-webview-app/app/build/outputs/apk/debug/app-debug.apk
```

如果本机已安装 Android Gradle 环境，也可以执行：

```bash
cd android-webview-app
gradle :app:assembleDebug
```

本仓库不提交 Android Studio 本地配置、签名文件、`local.properties` 或构建产物。

## 如何安装到平板

1. 将 APK 复制到平板。
2. 打开 APK 并允许安装。
3. 桌面出现“工单资料库”后启动应用。
4. 使用线上账号登录。

APK 不内置账号、密码、token、数据库连接串、S3 Key 或 SESSION_SECRET。

## 权限说明

- `INTERNET`：访问线上 Web 系统。
- `CAMERA`：支持拍照上传。
- `READ_MEDIA_IMAGES`：兼容图片选择。
- `READ_EXTERNAL_STORAGE`：兼容低版本文件选择。
- `WRITE_EXTERNAL_STORAGE`：兼容低版本下载保存。

## 文件上传 / 拍照 / 下载说明

- WebView 开启 JavaScript 和 DOM Storage。
- 文件上传使用系统文件选择器。
- `accept=image/*` 时提供图片选择和拍照入口。
- `accept=application/pdf` 时提供文件选择入口。
- 下载使用系统 `DownloadManager`，不会静默失败；如系统下载服务不可用，会尝试调起系统浏览器。

## 白名单域名说明

APK 只允许在 WebView 内加载：

```text
qdowqencjyph.sealoshzh.site
```

其他域名不会直接在壳内打开，用户确认后才会交给系统浏览器。

## 常见问题

如果页面无法打开：

1. 检查平板网络。
2. 用浏览器直接打开线上地址。
3. 确认 Sealos 服务正常。
4. 确认设备时间正确，避免 HTTPS 证书校验失败。

如果拍照上传不可用：

1. 检查相机权限。
2. 重新打开文件选择。
3. 确认 Web 页面上传入口接受图片类型。

如果下载失败：

1. 检查系统下载管理器是否可用。
2. 检查存储权限。
3. 用浏览器打开同一文件下载链接验证。
