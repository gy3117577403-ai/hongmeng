# 预览适屏与旋转 QA

版本：v1.14.0-drawing-library-auto-sync-preview

## PDF 预览

验收点：

- 默认进入“适应窗口”模式。
- 首次加载根据容器宽高计算缩放比例。
- 窗口尺寸变化后自动重新计算缩放比例。
- 支持上一页、下一页、缩小、放大、适宽、整页、原始大小、全屏。
- 支持左旋、右旋、重置旋转。
- 旋转角度限定为 0 / 90 / 180 / 270。
- PDF.js 渲染时通过 `getViewport({ rotation })` 应用旋转。

保留兼容能力：

- legacy pdfjs 加载。
- `Promise.withResolvers` polyfill。
- Android WebView ArrayBuffer 兜底。
- 8 秒慢加载提示。
- 下载和系统打开兜底入口。

## 图片预览

验收点：

- 默认完整显示图片，使用适应窗口模式。
- 保留 `image-orientation: from-image`。
- 支持缩小、放大、适应窗口、原始大小、全屏。
- 支持左旋、右旋、重置旋转。
- 旋转使用 CSS `transform: rotate(...)`，中心点为图片中心。
- 90 / 270 度旋转时图片保持居中，不裁切主内容。

## Android WebView 验收

- PDF 在 APK WebView 中仍走同源 content API。
- 如果 WebView 对 PDF worker 支持不稳定，仍可使用下载或系统打开。
- 图片旋转和适屏不依赖原生桥。
- 不缓存签名下载链接。

## 已知风险

暂无阻塞问题。不同系统 WebView 对 PDF worker 的支持存在差异，已保留 ArrayBuffer 和下载兜底。
