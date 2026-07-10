# 生产执行中心 QA 报告

版本：v1.15.0-production-execution-center
验证环境：本地 Docker Compose、PostgreSQL、MinIO、Next.js production container
结论：本地验证通过，尚未部署 Sealos

## 数据结构

- `WorkOrder` 增加负责人、工位、完成数量、开工时间、完成时间、最近进度时间和最近进度备注，全部为可空字段。
- 新增 `WorkOrderProgressLog`，以 WorkOrder 一对多关系追加进度历史。
- migration 仅新增列、表、索引和外键，不删除或改写旧字段。

## 统计规则验证

使用 4 张当前周临时工单和 1 张历史周临时工单验证：

- 当前周总数 4，历史周工单未混入。
- 今日交期 1、已逾期 1、未发图 1、配料未齐 2、资料不完整 3、紧急 1、已完成 1。
- 四状态各 1 张，服务端摘要与看板列数一致。
- 日期比较按 `Asia/Shanghai` 当天边界执行。

## API

- `GET /api/dashboard/production-summary`：通过。
- `GET /api/work-orders/execution`：通过，支持视图、组合筛选、分页和旧请求取消。
- `PATCH /api/work-orders/[id]/execution`：通过。
- `GET /api/work-orders/[id]/progress-logs`：通过，最多每页 50 条。
- `POST /api/work-orders/batch-execution`：通过。
- `GET /api/export/production-execution.csv`：通过，响应为 UTF-8 BOM CSV。

## 进度与时间戳

- 单工单由在前端切到在后端后自动记录 `startedAt`。
- 切到已完成后自动记录 `completedAt`。
- 从已完成撤回后 `completedAt` 清空。
- 连续三次更新生成三条进度记录，旧记录未覆盖。
- 操作日志仅记录动作、字段名和状态变化，不记录密码或 token。

## 批量操作

- 批量负责人更新：通过。
- 批量状态更新：通过。
- 错误确认词修改为已完成：HTTP 400，未写入。
- 正确输入 `COMPLETE_BATCH`：事务成功并记录完成时间。
- 历史周执行更新：HTTP 409，保持只读。

## 图纸联动与回归

- 0/5、3/5、5/5 三种图纸资料完整度计算正确。
- 有图纸资料时跳转既有 item；无 item 时只打开预填新建页面，不自动创建空记录。
- 连接器参数 API 与周计划差异 API 回归返回正常。
- 既有 PDF、图片、上传、预览、下载和 S3 同步实现未修改；生产容器构建通过。

## 平板布局

- 1366x1024：四列完整显示，Console 0 error。
- 1280x800：四列完整显示，Console 0 error。
- 1024x768：看板内部横向滚动，页面 `document/body` 无横向溢出，Console 0 error。
- 更新进度弹窗和 Portal 状态菜单未超出视口。

## 构建验证

- `npx prisma generate`：通过。
- `npx prisma migrate deploy`：通过。
- `npx prisma migrate status`：Database schema is up to date。
- `npm run build`：通过；仅保留项目已有的非阻塞 ESLint warning。
- `npm run smoke`：通过，健康接口、PWA manifest 和登录页正常。
- `docker compose -p hongmeng up --build -d`：通过。
- `docker build -t hongmeng-workorder:v1-15-production .`：通过。
- `/api/health`：HTTP 200。

测试数据使用 `TEST-V115-*` 前缀，仅存在于本地 compose 数据库，验证后清理；未写入生产环境、仓库、报告目录或 S3 生产 Bucket。
