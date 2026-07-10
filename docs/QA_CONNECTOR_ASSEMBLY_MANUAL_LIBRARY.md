# QA：连接器组装说明书资料库

版本：v1.16.0-connector-assembly-manual-library

状态：本地候选，未部署 Sealos。

## 数据模型

- 新增 `ConnectorAssemblyManual`：说明书主数据。
- 新增 `ConnectorAssemblyManualVersion`：版本、发布日期、页数、文件模式、最新版本、目录和全文索引。
- 新增 `ConnectorAssemblyManualAsset`：PDF / 图片对象元数据和顺序。
- 新增 `ConnectorAssemblyManualBinding`：说明书与连接器参数多对多关联。
- `ConnectorParameter` 只新增反向关系，不删除、不覆盖现有参数字段。
- migration：`202607100002_connector_assembly_manual_library`。

## API

已覆盖：

- 说明书列表、新增、详情、编辑、软删除、恢复。
- 版本新增、编辑、软删除、恢复、设为最新版。
- PDF / 多图上传。
- 受认证 content / download。
- 文件编辑、软删除、恢复。
- 型号绑定和解除绑定。
- 全局搜索和回收站扩展。

认证失败走 JSON 401，不返回 HTML 登录页。

## 自动化接口验收

使用未提交的本地 fixture：

- 3 页 PDF，正文包含唯一测试词。
- 2 张 PNG 图片。
- 两条本地连接器参数记录。

结果：

- 登录：通过。
- 新增说明书和首版：通过，HTTP 201。
- PDF 上传：通过。
- 页数识别：3 页，符合 fixture。
- PDF content：HTTP 200，`application/pdf`，`Cache-Control: no-store`。
- PDF 下载：HTTP 200，`application/pdf`。
- PDF 正文唯一词全局搜索：通过。
- 重复版本：HTTP 409。
- 新增图片集版本：通过。
- 两图上传和 `pageCount=2`：通过。
- 图片顺序调整：通过。
- 说明书文件软删除 / 恢复：通过。
- 参数行 `manualCount`：通过。
- 详情返回 2 个版本、2 个参数绑定、3 个目录项：通过。
- 版本软删除 / 恢复 / 设最新版：通过。
- 说明书软删除 / 回收站 / 恢复：通过。
- 说明书创建、版本上传、绑定、下载、删除和恢复日志：通过。
- 测试结束后 QA 说明书记录保留为本地软删除状态；未物理删除 S3 测试对象。

## PDF.js standalone 修复

首次容器验收发现服务端 PDF.js fake worker 会错误定位到 Next chunk 目录。修复后从运行目录向上定位现有 `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`，不新增 PDF 渲染器。重建 standalone 容器后，PDF 页数和正文提取通过。

## 版本管理

- 同一说明书 revision 唯一约束生效。
- 新版本默认设为最新。
- 标记最新时会清除其他有效版本的 `isLatest`。
- 删除最新版会自动选择最近有效版本。
- 历史版本和 S3 文件保持保留。

## PDF 预览

- 复用 `components/PdfViewer.tsx`。
- 当前页单页渲染和相邻页预取保留。
- 页码输入、翻页、缩放、旋转、适应窗口、适宽、整页、原始大小和全屏可用。
- 目录受控页码竞态已在本轮实测中发现并修复。

## 图片集预览

- 复用 `components/ImageViewer.tsx`。
- 只挂载当前图片。
- 上一页 / 下一页、旋转、适应窗口、原始大小、全屏和下载入口可用。
- 顺序调整 API 和 UI 通过。

## 搜索

- 说明书页面支持标题、型号、制造商、系列、文档编号、版本、关键词、PDF 正文和文件名。
- 全局搜索新增说明书与说明书文件分组。
- 结果可携带 manualId、versionId 和页码进入说明书页。
- 本轮不引入 OCR。

## 参数关联

- 一份说明书绑定多个参数：通过。
- 连接器参数行返回 `manualCount`：通过。
- 解除关联只删除绑定，不删除参数或说明书：API 已覆盖。
- 型号候选采用搜索 + 用户多选确认，不自动关联模糊结果。

## 回收站与日志

- 已删除说明书、版本、说明书文件均进入回收站响应。
- 恢复顺序保护：所属说明书 / 版本未恢复时，不允许直接恢复子项。
- 删除和恢复均不物理删除对象存储文件。
- 规定的说明书操作均接入 operation_logs。

## 平板布局

Playwright 本地视觉验收：

- 1366x1024：PDF / 图片工作台三栏可用，console 0 error。
- 1280x800：页面级 `scrollWidth` 等于 `innerWidth`，无横向溢出。
- 1024x768：页面级 `scrollWidth` 等于 `innerWidth`，PDF / 图片预览、全屏工具条和目录跳页可用，console 0 error。

截图目录：`output/playwright/`，目录已在 `.gitignore` 中，不提交。

## 回归

- Prisma generate：通过。
- Prisma migrate deploy：通过。
- Prisma migrate status：数据库已是最新。
- TypeScript：通过。
- Next lint：通过；仅保留项目原有 `<img>` / DrawingLibrary hook 警告。
- npm run build：通过。
- Docker Compose standalone 构建与启动：通过。
- `docker build -t hongmeng-workorder:v1-16-connector-manuals .`：通过。
- `/api/health`：通过。
- 连接器参数查询、原始资料附件、导入批次和 CSV 导出只读接口：HTTP 200。
- 生产工单、图纸资料库、周计划、生产执行摘要和全局搜索只读接口：HTTP 200。
- 最终 standalone 容器上重新执行完整说明书 API fixture，新增、PDF / 图片上传、版本、目录、关联、下载、软删除恢复和日志均通过。

## 真实样本待验收

当前任务没有可访问的 `ECTA24(32)芯插座（19年）.pdf` 文件，因此没有伪造样本上传结论。部署或交付前需用用户样本确认：

1. 页数为 8。
2. 第 1-8 页切换、旋转、适应窗口和全屏。
3. 下载。
4. 搜索 ECTA24。
5. PDF 有文字层时搜索“灌胶”。
6. 点击“灌胶”跳到第 8 页。
7. 绑定 ECTA24 / ECTA32。

## 已知问题

- 扫描型 PDF 没有文字层时无法全文搜索；本版本不含 OCR。
- 真正的 8 页用户样本尚需补测。
- 没有阻塞本地构建、migration、接口或容器启动的问题。

## 上线建议

在真实样本验收通过后，可作为 Sealos 部署候选。本任务只提交、推送、打 tag 和核验 GHCR，不执行 Sealos 部署。
