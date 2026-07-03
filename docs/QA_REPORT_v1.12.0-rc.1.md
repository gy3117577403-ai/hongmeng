# QA 报告 v1.12.0-rc.1

## 基本信息

- 版本：v1.12.0-rc.1
- commit：以 `v1.12.0-rc.1` tag 指向 commit 为准
- 状态：本地验证通过，等待统一部署

## migration 情况

- 新增 migration：`202607030003_production_stability`
- 新增模型：`DataChangeSnapshot`
- 新增模型：`ConnectorParameterImportBatch`
- `ConnectorParameter` 新增可选字段：`importBatchId`
- 新增索引：工单、文件、连接器参数、导入批次、操作日志、变更快照相关查询索引
- migration 仅做新增，不删除字段，不破坏已有数据

## 新增 API

- `GET /api/change-snapshots`
- `GET /api/connector-parameter-import-batches`
- `POST /api/connector-parameter-import-batches/[id]/rollback`
- `GET /api/system/status` 增强返回生产健康状态

## 防误操作验收

- 删除工单：输入完整工单号后才能确认。
- 删除文件：输入 `DELETE` 或文件名后 4 位后才能确认。
- 删除连接器参数：输入 `DELETE` 后才能确认。
- 批量删除连接器参数：输入 `DELETE` 后才能确认。
- 删除原始资料附件：输入 `DELETE` 后才能确认。
- 批量导入超过 100 行：输入 `IMPORT` 后才能确认。
- 导入批次回滚：输入 `ROLLBACK` 后才能确认。

## 快照验收

- 工单创建、编辑、删除和恢复会写入 DataChangeSnapshot。
- 文件编辑、移动、删除和恢复会写入 DataChangeSnapshot。
- 连接器参数创建、编辑、删除、恢复、批量更新和批量删除会写入 DataChangeSnapshot。
- 快照内容经过脱敏处理，不包含敏感连接信息、访问凭证或账号口令。

## 导入批次验收

- 导入预览不创建批次。
- 确认导入创建 ConnectorParameterImportBatch。
- 本批次新增参数写入 importBatchId。
- 默认跳过重复行。
- 手动新增参数不写入 importBatchId。

## 回滚验收

- 批次回滚只软删除该批次尚未删除的参数。
- 批次回滚不影响手动新增参数。
- 批次只能回滚一次。
- 回滚后写入 operation_logs 和 DataChangeSnapshot。

## 上传重试验收

- 上传失败项保留在队列中。
- 队列显示文件名、类型、大小、状态、失败原因、重试和移除。
- 支持单项重试和重试全部失败。
- 不把文件内容、base64 或签名地址写入 localStorage。

## 健康检查验收

- `/api/system/status` 返回 app、database、storage、upload、migrations、counts 和 warnings。
- API 不返回敏感连接信息、访问凭证或账号口令。
- 系统设置中显示生产健康检查和生产稳定中心。

## 性能索引验收

- migration 增加工单、文件、连接器参数、导入批次、操作日志和快照查询索引。
- 不引入全文搜索引擎。
- 搜索逻辑继续使用现有 contains 查询。

## 回归测试结果

- 登录、修改密码、账号管理、工单资料库、上传、PDF.js 预览、图片预览、下载、ZIP 下载、回收站、操作日志、系统设置、PWA 和连接器参数资料保留。
- `npx prisma generate` 通过。
- `npx prisma migrate deploy` 通过。
- `npm run build` 通过。
- `docker build -t hongmeng-workorder:v1-12-stability .` 通过。
- `docker compose -p hongmeng up --build -d` 通过。
- `npm run smoke` 通过。
- `/api/health` 返回 `ok: true`。
- 1366x1024、1280x800、1024x768 dashboard 浏览器 console 0 error，无页面级横向溢出。
- 1024x768 连接器参数页浏览器 console 0 error，无页面级横向溢出。

## 已知问题

暂无阻塞问题。
