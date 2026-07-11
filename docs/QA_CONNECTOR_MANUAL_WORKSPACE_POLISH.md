# v1.16.2 连接器组装说明书工作台优化 QA

版本：v1.16.2-connector-manual-workspace-polish

日期：2026-07-11

状态：本地验证通过，尚未部署 Sealos。

## 变更范围

- 工作台重排为说明书索引、主预览、目录 / 版本 / 关联型号三栏。
- 右栏默认目录，可收起；1024px 下为覆盖式抽屉。
- 列表卡片移除空日期、空制造商、重复型号和长状态文案。
- 常驻快捷筛选与 Portal 高级筛选分离。
- 取消“信息”Tab；紧凑摘要和更多信息只渲染非空字段。
- 删除移入“更多”危险操作。
- PDF / 图片新增共享 `readingMode`，未复制预览实现。
- 单份新增改为选择文件、自动解析、确认保存三步。
- 通用说明词不再作为制造商，解析结果增加可信度分类。
- 新增只读元数据审计脚本。

## 元数据治理

禁止作为制造商的通用词：组装说明、组装说明书、操作说明、产品说明、目录、说明书、装配说明。

解析可信度为 `confirmed`、`detected`、`needs_review`。文件名名称保持主名称，`detectedTitle` 仅作为建议 / 搜索别名；建议只在用户点击后填入空字段，不覆盖已输入名称和制造商。

`npm run connector-manuals:audit-metadata` 在本地 PostgreSQL 执行成功。QA 清理后有效说明书为 0，通用制造商、空标题、无版本、无页数、无资产、多个 latest、重复版本与异常 MIME 均为 0。脚本输出明确标记 `DRY RUN / READ ONLY`，未修改数据库或 S3。

## 功能验证

| 项目 | 结果 |
| --- | --- |
| 说明书 API 新增 / 详情 / 编辑 | 通过 |
| PDF 上传、页数读取、正文搜索 | 通过，fixture 为 3 页 |
| 图片集上传、翻页、排序 | 通过，fixture 为 2 张 |
| 版本重复阻止、切换、设最新 | 通过 |
| 目录点击跳页 | 通过，第 1 页跳到第 3 页 |
| 型号关联 / 解除入口 | 通过 |
| 文件 content / download | 通过，PDF Content-Type 与 no-store 正确 |
| 说明书 / 版本 / 文件软删除恢复 | 通过 |
| 操作日志 | 通过 |
| 批量导入入口与原有 API 回归 | 通过 |
| 单份新增三步流程 | 通过 |
| 识别建议不覆盖用户输入 | 通过 |
| 阅读工具栏更多菜单 / 全屏 | 通过 |
| 临时 QA 数据清理 | 通过，仅软删除，无 S3 物理删除 |

## 视觉验证

Playwright 实测视口：

- 1366x1024：三栏工作台、PDF 目录与主预览正常。
- 1280x800：工具栏单行，目录跳页后第 3 页正常。
- 1024x768：无页面级横向溢出，右栏首次进入默认收起，打开后覆盖显示。

三个视口的 `documentElement.scrollWidth` 均等于视口宽度，浏览器 console 为 0 error / 0 warning。截图保存在本地忽略目录 `output/playwright/`，不提交仓库。

## 构建验证

- `npx prisma generate`：通过。
- Prisma migration：本轮未修改 schema，未新增 migration。
- `npm run build`：通过，仅保留项目已有的非阻塞 lint warning。
- `npm run smoke`：通过，health、manifest、login 均为 OK。
- `docker compose -p hongmeng up --build -d`：通过，应用、PostgreSQL、MinIO 正常运行。
- `/api/health`：HTTP 200，返回 `ok: true`。

## 样本说明

用户指定的真实 8 页 `ECTA24(32)芯插座（19年）.pdf` 未作为本轮可访问附件提供，因此没有伪造真实上传结果。本地使用不提交的 3 页 PDF fixture 验证解析、预览、目录跳页、缩放、旋转、全屏、下载和正文搜索结构。真实 8 页样本仍需在统一部署前按指南人工复核页数、制造商、日期、型号与 5 个章节。

## 已知问题

暂无阻塞问题。构建仍会显示仓库既有的 `<img>` 优化提示及 DrawingLibrary effect 依赖提示，本轮未扩大范围处理。
