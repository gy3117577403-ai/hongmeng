# v1.17.0 生产组长工作台 QA 报告

日期：2026-07-14
状态：本地验证通过，尚未部署 Sealos

## 环境

- Windows Docker Compose：Next.js、PostgreSQL、MinIO。
- 视口：1366x1024、1280x800、1024x768。
- 截图目录：`output/playwright/v1.17.0-production-leader/`（已忽略，不提交）。
- 本地 QA 样本在验收后已恢复，未修改生产环境或 S3。

## 自动化验证

| 检查项 | 结果 |
| --- | --- |
| 数量单元测试 | 9 项通过，覆盖 3000/2990、3000/3000、3000/3050、空值、负数和尾数未清 |
| 正常状态隐藏 | 图纸已发、料齐不生成异常标签 |
| 图纸异常 | 待样品、待客户、图纸变更正确显示并参与摘要筛选 |
| 阶段卡片 | 未发图、进行中、已完成分别使用独立结构 |
| 进度侧栏 | 累计完成 2990 → 2991 后卡片局部更新，剩余 10 → 9，无页面导航 |
| 状态菜单 | 在前端 → 在后端后卡片局部移动，PATCH 200，无整页刷新 |
| 完成确认 | 剩余 600 套时显示尾数未清确认提示，取消不会改状态 |
| 图纸状态 | 快捷菜单 PATCH 200，并写进度日志；普通“已发”不生成待发标签 |
| 尾数筛选 | 只返回 1 条尾数未清工单 |
| 图纸待确认筛选 | 返回待样品、待客户和图纸变更共 3 条 |
| 已完成卡片 | 高度 68-70px，正常完成、尾数未清和超产显示正确 |
| 已完成列 | 可展开 / 收起，1024px 默认折叠并写入 `sessionStorage` |
| 工单资料直达 | 点击规格进入正确工单且默认 `categoryCode=drawing` |
| 返回恢复 | 返回 `/production` 后保留视图、周、筛选与会话滚动状态 |
| 菜单交互 | Escape、点击外部、互斥打开均通过 |
| 页面横向溢出 | 三个视口均无页面级横向溢出 |
| 200 卡片滚动 | 只读网络桩四列各 50 条，首列 `scrollHeight=8095`、`clientHeight=499`，可滚动到底且页面无横向溢出 |
| Console | 最终浏览器检查 0 error |

## 构建与服务

- `npx prisma generate`：通过。
- `npm run test:production-leader`：9/9 通过。
- `npm run build`：通过，仅保留项目既有的 `<img>` 与 Hook lint warning。
- `docker compose -p hongmeng up --build -d`：通过，app、db、minio 均运行。
- `/api/health`：返回 `ok=true`。
- `npm run smoke`：health、manifest、login 全部通过。
- `docker build -t hongmeng-workorder:v1-17-production-leader .`：通过。

## 结构与回归边界

- 未新增 Prisma migration，`prisma/` 无差异。
- 生产执行 PATCH 继续写 `WorkOrderProgressLog`、`DataChangeSnapshot` 和 `operation_logs`。
- 周计划、生产工单、图纸资料库、连接器参数与组装说明书路由保持原行为。
- 没有恢复 Harmony / DevEco 或 `/api/native`。
- 本轮未在真实 Android WebView 设备执行独立性能测试；平板浏览器三个目标视口和无页面溢出已通过。

## 结论

v1.17.0-production-leader-workbench 达到本地部署候选标准。该结论不代表已部署或已在线上验收。
