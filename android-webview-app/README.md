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

1. 如已安装旧 APK，建议先卸载旧版本。
2. 将最新 APK 复制到平板。
3. 如系统提示，先允许安装未知来源应用。
4. 打开 APK 并允许安装。
5. 桌面出现“工单资料库”后启动应用。
6. 使用线上账号登录。

APK 不内置账号、密码、token、数据库连接串、S3 Key 或 SESSION_SECRET。

## 权限说明

- `INTERNET`：访问线上 Web 系统。
- `CAMERA`：支持拍照上传。
- `READ_MEDIA_IMAGES`：兼容图片选择。
- `READ_EXTERNAL_STORAGE`：兼容低版本文件选择。
- `WRITE_EXTERNAL_STORAGE`：兼容低版本下载保存。

不申请麦克风权限。当前 APK 内语音输入如果 WebView 不支持 Web Speech API，会提示使用键盘输入。

## APK 支持的设备能力

- 文件选择：支持 PDF、图片和普通文件选择。
- 多选：Web 页面 input 支持 multiple 时，壳层允许多选。
- 拍照上传：`accept=image/*` 且 Web 页面请求 capture 时，会优先调起系统相机。
- 下载：使用系统 `DownloadManager`，下载完成后显示系统通知。
- PDF 系统打开：PDF 预览失败时可下载或调起系统处理。
- 剪贴板：提供 `AndroidBridge.copyText`，Web 端复制链接优先走壳层剪贴板。
- 返回键：WebView 可后退时返回上一页；不能后退时双击退出。
- 诊断能力：提供 `AndroidBridge.getCapabilities()`，用于排查文件选择、相机、下载、剪贴板和语音能力。
- 横屏锁定：APK 主界面锁定横屏，拍照或文件选择返回后恢复横屏。

## 文件上传 / 拍照 / 下载说明

- WebView 开启 JavaScript 和 DOM Storage。
- 文件上传使用系统文件选择器。
- `accept=image/*` 时提供图片选择和拍照入口。
- `accept=application/pdf` 时提供文件选择入口。
- 拍照上传依赖 Android `CAMERA` 权限；首次使用时需要允许。
- Web 页面调用 `navigator.mediaDevices.getUserMedia` 时，APK 壳会在白名单域名下转接摄像头授权。
- APK 内拍照上传优先使用网页内摄像头预览，系统相机仅作为 fallback。
- 大尺寸图片上传前会在 Web 端尝试压缩优化，减少现场网络卡顿。
- 下载使用系统 `DownloadManager`，不会静默失败；如系统下载服务不可用，会尝试调起系统浏览器。

拍照上传测试方法：

1. 打开 APK 并登录。
2. 选择一个工单和图片分类。
3. 点击“拍照上传”。
4. 首次使用时允许相机权限。
5. 确认先出现网页内相机预览；如不可用，再使用系统相机 fallback。
6. 拍照确认后等待上传完成。
7. 回到资料库确认图片方向正确且能预览。

下载测试方法：

1. 打开一个 PDF 或图片资料。
2. 点击“下载当前”。
3. 确认系统下载通知出现。
4. 打开系统下载目录验证文件存在。

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

针对部分 Android WebView 缺少 `Promise.withResolvers` 的情况，Web 端会在加载 PDF.js 之前注入兼容 polyfill，并优先使用 `pdfjs-dist/legacy` 构建和同源 legacy worker。这样可以避免新版 PDF.js 在老 WebView 中初始化失败。

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
2. 在系统设置中确认“工单资料库”已允许相机权限。
3. 确认已卸载旧 APK 并安装 GitHub Actions 最新 debug APK。
4. 重新打开文件选择。
5. 如系统相机不可用，可改用“上传图片”选择本地照片。
3. 确认 Web 页面上传入口接受图片类型。
4. 如权限被拒绝，在系统设置中重新允许相机权限，或改用“上传图片”。

如果下载失败：

1. 检查系统下载管理器是否可用。
2. 检查存储权限。
3. 用浏览器打开同一文件下载链接验证。

如果语音输入不可用：

1. 当前 APK 仅做 Web Speech API 降级提示。
2. 使用键盘输入。
3. 后续如需原生语音识别，再单独增加 Android SpeechRecognizer。
