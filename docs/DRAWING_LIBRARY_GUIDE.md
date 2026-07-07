# 图纸资料库使用说明

版本：v1.13.10-layout-layer-preview-polish

状态：本地开发与上线前候选功能，等待统一部署验收。

## 定位

图纸资料库是长期资料主数据，不是本周生产计划，也不是周计划工单列表。

它只按客户、产品规格、品名和资料文件管理长期可复用图纸资料。所有登录账号共享同一套数据，不做角色权限。

## v1.14.0 生产资料自动沉淀

生产工单资料库上传 PDF / JPG / PNG 后，会在保留 `ResourceFile` 的同时自动同步到图纸资料库。

- 当前工单必须有规格 `specification`，系统按 `客户 + 规格` 归档。
- 如果图纸资料库已有对应客户和规格，复用已有 `DrawingLibraryItem`。
- 如果不存在，上传生产资料时创建新的长期图纸资料记录。
- `DrawingLibraryFile` 复用生产资料的 S3 `objectKey`，不会重复上传 S3 对象。
- `sourceResourceFileId` 用于记录来源生产资料文件，避免同一 `ResourceFile` 重复同步。
- 如果当前工单未设置规格，生产资料仍会正常保存到工单，但不会自动进入图纸资料库。
- 连接器参数资料库、周计划导入和本周清理机制不受影响。

已有生产资料可在当前工单“更多”菜单或右侧信息 / 操作面板点击“同步到图纸资料库”进行补同步，也可以使用命令行 dry-run 脚本先检查影响范围。

## v1.13.10 布局说明

图纸资料库详情页已经精简为长期资料管理视图：

- 顶部只保留规格、客户、品名、资料状态和最近更新时间。
- 不再展示周计划字段，也不展示大块重复信息卡。
- 主内容区采用分类栏、预览区、文件列表三栏布局。
- PDF / 图片预览区是主区域，右侧文件列表不再挤压核心预览空间。
- 顶部资料库菜单和用户菜单使用统一浮层，避免被 PDF / 图片预览或右侧栏遮挡。

## 保存字段

`DrawingLibraryItem` 只保存：

- 客户
- 客户编码，如果能从客户名称括号中解析
- 产品规格
- 品名 / 产品名称
- 资料完整度
- 最近更新时间
- 备注
- 最近关联工单和导入时间

`DrawingLibraryFile` 保存：

- 图纸资料记录 ID
- 资料分类
- 原始文件名
- 显示文件名
- MIME 类型
- 文件大小
- 版本
- S3 对象 key
- 上传人
- 备注
- 软删除时间

## 不进入图纸资料库的字段

以下字段属于 `WorkOrder` 的周计划 / 生产工单，不写入 `DrawingLibraryItem`，也不在图纸资料库首页展示：

- 图纸已发 / 未发
- 配料状态
- 交期
- 未交量
- 工时
- 总工时
- 业务员
- 订单日期
- 客户等级
- 来源订单号
- 周几
- 本周计划状态

这些字段继续在生产工单和周计划页面显示。

## 唯一匹配规则

图纸资料库匹配键：

```text
customerName + "::" + specification
```

如果客户为空：

```text
specification
```

同一客户同一规格只保留一条长期图纸资料记录。

## 周计划导入关联

周计划 Excel / CSV 确认导入时：

1. `WorkOrder` 保存完整周计划字段。
2. 系统读取 `customerName` 和 `specification`。
3. 按图纸资料库匹配键查找 `DrawingLibraryItem`。
4. 如果存在则关联。
5. 如果不存在，不再自动创建可见图纸资料记录。
6. `WorkOrder.drawingLibraryItemId` 保持为空，生产工单仍保留 `specification` 和 `libraryKey`。
7. 只有用户手动新增图纸资料，或在生产工单上传图纸资料文件时，才创建长期图纸资料记录。

导入不会把图纸状态、配料状态、交期、未交量、工时等周计划字段写入图纸资料库。

这样可以避免图纸资料库首页被周计划中的所有规格填满，默认只展示真正有长期维护价值的资料记录。

## 默认显示规则

图纸资料库首页默认显示：

- 有图纸资料文件的记录。
- 用户手动新增的记录。
- 有备注的记录。
- 已经被维护过且能确认有长期资料价值的记录。

默认不显示：

- 周计划导入自动产生的空壳记录。
- `0/5`、`0 个文件` 且无备注的空资料记录。

已删除记录不在默认列表显示。

## 首页布局

图纸资料库首页为：

```text
客户 -> 产品规格 -> 图纸信息
```

客户列表显示：

- 全部客户
- 客户名称
- 规格数量
- 缺资料规格数量

规格列表显示：

- 产品规格
- 客户
- 品名
- 资料完整度
- 文件数量
- 最近更新时间

右侧图纸信息显示：

- 客户
- 客户编码
- 产品规格
- 品名
- 完整度
- 最近更新
- 备注
- 分类文件

## 资料分类

图纸资料库使用现有资源分类：

- 原图
- SOP指导书
- 成品图
- 辅料规格
- 注意事项

完整度规则：

- 原图、SOP指导书、成品图为必填分类。
- 辅料规格、注意事项为可选分类。
- 有效文件只统计未软删除文件。

## 网页端批量导入原图

v1.14.2 增加了图纸资料库页面内的“批量导入原图”入口，用于替代大多数命令行导入场景。

页面导入遵循安全分步：

1. 用户主动选择本地图纸文件夹。
2. 前端只读取文件名、大小、MIME 类型和相对路径。
3. 前端按共享解析规则提取客户文件夹、规格和品名。
4. 用户确认客户文件夹映射。
5. 调用 `POST /api/drawing-library/bulk-originals/preview` 做只读预览。
6. 输入确认码 `IMPORT_ORIGINALS` 后才会上传。

上传规则：

- 固定上传到“原图”分类。
- 未确认客户不上传。
- 规格无法识别不上传。
- 疑似非原图默认不上传。
- 重复文件默认跳过。
- 不删除任何数据库记录、生产工单、连接器参数或 S3 对象。

网页端与命令行工具共用规格识别规则，支持 `1CA7-X01E-E`、`D010304-8222-V03`、`GRQ05BAT-Switch-V1`、`JW2.5-CAN485-V1`、`BOA1310000F1`、`L009A0013` 等常见图纸规格。

## 文件管理

每个分类支持：

- 上传 PDF / JPG / PNG
- 预览 PDF / 图片
- 下载文件
- 软删除文件
- 历史版本列表展示

文件上传到 S3 兼容对象存储，元数据保存到 PostgreSQL。删除只做软删除，不物理删除 S3 对象。

## 搜索和筛选

支持搜索：

- 客户
- 客户编码
- 规格
- 品名
- 备注

支持筛选：

- 全部
- 缺原图
- 缺 SOP
- 缺成品图
- 资料完整
- 最近更新

不支持按图纸已发、配料状态、交期、未交量、工时筛选，因为这些不属于长期图纸资料库。

## 本周生产工单清理

清理本周生产工单只影响 `WorkOrder`：

```text
planActive=false
planClearedAt=now()
planClearedBy=current user
```

不会删除或修改：

- `DrawingLibraryItem`
- `DrawingLibraryFile`
- `ResourceFile`
- S3 文件对象
- `ConnectorParameter`
- `ConnectorParameterFile`
- 用户账号

## 空资料清理

历史版本可能已经因为周计划导入产生空图纸资料记录。可使用“清理空资料”入口或命令行脚本进行安全清理。

清理候选必须同时满足：

- 未删除。
- 没有关联任何图纸资料文件。
- 备注为空或 `-`。
- 存在 `lastImportedAt`。
- 存在 `lastWorkOrderId`。

不会清理：

- 有文件的记录。
- 有备注的记录。
- 手动新增的记录。
- 生产工单。
- 连接器参数和连接器附件。
- S3 / Object Storage 文件对象。

页面入口：图纸资料库 -> 清理空资料。

命令行 dry-run：

```bash
npm run drawing-library:cleanup-empty:dry
```

正式执行必须显式确认：

```bash
CONFIRM_CLEAN_EMPTY_DRAWING_LIBRARY=YES npm run drawing-library:cleanup-empty
```

Windows PowerShell 示例：

```powershell
$env:CONFIRM_CLEAN_EMPTY_DRAWING_LIBRARY="YES"
npm run drawing-library:cleanup-empty
Remove-Item Env:\CONFIRM_CLEAN_EMPTY_DRAWING_LIBRARY
```

## 本地图纸原图批量导入

v1.14.1 新增本地命令行批量导入工具，用于把企业微信微盘下载到本地的图纸原图导入到图纸资料库“原图”分类。

默认目录：

```text
C:\Users\31175\Desktop\图纸
```

建议结构：

```text
图纸\客户简称\规格-品名.pdf
```

核心规则：

- 默认只做 dry-run，不写库、不上传文件。
- 正式执行必须设置 `CONFIRM_BULK_ORIGINAL_UPLOAD=YES`。
- 只导入“原图”分类，不导入 SOP、成品图、辅料规格或注意事项。
- 会生成 `matched.csv`、`unmatched.csv`、`duplicates.csv`、`uploaded.csv`、`failed.csv` 等报告。
- 客户简称映射使用 `config/customer-aliases.local.json`，该文件不提交 Git。
- 浏览器页面不能扫描本地任意文件夹，因此批量导入通过命令行执行。

dry-run 示例：

```bash
npm run drawings:bulk-originals:dry -- --source "C:\Users\31175\Desktop\图纸"
```

完整说明见：

```text
docs/BULK_ORIGINAL_DRAWING_IMPORT_GUIDE.md
```

## 连接器参数库

连接器参数库是独立资料库，不受图纸资料库新增、导入关联、本周工单清理影响。

## 敏感信息

本文档不包含数据库密码、`DATABASE_URL`、S3 Key、S3 Secret、`SESSION_SECRET`、账号密码或任何真实密钥。
