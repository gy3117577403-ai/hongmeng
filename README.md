# 工单资料库 / 鸿蒙平板资料管理系统

当前项目路线：Web 网页版 + Sealos 部署。Harmony / DevEco 原生 App 试验工作已停止维护，并归档到 Git tag `v2.0.0-native-archive`。

## 生产部署状态

- 当前生产版本：v1.12.0
- 上线地址：https://qdowqencjyph.sealoshzh.site
- 部署平台：Sealos
- 镜像：`ghcr.io/gy3117577403-ai/hongmeng`
- 数据库：Sealos PostgreSQL
- 文件存储：Sealos Object Storage
- 数据模式：账号登录，共享数据
- 权限模式：无角色权限

## 功能范围

- 账号登录、修改密码、账号管理
- 工单资料库、工单新增 / 编辑 / 软删除 / 恢复
- 工单搜索、状态筛选、资料完整性状态
- PDF / JPG / PNG 上传到 S3 兼容对象存储
- PDF.js 预览、图片完整预览、文件下载、当前工单 ZIP 下载
- 生产工单上传资料自动沉淀到图纸资料库，PDF / 图片预览支持适应窗口和旋转
- 本地图纸原图批量导入工具，支持 dry-run 报告、客户别名匹配和只导入“原图”分类
- 文件版本显示、文件信息编辑、跨分类 / 跨工单移动
- 网页版拍照上传、浏览器语音输入
- 连接器参数资料、Excel / CSV 导入预览、导入批次回滚
- 原始资料附件上传 / 下载 / 删除
- 操作日志、回收站、数据变更快照、生产稳定中心
- PWA、系统设置、数据导出、打印摘要、错误页
- 周计划 Excel / CSV 工单导入预览与确认
- 图纸资料库首页：按客户 -> 规格 -> 图纸资料管理长期图纸文件，不保存周计划状态字段

## 本地启动

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run prisma:seed
npm run dev
```

访问 `http://localhost:3000`，默认账号为 `admin`。不要把真实生产密码或密钥写入仓库。

## Docker 启动

```bash
docker compose up --build
```

## Sealos 镜像

推送到 GitHub main 后，工作流会构建：

```text
ghcr.io/gy3117577403-ai/hongmeng:latest
```

Sealos App Deploy 端口填 `3000`。

## 平板交付方式

当前主线交付仍是 Web 网页版 + Sealos。现场平板可按设备能力选择：

- Web 浏览器：直接打开 `https://qdowqencjyph.sealoshzh.site`，适合临时访问和快速验收。
- PWA 添加到桌面：在平板浏览器菜单中选择“添加到桌面 / 安装应用”，从桌面图标进入，减少地址栏和标签栏干扰。
- Android APK WebView 壳：使用 `android-webview-app/` 打包 APK，或通过 GitHub Actions 的 `Android WebView APK` workflow 下载 debug APK；安装后全屏加载 `https://qdowqencjyph.sealoshzh.site/dashboard`。

v1.13.4-tablet-final-pretest 增加了平板端“同步”入口。现场如果用 Web 浏览器上传资料，APK / PWA 端可在当前工单点击“同步”刷新工单列表、分类数量和当前资料文件，不需要反复退出或刷新整个页面。PWA Service Worker 只缓存 manifest 和图标，不缓存业务 API、页面、上传响应、签名链接或文件内容流。

当前不再维护 DevEco 原生 ArkTS 路线，也不再维护 `harmony-tablet` 或 `/api/native/*`。APK 壳只负责全屏加载现有 Web 系统，不内置账号、密码、token、数据库连接串或对象存储密钥。

## 历史归档

Harmony 原生 App 试验工作已归档到 tag `v2.0.0-native-archive`。当前生产和后续维护继续使用 Web / Sealos 路线，不再维护 `harmony-tablet`、DevEco 工程或 `/api/native/*`。

## 发布记录摘要

- v1.3.0：工单管理、资料完整性、ZIP 下载、操作日志
- v1.4.0：批量上传、版本递增、文件编辑、上传管理增强
- v1.5.0：PWA、系统设置、数据导入导出、打印摘要、错误页
- v1.6.0：账号管理、回收站恢复、文件错传纠正、全局搜索、工单直达链接和二维码、拍照上传、现场概览、使用帮助、诊断信息导出
- v1.8.0：PDF.js 自定义预览、图片完整预览、同源文件内容流 API、PDF worker API、工作台预览优先布局、1024x768 优化
- v1.9.0：实时拍照上传、后置摄像头优先、语音输入按钮、全局搜索 / 表单 / 文件信息语音输入
- v1.10.0：连接器参数资料、导入预览、重复识别、批量操作、原始资料附件
- v1.11.0：主页空态资料缺失引导卡、分类栏完整显示、当前工单条资料状态优化
- v1.12.0：危险操作防误触、数据变更快照、连接器参数导入批次、导入批次回滚、上传失败重试、生产健康检查增强、生产稳定中心、数据库索引优化
- v1.13.4-tablet-final-pretest：PWA / APK 缓存收口、当前工单同步按钮、旧工单资料安全清理脚本、seed 样例工单开关。该版本用于平板真实数据测试前预检，不是生产发布记录。
- v1.13.5-weekly-plan-import：支持周计划 `.xls` / `.xlsx` / `.csv` 工单导入，新增预览/确认流程、SO 单号错位行识别、合计行跳过、周几转计划日期、图纸/配料状态映射。该功能用于后续真实工单批量导入。
- v1.13.6-weekly-plan-production-cleanup：周计划工单主显示改为规格 / 生产编号，保留内部 `WO-*` 编号；新增本周生产工单清理预览和 `CLEAR_WEEK` 确认机制，仅设置 `planActive=false`，不删除资料文件、S3 对象或连接器参数。
- v1.13.7-workorder-header-simplify：周计划导入后的工单主显示以规格为准，当前工单条仅展示客户和规格，支持一键复制规格；其他生产信息保留在右侧信息面板。
- v1.13.8-drawing-library-home：新增长期图纸资料库首页，按客户和规格管理图纸文件；图纸资料库不显示、不保存图纸已发、配料、未交量、交期、工时等周计划字段。该版本为待部署候选，不代表生产已上线。
- v1.13.9-drawing-library-cleanup-ui：图纸资料库默认隐藏周计划导入产生的空壳记录；周计划导入不再自动创建可见图纸资料记录，只关联已有记录；新增空资料 dry-run / 确认清理脚本和页面入口，只软删除空 DrawingLibraryItem，不影响生产工单、连接器参数、资料文件或 S3 对象。该版本为待部署候选，不代表生产已上线。
- v1.13.10-layout-layer-preview-polish：统一顶部菜单、管理员菜单、资料库切换菜单、工单更多菜单和连接器行菜单的浮层层级；图纸资料库详情页移除重复信息大卡片，改为紧凑标题区和分类栏 / 预览区 / 文件列表三栏布局，预览区优先。该版本为待部署候选，不代表生产已上线。
- v1.14.0-drawing-library-auto-sync-preview：生产工单上传 PDF / 图片后自动沉淀到图纸资料库，复用同一 S3 objectKey，不重复上传；新增当前工单手动同步和历史资料 dry-run 补同步脚本；PDF / 图片预览默认适应窗口并支持左旋、右旋和重置。该版本为待部署候选，不代表生产已上线。
- v1.14.1-bulk-original-drawing-import：新增本地图纸原图批量导入工具，默认扫描 `C:\Users\31175\Desktop\图纸`，支持客户别名、规格提取、重复识别、dry-run 报告和正式上传确认；只导入图纸资料库“原图”分类，不影响生产工单、连接器参数或 S3 删除。该版本为待部署候选，不代表生产已上线。
- v1.14.1-bulk-original-drawing-import-fix1：增强批量原图导入的 1CA 系列、通用前缀规格和括号 / 下划线品名解析；离线 dry-run 会输出 `locallyParsedFiles`、`readyForOnlineCheckFiles`、`onlineIndexAvailable` 和 `duplicateCheckSkipped`，便于未登录时先做本地预检。该版本为待部署候选，不代表生产已上线。

## 交付文档索引

- [用户手册 v1.5.0](docs/USER_MANUAL_v1.5.0.md)
- [运维手册 v1.5.0](docs/ADMIN_OPERATION_v1.5.0.md)
- [现场使用指南 v1.6.0](docs/FIELD_USE_GUIDE_v1.6.0.md)
- [拍照与语音输入说明 v1.9.0](docs/CAMERA_VOICE_GUIDE_v1.9.0.md)
- [连接器参数资料指南 v1.10.0](docs/CONNECTOR_PARAMETERS_GUIDE_v1.10.0.md)
- [图纸资料库使用说明](docs/DRAWING_LIBRARY_GUIDE.md)
- [图纸资料库同步说明](docs/DRAWING_LIBRARY_SYNC_GUIDE.md)
- [本地图纸原图批量导入指南](docs/BULK_ORIGINAL_DRAWING_IMPORT_GUIDE.md)
- [图纸资料库空数据清理说明](docs/DRAWING_LIBRARY_CLEANUP_GUIDE.md)
- [布局层级与预览区优化 QA](docs/QA_LAYOUT_LAYER_PREVIEW_POLISH.md)
- [预览适屏与旋转 QA](docs/QA_PREVIEW_ROTATE_AND_FIT.md)
- [生产稳定性指南 v1.12.0](docs/PRODUCTION_STABILITY_GUIDE_v1.12.0.md)
- [平板交付方案](docs/TABLET_APP_DELIVERY_PLAN.md)
- [平板真机测试前最终预检计划](docs/PRE_REAL_DATA_TEST_PLAN.md)
- [周计划 Excel 工单导入说明](docs/WEEKLY_PLAN_IMPORT_GUIDE.md)
- [周计划生产工单显示与清理机制](docs/WEEKLY_PLAN_WORKORDER_DISPLAY_AND_CLEANUP.md)
- [备份计划 v1.5.0](docs/BACKUP_PLAN_v1.5.0.md)
- [回滚指南 v1.5.0](docs/ROLLBACK_GUIDE_v1.5.0.md)
- [部署 Smoke Test v1.5.0](docs/SMOKE_TEST_v1.5.0.md)

## 数据不丢验收

1. 上传 PDF/JPG/PNG 后刷新页面仍在。
2. 退出再登录后数据仍在。
3. 换设备登录后数据仍在。
4. 重启或重新部署容器后数据仍在。
5. `resource_files` 有元数据记录。
6. 对象存储 Bucket 有实际文件。
7. 删除后前端隐藏，数据库记录仍保留软删除状态。
