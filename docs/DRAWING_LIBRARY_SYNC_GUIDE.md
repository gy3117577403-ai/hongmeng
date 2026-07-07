# 图纸资料库同步说明

版本：v1.14.0-drawing-library-auto-sync-preview

## 自动同步规则

生产工单资料库上传 PDF、JPG、PNG 后，系统会先保存生产资料文件，再尝试同步到图纸资料库。

同步适用分类：

- 原图
- SOP指导书
- 成品图
- 辅料规格
- 注意事项

同步不适用：

- 上传管理队列
- 已软删除文件
- 临时或非有效分类文件

## 归档规则

图纸资料库按 `客户 + 规格` 归档。当前工单已有 `drawingLibraryItemId` 时优先使用该关联，否则按客户和规格查找或创建 `DrawingLibraryItem`。

如果当前工单未设置规格，上传仍然成功，但不会创建图纸资料库记录。页面会提示：资料已保存到生产工单，未归档到图纸资料库。

## 去重规则

同步不会重复上传 S3 对象。`DrawingLibraryFile` 直接复用生产资料的 `objectKey`。

系统使用两层去重：

- `sourceResourceFileId` 唯一关联来源 `ResourceFile`。
- 同一 `objectKey` 已存在时不再创建重复 `DrawingLibraryFile`。

## 手动同步

入口：

- 当前工单顶部“更多”菜单。
- 右侧资料工具窗。

按钮：同步到图纸资料库。

成功提示会显示新增数量和跳过数量。

## 历史补偿脚本

默认 dry-run：

```bash
npm run drawing-library:sync-from-workorders:dry
```

正式执行需要显式确认：

```bash
CONFIRM_SYNC_DRAWING_LIBRARY=YES npm run drawing-library:sync-from-workorders
```

PowerShell：

```powershell
$env:CONFIRM_SYNC_DRAWING_LIBRARY="YES"
npm run drawing-library:sync-from-workorders
Remove-Item Env:\CONFIRM_SYNC_DRAWING_LIBRARY
```

脚本不会删除生产工单、生产资料、图纸资料、连接器参数或 S3 对象。

## 常见问题

为什么某些文件没有同步？

- 当前工单没有规格。
- 文件已软删除或状态不是 uploaded。
- 文件分类不在同步范围内。
- 同一 `ResourceFile` 或同一 S3 `objectKey` 已经同步过。

为什么以前上传的 PDF 没有进入图纸资料库？

旧上传链路和图纸资料库上传链路没有统一同步函数，也缺少来源文件唯一关联。v1.14.0 起上传 API 和手动同步 API 都复用同一套同步规则。

连接器参数会被影响吗？

不会。同步只读取生产工单 `ResourceFile` 和图纸资料库 `DrawingLibraryItem` / `DrawingLibraryFile`，不读写连接器参数表。
