# 周计划工单中心与工单抽屉说明

版本：v1.14.6-weekly-workorder-center

状态：待部署候选，不代表生产已上线。

## 目标

v1.14.6 将生产工单抽屉调整为周计划工单中心，重点解决平板上工单卡片拥挤、筛选横向溢出和“结束本周”语义不清的问题。

## 周计划状态

本版本不新增 Prisma migration，继续使用现有字段表达周计划生命周期：

- 当前周：`planType = weekly_plan` 且 `planActive = true`
- 下周草稿：`planType = weekly_plan` 且 `planActive = false` 且 `planClearedAt = null`
- 历史周：`planType = weekly_plan` 且 `planActive = false` 且 `planClearedAt != null`

手工工单仍使用 `planActive = true` 出现在当前列表，不受下周草稿和历史周切换影响。

## 工单抽屉

入口仍为首页顶部“工单”按钮。抽屉重排为：

- 顶部：生产工单、周范围、当前列表数量
- 操作：导入下周、结束本周、启用下周、新建工单、关闭
- 视图：当前周 / 下周草稿 / 历史周
- 搜索：规格 / 客户 / 品名 / SO 单号 / 内部编号
- 快速筛选：全部 / 今日交期 / 缺资料 / 异常
- 状态筛选：下拉选择未发图 / 在前端 / 在后端 / 已完成

抽屉宽度按平板横屏优化：桌面最大约 460px，平板常用 420px，窄屏不低于可读宽度。

## 工单卡片

卡片主标题使用：

```text
displayCode = specification || code
```

卡片只展示现场快速判断需要的信息：

- 规格 / 生产编号
- 客户 + 品名
- 未交量
- 交期
- 图纸状态
- 配料状态
- 资料完整性
- 状态流转
- 优先级

已移除无实际意义的进度条和百分比显示。更多字段仍保留在右侧信息面板、编辑弹窗、导出和搜索数据中。

## 导入下周

“导入下周”会打开系统设置中的周计划 Excel 导入，并默认选择“保存为下周草稿”。

保存为下周草稿时：

- 工单会写入数据库。
- `planActive = false`
- `planClearedAt = null`
- 不进入当前周生产列表。
- 不创建空图纸资料库记录。
- 如已有同客户同规格图纸资料，会继续关联。

如确需立即进入当前生产列表，可在系统设置里切换为“立即进入当前周”。

## 结束本周

“结束本周”是归档当前周，不是删除数据。

后端 API：

- `POST /api/work-orders/week/close/preview`
- `POST /api/work-orders/week/close/commit`

确认词：

```text
CLOSE_WEEK
```

commit 只更新：

```text
planActive = false
planClearedAt = now()
planClearedBy = current user
```

不会删除：

- `WorkOrder`
- `ResourceFile`
- S3 / Object Storage 文件对象
- `DrawingLibraryItem`
- `DrawingLibraryFile`
- `ConnectorParameter`
- 连接器附件
- 用户账号

操作日志 action：

```text
close_weekly_work_orders
```

## 启用下周

“启用下周”会先预览影响范围，再要求输入确认词。

后端 API：

- `POST /api/work-orders/week/activate-next/preview`
- `POST /api/work-orders/week/activate-next/commit`

确认词：

```text
START_NEXT_WEEK
```

commit 流程：

1. 将当前所有 active 周计划工单归档为历史周。
2. 将指定 `weekStartDate` 的下周草稿设为 `planActive = true`。
3. 其他历史周和草稿不删除、不清空。

操作日志 action：

```text
activate_next_weekly_work_orders
```

## 验收重点

- 当前周 / 下周草稿 / 历史周切换正常。
- 工单抽屉不出现横向筛选条挤压。
- 工单卡片不显示进度条。
- 卡片主标题显示规格，客户和品名可读。
- 结束本周必须输入 `CLOSE_WEEK`。
- 启用下周必须输入 `START_NEXT_WEEK`。
- 归档后资料文件、图纸资料库和连接器参数不受影响。
- 下周草稿启用后成为默认生产列表。

## 敏感信息

本文档不包含数据库密码、`DATABASE_URL`、S3 Key、S3 Secret、`SESSION_SECRET`、账号密码或任何真实密钥。
