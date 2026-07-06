# 平板 APK 横屏 / 拍照 / 加载性能 QA

## 版本

v1.13.3-tablet-apk-performance-camera-fix

## 修复范围

本次只修 Android WebView APK 壳和必要的 Web 前端上传 / 拍照 / 预览体验，不修改数据库、不修改 Prisma schema、不修改 Sealos 环境变量、不恢复 DevEco / Harmony ArkTS 工程、不恢复 `/api/native`。

APK 仍只加载：

```text
https://qdowqencjyph.sealoshzh.site/dashboard
```

## 横屏锁定验收

- `MainActivity` 在 Manifest 中锁定横屏。
- `onCreate`、拍照返回、文件选择返回、权限返回和 `onResume` 都会恢复横屏。
- `configChanges` 已覆盖 `keyboardHidden`、`orientation`、`screenSize`、`screenLayout`、`smallestScreenSize`、`uiMode`。
- APK 主界面应保持横屏。系统相机作为外部应用打开时可能短暂使用系统相机自身方向，但返回 APK 后必须恢复横屏。

## getUserMedia 拍照验收

- APK WebView 中点击“拍照上传”优先打开网页内拍照弹窗。
- 拍照弹窗优先使用 `navigator.mediaDevices.getUserMedia`。
- 默认请求后置摄像头：`facingMode: environment`。
- 关闭弹窗、取消或上传完成后必须释放 video tracks。
- 摄像头权限被拒绝时显示：

```text
摄像头权限被拒绝，请在系统设置中开启或使用上传图片。
```

## 系统相机 fallback 验收

- 如果 WebView 不支持 getUserMedia，或网页内摄像头不可用，弹窗中提供 `input type=file accept=image/* capture=environment`。
- 系统相机 fallback 由 Android `onShowFileChooser` 接管。
- fallback 选择取消后，下次点击仍能重新打开。

## 图片方向验收

- 网页内 getUserMedia 拍照通过 canvas 生成 JPEG，方向应与预览一致。
- 图片预览和缩略图 CSS 使用 `image-orientation: from-image`。
- 系统相机 fallback 返回的图片会在前端压缩流程中经浏览器解码后重新绘制，尽量消除 EXIF 方向差异。

## 图片压缩验收

- 仅图片进入压缩逻辑，PDF 不处理。
- 大于约 1MB 的图片上传前会尝试优化。
- 最大边长约 2560px。
- JPEG quality 为 0.9。
- 压缩失败时上传原图，不阻塞生产使用。
- 上传队列显示压缩前后大小，例如 `6.2 MB -> 1.4 MB`。
- 不把图片 base64 写入 localStorage，不把图片内容写日志。

## 上传刷新策略验收

- 批量上传过程中，单个文件成功后只更新上传队列状态。
- 批量结束后只刷新目标工单 / 目标分类文件列表一次。
- 成功后自动选中最新上传文件。
- 上传完成 toast：

```text
批量上传完成：成功 X 个，失败 Y 个
```

- 上传任务保存点击上传时的 `workOrderId` 和 `categoryId`，避免用户切换分类后错传。

## 图片预览性能验收

- 主图预览使用 `loading="lazy"` 和 `decoding="async"`。
- 图片容器使用 `object-fit: contain`，避免裁切。
- 切换文件时显示“图片加载中”。
- 图片加载失败时显示：

```text
图片加载失败，可重新加载或下载原图
```

- 缩略图懒加载，避免缩略条一次性主动加载全部大图。

## PDF 加载慢兜底验收

保留上一版 PDF WebView 兼容能力：

- `Promise.withResolvers` polyfill。
- `pdfjs-dist/legacy`。
- WebView 下通过 ArrayBuffer 预览。
- 失败兜底：重新加载、下载 PDF、用系统打开。

新增慢加载提示：

- PDF 加载超过 8 秒时显示：

```text
PDF 加载较慢，可继续等待或下载查看。
```

## WebView 性能配置验收

Android WebView 配置包括：

- JavaScript enabled。
- DOM Storage enabled。
- File / Content access enabled。
- Images automatically loaded。
- Media playback does not require user gesture。
- Cache mode `LOAD_DEFAULT`。
- Wide viewport 和 overview mode。
- 关闭 WebView 原生缩放控件。
- Activity hardware acceleration enabled。
- `onPause` / `onResume` 转发给 WebView。

## 仍需实机验证的问题

- 鸿蒙平板系统 WebView 的 getUserMedia 兼容性。
- 系统相机 fallback 在不同设备上的方向表现。
- 大图压缩耗时和画质平衡。
- PDF 在低性能设备上的首次加载耗时。
- GitHub Actions 构建 debug APK 后，需要卸载旧 APK 并安装新 APK 实测。

本文档不包含数据库密码、对象存储密钥、SESSION_SECRET、admin 密码、token 或任何真实生产密码。
