# APK WebView PDF 预览兼容验收

## 版本

v1.13.2-tablet-apk-pdf-webview-fix

## 问题现象

Android WebView APK 壳内打开 PDF 资料时，页面进入 PDF 预览逻辑后失败，提示：

```text
当前平板内置 WebView 暂不支持直接预览此 PDF，可下载或用系统打开
Promise.withResolvers is not a function
```

## 根因

目标平板内置 Android WebView 的 JavaScript 引擎不支持 `Promise.withResolvers`。新版 PDF.js 在初始化时会使用该能力，如果 polyfill 没有在 PDF.js 模块加载前执行，就会导致 PDF.js 初始化失败。

## 修复方式

- 在 `components/PdfViewer.tsx` 中新增 `Promise.withResolvers` 安全 polyfill。
- 确保 polyfill 在动态导入 PDF.js 之前执行。
- PDF.js 改为动态导入 `pdfjs-dist/legacy/build/pdf.mjs`，优先兼容 Android WebView。
- `/api/pdf-worker` 优先返回 `pdfjs-dist/legacy/build/pdf.worker.min.mjs`。
- Android WebView 环境下通过同源 content API 拉取 PDF `ArrayBuffer`，再交给 PDF.js 渲染。
- 保留“重新加载”“下载 PDF”“用系统打开”兜底按钮。

## 验收步骤

1. 部署包含本修复的 Web 镜像到 Sealos。
2. 等待 GitHub Actions 重新构建 Android WebView debug APK。
3. 卸载平板上的旧 APK。
4. 安装新的 APK。
5. 登录工单资料库。
6. 选择包含 PDF 的工单和分类。
7. 打开 PDF 预览。
8. 确认不再出现 `Promise.withResolvers is not a function`。
9. 验证翻页、缩放、适宽、整页和全屏仍可用。
10. 验证“下载 PDF”和“用系统打开”仍可用。

## 如果仍失败

记录页面显示的安全错误详情：

- 是否为 APK WebView。
- HTTP status。
- Content-Type。
- 错误摘要。

禁止记录账号密码、token、Cookie、数据库连接串、S3 Key、SESSION_SECRET 或签名下载链接。

## 已知说明

- 本修复不修改数据库、Prisma schema、S3 或 Sealos 环境变量。
- 本修复不恢复 DevEco / Harmony ArkTS 工程。
- 本修复不恢复 `/api/native`。
- APK 加载地址仍为 `https://qdowqencjyph.sealoshzh.site/dashboard`。

## 建议结论

完成 Web 部署并安装新 APK 后，可以进行现场 PDF 预览实机验收。
