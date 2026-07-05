# Harmony Native Workbench Parity QA

版本：v2.0.0-native-rc.4

日期：2026-07-05

范围：Harmony 原生工作台数据链路、Web 工作台结构对齐、上传能力状态、连接器参数入口回归。

## 约束

- 不使用 WebView。
- 不修改 Web 成熟页面。
- 不修改 Prisma schema、数据库结构、S3 配置或 `API_BASE_URL`。
- 不记录密码、token、数据库连接串、S3 Key、`SESSION_SECRET`。
- 不提交 `harmony-tablet/build-profile.json5`、`oh_modules`、`build`、`.hvigor`、`.idea`、`local.properties`。

## Native API 对照

### `/api/native/work-orders`

实际调用：

`GET /api/native/work-orders?page=1&pageSize=50`

本地验证结果：

- HTTP 状态：200
- Content-Type：`application/json`
- `ok`：true
- `data` 结构摘要：`workOrders,page,pageSize,total`
- 返回工单数：40

Harmony 解析逻辑：

- 兼容 `data` 为数组。
- 兼容 `data.workOrders`。
- 兼容 `data.items`。
- 兼容 `data.list`。
- 兼容顶层 `workOrders` / `items`。
- 非兼容格式时显示“工单接口返回格式异常”。

### `/api/native/work-orders/{id}/resources`

实际调用：

`GET /api/native/work-orders/{id}/resources`

本地验证结果：

- HTTP 状态：200
- Content-Type：`application/json`
- `ok`：true
- `data` 结构摘要：`categories,files`
- 分类数：5
- 当前首个工单文件数：0

Harmony 解析逻辑：

- 兼容 `data.categories` / `data.files`。
- 兼容 `data.resourceCategories` / `data.resourceFiles`。
- 兼容 `data` 为文件数组。
- 后端未返回分类时生成默认分类：原图、SOP指导书、成品图、辅料规格、注意事项。
- 按 `categoryId`、`categoryCode`、`categoryName` 将文件归类。
- 不再显示“分类暂未返回，请检查资料接口”。

### `/api/native/connector-parameters`

实际调用：

`GET /api/native/connector-parameters?page=1&pageSize=5&keyword=`

本地验证结果：

- HTTP 状态：200
- Content-Type：`application/json`
- `ok`：true
- `data` 结构摘要：`parameters,page,pageSize,total`
- 当前返回参数数：13

Harmony 解析逻辑：

- 连接器参数页通过 `data.parameters` 渲染列表。
- 搜索、缺失字段筛选、重点筛选入口保留。
- 空值保持空白显示。
- 重点行继续使用浅黄色标识。

## 数据链路修复结果

- 登录进入 `WorkbenchPage` 后调用工单列表接口。
- 工单数组非空时默认选中第一条工单。
- 选中工单后立即加载工单详情和资源分类。
- 默认选中第一个资料分类：原图。
- 当前分类有文件时默认选中第一条文件。
- 当前分类无文件时显示空态引导和上传入口，不显示“文件 0 个”。
- 接口失败时显示明确错误，不静默失败。

## 上传能力状态

当前 Harmony 原生文件选择与相机 adapter 仍是工程占位实现，状态如下：

- 文件选择：待真机适配
- 相机：待真机适配
- 上传按钮会调用 `FilePickerAdapter.pickPdf()`、`FilePickerAdapter.pickImages()`、`CameraAdapter.openCamera()`。
- 当 adapter 返回空结果时，UI 明确提示“文件选择能力正在适配，请使用 Web 端上传或等待下一版本。”。
- 右侧上传工具窗显示能力状态，避免误认为已完全可用。

## Web / Harmony 对照表

| 项目 | Web版 | Harmony版 | 是否完成 | 备注 |
| --- | --- | --- | --- | --- |
| 默认选中第一个工单 | 有 | 有 | 完成 | 工单列表非空时自动选中第一条 |
| 工单抽屉 | 有 | 有 | 完成 | 支持搜索、状态筛选、工单卡片 |
| 顶部搜索 | 有 | 有 | 完成 | 顶部全局搜索框保留 |
| 当前工单信息条 | 有 | 有 | 完成 | 显示客户、工单号、产品、状态、优先级、计划日期、资料状态 |
| 资料分类栏 | 有 | 有 | 完成 | 原图、SOP指导书、成品图、辅料规格、注意事项、上传管理 |
| 分类数量 | 有 | 有 | 完成 | 根据接口分类或默认分类计算 |
| 状态点 | 有 | 有 | 完成 | 按文件数和必填状态显示 |
| 空态引导 | 有 | 有 | 完成 | 当前分类无文件时显示缺资料引导 |
| 图片预览 | 有 | 有 | 完成 | 使用原生 `Image`，`Contain` 显示 |
| PDF 卡片 | 有 | 有 | 完成 | 显示文件名、版本、大小、下载/打开入口 |
| 右侧工具窗 | 有 | 有 | 完成 | 信息、上传、操作、队列四个 tab |
| 上传入口 | 有 | 有 | 部分完成 | 入口和队列存在，原生 picker/camera 待真机适配 |
| 底部缩略图 | 有 | 有 | 完成 | 当前分类多个文件时悬浮显示 |
| 连接器参数入口 | 有 | 有 | 完成 | 顶部入口可进入原生页面 |
| 设置入口 | 有 | 有 | 完成 | 顶部入口可进入设置页 |
| 退出登录 | 有 | 有 | 完成 | 调用原生 auth store logout |

## 已知问题

- DevEco CLI 未在当前命令行环境可用，Harmony Build 需要在 DevEco Studio 中验证。
- 原生文件选择、相机拍照能力仍需 DevEco 真机 adapter 接入；当前已在 UI 中标注为“待真机适配”。

## 建议

建议进入 DevEco Studio 后执行：

1. 构建 -> 清理项目
2. 构建 -> 生成项目
3. 运行 -> 运行 entry
4. 登录后检查默认选中工单、分类栏、空态、右侧工具窗、连接器参数入口。
