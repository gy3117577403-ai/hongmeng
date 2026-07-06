# 平板交付方案

## 背景

当前系统继续使用 Web 网页版 + Sealos 部署方式。目标是在平板现场使用时尽量减少浏览器地址栏、标签栏和浏览器操作入口的干扰，同时不改数据库、不改 Prisma schema、不破坏现有上传、预览、下载、PostgreSQL 和 S3 对象存储能力。

线上地址：

```text
https://qdowqencjyph.sealoshzh.site
```

## 为什么不能打包成 .exe

`.exe` 是 Windows 桌面应用交付格式，不能直接安装到鸿蒙平板或 Android 平板。平板端应优先使用 PWA、Android APK 或对应系统的原生应用包。

## PWA 安装方案

PWA 适合支持“添加到桌面 / 安装应用”的平板浏览器。

安装步骤：

1. 在平板浏览器打开 `https://qdowqencjyph.sealoshzh.site`。
2. 登录系统。
3. 打开系统设置中的“添加到桌面”说明。
4. 点击浏览器右上角菜单。
5. 选择“添加到桌面”或“安装应用”。
6. 从桌面图标启动系统。

PWA 配置要点：

- 启动地址：`/dashboard`
- 显示模式：`fullscreen`，并回退到 `standalone`
- 主题色：`#ff6a00`
- 背景色：`#fff7ed`
- 只缓存 manifest 和图标
- 不缓存 API 响应
- 不缓存上传响应
- 不缓存签名下载链接

## Android APK WebView 壳方案

如果平板支持安装 Android APK，推荐使用 `android-webview-app/` 打包壳应用。

APK 壳只负责全屏加载：

```text
https://qdowqencjyph.sealoshzh.site/dashboard
```

它不内置账号、密码、token、数据库连接串、S3 Key 或 SESSION_SECRET。用户仍通过线上 Web 系统登录，所有数据仍保存在 Sealos PostgreSQL 和 Sealos Object Storage。

主要能力：

- 全屏 WebView
- 隐藏浏览器地址栏和标签栏
- 支持返回键
- 支持文件选择
- 支持图片选择和拍照上传
- 支持系统 DownloadManager 下载
- 只允许加载 `qdowqencjyph.sealoshzh.site`
- 非白名单域名需要用户确认后用系统浏览器打开

## Android WebView PDF 预览兼容

Android WebView 中 PDF.js 可能遇到 worker 加载、Cookie、同源内容流或 WebView 内核差异导致的 PDF 预览失败。当前已增加 WebView 专用兼容处理：

- APK 壳 User-Agent 追加 `HongmengWorkorderWebView/1.0`。
- APK 壳注入 `window.__HONGMENG_WEBVIEW__ = true`。
- Web PDF 组件在加载 PDF.js 前补齐 `Promise.withResolvers` polyfill，兼容较旧 Android WebView。
- PDF.js 优先使用 `pdfjs-dist/legacy` 构建。
- `/api/pdf-worker` 优先返回本地 `pdfjs-dist/legacy` worker，不依赖 CDN。
- Web PDF 组件检测到 WebView 后，优先通过同源 `/api/resource-files/{id}/content` 拉取 PDF `ArrayBuffer`，再交给 PDF.js 渲染。
- PDF content API 明确返回 `Content-Type: application/pdf`、`Content-Disposition: inline`、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。
- 如果仍无法预览，页面会提供“重新加载”“下载 PDF”“用系统打开”兜底。

如果 WebView 仍无法直接渲染某个 PDF，可先下载 PDF，或通过“用系统打开”让系统 PDF 应用处理。

## Android APK 设备能力补齐

v1.13.1-tablet-apk-device-fix 对 APK WebView 壳补齐了从浏览器切换到 App 后容易缺失的设备能力：

- 文件选择：支持 PDF、图片、普通文件和 multiple 回调。
- 拍照上传：`capture=image/*` 场景优先调起系统相机，使用 FileProvider `content://` 临时图片 URI。
- 下载：使用系统 DownloadManager，携带 Cookie 和 User-Agent，支持当前文件、ZIP 包和 PDF 兜底下载。
- PDF 系统打开：无法预览时可下载或交给系统 PDF 应用处理。
- 剪贴板：Web 端复制链接优先调用 `AndroidBridge.copyText`。
- 返回键：WebView 可后退时返回上一页，否则 2 秒内双击退出。
- 壳能力诊断：`AndroidBridge.getCapabilities()` 可返回文件选择、相机、下载、剪贴板、语音等能力。

语音输入仍优先依赖浏览器 Web Speech API。若 Android WebView 不支持，页面会明确提示“当前 APK 暂不支持语音输入，请使用键盘输入”，不影响手动输入。

v1.13.2-tablet-apk-device-bridge 继续补齐 WebView 设备桥闭环：

- WebView `onPermissionRequest` 转接 getUserMedia 摄像头授权。
- 只对白名单域名 `qdowqencjyph.sealoshzh.site` 授予摄像头资源。
- APK 环境下“拍照上传”优先触发 `input accept=image/* capture=environment`，直接调起系统相机。
- 系统设置中显示“平板 App 能力”，用于现场确认文件选择、拍照、摄像头授权、下载和剪贴板是否可用。
- 拒绝相机权限时给出明确提示，并允许改用“上传图片”。

v1.13.3-tablet-apk-performance-camera-fix 面向现场横屏和加载体验继续优化：

- APK 主界面锁定横屏，拍照、文件选择和权限返回后恢复横屏。
- 拍照上传优先使用网页内 getUserMedia，减少外部系统相机造成的竖屏和图片方向问题。
- 系统相机 `input capture` 保留为 fallback。
- 大尺寸图片上传前会尝试压缩到适合现场网络的尺寸，失败时上传原图。
- 图片预览和缩略图使用懒加载、异步解码和 EXIF 方向 CSS。
- PDF 加载超过 8 秒时提示可继续等待或下载查看。

v1.13.4-tablet-final-pretest 面向平板真实数据测试前做最后收口：

- PWA Service Worker 继续只缓存 manifest 和图标。
- 不缓存 `/api/*`、`/dashboard`、上传响应、下载链接、签名链接和文件内容流。
- 工作台顶部增加“同步”按钮，用于刷新当前工单、分类数量和当前分类文件列表。
- 右侧资料工具窗增加“同步当前工单资料”入口，适合 APK / PWA 长时间停留在同一工单时手动更新。
- 上传成功后会更新同步状态，减少反复全页刷新。
- 新增旧工单数据清理脚本，默认 dry-run，且不会清理连接器参数资料。
- seed 默认不再生成样例工单，避免真实数据测试前出现旧样例数据。

平板同步建议：

1. 浏览器端上传或修改当前工单资料。
2. APK / PWA 端保持在同一工单。
3. 点击“同步”。
4. 确认资料数量、文件列表、预览入口和下载入口已刷新。

## HarmonyOS NEXT 风险说明

部分鸿蒙平板可以安装 Android APK，部分 HarmonyOS NEXT 设备可能不再支持 APK。需要在目标设备上确认系统版本和 APK 安装能力。

如果设备支持 APK，推荐 APK WebView 壳。

如果设备不支持 APK，推荐使用 PWA 添加到桌面；若必须要系统级原生包，则需要重新评估 DevEco HAP 路线。

## APK 构建和安装

构建入口：

```text
android-webview-app/
```

使用 Android Studio 打开该目录，等待 Gradle Sync 完成，然后执行：

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

命令行环境完整时也可执行：

```bash
cd android-webview-app
gradle :app:assembleDebug
```

也可以使用 GitHub Actions 自动构建 debug APK：

1. 打开 GitHub 仓库的 `Actions` 页面。
2. 选择 `Android WebView APK`。
3. 点击 `Run workflow`，或推送 `android-webview-app/**` 变更到 `main` 自动触发。
4. 构建完成后下载 artifact：

```text
hongmeng-workorder-webview-debug-apk
```

常见 APK 输出路径：

```text
android-webview-app/app/build/outputs/apk/debug/app-debug.apk
```

debug APK 与正式签名 APK 的区别：

- debug APK：由构建环境生成调试签名，适合内部安装、现场验证和功能确认。
- 正式签名 APK：使用公司发布证书签名，适合长期分发和版本管理。

当前阶段只构建 debug APK，不提交 keystore、签名证书、签名密码、GitHub Token 或任何生产密钥。正式签名流程后续单独设计，应通过 GitHub Secrets 或本地安全签名完成。

安装方式：

1. 将 APK 复制到平板。
2. 允许安装来自当前来源的应用。
3. 安装“工单资料库”。
4. 打开应用并登录。
5. 验证上传、拍照上传、预览、下载、连接器参数和系统设置。

## 回滚方式

PWA 回滚：

1. 删除桌面图标。
2. 清理浏览器站点数据。
3. 重新通过浏览器访问线上地址。

APK 回滚：

1. 卸载当前 APK。
2. 安装上一版 APK。
3. 登录后检查 `/api/health`、工单列表、上传、预览和下载。

Sealos 回滚仍按运维回滚文档执行，通过镜像 digest 回滚，不删除数据库，不删除对象存储 Bucket。

## 验收清单

- 浏览器访问正常。
- PWA manifest 可访问。
- PWA 桌面入口可打开 `/dashboard`。
- APK 安装后无浏览器地址栏。
- APK 登录正常。
- APK 上传 PDF / JPG / PNG 正常。
- APK 拍照上传权限正常。
- APK 下载不静默失败。
- 非白名单域名不会直接在壳内打开。

本文档不包含任何数据库密码、对象存储密钥、SESSION_SECRET、admin 密码或真实生产密码。
