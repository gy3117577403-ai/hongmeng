# 周计划差异中心 QA 记录

版本：v1.14.7-weekly-plan-diff-center

状态：本地验证记录，尚未部署 Sealos。

## 测试数据

使用纯本地合成元数据验证差异算法，不读取或修改线上真实工单：

- 当前周：5 条。
- 下周草稿：6 条。
- 新增：2 组。
- 延续：2 组。
- 变更：1 组。
- 下周取消：2 组。
- 重复：1 组。
- 异常：1 组。

重复和异常作为审核标签叠加在基础差异类型上，因此不要求与当前周 / 下周原始行数简单相加。

## 差异统计

纯函数验证结果：

```text
currentCount=5
nextCount=6
newCount=2
continuedCount=2
changedCount=1
removedCount=2
duplicateCount=1
invalidCount=1
```

字段级变化验证：`uncompletedQty` 正确返回 `20 -> 40`。

## 异常阻断

- 客户缺失会生成阻断异常。
- 同一稳定键重复会生成阻断异常。
- `activate-next/commit` 在阻断异常大于 0 时返回 `409`。
- 警告不阻断，但预检和确认弹窗会显示数量。
- `START_NEXT_WEEK` 仍是必填确认词。

## 周切换

- 当前周归档和下周启用位于同一 Prisma transaction。
- 如果目标草稿已被其他请求启用，本次事务回滚并返回冲突。
- 独立“结束本周”仍使用 `CLOSE_WEEK`，作为备用操作。

## 历史周

- 历史周只查询 `planActive=false` 且 `planClearedAt != null` 的周计划工单。
- 按周显示数量、完成数、缺资料数、归档时间和操作人。
- 历史工单只读，不混入当前生产列表。

## 文件保留

本版本没有删除文件的代码路径。周切换只更新 WorkOrder 周状态字段，不删除 `ResourceFile`、`DrawingLibraryFile` 或 S3 对象。

## 连接器回归

差异查询和周切换没有读写 `ConnectorParameter`、`ConnectorParameterFile` 或连接器导入批次。连接器模块不受本次功能影响。

## 构建验证

- `npx prisma generate`：通过。
- Prisma migration：本版本未新增。
- `npm run build`：通过；diff、history、CSV 和 `/weekly-plan-center` 均进入生产构建路由。
- `npm run smoke`：通过；`/api/health`、`/manifest.webmanifest`、`/login` 均为 OK。
- 浏览器 1366x1024 / 1280x800 / 1024x768：通过本地合成数据视觉验收。
- 页面横向溢出：三个视口均为 0；宽表只在自身容器内横向滚动。
- 浏览器 console：0 error。
- 历史周：周列表和只读工单表格视觉验收通过。
- 启用预检：阻断异常为 2 时确认按钮禁用，不显示确认输入。

本机 Docker Desktop 未运行，且本地生产服务未配置 `DATABASE_URL`，因此没有在本轮执行真实 PostgreSQL 周切换事务。没有使用线上真实数据做破坏性验证，也没有声称数据库事务已在线上验证。事务路径已通过 TypeScript、生产构建、静态审计和阻断 UI 合成数据验证；部署前仍需在可连接的测试数据库执行一次完整草稿切换验收。

## 结论

代码构建、smoke、差异算法和三视口视觉验证均通过。建议作为统一部署候选；在部署前或维护窗口内，需使用非生产破坏性测试数据补做 PostgreSQL transaction 的真实切换验证。
