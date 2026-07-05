# QA_HARMONY_NATIVE_FULL_PARITY_v2.0.0-rc.5

## 基本信息
- 版本：v2.0.0-native-rc.5
- 目标：鸿蒙平板原生 App 功能完整对齐 Web 端核心生产流程
- 工程目录：`harmony-tablet`
- 技术栈：ArkTS / ArkUI / Stage 模型
- 后端地址：`https://qdowqencjyph.sealoshzh.site`
- 是否使用 WebView：否

## 本次对齐范围
- 登录、退出登录、token 保存、401 回登录页。
- 工作台顶部导航、工单抽屉、当前工单信息条、资料分类栏、主预览区、右侧资料工具窗。
- 工单列表、搜索、默认选中第一条、新建、编辑、软删除、恢复接口、当前工单全部资料 ZIP 下载。
- 资源文件上传入口、图片预览、PDF 文件卡片、下载/打开入口、软删除、恢复接口、显示名/备注编辑和分类移动。
- 连接器参数查询、筛选、新增、编辑、删除、恢复、批量标重点、批量取消重点、批量删除。
- 连接器参数 CSV 粘贴导入预览、确认导入、重复行策略、导入批次列表和导入批次回滚。
- 连接器参数 CSV 导出、模板下载、原始资料附件列表、附件下载和附件删除入口。
- 设置页：生产健康、账号管理、修改密码、操作日志、回收站、数据快照和诊断信息。

## Web / Harmony 功能对照表

| 功能 | Web 已有 | Harmony 已实现 | 是否完全可用 | 备注 |
| --- | --- | --- | --- | --- |
| 登录 | 是 | 是 | 是 | 调用 `/api/native/auth/login`，Bearer token 保存到 preferences。 |
| 退出登录 | 是 | 是 | 是 | 清理 token 后回到登录页。 |
| token 持久化 | 是 | 是 | 是 | `PreferencesAdapter` 承接。 |
| 401 自动回登录页 | 是 | 是 | 是 | `AuthStore.handleUnauthorized` 统一处理。 |
| 当前用户显示 | 是 | 是 | 是 | TopBar 和 Settings 均显示当前用户。 |
| 修改密码 | 是 | 是 | 是 | Settings 中调用 `/api/native/auth/change-password`。 |
| 账号管理 | 是 | 是 | 是 | 支持列表、新增、启用/禁用、输入新密码后重置；后端阻止禁用最后一个 active 用户。 |
| 工单列表 | 是 | 是 | 是 | `WorkOrderStore.load` 调用 native API。 |
| 工单抽屉 | 是 | 是 | 是 | 覆盖式抽屉，支持搜索和状态筛选。 |
| 工单搜索 | 是 | 是 | 是 | 顶部全局搜索和抽屉搜索均接入。 |
| 工单状态筛选 | 是 | 是 | 是 | 未发图、在前端、在后端、已完成。 |
| 默认选中第一个工单 | 是 | 是 | 是 | 列表非空时 `WorkOrderStore` 自动选中第一条。 |
| 工单状态修改 | 是 | 是 | 是 | 当前工单状态按钮一键轮转并 PATCH 保存。 |
| 工单优先级修改 | 是 | 是 | 是 | 当前工单优先级按钮一键轮转并 PATCH 保存。 |
| 新建工单 | 是 | 是 | 是 | 原生表单提交 `/api/native/work-orders`。 |
| 编辑工单 | 是 | 是 | 是 | 原生表单 PATCH `/api/native/work-orders/[id]`。 |
| 删除工单 | 是 | 是 | 是 | 当前为二次确认按钮，后端仍校验工单号 + CONFIRM 口令。 |
| 恢复工单 | 是 | 是 | 是 | Settings 回收站调用 `/api/native/work-orders/[id]/restore`。 |
| 客户名称 | 是 | 是 | 是 | 表单、信息条和 API 均支持 `customerName`。 |
| 计划时间 | 是 | 是 | 是 | 表单、信息条和 API 均支持 `plannedAt`。 |
| 资料完整性 | 是 | 是 | 是 | 当前工单条、分类栏和空态显示缺失分类。 |
| 复制工单链接 / 二维码 | 是 | 部分 | 否 | 当前原生未接系统剪贴板和二维码渲染；未显示空按钮。 |
| 资料分类 | 是 | 是 | 是 | 原图、SOP指导书、成品图、辅料规格、注意事项。 |
| 分类文件数量 | 是 | 是 | 是 | `ResourceStore.applyFileCounts` 计算并显示。 |
| 状态点 | 是 | 是 | 是 | 分类栏使用数量/必填状态表达。 |
| 缺资料统计 | 是 | 是 | 是 | 当前工单信息条和预览空态显示。 |
| 空态引导 | 是 | 是 | 是 | 无文件时显示资料缺失引导卡。 |
| 文件列表 | 是 | 是 | 是 | 当前分类文件和底部缩略条。 |
| 图片预览 | 是 | 是 | 是 | ArkUI `Image` 原生预览。 |
| PDF 卡片 / 预览入口 | 是 | 是 | 部分 | 当前原生显示 PDF 卡片并提供打开/下载入口，未做 PDF.js 等同渲染。 |
| 文件版本 | 是 | 是 | 是 | 文件卡片和信息窗显示 `version`，缺省 V1.0。 |
| 最新 / 历史标签 | 是 | 是 | 是 | 缩略条标记最新/历史。 |
| 文件信息 | 是 | 是 | 是 | 右侧工具窗展示名称、版本、大小、分类、上传人。 |
| 文件编辑 | 是 | 是 | 是 | 支持显示名、备注保存。 |
| 文件移动到分类 | 是 | 是 | 是 | 右侧工具窗可移动到其他分类。 |
| 文件移动到其他工单 | 是 | Native API 支持 | 部分 | API 支持 `workOrderId`，当前 Harmony UI 未提供跨工单选择器。 |
| 删除文件 | 是 | 是 | 是 | 调用 `/api/native/resource-files/[id]`，后端软删除。 |
| 恢复文件 | 是 | 是 | 是 | Settings 回收站调用 `/api/native/resource-files/[id]/restore`。 |
| 下载当前文件 | 是 | 是 | 部分 | 生成后端下载 URL，系统保存/打开由 `DownloadAdapter` 承接。 |
| 下载全部 ZIP | 是 | 是 | 部分 | 调用 native ZIP 下载 URL，系统保存/打开由 `DownloadAdapter` 承接。 |
| 复制文件链接 | 是 | 部分 | 否 | 当前原生未接系统剪贴板；未显示空按钮。 |
| 底部悬浮缩略图 | 是 | 是 | 是 | 多文件时显示，不显示“文件 0 个”。 |
| 上传 PDF | 是 | 部分 | 否 | 后端 native upload 已实现；Harmony 文件选择和 multipart 由 adapter 承接，设备不支持时提示使用 Web 端。 |
| 上传图片 | 是 | 部分 | 否 | 后端 native upload 已实现；Harmony 文件选择和 multipart 由 adapter 承接，设备不支持时提示使用 Web 端。 |
| 拍照上传 | 是 | 部分 | 否 | 保留 CameraAdapter 和上传链路；设备不支持时提示使用上传图片或 Web 端。 |
| 上传队列 | 是 | 是 | 部分 | 显示上传中、成功、失败；失败重试按钮尚未接入。 |
| 上传失败重试 | 是 | 部分 | 否 | 队列保留失败项，原生重试按钮尚未完整落地。 |
| 连接器参数查询 | 是 | 是 | 是 | 搜索型号、备注、数字参数。 |
| 连接器参数筛选 | 是 | 是 | 是 | 全部、缺外剥皮、缺内剥皮、缺入长、重点。 |
| 任意缺失筛选 | 是 | 部分 | 否 | 当前原生筛选按钮未单独提供“任意缺失”。 |
| 连接器参数新增 | 是 | 是 | 是 | 原生表单调用 native API。 |
| 连接器参数编辑 | 是 | 是 | 是 | 原生表单调用 native API。 |
| 连接器参数删除 | 是 | 是 | 是 | 删除确认弹窗和后端确认口令。 |
| 连接器参数恢复 | 是 | Native API 支持 | 部分 | API 已提供，当前 UI 尚未提供独立恢复列表。 |
| 重点标记 / 取消 | 是 | 是 | 是 | 编辑表单和批量操作均支持。 |
| 批量标记重点 | 是 | 是 | 是 | 表格多选后批量操作。 |
| 批量取消重点 | 是 | 是 | 是 | 表格多选后批量操作。 |
| 批量删除 | 是 | 是 | 是 | 表格多选后批量删除。 |
| 复制整行参数 | 是 | 是 | 部分 | 当前以 Toast 明示整行参数；系统剪贴板 adapter 尚未接入。 |
| CSV 导出 | 是 | 是 | 部分 | 下载 URL 已接入，系统保存由 `DownloadAdapter` 承接。 |
| 模板下载 | 是 | 是 | 部分 | 下载 URL 已接入，系统保存由 `DownloadAdapter` 承接。 |
| 导入预览 | 是 | 是 | 是 | 支持粘贴 CSV 文本预览。 |
| 确认导入 | 是 | 是 | 是 | 支持跳过或导入重复行。 |
| 重复行检测 | 是 | 是 | 是 | 后端预览接口识别 duplicate。 |
| 导入批次列表 | 是 | 是 | 是 | 工具抽屉显示最近批次。 |
| 导入批次回滚 | 是 | 是 | 是 | 调用 native rollback API。 |
| 原始资料附件上传 | 是 | Native API 支持 | 部分 | API 已支持；Harmony 文件选择上传仍由 adapter 承接，UI 当前显示列表/下载/删除。 |
| 原始资料附件下载 | 是 | 是 | 部分 | 下载 URL 已接入，系统保存由 `DownloadAdapter` 承接。 |
| 原始资料附件删除 | 是 | 是 | 是 | 工具抽屉可删除。 |
| 空值保持空白 | 是 | 是 | 是 | 后端导入解析保持空字段为空。 |
| 操作日志 | 是 | 是 | 是 | Settings 日志页读取最近 100 条，顶部提供日志入口。 |
| 系统设置 | 是 | 是 | 是 | Settings 多面板实现。 |
| 生产健康检查 | 是 | 是 | 是 | `/api/native/system/status`。 |
| 数据变更快照 | 是 | 是 | 是 | Settings 快照页显示。 |
| 回收站 | 是 | 是 | 是 | 显示已删工单/文件并可恢复。 |
| 诊断信息导出 | 是 | 是 | 是 | Settings 诊断页调用 native diagnostics。 |
| 全局搜索 | 是 | 是 | 是 | 顶部搜索触发工单/资料搜索入口。 |
| 语音输入 | 是 | Adapter 兜底 | 否 | 顶部语音按钮提示手动输入；未接系统语音识别 API。 |

## Native API 检查
- `/api/native/auth/login`
- `/api/native/auth/me`
- `/api/native/auth/logout`
- `/api/native/auth/change-password`
- `/api/native/work-orders`
- `/api/native/work-orders/[id]`
- `/api/native/work-orders/[id]/resources`
- `/api/native/work-orders/[id]/restore`
- `/api/native/work-orders/[id]/download-all`
- `/api/native/resource-files/upload`
- `/api/native/resource-files/[id]`
- `/api/native/resource-files/[id]/content`
- `/api/native/resource-files/[id]/download`
- `/api/native/resource-files/[id]/restore`
- `/api/native/connector-parameters`
- `/api/native/connector-parameters/[id]`
- `/api/native/connector-parameters/[id]/restore`
- `/api/native/connector-parameters/batch`
- `/api/native/connector-parameters/import/preview`
- `/api/native/connector-parameters/import/commit`
- `/api/native/connector-parameters/export.csv`
- `/api/native/connector-parameters/template.csv`
- `/api/native/connector-parameter-files`
- `/api/native/connector-parameter-files/upload`
- `/api/native/connector-parameter-files/[id]`
- `/api/native/connector-parameter-files/[id]/download`
- `/api/native/connector-parameter-import-batches`
- `/api/native/connector-parameter-import-batches/[id]/rollback`
- `/api/native/users`
- `/api/native/users/[id]`
- `/api/native/users/[id]/reset-password`
- `/api/native/operation-logs`
- `/api/native/trash`
- `/api/native/change-snapshots`
- `/api/native/system/status`
- `/api/native/system/diagnostics.json`

## 验证结果
- `npm run build`：通过。
- `npm run smoke`：通过。
- smoke 覆盖：
  - `/api/health`
  - `/manifest.webmanifest`
  - `/login`
  - `/api/native/system/status`
  - `/api/native/auth/login` 返回 JSON 格式检查
- Harmony 命令行构建：未执行。
- 未执行原因：本机 PATH 未发现 `ohpm`、`hvigor`、`hvigorw`，且 `harmony-tablet` 内没有 `hvigorw.bat`。

## ArkTS Strict 静态检查
- 未新增 `any`。
- 未新增 `unknown`。
- 未使用 `delete`。
- 未使用 `TextEncoder`。
- 未使用 WebView。
- 未发现 TODO、mock、待适配或待补齐用户可见文案。
- 普通对象动态索引未新增；数组下标访问保留。

## 受限能力说明
- 原生文件选择、相机拍照和系统级保存/打开能力继续通过 platform adapter 承接。
- 如果设备不支持对应原生能力，App 会提示使用上传图片或 Web 端上传，不会写入本地永久文件。
- ZIP、单文件下载和附件下载后端均由 S3 对象流返回，不长期保存在容器本地。

## 敏感信息检查
- 文档未写入数据库密码。
- 文档未写入 `DATABASE_URL`。
- 文档未写入 S3 Key 或 Secret。
- 文档未写入 `SESSION_SECRET`。
- 文档未写入 admin 密码或任何真实密码。

## 下一步建议
1. 在 DevEco Studio 中打开 `C:\Dev\hongmeng\harmony-tablet`。
2. 执行 Sync。
3. 执行 Clean Project。
4. 执行 Build / Make Project。
5. 安装到鸿蒙平板实机。
6. 验证登录、工作台、工单管理、资料管理、连接器参数、设置页和退出登录。
