# v1.10.0-rc.2 QA 报告

版本：v1.10.0-rc.2

commit：以 `v1.10.0-rc.2` tag 指向的提交为准。

状态：本地验证通过，等待统一部署。本文档不包含任何数据库密码、对象存储密钥、SESSION_SECRET 或账号密码。

## migration 情况

本版本未新增 Prisma migration。沿用 v1.10.0-rc.1 已新增的：

- `connector_parameters`
- `connector_parameter_files`

## 新增 API

- `POST /api/connector-parameters/import/preview`
- `POST /api/connector-parameters/import/commit`
- `POST /api/connector-parameters/batch`
- `PATCH /api/connector-parameters/batch`

`POST /api/connector-parameters/import` 保留为兼容入口，但只返回预览结果，不直接写入数据库。

## 导入预览验收

- CSV 文件导入进入预览：通过
- XLSX 文件导入进入预览：通过
- Excel 粘贴导入进入预览：通过
- 预览阶段不写入数据库：通过
- 点击“确认导入”后才写入数据库：通过

## 重复行验收

- 与数据库已有记录重复时标记为疑似重复：通过
- 同一批导入内重复时标记为疑似重复：通过
- 默认跳过重复行：通过
- 选择“仍然导入重复行”后可导入重复行：通过

## 黄色重点识别验收

- 重点列识别：通过
- 支持 是 / 否 / true / false / 1 / 0 / yes / no / Y / N：通过
- Excel 黄色底色识别：best-effort，接口可正常解析且不报错
- 说明：重点列识别最可靠；本地由 `xlsx` 生成的测试样式未被社区版稳定读回，黄色底色识别受 `xlsx` 社区版样式读取能力影响，不作为阻塞项。

## 批量操作验收

- 表头全选当前页：通过
- 批量标记重点：通过
- 批量取消重点：通过
- 批量删除：通过
- 批量删除二次确认：通过
- 批量操作日志：通过

## 表格体验验收

- 表头 sticky：通过
- 序号列和型号列视觉固定：通过
- 空值显示为空白：通过
- 重点行浅黄色背景：通过
- 选中行浅橙色背景：通过
- 1366x1024、1280x800、1024x768 页面整体无严重横向溢出：通过

## 原始资料附件验收

- 文件类型标识：通过
- 文件大小显示：通过
- 上传时间显示：通过
- 上传 / 下载 / 删除：通过
- 删除二次确认：通过
- 空状态文案：通过

## 回归测试结果

- `npx prisma generate`：通过
- `npx prisma migrate deploy`：通过
- `npm run build`：通过
- `docker build -t hongmeng-workorder:v1-10-connector-params-rc2 .`：通过
- `docker compose -p hongmeng up --build -d`：通过
- `npm run smoke`：通过
- `/api/health`：通过
- 连接器参数新增 / 编辑 / 删除 / 恢复：通过
- 连接器参数搜索 / 缺失筛选：通过
- 生产资料库上传 / 预览 / 下载 / ZIP 下载：通过
- 浏览器 console 0 error：通过

## 已知问题

暂无阻塞问题。黄色底色识别为 best-effort，推荐真实导入模板优先使用“重点”列。
