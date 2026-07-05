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
- 资源文件上传入口、图片预览、PDF 文件卡片、下载/打开入口、复制链接、软删除、恢复接口、显示名/备注编辑、分类移动和工单 ID 移动。
- 连接器参数查询、筛选、新增、编辑、删除、恢复、批量标重点、批量取消重点、批量删除。
- 连接器参数 CSV 粘贴导入预览、CSV/XLS/XLSX 文件导入预览、确认导入、重复行策略、导入批次列表和导入批次回滚。
- 连接器参数 CSV 导出、模板下载、原始资料附件列表、附件下载和附件删除入口。
- 设置页：生产稳定中心、系统状态、账号管理、修改密码、操作日志、回收站、数据快照和诊断信息。

## Web / Harmony 功能对照表

| 功能 | Web 已有 | Harmony 已实现 | 是否完全可用 | 备注 |
| --- | --- | --- | --- | --- |
| 登录 | 是 | 是 | 是 | 调用 `/api/native/auth/login`，Bearer token 保存到 preferences。 |
| 退出登录 | 是 | 是 | 是 | 清理 token 后回到登录页。 |
| token 持久化 | 是 | 是 | 是 | `PreferencesAdapter` 承接。 |
| 401 自动回登录页 | 是 | 是 | 是 | `AuthStore.handleUnauthorized` 统一处理。 |
| 当前用户显示 | 是 | 是 | 是 | TopBar 和 Settings 均显示当前用户。 |
| 修改密码 | 是 | 是 | 是 | Settings 中调用 `/api/native/auth/change-password`。 |
| 账号管理 | 是 | 是 | 是 | 支持列表、新增、启用/禁用、输入新密码后重置；启用/禁用和重置密码均有二次确认，Native API 校验确认口令，后端阻止禁用最后一个 active 用户。 |
| 工单列表 | 是 | 是 | 是 | `WorkOrderStore.load` 调用 native API。 |
| 工单抽屉 | 是 | 是 | 是 | 覆盖式抽屉，支持搜索和状态筛选。 |
| 工单搜索 | 是 | 是 | 是 | 抽屉搜索按工单过滤；顶部全局搜索调用 `/api/native/search` 并展示工单/文件结果，文件结果使用 Native ticket URL。 |
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
| 复制工单链接 / 二维码 | 是 | 是 | 需真机验证 | 工单链接已接入 `ClipboardAdapter`；工单信息条可打开 ArkUI `QRCode` 直达二维码弹窗，并保留复制链接按钮。 |
| 资料分类 | 是 | 是 | 是 | 原图、SOP指导书、成品图、辅料规格、注意事项。 |
| 分类文件数量 | 是 | 是 | 是 | `ResourceStore.applyFileCounts` 计算并显示。 |
| 状态点 | 是 | 是 | 是 | 分类栏使用数量/必填状态表达。 |
| 缺资料统计 | 是 | 是 | 是 | 当前工单信息条和预览空态显示。 |
| 空态引导 | 是 | 是 | 是 | 无文件时显示资料缺失引导卡。 |
| 文件列表 | 是 | 是 | 是 | 当前分类文件和底部缩略条。 |
| 图片预览 | 是 | 是 | 是 | ArkUI `Image` 原生预览。 |
| PDF 卡片 / 预览入口 | 是 | 是 | 需真机验证 | 原生显示 PDF 卡片，提供系统预览和下载入口；内容/下载 URL 使用短期 ticket，不使用 WebView。 |
| 文件版本 | 是 | 是 | 是 | 文件卡片和信息窗显示 `version`，缺省 V1.0。 |
| 最新 / 历史标签 | 是 | 是 | 是 | 缩略条标记最新/历史。 |
| 文件信息 | 是 | 是 | 是 | 右侧工具窗展示名称、版本、大小、分类、上传人。 |
| 文件编辑 | 是 | 是 | 是 | 支持显示名、备注保存。 |
| 文件移动到分类 | 是 | 是 | 是 | 右侧工具窗可移动到其他分类。 |
| 文件移动到其他工单 | 是 | 是 | 是 | 右侧工具窗可从当前工单列表点选目标工单，也可输入目标工单 ID 后保存，当前工单会刷新并移除已移走文件。 |
| 删除文件 | 是 | 是 | 是 | UI 二次确认后调用 `/api/native/resource-files/[id]`，后端仍校验删除确认口令并软删除。 |
| 恢复文件 | 是 | 是 | 是 | Settings 回收站调用 `/api/native/resource-files/[id]/restore`。 |
| 下载当前文件 | 是 | 是 | 需真机验证 | `DownloadAdapter` 先用 Bearer 换短期 ticket URL，再交给系统能力打开；系统无法打开时自动复制短期下载链接，不在 App 本地长期保存文件。 |
| 下载全部 ZIP | 是 | 是 | 需真机验证 | 调用 native ZIP 下载 URL，`DownloadAdapter` 会先换短期 ticket，再由系统保存/打开；失败时复制短期下载链接。 |
| 复制文件链接 | 是 | 是 | 需真机验证 | `ClipboardAdapter` 写入系统剪贴板，失败时提示手动记录。 |
| 底部悬浮缩略图 | 是 | 是 | 是 | 多文件时显示，不显示“文件 0 个”。 |
| 上传 PDF | 是 | 是 | 需真机验证 | `FilePickerAdapter.pickPdf` 接系统文档选择器，`httpClient.uploadMultipart` 接 native multipart 上传。 |
| 上传图片 | 是 | 是 | 需真机验证 | `FilePickerAdapter.pickImages` 接系统图片选择器，上传成功后刷新并选中新文件。 |
| 拍照上传 | 是 | 是 | 需真机验证 | `CameraAdapter` 已提供现场照片入口；当前未启用直接相机能力时，右侧工具窗显示“选择现场照片”，提示先用系统相机拍照后选择图片，并保留上传图片兜底。 |
| 上传队列 | 是 | 是 | 是 | 显示上传中、成功、失败，失败项保留原始选择文件。 |
| 上传失败重试 | 是 | 是 | 是 | 支持单条失败重试和全部失败重试；文件选择能力仍依赖平台 adapter。 |
| 连接器参数查询 | 是 | 是 | 是 | 搜索型号、备注、数字参数。 |
| 连接器参数筛选 | 是 | 是 | 是 | 全部、缺外剥皮、缺内剥皮、缺入长、任意缺失、重点。 |
| 任意缺失筛选 | 是 | 是 | 是 | 原生按钮传递 `missing=any`，后端按外剥皮/内剥皮/入长任一缺失查询。 |
| 连接器参数新增 | 是 | 是 | 是 | 原生表单调用 native API。 |
| 连接器参数编辑 | 是 | 是 | 是 | 原生表单调用 native API。 |
| 连接器参数删除 | 是 | 是 | 是 | 删除确认弹窗和后端确认口令。 |
| 连接器参数恢复 | 是 | 是 | 是 | Settings 回收站显示已删除连接器参数并调用 restore API。 |
| 重点标记 / 取消 | 是 | 是 | 是 | 编辑表单和批量操作均支持。 |
| 批量标记重点 | 是 | 是 | 是 | 表格多选后批量操作。 |
| 批量取消重点 | 是 | 是 | 是 | 表格多选后批量操作。 |
| 批量删除 | 是 | 是 | 是 | 表格多选后弹出确认，再批量软删除。 |
| 复制整行参数 | 是 | 是 | 需真机验证 | `ClipboardAdapter` 写入系统剪贴板，失败时提示手动记录。 |
| CSV 导出 | 是 | 是 | 需真机验证 | 下载 URL 已接入，`DownloadAdapter` 会先换短期 ticket，再由系统保存/打开；失败时复制短期下载链接。 |
| 模板下载 | 是 | 是 | 需真机验证 | 下载 URL 已接入，`DownloadAdapter` 会先换短期 ticket，再由系统保存/打开；失败时复制短期下载链接。 |
| 导入预览 | 是 | 是 | 需真机验证 | 支持粘贴 CSV 文本预览，也支持通过 `FilePickerAdapter` 选择 CSV/XLS/XLSX 文件后 multipart 预览。 |
| 确认导入 | 是 | 是 | 是 | 支持跳过或导入重复行；超过 100 行时 Harmony UI 和 Native API 均要求 `IMPORT_CONFIRM`。 |
| 重复行检测 | 是 | 是 | 是 | 后端预览接口识别 duplicate。 |
| 导入批次列表 | 是 | 是 | 是 | 工具抽屉显示最近批次。 |
| 导入批次回滚 | 是 | 是 | 是 | 弹出确认后调用 native rollback API，服务层和后端均校验 `ROLLBACK` 确认口令。 |
| 原始资料附件上传 | 是 | 是 | 需真机验证 | UI 已提供上传按钮，`FilePickerAdapter.pickAnySupportedFile` + native multipart API 上传。 |
| 原始资料附件下载 | 是 | 是 | 需真机验证 | Native 列表和上传响应返回短期 ticket 下载 URL，系统保存/打开由 `DownloadAdapter` 承接；失败时复制短期下载链接。 |
| 原始资料附件删除 | 是 | 是 | 是 | 工具抽屉弹出确认后删除，Native 后端校验 `DELETE` 确认口令。 |
| 空值保持空白 | 是 | 是 | 是 | 后端导入解析保持空字段为空。 |
| 操作日志 | 是 | 是 | 是 | TopBar 日志入口可直达 Settings 日志面板，读取最近 100 条，不显示敏感信息。 |
| 系统设置 | 是 | 是 | 是 | TopBar 设置入口进入生产稳定中心，Settings 多面板覆盖账号、密码、日志、回收站、快照和诊断。 |
| 生产健康检查 | 是 | 是 | 是 | `/api/native/system/status`，返回版本标识为 `v2.0.0-native-rc.5`。 |
| 生产稳定中心 | 是 | 是 | 是 | Settings 独立入口聚合服务、数据库、对象存储、数据量、风险提示、日志、回收站和诊断入口。 |
| 数据变更快照 | 是 | 是 | 是 | Settings 快照页显示。 |
| 回收站 | 是 | 是 | 是 | 显示已删工单、文件、连接器参数并可恢复。 |
| 诊断信息导出 | 是 | 是 | 是 | Settings 诊断页调用 native diagnostics，并可复制诊断 JSON。 |
| 全局搜索 | 是 | 是 | 是 | 顶部搜索调用 native search，结果面板可直达工单或定位文件，文件 DTO 不返回 Web cookie 下载路径。 |
| 语音输入 | 是 | 是 | 需真机验证 | `VoiceInputAdapter` 覆盖全局搜索、工单搜索、工单备注、连接器搜索/备注、文件备注；当前设备能力不可用时按钮显示手动输入，并提示键盘录入。 |

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
- `/api/native/search`
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
- `/api/native/download-ticket`

## 验证结果
- `npm run build`：通过。
- `npm run smoke`：通过。
- `npm run harmony:check`：通过，扫描 45 个 ArkTS 文件，并检查 Harmony 工程关键结构、rc5 版本标识、API 地址、页面 profile / 路由常量、Tablet / Entry 配置、`.gitignore`、敏感字符串和禁暂存本地签名 / 生成目录。
- smoke 覆盖：
  - `/api/health`
  - `/manifest.webmanifest`
  - `/login`
  - `/api/native/system/status`
  - `/api/native/auth/login` 返回 JSON 格式检查
  - `/api/native/download-ticket` 返回 JSON 格式检查
  - `/api/native/auth/me` 返回 JSON 格式检查
  - `/api/native/work-orders` 返回 JSON 格式检查
  - `/api/native/search` 返回 JSON 格式检查
  - `/api/native/connector-parameters` 返回 JSON 格式检查
  - `/api/native/connector-parameter-files` 返回 JSON 格式检查
  - `/api/native/connector-parameter-import-batches` 返回 JSON 格式检查
  - `/api/native/users` 返回 JSON 格式检查
  - `/api/native/operation-logs` 返回 JSON 格式检查
  - `/api/native/trash` 返回 JSON 格式检查
  - `/api/native/change-snapshots` 返回 JSON 格式检查
  - `/api/native/system/diagnostics.json` 返回 JSON 格式检查
  - Native 动态和写入路由无登录探测：账号、工单、资源文件、连接器参数、导入批次、附件上传/下载/删除均返回 JSON 格式错误，不返回 HTML 或 404 页面
  - 动态路由覆盖：`/api/native/work-orders/[id]`、`/api/native/resource-files/[id]`、`/api/native/connector-parameters/[id]`、`/api/native/users/[id]`、`/api/native/connector-parameter-files/[id]`
  - 写入路由覆盖：POST / PATCH / DELETE 的工单、文件、账号、连接器参数、导入批次回滚和附件操作
- smoke 不包含真实账号密码，不写入业务数据；未登录写入路由仅验证路由存在和统一 `{ ok, error }` 返回格式。
- Harmony 命令行构建：未执行。
- 未执行原因：本机 PATH 未发现 `ohpm`、`hvigor`、`hvigorw`，且 `harmony-tablet` 内没有 `hvigorw.bat`。

## ArkTS Strict / 工程约束静态检查
- 已新增 `scripts/harmony-static-check.mjs`，并通过 `npm run harmony:check` 执行。
- 已检查 `AppScope/app.json5` 的 `versionName` 和 `oh-package.json5` 的 `version` 均为 `2.0.0-native-rc.5`。
- 已检查 `/api/native/system/status` 的版本标识为 `v2.0.0-native-rc.5`，并检查 Native search / trash 文件 DTO 不复用 Web cookie 下载路径。
- 已检查 Native download-ticket 白名单覆盖资源 content/download、工单 ZIP、连接器附件、连接器 CSV 导出和模板下载路径。
- 已检查 Native 危险操作确认口令：工单删除、文件删除、连接器删除/批量删除、附件删除、导入确认、导入批次回滚、账号启停、重置密码和最后 active 用户保护。
- 已检查 `API_BASE_URL` 保持为 `https://qdowqencjyph.sealoshzh.site`。
- 已检查 `main_pages.json`、`Routes` 常量和 `EntryAbility` 入口页覆盖 Login、Workbench、ConnectorParameters、Settings。
- 已检查页面文件中的 `this.xxx()` 方法调用均有同文件方法定义，避免页面编译期出现缺失方法引用。
- 已检查 `module.json5` 为 entry 模块、包含 EntryAbility、Tablet deviceTypes、startWindowIcon 和 startWindowBackground。
- 已检查 `.gitignore` 包含 `oh_modules`、`build`、`.hvigor`、`.idea`、`local.properties`、`node_modules`、`.next` 和 `.env` 相关规则。
- 已检查当前没有暂存 `harmony-tablet/build-profile.json5`、`local.properties` 或 Harmony 生成目录。
- 已检查 Harmony 工程源码和配置未包含 `DATABASE_URL`、`SESSION_SECRET`、S3 Secret、`passwordHash` 或常见访问密钥格式。
- 未新增 `any`。
- 未新增 `unknown`。
- 未使用 `delete`。
- 未使用 `TextEncoder`。
- 未使用 WebView。
- 未发现 TODO、mock、待适配或待补齐用户可见文案。
- 普通对象动态索引未新增；数组下标访问保留。

## 受限能力说明
- 原生文件选择、现场照片入口、系统级保存/打开、剪贴板和语音输入继续通过 platform adapter 承接。
- `FilePickerAdapter` 已接入文档选择器、图片选择器和附件选择器；`httpClient.uploadMultipart` 已接 native multipart 上传。
- 右侧工具窗展示 `FilePickerAdapter` / `CameraAdapter` 的状态和 guidance；系统选择器或直接相机能力不可用时，给出“请使用上传图片或 Web 端完成”等面向现场使用的替代方案。
- `DownloadAdapter` 对 native 下载会先用 Bearer 换短期 ticket URL，再使用系统能力打开；没有打开上下文或系统无法打开时，会自动复制短期下载链接，不在 App 本地长期保存文件。
- `ClipboardAdapter` 写入系统剪贴板；`VoiceInputAdapter` 在系统语音不可用时提供手动输入兜底。
- 如果设备不支持对应原生能力，App 会给出明确用户提示，不会写入本地永久文件。
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
