# Android WebView APK PDF 预览兼容 QA

## 问题现象

Android WebView APK 壳可以正常打开工单资料库 Web 页面，登录、工单、分类和文件列表均可显示，但在 APK WebView 内预览 PDF 时出现：

```text
PDF 加载失败，请检查文件是否完整或稍后重试
```

同一文件在普通浏览器中可能正常，说明问题集中在 Android WebView 与 PDF.js worker、Cookie、同源内容流或文件响应头兼容性。

## 修复内容

- 增强 `/api/resource-files/[id]/content` 响应头：
  - `Content-Type: application/pdf`
  - `Content-Disposition: inline`
  - `Cache-Control: no-store`
  - `X-Content-Type-Options: nosniff`
- 未登录、文件不存在和服务器错误均返回明确 JSON，不返回 HTML 页面伪装成 PDF。
- PDF Viewer 检测 Android WebView 后，优先 fetch 同源 content API，并以 `ArrayBuffer` 方式交给 PDF.js。
- PDF Viewer 增加可操作失败提示：
  - 登录已过期
  - 文件不存在或已删除
  - 服务返回页面而不是 PDF
  - PDF worker / WebView 不兼容
- PDF Viewer 增加兜底按钮：
  - 重新加载
  - 下载 PDF
  - 用系统打开
- Android WebView APK 壳追加 User-Agent：

```text
HongmengWorkorderWebView/1.0
```

- Android WebView APK 壳注入：

```js
window.__HONGMENG_WEBVIEW__ = true
```

- Android WebView APK 壳允许 Cookie 和 Android L+ third-party Cookie，避免 WebView 文件流请求丢登录态。

## 浏览器 PDF 预览验收

待部署后在浏览器验证：

1. 登录系统。
2. 打开含 PDF 的工单。
3. PDF 默认适应宽度显示。
4. 翻页、缩放、适宽、整页、全屏正常。
5. 下载当前 PDF 正常。
6. 图片预览、上传、下载全部 ZIP、连接器参数页不受影响。

## APK WebView PDF 预览验收

待 GitHub Actions 构建新 debug APK 并安装后验证：

1. 打开 APK。
2. 登录系统。
3. 打开含 PDF 的工单资料。
4. PDF 能在 WebView 中渲染。
5. 如 WebView 内核不支持，页面显示明确原因。
6. 失败提示中出现“重新加载”“下载 PDF”“用系统打开”按钮。
7. 不出现笼统“PDF 加载失败，请检查文件是否完整或稍后重试”。

## 下载兜底验收

1. 在 PDF 失败提示中点击“下载 PDF”。
2. 系统 DownloadManager 开始下载，或调起外部浏览器。
3. 下载不静默失败。
4. 在 PDF 失败提示中点击“用系统打开”。
5. 如设备有 PDF 查看器，应可通过系统处理该 PDF。

## 已知问题

- 本机缺少 Android SDK / Gradle 环境，APK 构建需要 GitHub Actions 重新运行验证。
- 部分 HarmonyOS NEXT 设备可能不支持 Android APK，需要使用 PWA 或另行评估 HAP 路线。
- “用系统打开”依赖系统是否存在可处理 PDF 的应用。

本文档不包含数据库密码、对象存储密钥、SESSION_SECRET、admin 密码或任何真实生产密码。
