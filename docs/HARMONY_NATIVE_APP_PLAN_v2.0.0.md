# Harmony Native App Plan v2.0.0

## 目标
新增真正鸿蒙平板原生 App，目录为 `harmony-tablet`。该 App 使用 ArkTS、ArkUI 和 Stage 模型，不使用 WebView 套壳现有网页。

## 架构
- Web / 后端：继续由 Next.js 项目提供 Sealos HTTPS API。
- 原生 App：`harmony-tablet`，通过 Bearer token 调用 `/api/native/*`。
- 数据持久化：元数据仍在 PostgreSQL，文件仍在对象存储。
- 登录模式：账号登录，所有登录用户共享同一套业务数据。
- 权限模式：无角色权限。

## v2.0.0-native-rc.1 范围
- 登录页
- 工作台页
- 工单抽屉
- 当前工单信息条
- 资料分类栏
- 图片预览
- PDF 文件卡片和打开入口
- 右侧资料工具窗
- 连接器参数页
- 设置页
- 原生 HTTP 客户端
- Bearer token 登录态

## 已实现页面
- `LoginPage.ets`
- `WorkbenchPage.ets`
- `ConnectorParametersPage.ets`
- `SettingsPage.ets`

## 已实现组件
- `TopBar.ets`
- `WorkOrderDrawer.ets`
- `CurrentWorkOrderBar.ets`
- `ResourceCategoryRail.ets`
- `ResourcePreviewPanel.ets`
- `ResourceToolPanel.ets`
- `EmptyResourceState.ets`
- `ConnectorParameterTable.ets`
- `CommonButton.ets`

## 已实现 Native API
- `POST /api/native/auth/login`
- `GET /api/native/auth/me`
- `POST /api/native/auth/logout`
- `GET /api/native/work-orders`
- `GET /api/native/work-orders/[id]`
- `PATCH /api/native/work-orders/[id]`
- `GET /api/native/work-orders/[id]/resources`
- `GET /api/native/resource-files/[id]/content`
- `GET /api/native/resource-files/[id]/download`
- `POST /api/native/resource-files/upload`
- `GET /api/native/connector-parameters`
- `POST /api/native/connector-parameters`
- `PATCH /api/native/connector-parameters/[id]`
- `DELETE /api/native/connector-parameters/[id]`

## 未实现能力
- 原生文件选择器上传
- 原生相机拍照上传
- 原生 PDF 完整渲染
- 原生连接器参数导入预览
- 离线同步
- OCR

## DevEco 打开方式
1. 使用英文路径 `C:\Dev\hongmeng\harmony-tablet`。
2. DevEco Studio 选择 Open Project。
3. 等待 ohpm 和 hvigor 同步。
4. 如果 SDK 版本提示不匹配，以本机 DevEco 推荐 SDK 为准。

## 构建方式
优先在 DevEco Studio 中 Sync Project 后构建 `entry` HAP。若本机配置了命令行工具，可在 `harmony-tablet` 下尝试：

```bash
ohpm install
hvigorw assembleHap
```

当前仓库不提交 `oh_modules`、`build`、`.hvigor`、`.idea` 或本地属性文件。

## 真机调试步骤
1. 确认平板可访问服务器公开地址。
2. 开启开发者模式并连接 DevEco Studio。
3. 运行 `entry`。
4. 登录后检查工单列表、资料分类、图片预览、PDF 文件卡片和连接器参数页。
5. 文件选择、拍照上传和原生 PDF 渲染在后续 RC 中补齐。

## 注意
本工程不是 WebView 套壳。主界面使用 ArkUI 原生组件实现，现有 Web 页面只继续作为浏览器端入口保留。
