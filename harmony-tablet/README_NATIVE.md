# HongmengWorkorderTablet

这是工单资料库的鸿蒙平板原生 App 工程，目标版本为 `v2.0.0-native-rc.2`。

## 工程说明
- 工程目录：`harmony-tablet`
- 技术栈：ArkTS / ArkUI / Stage 模型
- 包名：`com.factory.workorder`
- 模块：`entry`
- 设备优先级：Tablet
- 主界面不使用 WebView，不套壳现有网页
- 数据通过 HTTPS API 调用 Sealos 后端

## DevEco Studio 打开方法
1. 打开 DevEco Studio。
2. 选择 Open Project。
3. 选择英文路径下的 `C:\Dev\hongmeng\harmony-tablet`。
4. 等待 ohpm / hvigor 同步。
5. 如果 SDK 版本提示不匹配，按本机 DevEco 推荐版本修正 `compatibleSdkVersion`。

## DevEco 同步失败修复说明
- 本工程已按本机 `DevEcoStudio26.0` 的 Empty Ability / Stage 模型模板对齐基础配置。
- 根 `oh-package.json5` 不再把 `@ohos/hvigor-ohos-plugin` 或 `@ohos/hvigor` 写为 `latest` 依赖。
- `@ohos/hvigor-ohos-plugin` 是 DevEco / Hvigor 内置插件，由 DevEco 环境提供，不应手动改成 `latest`。
- 如果再次出现 `@ohos/hvigor-ohos-plugin@latest not found`，请先检查根 `oh-package.json5` 是否被改回 `latest`。
- 推荐优先使用 DevEco Studio 内置工程升级 / Sync 工具处理 SDK 或模板格式差异。
- 命令行构建需要本机 PATH 中存在 `ohpm`、`hvigor` 或工程自带 `hvigorw.bat`；若没有，请在 DevEco Studio 内点击 Sync / Build。

## API 配置
默认服务器地址位于：

```text
entry/src/main/ets/constants/api.ets
```

默认值：

```text
https://qdowqencjyph.sealoshzh.site
```

该地址为公开服务地址。工程不包含数据库连接、对象存储凭据或任何密钥。

## 当前已实现功能
- 原生登录页，调用 `/api/native/auth/login`
- Bearer token HTTP 客户端，支持 GET / POST / PATCH / DELETE
- token 和当前用户本地 preferences 持久化，401 后回登录页
- 工作台页面，拉取真实工单列表
- 顶部栏
- 当前工单信息条
- 覆盖式工单抽屉和工单搜索
- 资料分类栏和文件列表
- 图片原生 Image 预览
- PDF 文件卡片和下载 / 打开入口
- 右侧资料工具窗
- 上传 PDF / 图片入口和上传队列
- 拍照上传入口和 Camera adapter
- 连接器参数搜索、筛选、新增、编辑、软删除
- 设置页，调用 `/api/native/system/status`
- 系统能力 adapter：FilePicker、Camera、Download、Permission、Preferences、Toast

## 当前未实现功能
- DevEco 真机文件选择器 API 绑定
- DevEco 真机相机预览 / 拍照 API 绑定
- 原生 PDF 完整渲染
- 连接器参数原生导入预览
- 原生 Excel 导入

## 如何运行
1. 在 DevEco Studio 中打开工程。
2. 连接鸿蒙平板或启动 Tablet 模拟器。
3. 选择 `entry` 模块。
4. 点击 Run。
5. 登录后进入工作台。

## 真机调试
- 确认平板网络可访问服务器地址。
- 首次使用拍照上传前，需要在真机上确认相机权限。
- 当前 RC 版本已经完成页面和 adapter 闭环；文件选择、下载保存和相机能力需要下一步在 DevEco 真机环境按 adapter 内 TODO 补齐系统 API。

## v2.0.0-native-rc.2 功能范围
- 原生登录、退出登录和 token 持久化。
- 原生工作台接入真实工单、资料分类和文件列表。
- 图片使用 ArkUI `Image` 组件预览。
- PDF 暂以文件卡片方式显示，并提供下载 / 打开入口。
- 上传 PDF / JPG / PNG 通过 `FilePickerAdapter` 与 `resourceApi.uploadResourceFile` 串联。
- 拍照上传通过 `CameraAdapter` 保留完整入口和兜底上传图片路径。
- 连接器参数接入真实查询、新增、编辑和软删除 API。
- 设置页展示服务器、当前用户、登录状态和系统安全状态摘要。
- 不使用 WebView，不包含数据库连接、对象存储凭据或任何真实密钥。
