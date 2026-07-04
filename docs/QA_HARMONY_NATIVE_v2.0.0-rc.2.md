# QA_HARMONY_NATIVE_v2.0.0-rc.2

版本：v2.0.0-native-rc.2

commit：本报告随 `v2.0.0-native-rc.2` 提交生成，最终提交哈希以 tag 指向为准。

## Native API 情况
- `POST /api/native/auth/login`：已存在，返回 Bearer token 和安全用户信息。
- `GET /api/native/auth/me`：已存在，用于恢复当前用户。
- `POST /api/native/auth/logout`：已存在。
- `GET /api/native/work-orders`：已存在，支持工单列表和搜索。
- `GET /api/native/work-orders/[id]`：已存在。
- `PATCH /api/native/work-orders/[id]`：已存在。
- `GET /api/native/work-orders/[id]/resources`：已存在，返回资源分类和文件列表。
- `POST /api/native/resource-files/upload`：已存在，使用 S3 兼容对象存储并写入 PostgreSQL 元数据。
- `GET /api/native/resource-files/[id]/content`：已存在。
- `GET /api/native/resource-files/[id]/download`：已存在。
- `DELETE /api/native/resource-files/[id]`：本次新增，软删除文件，不删除 S3 对象。
- `GET /api/native/connector-parameters`：已存在。
- `POST /api/native/connector-parameters`：已存在。
- `PATCH /api/native/connector-parameters/[id]`：已存在。
- `DELETE /api/native/connector-parameters/[id]`：已存在，软删除。
- `GET /api/native/system/status`：本次新增，使用 Bearer token 返回安全状态摘要。

## 原生登录实现
- `LoginPage.ets` 调用真实登录 API。
- `AuthStore.ets` 保存 token 和 user。
- `PreferencesAdapter.ets` 封装本地持久化，当前包含 DevEco 真机验证 TODO 和内存兜底。
- 密码只用于登录请求，不写入日志、页面或文档。

## 工单数据拉取
- `WorkbenchPage.ets` 进入后拉取真实工单。
- 支持工单抽屉和工单搜索。
- 默认选中第一条工单并加载对应资料分类和文件。

## 资源分类 / 文件列表
- 使用 `GET /api/native/work-orders/[id]/resources`。
- 分类包含原图、SOP指导书、成品图、辅料规格、注意事项和上传管理。
- 文件列表按分类显示，并显示最新 / 历史与版本信息。

## 图片原生预览
- `ResourcePreviewPanel.ets` 使用 ArkUI `Image` 组件。
- 预览方式为 contain，不裁切。
- 文件内容走 Native content API URL。

## PDF 卡片预览
- PDF 暂不做原生完整渲染。
- PDF 显示文件名、版本、大小、上传时间。
- 提供下载和打开入口，由 `DownloadAdapter.ets` 统一承接。

## 上传 Adapter
- 新增 `FilePickerAdapter.ets`。
- `resourceApi.uploadResourceFile` 已串联 multipart 上传接口。
- `WorkbenchPage.ets` 已包含上传 PDF、上传图片和上传队列。
- DevEco 真机文件选择和文件内容读取 API 仍需按 adapter TODO 补齐。

## Camera Adapter
- 新增 `CameraAdapter.ets`。
- `WorkbenchPage.ets` 已包含拍照上传弹窗、拍照入口和上传图片兜底。
- 原生相机预览、拍照和释放资源需要在 DevEco 真机环境补齐。

## 连接器参数拉取
- `ConnectorParametersPage.ets` 调用真实 Native API。
- 支持搜索、缺外剥皮、缺内剥皮、缺入长、重点筛选。
- 支持新增、编辑和软删除。

## SettingsPage
- 展示服务器地址、当前用户、登录状态。
- 调用 `GET /api/native/system/status` 展示数据库、对象存储、数量和 warning 摘要。
- 不展示 token、连接串、对象存储密钥或任何真实密码。

## WebView 检查
- 未使用 WebView。
- 未发现 `webview` 或 `@ohos.web` 导入。
- 主界面继续使用 ArkUI 原生组件。

## DevEco 构建情况
- 本机未发现 `ohpm`。
- 本机未发现 `hvigor`。
- 工程内未发现 `hvigorw.bat` 或 `hvigorw`。
- 因本机缺少 DevEco CLI / ohpm / hvigor，本次未执行 HAP 命令行构建。
- 需要后续在 DevEco Studio 内执行 Sync / Build，并集中修复 ArkTS / ArkUI / SDK 编译报错。

## Web npm run build 结果
- 已执行 `npm run build`。
- 结果：通过。
- 仅存在历史 `<img>` ESLint warning，未阻塞构建。

## Web npm run smoke 结果
- 已执行 `npm run smoke`。
- 检查目标：`http://localhost:3000`。
- `/api/health`：通过。
- `/manifest.webmanifest`：通过。
- `/login`：通过。

## 已知问题
- DevEco 命令行构建未执行，需在 DevEco Studio 环境验证。
- 文件选择、文件保存、相机预览和拍照仍需按 platform adapter 内 TODO 接入真机 API。
- 原生 PDF 完整渲染暂未实现。
- 原生 Excel 导入暂未实现。

## 下一步计划
- 在 DevEco Studio 打开 `harmony-tablet` 并完成 Sync。
- 根据 DevEco 编译报错集中修复 ArkTS / ArkUI / SDK API 差异。
- 在鸿蒙平板真机验证登录、工单数据、图片预览、PDF 卡片、上传入口、拍照入口和连接器参数 CRUD。
