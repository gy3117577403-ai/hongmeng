# 周计划差异中心使用说明

版本：v1.14.7-weekly-plan-diff-center

状态：本地开发候选，尚未部署 Sealos，不代表生产上线版本。

## 数据结构审计

本版本复用现有 `WorkOrder` 字段：

- `planType`
- `weekStartDate`
- `weekEndDate`
- `planActive`
- `importBatchId`
- `planClearedAt`
- `planClearedBy`

当前 schema 没有 `planStatus` 或独立周计划批次表，但现有组合已经能稳定区分：

- 当前周：`planType = weekly_plan`、`planActive = true`
- 下周草稿：`planType = weekly_plan`、`planActive = false`、`planClearedAt = null`
- 历史周：`planType = weekly_plan`、`planActive = false`、`planClearedAt != null`

因此 v1.14.7 不新增 Prisma migration，也不重复创建相似字段。

## 稳定比较键

周计划差异由服务端 `lib/weekly-plan-diff-core.ts` 计算，不使用数据库 `id` 直接比较。

规则：

1. 有 `sourceOrderNo` 时，使用标准化后的来源订单号。
2. 没有 `sourceOrderNo` 时，使用 `customerName + specification + productName + processName`。
3. 标准化只用于比较：去除首尾空格、合并多余空格、英文字母转大写、中文括号转英文括号。
4. 不修改数据库里的原始值。
5. 同一周同一比较键出现多条时，标记为“重复”，不自动合并。

## 差异分类

- 新增：下周草稿存在，当前周不存在。
- 延续：两周都存在，关键生产字段没有变化。
- 有变更：两周都存在，至少一个关键字段变化。
- 下周取消：当前周存在，下周草稿不再出现。只表示不再排产，不删除历史工单。
- 重复：同一周同一稳定键存在多条，无法唯一比较。
- 异常：客户、规格、计划周、交期或来源订单映射存在阻断问题。

“重复 / 异常”是审核标签，可与“新增 / 延续 / 变更”同时统计。例如一条下周新增工单也可能同时是重复项。

字段级变化至少覆盖：客户、品名、规格、工序、未交量、工时、总工时、图纸、交期、计划日期、配料、业务员和备注。页面会显示类似：

```text
未交量：20 -> 40
交期：周六 -> 周二
配料：缺插件 -> 已配料
```

## 差异审核流程

1. 在生产工单抽屉点击“导入下周”。
2. 选择 Excel 和计划周开始日期。
3. 查看解析预览并确认导入。
4. 系统只保存为下周草稿，不覆盖当前周。
5. 导入完成后进入 `/weekly-plan-center`。
6. 检查新增、延续、变更、下周取消、重复和异常。
7. 处理阻断异常；警告可以保留，但启用弹窗会列出数量。
8. 点击“预检并启用下周”。
9. 输入 `START_NEXT_WEEK`。
10. 系统在同一事务中归档当前周并启用下周草稿。

## 阻断异常与警告

阻断异常未解决时，接口返回 `409`，不能启用下周：

- 规格为空。
- 客户为空。
- 同一周稳定键重复且无法唯一判断。
- `weekStartDate` 缺失。
- `plannedAt` 和 `deliveryDay` 同时为空。
- 同一 `sourceOrderNo` 对应多个不同客户或规格。

警告不会阻断切换，但会在预检中提示：

- 品名为空。
- 未关联图纸资料。
- 图纸资料为 `0/5`。
- 图纸状态为空。
- 配料状态为空。
- 未交量为空。

## 图纸资料库联动

差异表仅读取必要元数据，显示：

- 资料完整度 `X/5`
- 文件数量
- 已关联 / 未关联

已关联时点击规格会定位到对应图纸资料。未关联时点击会打开新建图纸资料弹窗，并预填客户、规格和品名。周计划导入本身不会自动创建空图纸资料记录，也不会污染图纸资料库首页。

## 安全启用下周

API：

- `POST /api/work-orders/week/activate-next/preview`
- `POST /api/work-orders/week/activate-next/commit`

commit 必须输入：

```text
START_NEXT_WEEK
```

启用动作使用数据库 transaction，防止部分归档、部分启用。重复点击时，如果草稿已经被启用，会返回冲突提示。操作日志 action 为 `activate_next_week`，只记录周范围和数量统计。

整个流程不会删除：

- `WorkOrder`
- `ResourceFile`
- `DrawingLibraryItem`
- `DrawingLibraryFile`
- S3 / Object Storage 对象
- 连接器参数或附件
- 用户账号

## 历史周

“历史周”按周展示：周范围、工单数量、完成数量、缺资料数量、归档时间和操作人。点击后只读查看该周工单，可按规格、客户和品名搜索。历史周不会混入当前周生产列表。

## 差异 CSV

“导出下周差异”会下载 UTF-8 BOM CSV，包含差异类型、规格、客户、品名、两周未交量、两周交期、图纸 / 配料状态、资料完整度和异常信息。

文件名示例：

```text
weekly-plan-diff-2026-07-06-to-2026-07-13.csv
```

## 每周推荐流程

```text
导入下周草稿
-> 差异审核
-> 处理阻断异常
-> 预检启用
-> 输入 START_NEXT_WEEK
-> 当前周归档
-> 下周草稿成为当前周
```

“结束本周 / `CLOSE_WEEK`”保留为备用操作。日常推荐直接从差异中心启用下周，由系统自动归档当前周。

本文档不包含数据库密码、`DATABASE_URL`、S3 Key、`SESSION_SECRET`、账号密码、token 或任何真实密钥。
