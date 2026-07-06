# Android WebView APK 设备能力 QA

## 版本

v1.13.2-tablet-apk-device-bridge

## 修复范围

本次只补齐 Android WebView APK 壳设备能力，不修改数据库、不修改 Prisma schema、不修改 Sealos 环境变量、不恢复 DevEco / Harmony ArkTS 工程、不恢复 `/api/native`。

APK 仍只加载：

```text
https://qdowqencjyph.sealoshzh.site/dashboard
```

## 定位结论

当前 APK 壳此前已具备基础 WebView、DownloadManager、FileProvider、文件选择和剪贴板桥接，但缺少完整的 `WebChromeClient.onPermissionRequest`，导致 Web 页面通过 `navigator.mediaDevices.getUserMedia` 调用摄像头时无法稳定授权。

本次补齐：

- `onShowFileChooser`：PDF、图片、拍照 capture、多选、取消回调和连续选择。
- `onPermissionRequest`：白名单域名下的 getUserMedia 摄像头授权。
- `onRequestPermissionsResult`：区分 file chooser 拍照权限和 getUserMedia 权限。
- FileProvider 路径：cache、files、external cache、Pictures、Download。
- AndroidBridge 能力状态：文件选择、拍照、getUserMedia、下载、剪贴板、语音兜底。
- Web 端 APK 环境拍照：优先触发 `input accept=image/* capture=environment`。

## 权限与 Manifest 检查

- `INTERNET`：已声明。
- `CAMERA`：已声明，用于拍照上传和 getUserMedia 视频授权。
- `READ_MEDIA_IMAGES`：已声明，用于 Android 13+ 图片选择兼容。
- `READ_EXTERNAL_STORAGE`：`maxSdkVersion=32`，用于旧系统文件选择兼容。
- `WRITE_EXTERNAL_STORAGE`：`maxSdkVersion=28`，用于旧系统下载保存兼容。
- `RECORD_AUDIO`：未声明。本轮不实现 Android 原生语音识别，不额外请求麦克风权限。
- `android:usesCleartextTraffic="false"`：已配置。
- `android:hardwareAccelerated="true"`：已配置。
- FileProvider authorities：`${applicationId}.fileprovider`。

## 文件选择验收

### 上传 PDF

1. 打开 APK 并登录。
2. 进入工单资料库，选择工单和分类。
3. 点击“上传 PDF”。
4. 系统文件选择器打开。
5. 只能选择 PDF 或可识别的 PDF 文件。
6. 取消选择后，再次点击仍能打开。
7. 选择文件后进入上传队列并上传成功。

### 上传图片

1. 点击“上传图片”。
2. 系统图片 / 文件选择器打开。
3. 支持选择 JPG / PNG。
4. 支持 Web 页面 multiple 时多选。
5. 取消选择后，再次点击仍能打开。
6. 选择后进入上传队列并上传成功。

## 拍照上传验收

### input capture 拍照

1. 点击“拍照上传”。
2. APK WebView 环境下优先触发隐藏 input：

```html
<input type="file" accept="image/*" capture="environment">
```

3. 首次使用时系统请求相机权限。
4. 允许权限后调起系统相机。
5. 拍照确认后图片进入上传队列。
6. 上传成功后能在当前分类预览。

### getUserMedia 摄像头授权

普通浏览器继续使用 Web 端拍照弹窗和 `navigator.mediaDevices.getUserMedia`。

APK 壳已实现 `WebChromeClient.onPermissionRequest`：

- 只允许白名单域名 `qdowqencjyph.sealoshzh.site`。
- 仅授权 `PermissionRequest.RESOURCE_VIDEO_CAPTURE`。
- 如果系统相机权限未授予，会请求 Android `CAMERA` runtime permission。
- 用户同意后执行 `request.grant(request.getResources())`。
- 用户拒绝后执行 `request.deny()` 并 Toast 提示。

## 权限拒绝场景

1. 首次拍照上传时拒绝相机权限。
2. 页面必须提示：

```text
摄像头权限被拒绝，请在系统设置中开启或使用上传图片。
```

3. 文件选择回调必须释放。
4. 再次点击上传或拍照不应卡死。
5. 用户可改用“上传图片”完成业务。

## 下载验收

### 下载当前文件

1. 打开 PDF 或图片资料。
2. 点击下载。
3. APK 壳通过系统 `DownloadManager` 下载。
4. 下载请求携带 Cookie 和 User-Agent。
5. 系统通知显示下载完成。

### 下载全部 ZIP

1. 选择包含多个文件的工单。
2. 点击“下载全部”。
3. ZIP 下载进入系统下载管理。
4. 文件名应为工单资料包。
5. 下载失败时必须 Toast 提示，不允许静默失败。

## PDF 系统打开验收

1. 打开 PDF 资料。
2. 点击“用系统打开”。
3. 如果系统有 PDF 阅读器，应调起系统处理。
4. 如果没有 PDF 阅读器，应提示：

```text
未找到可打开 PDF 的应用，请先下载文件。
```

PDF 预览仍优先使用 Web PDF.js；系统打开只是兜底。

## 剪贴板复制验收

- APK 壳提供 `AndroidBridge.copyText(String text)`。
- Web 端复制工单链接和连接器参数时优先走 AndroidBridge。
- 成功后 Toast：`已复制`。
- 不复制账号密码、token、数据库连接串或对象存储密钥。

## 返回键验收

- WebView 可以后退时，返回键执行 `webView.goBack()`。
- WebView 不能后退时，首次返回提示“再按一次退出工单资料库”。
- 2 秒内再次返回才退出 App。

## 壳能力诊断

APK 壳提供：

```js
AndroidBridge.getCapabilities()
```

返回 JSON 字符串，包含：

- `webView`
- `fileChooser`
- `cameraCapture`
- `getUserMediaPermission`
- `downloadManager`
- `clipboard`
- `speech`
- `userAgent`

Web 系统设置中会显示“平板 App 能力”，用于现场确认文件选择、拍照、摄像头授权、下载和剪贴板桥接是否可用。

## 语音输入降级

- 当前 APK 不新增麦克风权限，不实现 Android 原生语音识别。
- 如果 WebView 不支持 Web Speech API，语音按钮会显示：

```text
当前 APK 暂不支持语音输入，请使用键盘输入。
```

- 用户可继续手动输入，不影响业务流程。

## 平板实机验收清单

1. 等待 GitHub Actions 构建最新 debug APK。
2. 卸载旧 APK。
3. 安装新 APK。
4. 打开 APK，确认无浏览器地址栏。
5. 登录成功。
6. 上传 PDF 成功。
7. 上传图片成功。
8. 拍照上传调起系统相机。
9. getUserMedia 摄像头授权可通过。
10. 拒绝相机权限时提示清楚，且上传按钮不会卡死。
11. 下载当前 PDF / 图片成功。
12. 下载全部 ZIP 成功。
13. PDF “用系统打开”可用或有明确无阅读器提示。
14. 复制工单链接成功。
15. 连接器参数复制整行成功。
16. 语音输入不可用时提示使用键盘输入。
17. 返回键先返回上一页，不能返回时双击退出。
18. 系统设置中可看到“平板 App 能力”。

## 已知问题

- 本机缺少 Android SDK / Gradle 环境，APK 构建需要 GitHub Actions 验证。
- 不同鸿蒙平板内置 WebView、系统文件选择器和系统相机实现可能存在差异，需要实机验收。
- 当前不做 Android 原生语音识别。

本文档不包含数据库密码、对象存储密钥、SESSION_SECRET、admin 密码、token 或任何真实生产密码。
