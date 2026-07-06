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

## Gradle 配置

工程根目录 `gradle.properties` 已启用 AndroidX：

```properties
android.useAndroidX=true
android.enableJetifier=true
```

这是 `androidx.core:core` 等 AndroidX 依赖构建所需配置。

## 如何从 GitHub Actions 下载 APK

当前仓库提供 GitHub Actions workflow：

```text
.github/workflows/android-webview-apk.yml
```

触发方式：

- 手动触发：GitHub 仓库页面进入 `Actions`，选择 `Android WebView APK`，点击 `Run workflow`。
- 自动触发：push 到 `main` 且 `android-webview-app/**` 或 workflow 文件发生变化。

下载方式：

1. 打开 GitHub 仓库的 `Actions` 页面。
2. 进入最新一次 `Android WebView APK` 构建。
3. 在页面底部 `Artifacts` 中下载：

```text
hongmeng-workorder-webview-debug-apk
```

当前产物是 debug APK，用于现场安装验证。debug APK 未做正式发布签名，后续如需长期分发，再新增正式签名包流程。签名证书、keystore、密码和 token 不提交到仓库。

## 如何安装到平板

1. 将 APK 复制到平板。
2. 如系统提示，先允许安装未知来源应用。
3. 打开 APK 并允许安装。
4. 桌面出现“工单资料库”后启动应用。
5. 使用线上账号登录。

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

## PDF 预览兼容说明

APK WebView 会在默认 User-Agent 后追加：

```text
HongmengWorkorderWebView/1.0
```

页面加载时也会注入：

```js
window.__HONGMENG_WEBVIEW__ = true
```

Web 端 PDF 组件检测到该标识后，会优先使用同源 content API 拉取 PDF `ArrayBuffer`，再交给 PDF.js 渲染，减少 worker、Cookie、签名链接或 WebView 内核差异造成的加载失败。

如果当前平板 WebView 仍无法预览某个 PDF，页面会提供：

- 重新加载
- 下载 PDF
- 用系统打开

下载走系统 `DownloadManager`。用系统打开会先访问同源预览接口，由 Web 端带登录态生成临时文件链接，再交给系统处理。

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
