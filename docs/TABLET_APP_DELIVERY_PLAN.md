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

常见 APK 输出路径：

```text
android-webview-app/app/build/outputs/apk/debug/app-debug.apk
```

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
