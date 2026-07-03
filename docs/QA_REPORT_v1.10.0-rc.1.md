# v1.10.0-rc.1 QA 报告

版本：v1.10.0-rc.1

commit：以 `v1.10.0-rc.1` tag 指向的提交为准。

状态：本地验证通过，等待统一部署。本文档不包含任何数据库密码、对象存储密钥、SESSION_SECRET 或账号密码。

## migration 情况

- 新增 Prisma migration：`202607030002_connector_parameters`
- 新增表：
  - `connector_parameters`
  - `connector_parameter_files`
- 不修改已有工单、文件、用户、操作日志表结构。

## 新增 API

- `GET /api/connector-parameters`
- `POST /api/connector-parameters`
- `PATCH /api/connector-parameters/[id]`
- `DELETE /api/connector-parameters/[id]`
- `POST /api/connector-parameters/[id]/restore`
- `GET /api/connector-parameters/template.csv`
- `GET /api/connector-parameters/export.csv`
- `POST /api/connector-parameters/import`
- `GET /api/connector-parameter-files`
- `POST /api/connector-parameter-files/upload`
- `GET /api/connector-parameter-files/[id]/download`
- `DELETE /api/connector-parameter-files/[id]`

## Excel / CSV 导入验收

- CSV 导入：通过。
- XLSX 导入：通过，使用服务端 `xlsx` 解析。
- XLS 导入：支持同一解析链路。
- 中文表头：通过。
- 英文表头：通过。
- 空单元格保持为空：通过。
- 型号重复导入：通过。
- 整行完全为空跳过：通过。

## 粘贴导入验收

- 支持从 Excel 复制 TSV 粘贴：通过。
- 支持 CSV 文本粘贴：通过。
- 支持中文表头：通过。
- 空单元格保持为空：通过。

## 查询验收

- 搜索型号：通过。
- 搜索备注：通过。
- 搜索参数值：通过。
- 输入防抖查询：通过。
- 回车立即查询：通过。
- 清空搜索：通过。

## 空值验收

- 外剥皮为空可以保存：通过。
- 内剥皮为空可以保存：通过。
- 入长为空可以保存：通过。
- 备注为空可以保存：通过。
- 型号为空可以保存：通过。
- 整行完全为空不能保存：通过。
- 空值 UI 不显示为 0：通过。
- 缺外剥皮 / 缺内剥皮 / 缺入长 / 任意缺失筛选：通过。

## 删除 / 恢复验收

- 参数删除使用软删除：通过。
- 已删除参数默认不显示：通过。
- 已删除参数可恢复：通过。
- 原始资料附件删除使用软删除：通过。

## 原始资料上传验收

- 支持 PDF / JPG / PNG / CSV / XLSX / XLS：通过。
- 文件保存到 S3 兼容对象存储：通过。
- 元数据写入 `connector_parameter_files`：通过。
- 下载原始资料：通过。
- 删除原始资料：通过。
- 前端不展示 objectKey：通过。

## 回归测试结果

- `npx prisma generate`：通过。
- `npx prisma migrate deploy`：通过。
- `npm run build`：通过。
- `docker build -t hongmeng-workorder:v1-10-connector-params .`：通过。
- `docker compose -p hongmeng up --build -d`：通过。
- `npm run smoke`：通过。
- `/api/health`：通过。
- 生产资料库登录、工单资料、PDF 预览、图片预览、上传、下载、ZIP 下载、工单抽屉回归：通过。
- 1366x1024、1280x800、1024x768 无严重横向溢出：通过。
- 浏览器 console 0 error：通过。

## 已知问题

暂无阻塞问题。
