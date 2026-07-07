# v1.14.3 全局搜索图纸资料库 QA

版本：v1.14.3-unified-search-drawing-library

状态：本地开发验证，等待统一部署验收。

## 验证目标

生产工单页顶部搜索升级为全局搜索，同时覆盖：

- 生产工单 `WorkOrder`
- 生产工单文件 `ResourceFile`
- 图纸资料 `DrawingLibraryItem`
- 图纸资料文件 `DrawingLibraryFile`
- 连接器参数 `ConnectorParameter`

生产工单左侧列表和工单抽屉仍然只显示生产工单，不混入图纸资料库记录。

## 搜索规格 8122

预期：

- 如果生产工单包含 `8122`，显示在“生产工单”分组。
- 如果生产文件包含 `8122`，显示在“生产文件”分组。
- 如果图纸资料规格包含 `8122`，显示在“图纸资料”分组。
- 如果图纸文件名包含 `8122`，显示在“图纸文件”分组。
- 如果连接器参数包含 `8122`，显示在“连接器参数”分组。

全部分组为空时显示：

```text
未找到匹配结果，请调整关键词
```

## 搜索 D010090-8122-V02

预期：

- 图纸资料库中存在该规格时，搜索浮层显示“图纸资料”结果。
- 点击结果跳转到：

```text
/drawing-library?itemId=<id>&keyword=D010090-8122-V02
```

- 图纸资料库自动填入关键词并选中对应规格。

## 图纸文件结果

预期：

- 图纸文件结果展示文件名、所属规格、客户和分类。
- 点击结果跳转到：

```text
/drawing-library?itemId=<itemId>&fileId=<fileId>&keyword=<keyword>
```

- 图纸资料库自动选中所属规格、分类和文件。

## 生产工单结果

预期：

- 点击生产工单结果仍然在 `/dashboard` 内切换到对应工单。
- 不会把 `DrawingLibraryItem` 插入生产工单列表。
- 工单列表、工单抽屉和本周生产过滤逻辑不变。

## 连接器参数结果

预期：

- 点击连接器参数结果进入：

```text
/connector-parameters?keyword=<keyword>
```

- 连接器参数页自动填入关键词并过滤列表。

## 图纸资料库自身搜索

预期：

- 搜索规格、客户、品名、备注可过滤图纸资料。
- 搜索图纸文件名可显示对应规格。
- 清空搜索后恢复正常客户和规格列表。

## 本地验证命令

```bash
npm run build
npm run smoke
```

## 安全边界

- 不新增数据库结构。
- 不新增 Prisma migration。
- 不修改 S3 配置。
- 不返回 S3 Secret、数据库连接串、SESSION_SECRET、账号密码或 token。
- 不恢复 DevEco / Harmony。
- 不恢复 `/api/native`。
