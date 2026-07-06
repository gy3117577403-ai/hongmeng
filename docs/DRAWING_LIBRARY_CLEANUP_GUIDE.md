# 图纸资料库空数据清理说明

版本：v1.13.9-drawing-library-cleanup-ui

状态：本地开发与上线前候选功能，等待统一部署验收。

## 为什么会有空资料记录

v1.13.8 初版图纸资料库会在周计划导入时，按客户和规格自动创建 `DrawingLibraryItem`。真实周计划中规格很多，但并不是每个规格都已经有长期图纸资料文件，因此首页会出现大量：

```text
0/5 · 0 个文件
空资料
```

这些记录会让图纸资料库看起来像周计划规格清单，不符合“长期图纸资料库”的定位。

## 新规则

从 v1.13.9 开始，周计划导入只会尝试关联已有图纸资料记录：

- 找到已有 `DrawingLibraryItem`：关联到 `WorkOrder.drawingLibraryItemId`。
- 找不到：不自动创建可见图纸资料记录。
- 用户手动新增图纸资料，或上传图纸资料文件时，才创建长期资料记录。

## Dry-run 用法

默认 dry-run 不修改任何数据：

```bash
npm run drawing-library:cleanup-empty:dry
```

输出包括：

- 候选空资料记录数量
- 涉及客户数量
- 涉及规格数量
- 保留记录数量
- 有文件记录数量
- 有备注记录数量
- 保留生产工单数量
- 保留连接器参数数量
- 前 20 条候选示例

## 正式清理用法

正式清理必须设置确认环境变量：

```bash
CONFIRM_CLEAN_EMPTY_DRAWING_LIBRARY=YES npm run drawing-library:cleanup-empty
```

Windows PowerShell：

```powershell
$env:CONFIRM_CLEAN_EMPTY_DRAWING_LIBRARY="YES"
npm run drawing-library:cleanup-empty
Remove-Item Env:\CONFIRM_CLEAN_EMPTY_DRAWING_LIBRARY
```

## 页面清理入口

入口：

```text
图纸资料库 -> 清理空资料
```

流程：

1. 点击“清理空资料”。
2. 查看预览统计。
3. 确认候选不包含有文件、有备注、生产工单或连接器参数。
4. 输入 `CLEAN_EMPTY`。
5. 点击“确认清理”。
6. 页面刷新客户和规格列表。

## 哪些会清理

只清理同时满足以下条件的 `DrawingLibraryItem`：

- `deletedAt is null`
- 没有关联任何 `DrawingLibraryFile`
- `remark` 为空或 `-`
- `lastImportedAt` 不为空
- `lastWorkOrderId` 不为空

清理方式是软删除：

```text
deletedAt = now()
```

## 哪些不会清理

不会清理：

- 有图纸资料文件的记录
- 有备注的记录
- 手动新增的记录
- 生产工单 `WorkOrder`
- 工单文件 `ResourceFile`
- 连接器参数 `ConnectorParameter`
- 连接器附件 `ConnectorParameterFile`
- 用户账号
- S3 / Object Storage 文件对象

## 回滚建议

清理是软删除。如果误清理，可通过数据库把对应 `DrawingLibraryItem.deletedAt` 置空，或后续增加图纸资料库回收站入口进行恢复。

清理前建议：

- 先运行 dry-run。
- 截图保存候选数量和示例。
- 确认生产工单、连接器参数和文件数量不在清理范围内。

## 敏感信息

本文档不包含数据库密码、`DATABASE_URL`、S3 Key、S3 Secret、`SESSION_SECRET`、账号密码或任何真实密钥。
