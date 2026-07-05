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
- 工单：列表、搜索、默认选中第一条、新建、编辑、软删除、恢复接口、当前工单全部资料 ZIP 下载。
- 资料：分类切换、图片预览、PDF 文件卡片、文件下载/打开入口、软删除、恢复接口、显示名/备注编辑、分类移动。
- 上传：PDF、图片、拍照入口和上传队列，原生文件选择/相机能力由 platform adapter 接入。
- 连接器参数：查询、缺失字段筛选、重点筛选、新增、编辑、删除、恢复、批量标重点、批量取消重点、批量删除、CSV 粘贴导入预览、确认导入、CSV 导出、模板下载、原始附件列表、附件下载/删除、导入批次回滚。
- 设置：系统状态、账号管理、修改密码、操作日志、回收站、数据快照、诊断信息。

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
- `FilePickerAdapter`：保留文件选择入口；设备不支持原生选择器时提示使用 Web 端上传。
- `CameraAdapter`：保留拍照上传入口；设备不支持直接拍照时提示使用上传图片或 Web 端上传。
- `DownloadAdapter`：保留文件、资料包和附件下载入口，后续可按真机能力接入系统保存/打开能力。
- `PreferencesAdapter`：用于 token 和用户信息本地保存。

## 安全约束
- 不使用 WebView。
- 不写入 `DATABASE_URL`。
- 不写入对象存储 Key 或 Secret。
- 不写入 `SESSION_SECRET`。
- 不写入 admin 密码或任何真实密码。
- 不提交 `oh_modules`、`build`、`.hvigor`、`.idea`、`local.properties`。
- `build-profile.json5` 如包含本地签名配置，不提交。
