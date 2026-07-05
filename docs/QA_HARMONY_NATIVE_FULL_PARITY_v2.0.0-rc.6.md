# Harmony Native Full Parity QA - v2.0.0-native-rc.6

## 基本信息
- 版本：v2.0.0-native-rc.6
- 阶段：功能对齐收口候选版
- 范围：Harmony 原生 ArkTS / ArkUI App 对齐 Web 版 v1.12+ 核心生产流程
- 约束：不使用 WebView，不改 Prisma schema，不改数据库结构，不提交密钥或本地签名配置
- 说明：本轮停止继续零散安全小修，仅做下载 ticket 改动验证、真实功能对照表和收口固化

## 状态口径
- `是`：代码与 Native API 证据显示功能链路已实现，且不依赖未验证的系统外部能力。
- `需 DevEco 真机验证`：代码已实现，但依赖 Harmony 系统能力、DevEco 构建运行、设备权限、剪贴板、下载打开、二维码渲染、文件选择器、相机或语音能力。
- `未完全可用`：当前代码中仍有明确功能缺口。本轮未发现需要新增业务功能的阻塞缺口。

## Web / Harmony 功能对照表

| 功能 | Web 版状态 | Harmony 版状态 | 是否完全可用 | 如果未完全可用，原因 | 下一步处理方式 |
| --- | --- | --- | --- | --- | --- |
| 登录 | 已有 | 原生登录页调用 `/api/native/auth/login`，token 持久化 | 是 | - | DevEco 回归登录流程 |
| 退出登录 | 已有 | TopBar / Settings 调用 `AuthStore.logout` | 是 | - | DevEco 回归退出跳转 |
| token 持久化 | 已有 | `PreferencesAdapter` 保存 token 和用户信息 | 是 | - | DevEco 回归冷启动 |
| 401 自动回登录页 | 已有 | `AuthStore.handleUnauthorized` 统一回登录页 | 是 | - | DevEco 回归失效 token |
| 当前用户显示 | 已有 | TopBar 和 Settings 显示当前用户 | 是 | - | DevEco 视觉确认 |
| 修改密码 | 已有 | Settings 调用 `/api/native/auth/change-password`，成功后退出 | 是 | - | DevEco 回归并确认密码输入态清理 |
| 账号管理 | 已有 | Settings 账号面板支持列表和操作 | 是 | - | DevEco 回归列表展示 |
| 新增账号 | 已有 | Settings 调用 `/api/native/users` | 是 | - | DevEco 回归表单输入 |
| 禁用 / 启用账号 | 已有 | Settings 调用 `/api/native/users/[id]`，带 ENABLE / DISABLE 确认 | 是 | - | DevEco 回归二次确认 |
| 重置密码 | 已有 | Settings 调用 `/api/native/users/[id]/reset-password`，带 RESET_PASSWORD 确认 | 是 | - | DevEco 回归密码输入 |
| 工单列表 | 已有 | `WorkOrderStore.load` 调用 `/api/native/work-orders` | 是 | - | DevEco 回归列表滚动 |
| 默认选中第一个工单 | 已有 | `WorkbenchPage.load` 在列表非空时选中第一条并加载资源 | 是 | - | DevEco 回归首次进入 |
| 工单抽屉 | 已有 | 覆盖式 `WorkOrderDrawer` | 是 | - | DevEco 视觉确认 |
| 工单搜索 | 已有 | 抽屉搜索和全局搜索均接入 Native API | 是 | - | DevEco 回归输入 |
| 状态筛选 | 已有 | 抽屉状态筛选覆盖未发图 / 在前端 / 在后端 / 已完成 | 是 | - | DevEco 回归筛选按钮 |
| 当前工单信息条 | 已有 | `CurrentWorkOrderBar` 展示客户、工单、产品、状态、优先级、plannedAt 和资料状态 | 是 | - | DevEco 视觉确认 |
| 新建工单 | 已有 | Workbench 表单调用 `/api/native/work-orders` | 是 | - | DevEco 回归表单 |
| 编辑工单 | 已有 | Workbench 表单调用 `/api/native/work-orders/[id]` | 是 | - | DevEco 回归保存 |
| 删除工单强确认 | 已有 | UI 二次确认，Native API 校验工单号 + CONFIRM | 是 | - | DevEco 回归确认弹窗 |
| 恢复工单 | 已有 | Settings 回收站调用 `/api/native/work-orders/[id]/restore` | 是 | - | DevEco 回归回收站 |
| 状态快速修改 | 已有 | `cycleCurrentStage` 调用 Native PATCH | 是 | - | DevEco 回归标签点击 |
| 优先级快速修改 | 已有 | `cycleCurrentPriority` 调用 Native PATCH | 是 | - | DevEco 回归标签点击 |
| plannedAt | 已有 | 工单表单和信息条支持 | 是 | - | DevEco 视觉确认 |
| customerName | 已有 | 工单表单、信息条、抽屉支持 | 是 | - | DevEco 视觉确认 |
| 资料完整性 | 已有 | 工单 DTO 和 UI 展示完整 / 缺资料 / 空工单 | 是 | - | DevEco 视觉确认 |
| 原图 | 已有 | 默认五类之一 | 是 | - | DevEco 视觉确认 |
| SOP指导书 | 已有 | 默认五类之一 | 是 | - | DevEco 视觉确认 |
| 成品图 | 已有 | 默认五类之一 | 是 | - | DevEco 视觉确认 |
| 辅料规格 | 已有 | 默认五类之一 | 是 | - | DevEco 视觉确认 |
| 注意事项 | 已有 | 默认五类之一 | 是 | - | DevEco 视觉确认 |
| 上传管理 | 已有 | 右侧工具窗上传页和队列页 | 是 | - | DevEco 视觉确认 |
| 分类数量 | 已有 | `ResourceStore.applyFileCounts` 统计 | 是 | - | DevEco 视觉确认 |
| 状态点 | 已有 | 分类栏状态点和必填分类状态 | 是 | - | DevEco 视觉确认 |
| 文件列表 | 已有 | 当前分类文件列表和底部缩略图 | 是 | - | DevEco 回归列表 |
| 图片预览 | 已有 | ArkUI `Image` 原生显示 | 需 DevEco 真机验证 | 图片 URI 渲染依赖设备运行环境 | DevEco 真机打开图片资源验证 |
| PDF 卡片 / 预览入口 | 已有 | PDF 卡片、打开和下载入口，不使用 WebView | 需 DevEco 真机验证 | 系统 PDF 打开能力需设备验证 | DevEco 真机打开 PDF |
| 文件版本 | 已有 | 文件卡片和信息窗显示 version，缺省 V1.0 | 是 | - | DevEco 视觉确认 |
| 最新 / 历史 | 已有 | 缩略图条显示最新 / 历史 | 是 | - | DevEco 视觉确认 |
| 文件信息 | 已有 | 右侧工具窗信息页 | 是 | - | DevEco 视觉确认 |
| 文件编辑 | 已有 | 右侧工具窗编辑显示名和备注 | 是 | - | DevEco 回归保存 |
| 文件移动分类 | 已有 | 右侧工具窗选择分类后保存 | 是 | - | DevEco 回归分类移动 |
| 文件移动工单 | 已有 | 可点选工单或输入目标工单 ID 后保存 | 是 | - | DevEco 回归跨工单移动 |
| 删除文件强确认 | 已有 | UI 二次确认，Native API 校验 DELETE | 是 | - | DevEco 回归确认弹窗 |
| 恢复文件 | 已有 | Settings 回收站调用 `/api/native/resource-files/[id]/restore` | 是 | - | DevEco 回归回收站 |
| 下载当前 | 已有 | `DownloadAdapter` 刷新短期 ticket 后交给系统打开 | 需 DevEco 真机验证 | 系统下载 / 打开能力依赖设备 | DevEco 真机下载文件 |
| 下载全部 ZIP | 已有 | 当前工单 ZIP 下载 URL 接入 `DownloadAdapter` | 需 DevEco 真机验证 | 系统下载 / 打开能力依赖设备 | DevEco 真机下载资料包 |
| 复制文件链接 | 已有 | `DownloadAdapter.copyDownloadUrl` 刷新短期 ticket 后复制 | 需 DevEco 真机验证 | 剪贴板能力需设备验证 | DevEco 真机复制并粘贴验证 |
| 缩略图浮层 | 已有 | 多文件时显示底部悬浮缩略图条 | 是 | - | DevEco 视觉确认 |
| 空态引导 | 已有 | 无文件时显示缺资料引导卡 | 是 | - | DevEco 视觉确认 |
| 上传 PDF | 已有 | `FilePickerAdapter.pickPdf` + native multipart 上传 | 需 DevEco 真机验证 | 系统文档选择器和 URI 访问需设备验证 | DevEco 真机选择 PDF 上传 |
| 上传图片 | 已有 | `FilePickerAdapter.pickImages` + native multipart 上传 | 需 DevEco 真机验证 | 系统图片选择器和 URI 访问需设备验证 | DevEco 真机选择图片上传 |
| 拍照上传 | 已有 | `CameraAdapter` 提供现场照片入口和上传确认；直接相机不可用时使用上传图片兜底 | 需 DevEco 真机验证 | 直接相机 / 图片选择能力依赖设备权限 | DevEco 真机拍照或选择现场照片 |
| 上传队列 | 已有 | 显示上传中、成功、失败状态 | 是 | - | DevEco 视觉确认 |
| 上传失败重试 | 已有 | 单条重试复用原队列项 | 是 | - | DevEco 回归失败重试 |
| 批量重试失败 | 已有 | 批量逐条复用失败队列项 | 是 | - | DevEco 回归批量重试 |
| 上传成功刷新文件列表 | 已有 | `ResourceStore.upload` 更新列表并刷新当前分类 | 是 | - | DevEco 回归上传后列表 |
| 上传后选中新文件 | 已有 | 上传成功后 `selectedFile = uploaded` | 是 | - | DevEco 回归选中状态 |
| 参数列表 | 已有 | `ConnectorParametersPage` 调用 Native 列表 API | 是 | - | DevEco 回归表格 |
| 搜索 | 已有 | 支持型号、备注、数字参数搜索 | 是 | - | DevEco 回归搜索 |
| 缺失筛选 | 已有 | 缺外剥皮、缺内剥皮、缺入长、任意缺失 | 是 | - | DevEco 回归筛选 |
| 重点筛选 | 已有 | 支持重点筛选 | 是 | - | DevEco 回归筛选 |
| 新增参数 | 已有 | 表单调用 Native 创建 API | 是 | - | DevEco 回归表单 |
| 编辑参数 | 已有 | 表单调用 Native PATCH API | 是 | - | DevEco 回归保存 |
| 删除参数强确认 | 已有 | UI 确认，Native API 校验 DELETE | 是 | - | DevEco 回归删除 |
| 恢复参数 | 已有 | Settings 回收站调用 restore API | 是 | - | DevEco 回归回收站 |
| 批量标记重点 | 已有 | 批量 API action `mark` | 是 | - | DevEco 回归批量选择 |
| 批量取消重点 | 已有 | 批量 API action `unmark` | 是 | - | DevEco 回归批量选择 |
| 批量删除 | 已有 | 批量 API action `delete`，带 DELETE 确认 | 是 | - | DevEco 回归批量删除 |
| 复制整行参数 | 已有 | `ClipboardAdapter` 复制整行参数文本 | 需 DevEco 真机验证 | 剪贴板能力需设备验证 | DevEco 真机复制粘贴验证 |
| 导入预览 | 已有 | 支持粘贴 CSV 文本和 CSV/XLS/XLSX 文件预览 | 需 DevEco 真机验证 | 文件选择导入需设备 picker 验证；粘贴文本可走代码/API | DevEco 真机验证文件导入预览 |
| 确认导入 | 已有 | 调用 Native commit API，支持大批量 IMPORT_CONFIRM | 是 | - | DevEco 回归提交 |
| 重复检测 | 已有 | Native preview 返回 duplicate / invalid / skipped | 是 | - | DevEco 回归预览结果 |
| 导入批次列表 | 已有 | 调用 `/api/native/connector-parameter-import-batches` | 是 | - | DevEco 回归批次列表 |
| 导入批次回滚 | 已有 | 调用 rollback API，带 ROLLBACK 确认 | 是 | - | DevEco 回归回滚确认 |
| CSV 导出 | 已有 | `DownloadAdapter` 下载导出 URL | 需 DevEco 真机验证 | 系统下载 / 打开能力依赖设备 | DevEco 真机导出 CSV |
| 模板下载 | 已有 | `DownloadAdapter` 下载模板 URL | 需 DevEco 真机验证 | 系统下载 / 打开能力依赖设备 | DevEco 真机下载模板 |
| 原始资料附件上传 | 已有 | `FilePickerAdapter.pickAnySupportedFile` + multipart 上传 | 需 DevEco 真机验证 | 系统文件选择器和 URI 访问需设备验证 | DevEco 真机上传附件 |
| 原始资料附件下载 | 已有 | 附件下载 URL 接入 `DownloadAdapter` | 需 DevEco 真机验证 | 系统下载 / 打开能力依赖设备 | DevEco 真机下载附件 |
| 原始资料附件删除 | 已有 | 调用附件 DELETE API，带 DELETE 确认 | 是 | - | DevEco 回归删除确认 |
| 系统设置 | 已有 | Settings 多面板 | 是 | - | DevEco 视觉确认 |
| 系统健康状态 | 已有 | `/api/native/system/status` | 是 | - | DevEco 回归状态页 |
| 生产稳定中心 | 已有 | Settings 默认稳定中心 | 是 | - | DevEco 视觉确认 |
| 操作日志 | 已有 | Settings 日志面板和 TopBar 入口 | 是 | - | DevEco 回归日志页 |
| 数据变更快照 | 已有 | Settings 快照面板 | 是 | - | DevEco 回归快照页 |
| 回收站 | 已有 | Settings 回收站覆盖工单、文件、连接器参数 | 是 | - | DevEco 回归恢复 |
| 诊断信息导出 | 已有 | Settings 诊断页复制 JSON | 需 DevEco 真机验证 | 剪贴板能力需设备验证 | DevEco 真机复制诊断 JSON |
| 全局搜索 | 已有 | TopBar 搜索调用 `/api/native/search` | 是 | - | DevEco 回归搜索跳转 |
| 语音输入 | 已有 | `VoiceInputAdapter` 提供手动输入兜底 | 需 DevEco 真机验证 | 系统语音能力未在本机验证 | DevEco 真机验证语音按钮和兜底 |
| 工单搜索语音输入 | 已有 | 工单抽屉接入 `VoiceInputAdapter` | 需 DevEco 真机验证 | 系统语音能力未在本机验证 | DevEco 真机验证工单搜索语音 |
| 表单语音输入 | 已有 | 工单备注、文件备注、连接器备注等接入 adapter | 需 DevEco 真机验证 | 系统语音能力未在本机验证 | DevEco 真机验证表单语音 |

## 仍未完全可用的功能清单
当前代码/API 层未发现必须新增业务功能的阻塞缺口；未完全可用项均来自 Harmony 系统能力或本轮未执行 DevEco 真机构建运行：
- PDF 系统预览 / 打开
- 图片 URI 真机渲染
- 下载当前文件
- 下载全部 ZIP
- 复制文件链接
- 上传 PDF
- 上传图片
- 拍照上传 / 现场照片入口
- 复制整行连接器参数
- 文件导入预览中的 CSV/XLS/XLSX 选择器路径
- CSV 导出
- 模板下载
- 原始资料附件上传
- 原始资料附件下载
- 诊断信息复制
- 语音输入、工单搜索语音输入、表单语音输入

## 需要 DevEco 真机验证的功能清单
- DevEco Studio Clean Project / Build / Run entry
- 登录后进入 Workbench 并默认选中第一个工单
- 工单抽屉、当前工单条、资料分类栏、预览区、右侧工具窗整体视觉
- 文件选择器：PDF、图片、CSV/XLS/XLSX、附件
- 现场照片入口：系统相机拍照后选择图片或系统图片选择器
- 系统下载 / 打开：PDF、图片、ZIP、CSV、模板、附件
- 剪贴板：工单链接、文件链接、连接器整行参数、诊断 JSON
- QRCode 渲染与扫码直达链接
- 语音输入 adapter 和手动输入兜底

## 本轮验证
- `npm run harmony:check`：通过。
- `git diff --check`：通过，仅 Windows 换行提示。
- `npm run build`：通过，仅既有 Next.js `<img>` lint warning。
- `npm run smoke`：通过。
- Harmony 命令行构建：未执行，本机 PATH 未发现 `ohpm`、`hvigor`、`hvigorw`，且仓库未提供 `harmony-tablet/hvigorw.bat`。

## 敏感信息与约束检查
- 未写入数据库密码、`DATABASE_URL`、S3 Key、`SESSION_SECRET`、admin 密码、token 或任何真实密码。
- 不使用 WebView。
- 不提交 `harmony-tablet/build-profile.json5` 本地签名配置。
- 不提交 `oh_modules`、`build`、`.hvigor`、`.idea`、`local.properties`。

## 收口结论
- 建议进入 DevEco Studio 统一 Build / Run / 真机验收。
- `v2.0.0-native-rc.6` 不覆盖旧 `v2.0.0-native-rc.5` tag。
- 若 DevEco 真机验收发现 ArkTS 编译或系统能力差异，应只修对应 adapter 或页面阻塞问题，不再扩展无关安全增强或新业务功能。
