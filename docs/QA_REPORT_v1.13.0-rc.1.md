# QA Report v1.13.0-rc.1

状态：本地验证通过，等待统一部署。本文档只记录验证结论，不包含敏感连接或凭据值。

## 版本
- 版本：v1.13.0-rc.1
- 类型：工业稳定增强版
- 范围：稳定性、防误触、日志和生产健康状态增强
- 部署状态：尚未部署 Sealos，尚未作为生产版本发布

## 验证范围
- 工单删除强确认：需输入工单号和 CONFIRM。
- 文件删除强确认：需输入 DELETE 和文件名后 4 位。
- 连接器参数删除和批量删除：继续使用 DELETE 二次确认。
- 连接器导入超过 100 行：需输入 IMPORT_CONFIRM 后确认入库。
- 上传队列：保留失败文件，支持单条重试和批量重试。
- 操作日志：覆盖上传失败、上传重试、复制连接器参数、导入批次回滚。
- 系统状态接口：返回应用版本、运行时长、数据库状态、对象存储状态、上传限制、统计计数和配置告警。
- 数据变更快照：延续 v1.12.0 的工单、文件、连接器参数和导入批次记录能力。

## 本地命令结果
- `npx prisma generate`：通过。
- `npx prisma migrate deploy`：通过，无待应用 migration。
- `npm run build`：通过，仅保留既有图片组件性能提示。
- `docker build -t hongmeng:v1-13-stability .`：通过。
- `docker compose -p hongmeng up --build -d`：通过。
- `npm run smoke`：通过。
- `/api/health`：返回 200。

## 登录态接口抽查
- `/api/system/status`：返回 200，版本为 v1.13.0-rc.1。
- `/api/resource-files/upload` 缺少必要字段时：返回 400，并写入 upload_failed 操作日志。
- 工单、文件、连接器参数和批量删除接口：缺少匹配确认口令时返回 400，确认口令匹配后才执行软删除。
- 上传重试：成功后写入 upload_retry 操作日志。
- `/api/operation-logs`：可查询 upload_failed、copy_connector_parameter、rollback_import_batch。
- 连接器导入批次回滚：可执行并写入回滚日志。

## UI 规则检查
- 工单删除弹窗文案和按钮禁用逻辑已改为工单号加 CONFIRM。
- 文件删除弹窗文案和按钮禁用逻辑已改为 DELETE 加文件名后 4 位。
- 连接器导入预览弹窗超过 100 行时改为 IMPORT_CONFIRM。
- 未调整页面层级、三栏工作台结构或现有业务范围。

## 数据与持久化
- 本次未新增 Prisma migration。
- 文件仍通过对象存储持久化。
- 元数据仍通过 PostgreSQL 持久化。
- 软删除和恢复路径保持不变。
- 所有已登录用户仍共享同一套业务数据。

## 已知问题
- `npm run build` 仍提示既有 `<img>` 性能建议，不影响构建和运行。
- 暂无阻塞问题。

## 是否建议上线
建议作为 v1.13.0-rc.1 候选版本进入统一部署前镜像构建与验收流程。
