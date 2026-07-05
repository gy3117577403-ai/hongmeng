# HongmengWorkorderTablet

这是工单资料库的鸿蒙平板原生 App 工程，当前候选版本为 `v2.0.0-native-rc.5`。

## 工程说明
- 工程目录：`harmony-tablet`
- 技术栈：ArkTS / ArkUI / Stage 模型
- 包名：`com.factory.workorder`
- 模块：`entry`
- 设备优先级：Tablet
- 主界面使用 ArkUI 原生组件，不使用 WebView，不套壳现有网页
- 数据通过 HTTPS 调用 Sealos 后端 `/api/native/*`

## API 配置
默认服务地址位于：

```text
entry/src/main/ets/constants/api.ets
```

当前值：

```text
https://qdowqencjyph.sealoshzh.site
```

工程不包含数据库连接串、对象存储密钥、会话密钥或任何真实密码。

## v2.0.0-native-rc.5 功能范围
- 原生登录、退出登录、token 保存和 401 回登录页。
- 工作台：顶部导航、工单抽屉、当前工单信息条、资料分类栏、预览区、右侧资料工具窗。
- 工单：列表、搜索、默认选中第一条、新建、编辑、软删除、恢复接口、工单直达二维码、当前工单全部资料 ZIP 下载。
- 资料：分类切换、图片预览、PDF 文件卡片、文件下载/打开入口、软删除、恢复接口、显示名/备注编辑、分类移动。
- 上传：PDF、图片、拍照入口、上传队列、失败重试和批量重试；原生文件选择、相机入口和 multipart 上传由 platform adapter 接入。
- 连接器参数：查询、缺失字段筛选、重点筛选、新增、编辑、删除、恢复、批量标重点、批量取消重点、批量删除、复制整行参数、CSV 粘贴导入预览、CSV/XLS/XLSX 文件导入预览、确认导入、CSV 导出、模板下载、原始附件列表、附件上传/下载/删除、导入批次回滚。
- 设置：生产稳定中心、系统状态、账号管理、修改密码、操作日志、回收站、数据快照、诊断信息。

## DevEco Studio 使用
1. 打开 DevEco Studio。
2. 选择 Open Project。
3. 打开 `C:\Dev\hongmeng\harmony-tablet`。
4. 执行 Sync。
5. 执行 Clean Project。
6. 执行 Build / Make Project。
7. 选择 `entry` 模块运行到鸿蒙平板或 Tablet 模拟器。

本机命令行如没有 `ohpm`、`hvigor` 或 `hvigorw`，请在 DevEco Studio 内构建，不要把命令行缺失误判为代码构建成功。

## 平台 Adapter 说明
- `FilePickerAdapter`：接入系统文档选择器、图片选择器和附件选择器，返回 URI 后交给 multipart 上传。
- `CameraAdapter`：接入系统图片选择器作为拍照/相册入口；如设备未提供相机入口，提示先拍照后选择图片。
- `DownloadAdapter`：使用系统能力打开文件、资料包和附件下载 URL，不在 App 本地长期保存文件。
- `ClipboardAdapter`：用于复制工单链接和文件链接。
- `VoiceInputAdapter`：统一语音入口，覆盖全局搜索、工单搜索、表单备注和文件信息备注；系统语音不可用时提示键盘手动输入。
- `PreferencesAdapter`：用于 token 和用户信息本地保存。

## 安全约束
- 不使用 WebView。
- 不写入 `DATABASE_URL`。
- 不写入对象存储 Key 或 Secret。
- 不写入 `SESSION_SECRET`。
- 不写入 admin 密码或任何真实密码。
- 不提交 `oh_modules`、`build`、`.hvigor`、`.idea`、`local.properties`。
- `build-profile.json5` 如包含本地签名配置，不提交。
