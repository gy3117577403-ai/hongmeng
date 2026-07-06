# 周计划生产工单显示与清理机制

版本：v1.13.6-weekly-plan-production-cleanup

状态：本地开发与上线前验证版本，等待统一部署验收。

## 目标

周计划 Excel 导入后，现场识别工单主要依赖 Excel 中的“规格”，例如 `D010304-8233-V02`。系统仍保留内部唯一编号 `code`，但页面主要显示改为：

```text
displayCode = specification || code
```

这样工单卡片、当前工单信息条、搜索结果、ZIP 文件名、打印摘要和二维码展示都优先显示现场熟悉的规格 / 生产编号。

## 数据字段

`WorkOrder` 新增周计划和资料匹配字段：

- `planType`：`weekly_plan` / `manual` / `library`
- `weekStartDate`：计划周开始日期
- `weekEndDate`：计划周结束日期
- `planActive`：是否仍显示在当前生产工单列表
- `planClearedAt`：清理时间
- `planClearedBy`：清理人
- `libraryKey`：资料库匹配键，周计划导入时使用 `specification`
- `drawingLibraryItemId`：关联长期图纸资料库记录

这些字段只用于生产计划显示、清理和同规格资料提示，不会删除历史数据。

长期图纸资料库使用独立的 `DrawingLibraryItem` / `DrawingLibraryFile`，只保存客户、客户编码、规格、品名、备注和资料文件，不保存图纸状态、配料状态、交期、未交量、工时、业务员或订单日期。

## 周计划导入规则

周计划 Excel / CSV 导入时：

- `specification` 作为主显示编号。
- `libraryKey = specification`。
- 如果已有匹配的 `DrawingLibraryItem`，则自动关联。
- 如果没有匹配记录，不再自动创建空图纸资料记录。
- 找到匹配时，`WorkOrder.drawingLibraryItemId` 指向长期图纸资料记录；找不到时保持为空。
- `planType = weekly_plan`。
- `planActive = true`。
- `weekStartDate` 和 `weekEndDate` 来自导入时选择的计划周。

手工新建工单默认：

- `planType = manual`。
- `planActive = true`。
- `libraryKey = specification || code`。
- 如填写了规格，会尝试关联已有图纸资料库记录；不存在时不自动创建空记录。

## 当前工单顶部条

从 v1.13.7 开始，当前工单顶部信息条只保留现场最常用的两项：

- 客户
- 规格

顶部条不再展示品名、未交量、图纸状态、配料状态、交期、状态、优先级、资料数量或计划时间，避免平板横屏页面被一整排标签挤满。

规格旁提供“复制规格”按钮：

- 优先复制完整 `specification`。
- 如果 `specification` 为空，则复制内部 `code`，并提示“规格未设置，已复制内部编号”。
- 如果无可复制内容，则提示“暂无可复制内容”。
- Android WebView APK 下优先使用 `AndroidBridge.copyText`，普通浏览器使用 Clipboard API，最后使用 textarea fallback。

顶部条移除的信息仍保留在右侧信息面板中，包括客户、规格、品名、订单日期、业务员、客户等级、工序、未交量、工时、总工时、图纸状态、配料状态、交期、计划时间、图纸下发、来源订单、来源行号、导入批次和内部编号。

内部 `WO-*` 编号仍保留为数据库唯一编号，只放在详情、确认和导出等辅助位置，不作为顶部主显示。

## 默认列表规则

默认工单列表和现场概览只显示：

```text
deletedAt = null
planActive = true
```

因此“一键清理本周生产工单”后，工单会退出当前生产列表，但数据库记录、资料文件和对象存储文件仍保留。

## 一键清理本周生产工单

入口：系统设置 -> 工单批量导入区域。

流程：

1. 选择计划周开始日期。
2. 点击“预览清理”。
3. 查看将影响的生产工单数量、已上传资料工单数量、不会删除的文件数量和连接器参数数量。
4. 输入 `CLEAR_WEEK`。
5. 点击“确认清理本周工单”。

后端 API：

- `POST /api/work-orders/clear-weekly-plan/preview`
- `POST /api/work-orders/clear-weekly-plan/commit`

正式清理只更新：

```text
planActive=false
planClearedAt=now()
planClearedBy=current user
```

操作日志 action：

```text
clear_weekly_plan_work_orders
```

## 不会被清理的数据

本功能不会删除：

- `WorkOrder` 记录
- `DrawingLibraryItem` 图纸资料库记录
- `DrawingLibraryFile` 图纸资料库文件记录
- `ResourceFile` 记录
- S3 / Object Storage 文件对象
- `ConnectorParameter`
- 连接器参数附件
- 连接器导入批次
- 用户账号
- 资源分类

## 与旧清库脚本的区别

`scripts/clear-workorder-data.mjs` 是维护窗口使用的真实清库脚本，必须显式设置确认环境变量后才会执行，并可能清理工单、文件元数据和可选 S3 对象。

v1.13.6 新增的“本周生产工单清理”是业务软清理，只让本周周计划工单退出当前生产列表，不删除资料库里的工单资料。

从 v1.13.9 开始，清理本周生产工单不会删除图纸资料库；周计划导入也不会再自动创建空图纸资料记录。图纸资料库是长期主数据，后续同客户同规格再次导入周计划时会继续复用已有资料记录。

## 同规格历史资料提示

当前分类没有文件时，系统会按 `libraryKey || specification || code` 查找其他未删除工单的同规格资料数量，并在空态卡片中提示“发现同规格历史资料”。

系统不会自动复制或移动旧资料，现场人员可根据提示手动查看、下载或重新上传，避免误关联。

## 验收重点

- 周计划导入后，工单卡片主标题显示规格，不显示 `WO-*`。
- ZIP 文件名使用规格作为前缀。
- 搜索仍可按规格、客户、品名、SO 单号和内部编号查找。
- 清理预览不改变数据。
- commit 必须输入 `CLEAR_WEEK`。
- 清理后默认列表不再显示本周已清理生产工单。
- 资源文件、S3 对象和连接器参数不受影响。

## 敏感信息

本文档不包含数据库密码、`DATABASE_URL`、S3 Key、S3 Secret、`SESSION_SECRET`、账号密码或任何真实密钥。
