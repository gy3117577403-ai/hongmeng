# Android WebView APK 设备能力 QA

## 版本

v1.13.1-tablet-apk-device-fix

## 修复范围

本次只补齐 Android WebView APK 壳设备能力，不修改数据库、不修改 Prisma schema、不修改 Sealos 环境变量、不恢复 DevEco / Harmony ArkTS 工程、不恢复 `/api/native`。

APK 仍只加载：

```text
https://qdowqencjyph.sealoshzh.site/dashboard
```

## 拍照上传修复说明

- `onShowFileChooser` 检测 `fileChooserParams.isCaptureEnabled()` 和 `accept=image/*`。
- 拍照场景优先请求 `CAMERA` 权限。
- 使用 `ACTION_IMAGE_CAPTURE` 调起系统相机。
- 使用 FileProvider 生成 `content://` 临时图片 URI。
- 拍照完成后把图片 URI 回传给 WebView。
- 权限被拒绝时释放 WebView file callback，并提示用户去系统设置开启权限或改用上传图片。

## 文件选择修复说明

- PDF：`application/pdf` 调起系统文件选择器。
- 图片：`image/*` 调起图库 / 文件选择器。
- 支持 `multiple` 时允许多选。
- 用户取消选择时回调 `null`，避免下一次文件选择无法打开。
- 新选择开始前会释放上一轮未完成的 `ValueCallback<Uri[]>`。

## 下载修复说明

- 下载使用系统 `DownloadManager`。
- 下载请求携带 Cookie 和 User-Agent。
- 支持当前 PDF / 图片、下载全部 ZIP、PDF 预览失败时下载。
- 下载失败时 Toast 提示，并尝试交给外部应用打开。

## PDF 系统打开说明

- Web 端“用系统打开”会先访问同源预览接口。
- 后端带登录态生成临时文件链接后，APK 壳会拦截非白名单域名并让系统处理。
- 如果系统没有 PDF 阅读器，会提示“未找到可打开 PDF 的应用，请先下载文件”。

## 剪贴板复制说明

- APK 壳提供 `AndroidBridge.copyText(String text)`。
- Web 端复制链接和连接器参数复制优先走 AndroidBridge。
- 不复制账号密码、token、数据库连接串或对象存储密钥。

## 语音输入降级说明

- 当前 APK 不新增麦克风权限，不实现 Android 原生语音识别。
- 如果 WebView 不支持 Web Speech API，语音按钮会显示键盘兜底提示。
- 用户可继续手动输入，不影响业务流程。

## 返回键说明

- WebView 可以后退时，返回键执行 `webView.goBack()`。
- WebView 不能后退时，首次返回提示“再按一次退出工单资料库”。
- 2 秒内再次返回才退出 App。

## 壳能力诊断

APK 壳提供：

```js
AndroidBridge.getCapabilities()
```

返回 JSON 字符串，包含：

- `fileChooser`
- `cameraCapture`
- `downloadManager`
- `clipboard`
- `speech`
- `userAgent`

## 平板实机验收清单

1. 安装 GitHub Actions 最新 debug APK。
2. 打开 APK，确认无浏览器地址栏。
3. 登录成功。
4. 打开工单资料库。
5. 上传 PDF 成功。
6. 上传图片成功。
7. 点击“拍照上传”，允许相机权限，拍照后上传成功。
8. 取消文件选择后，再次点击上传仍能打开选择器。
9. 多选文件时不会崩溃，能按 Web 页面能力处理。
10. PDF 预览正常，失败时有下载和系统打开兜底。
11. 下载当前 PDF / 图片成功。
12. 下载全部 ZIP 成功。
13. 复制工单链接成功。
14. 连接器参数复制整行成功。
15. 语音输入不可用时提示使用键盘输入。
16. 返回键先返回上一页，不能返回时双击退出。

## 已知问题

- 本机缺少 Android SDK / Gradle 环境，APK 构建需要 GitHub Actions 验证。
- 不同鸿蒙平板内置 WebView 和系统相机实现可能存在差异，需要实机验收。
- 当前不做 Android 原生语音识别。

本文档不包含数据库密码、对象存储密钥、SESSION_SECRET、admin 密码、token 或任何真实生产密码。
