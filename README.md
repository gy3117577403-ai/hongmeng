# 工单资料库 / 鸿蒙平板资料管理系统

生产版 v1.12.0：账号登录后按工单管理 PDF/JPG/PNG 资料，支持鸿蒙平板拍照上传、浏览器端语音输入、连接器参数资料、资料空态引导和生产稳定性防护。数据存 PostgreSQL，文件存 S3 兼容对象存储，容器重启或重新部署后数据不丢。

## 功能
- 登录：默认账号 `admin`
- 工单列表、搜索、进度、优先级
- 资源分类：原图、SOP指导书、成品图、辅料规格、注意事项
- PDF/JPG/PNG 上传到对象存储
- 文件元数据存 PostgreSQL
- PDF/图片预览、下载、软删除
- 所有登录账号共享同一套数据
- 平板横屏三栏 UI
- Docker / Sealos 部署配置

## 本地启动
```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run prisma:seed
npm run dev
```
访问 `http://localhost:3000`，账号 `admin`。

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

## Harmony Native App
- 目录：`harmony-tablet`
- 版本：v2.0.0-native-rc.5
- 技术栈：ArkTS / ArkUI / Stage 模型
- 设备优先：鸿蒙 Tablet
- 主界面：原生 ArkUI，不使用 WebView 套壳
- 后端：通过 HTTPS 调用 Sealos `/api/native/*`
- 默认服务地址：https://qdowqencjyph.sealoshzh.site
- 进度：原生 App 已接入后端真实登录、工单资料库、工单管理、资料管理、连接器参数、系统设置、生产稳定中心、日志、回收站、快照、诊断信息和平台 adapter 闭环
- 文档：[Harmony Native App Plan v2.0.0](docs/HARMONY_NATIVE_APP_PLAN_v2.0.0.md)
- 工程说明：[Native README](harmony-tablet/README_NATIVE.md)

## 生产部署状态
- 当前生产版本：v1.12.0
- 上线地址：https://qdowqencjyph.sealoshzh.site
- 部署平台：Sealos
- 镜像：`ghcr.io/gy3117577403-ai/hongmeng`
- 数据库：Sealos PostgreSQL
- 文件存储：Sealos Object Storage
- 数据模式：账号登录，共享数据
- 权限模式：无角色权限
- v1.3.0：工单管理、资料完整性、ZIP 下载、操作日志
- v1.4.0：批量上传、版本递增、文件编辑、上传管理增强
- v1.5.0：PWA、系统设置、数据导入导出、打印摘要、错误页
- v1.6.0：账号管理、回收站恢复、文件错传纠正、全局搜索、工单直达链接和二维码、拍照上传、现场概览、使用帮助、诊断信息导出
- v1.8.0：PDF.js 自定义预览、图片完整预览、文件名安全解码、同源文件内容流 API、PDF worker API、当前工单显示客户、工单信息区去重、右侧资料工具窗可收起 / 可拉伸、右侧工具窗覆盖式展开不挤压预览、缩略图默认收起并透明浮动、主预览区优先布局、顶部操作按钮收口、文件标题栏去重、1024x768 工作台优化
- v1.9.0：实时拍照上传、后置摄像头优先、拍照预览 / 重拍 / 确认上传、摄像头权限错误处理、capture fallback、语音输入按钮、全局搜索语音输入、工单表单语音输入、文件信息语音输入、语音输入权限和兼容提示
- v1.11.0：主页空态资料缺失引导卡、无文件时隐藏“文件 0 个”缩略入口、右侧工具条空态感知、分类栏完整显示、当前工单条资料状态优化、顶部操作进一步收口
- v1.12.0：危险操作防误触、数据变更快照、连接器参数导入批次、导入批次回滚、上传失败重试、生产健康检查增强、生产稳定中心、数据库索引优化

## 开发版本 / Release Candidate

### v2.0.0-native-rc.5
- 状态：本地 Web build / smoke 通过，Harmony 命令行工具缺失，等待 DevEco Studio 内清理、生成和真机验证
- 说明：鸿蒙平板原生 App 功能完整对齐候选版，不使用 WebView，不嵌入现有网页
- 功能：
  - 原生登录、退出、token 保存和修改密码
  - 原生工作台：顶部导航、工单抽屉、当前工单条、资料分类栏、预览区、右侧资料工具窗
  - 工单新建、编辑、软删除、恢复接口、工单直达二维码和当前工单全部资料 ZIP 下载
  - 资源文件 PDF/图片选择、multipart 上传、图片预览、PDF 系统预览入口、下载、打开、复制链接、软删除、恢复接口、文件信息编辑、分类移动和跨工单点选 / ID 移动
  - 连接器参数查询、筛选、新增、编辑、删除、恢复、复制整行参数、批量标记、批量删除、CSV 粘贴导入预览、CSV/XLS/XLSX 文件导入预览、确认导入、大批量导入确认、导入批次回滚、CSV 导出和原始附件上传/下载/删除
  - 平台 adapter：文件选择、现场照片入口、照片预览确认、native 下载短期 ticket、下载打开、剪贴板复制和多处语音/手动输入兜底
  - 设置页：生产稳定中心、系统状态、账号管理、账号启停 / 重置密码二次确认、修改密码、操作日志、回收站、数据快照和诊断信息
- 验证：
  - `npm run build` 通过
  - `npm run smoke` 通过
  - 本机缺少 `ohpm` / `hvigor` / `hvigorw`，Harmony HAP 构建需在 DevEco Studio 内验证
- 说明：
  - 当前不部署 Sealos
  - 当前不修改线上环境变量
  - 尚未作为生产版本发布

### v2.0.0-native-rc.2
- 状态：本地 Web build / smoke 通过，Harmony 命令行构建需进入 DevEco Studio 环境验证
- 说明：鸿蒙平板原生 App 数据闭环版，不使用 WebView
- 功能：
  - 原生登录、退出登录和 token 持久化
  - 真实工单列表、工单搜索、资料分类和文件列表
  - 图片原生预览
  - PDF 文件卡片预览、下载 / 打开入口
  - PDF / JPG / PNG 上传 adapter 和上传队列
  - 拍照上传入口与 Camera adapter
  - 连接器参数查询、筛选、新增、编辑、软删除
  - 设置页系统状态
- 验证：
  - `npm run build` 通过
  - `npm run smoke` 通过
  - 本机缺少 `ohpm` / `hvigor` / `hvigorw`，未执行 HAP 命令行构建
- 说明：
  - 当前不部署 Sealos
  - 当前不检查 GHCR digest
  - 当前不作为生产版本发布

### v1.3.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 工单新增 / 编辑 / 软删除
  - 工单搜索 / 筛选
  - 资料完整性状态
  - 当前工单全部资料 ZIP 下载
  - 文件版本显示
  - 操作日志
- 验证：
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - 上传 / 预览 / 下载 / ZIP 下载通过
  - 修改密码回归通过

### v1.4.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 批量上传
  - 上传状态反馈
  - 文件版本自动递增
  - 文件横向缩略列表
  - 图片缩略图
  - PDF 图标缩略卡片
  - 文件信息编辑
  - 上传管理增强
  - 操作日志筛选增强
- 验证：
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - 上传 / 预览 / 下载 / ZIP 下载通过
  - 工单管理回归通过
  - 修改密码回归通过
  - 1366x1024、1280x800、1024x768 无严重横向溢出

### v1.5.0-rc.1
- 状态：本地总验收中，等待统一部署
- 基于 commit：`ba4eb98447b55417d8cbd192e0b39fd9e372e230`
- 功能：
  - 登录
  - 修改密码
  - 平板三栏 UI
  - 工单新增 / 编辑 / 软删除
  - 工单搜索 / 筛选
  - 资料完整性状态
  - 资源分类
  - 批量上传 PDF / JPG / PNG
  - 文件预览
  - 单文件下载
  - 当前工单全部资料 ZIP 下载
  - 文件软删除
  - 文件版本自动递增
  - 文件信息编辑
  - 上传管理
  - 操作日志
  - PWA / 添加到桌面
  - 系统设置
  - 系统健康状态
  - 工单 CSV 导入
  - CSV / JSON 数据导出
  - 当前工单打印摘要
  - PostgreSQL 持久化
  - S3 对象存储持久化
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布
  - 后续将统一部署验收

### v1.6.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 多账号管理
  - 账号启用 / 停用
  - 管理端重置账号密码
  - 回收站查看与恢复工单 / 文件
  - 工单二维码打印
  - 当前工单链接复制
  - 全局搜索工单 / 文件
  - 文件跨工单 / 跨分类移动
  - 现场资料概览
  - 拍照上传入口
  - 使用帮助
  - 系统诊断信息导出
- 本地验证：
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - 登录、修改密码、工单管理、上传、预览、下载、ZIP 下载、导入导出回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.7.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 工单列表改为横向抽屉，资料库默认全屏显示
  - 顶部当前工单胶囊，集中显示工单号、产品、状态、优先级和计划时间
  - 工单状态统一为未发图 / 在前端 / 在后端 / 已完成
  - 工单卡片和顶部胶囊支持快速修改状态、优先级和计划时间
  - 左侧抽屉支持按钮打开、遮罩关闭、左缘滑入和左滑关闭
  - 工单计划时间字段、CSV 导入导出、元数据导出和打印摘要同步支持
  - 工单卡片紧凑化，资料完整性显示为完整 / 缺资料 N / 无资料
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - 登录、工单切换、状态流转、优先级修改、计划时间、上传、预览、下载、ZIP 下载、导入导出回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.8.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - PDF.js 同源流式预览，支持翻页、缩放、适宽、整页和全屏
  - 图片预览支持适应窗口、原始大小、缩放和全屏
  - 文件名安全解码和长文件名中间省略
  - 资料分类侧栏、右侧资料信息 / 上传 / 文件操作区优化
  - 顶部操作按钮分组，低频操作收纳到“更多操作”
  - 文件缩略图横向列表、版本状态和空态优化
- 本地验证：
  - `npx prisma generate` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - PDF / 图片预览、上传、下载、ZIP 下载、工单抽屉、状态流转、全局搜索、修改密码回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.8.0-rc.3
- 状态：本地验证通过，等待统一部署
- 功能：
  - 工单客户名称字段，支持新增 / 编辑、搜索、CSV 导入导出、元数据导出、打印摘要、工单直达链接和二维码展示
  - 首页顶部当前工单信息重排为常驻窄条，集中显示客户、工单号、产品、状态、优先级、计划时间和资料完整性
  - 右侧资料信息 / 上传 / 操作 / 队列区域收口为可折叠、可调整宽度的工具窗
  - 文件缩略图改为底部透明悬浮条，支持展开 / 收起，不再挤压预览高度
  - 顶部操作区保留下载全部、刷新和更多操作，降低平板横屏拥挤度
  - 1024x768 视口下右侧工具窗使用覆盖式布局，资料预览不被挤压
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - PDF / 图片预览、上传、下载、ZIP 下载、导入导出、全局搜索、修改密码回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.8.0-rc.4
- 状态：本地验证通过，等待统一部署
- 功能：
  - 主预览区优先布局
  - 取消固定分类 / 操作横条
  - 取消固定文件标题区
  - 文件信息悬浮胶囊
  - PDF / 图片悬浮控制条
  - 右侧工具窗覆盖式展开
  - 缩略图默认收起并透明浮动
  - Toast 位置调整
  - 1024x768 预览空间优化
- 本地验证：
  - `npx prisma generate` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - PDF / 图片预览、上传、下载、ZIP 下载、右侧工具窗、缩略图浮层回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.9.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 实时拍照上传
  - 后置摄像头优先
  - 拍照预览 / 重拍 / 确认上传
  - 摄像头权限错误处理
  - capture fallback
  - 语音输入按钮
  - 全局搜索语音输入
  - 工单表单语音输入
  - 文件信息语音输入
  - 语音输入权限和兼容提示
- 本地验证：
  - `npx prisma generate` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - 上传 / 预览 / 下载 / ZIP 下载回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.10.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 连接器参数资料模块
  - 参数新增 / 编辑 / 软删除 / 恢复
  - Excel / CSV 导入
  - Excel 粘贴导入
  - CSV 导出
  - 原始资料附件上传
  - 参数搜索和缺失筛选
  - 重点标记
  - 空缺字段保留为空
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - 生产资料库主要功能回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.10.0-rc.2
- 状态：本地验证通过，等待统一部署
- 功能：
  - 导入前预览
  - 重复行检测
  - 默认跳过重复行
  - Excel 黄色重点行 best-effort 识别
  - 表格 sticky 表头和型号列
  - 批量标记重点 / 取消重点 / 删除
  - 原始资料附件区优化
  - 样例 CSV
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - 生产资料库主要功能回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.10.0-rc.4
- 状态：本地验证通过，等待统一部署验收
- 功能：
  - 顶部统计区压缩
  - 原始资料附件抽屉
  - 表格操作列简化
  - 重点列优化
  - 缺失字段筛选高亮
  - 搜索命中高亮
  - 复制整行参数
  - 表格滚动体验优化
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - 连接器参数查询、筛选、附件、导入导出和复制参数回归通过
- 说明：
  - 尚未部署 Sealos
  - 等待统一部署验收
  - 尚未作为生产版本发布

### v1.11.0-rc.1
- 状态：本地验证通过，等待统一部署
- 功能：
  - 主页空态资料缺失引导卡
  - 无文件时隐藏“文件 0 个”缩略图入口
  - 右侧工具栏空态感知
  - 分类栏完整显示
  - 当前工单条资料状态优化
  - 顶部操作进一步收口
- 本地验证：
  - `npx prisma generate` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - 空态、分类栏、右侧工具栏和已有文件预览回归通过
- 说明：
  - 尚未部署 Sealos
  - 尚未作为生产版本发布

### v1.12.0-rc.1
- 状态：已完成 Sealos 线上验收，并固化为生产版本 v1.12.0
- 功能：
  - 危险操作防误触
  - 数据变更快照
  - 连接器参数导入批次
  - 导入批次回滚
  - 上传失败重试
  - 生产健康检查增强
  - 生产稳定中心
  - 数据库索引优化
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
- 说明：
  - 已部署 Sealos
  - 已作为生产版本 v1.12.0 发布

### v1.13.0-rc.1
- 状态：本地验证中，等待统一部署
- 功能：
  - 工单删除强确认：输入工单号和 CONFIRM 后才能删除
  - 文件删除强确认：输入 DELETE 和文件名后 4 位后才能删除
  - 连接器参数删除 / 批量删除继续使用 DELETE 强确认
  - 超过 100 行的连接器导入需输入 IMPORT_CONFIRM 后才能确认入库
  - 上传队列保留失败文件，支持单条重试和批量重试
  - 上传失败、上传重试、复制连接器参数、导入批次回滚操作日志完善
  - 系统状态接口补充应用版本、数据库、对象存储、上传限制、统计计数和配置告警
  - 延续 v1.12.0 的数据变更快照和连接器导入批次回滚能力
- 本地验证：
  - `npx prisma generate` 通过
  - `npx prisma migrate deploy` 通过
  - `npm run build` 通过
  - `docker build` 通过
  - `docker compose` 通过
  - `npm run smoke` 通过
  - `/api/health` 通过
  - 系统状态、上传失败日志、复制参数日志、导入批次回滚日志抽查通过
- 说明：
  - 当前不部署 Sealos
  - 当前不修改线上环境变量
  - 当前不作为生产版本发布

### RC 说明
- v1.3.0-rc.1、v1.4.0-rc.1、v1.5.0-rc.1、v1.6.0-rc.1、v1.7.0-rc.1、v1.8.0-rc.1、v1.8.0-rc.3、v1.8.0-rc.4、v1.9.0-rc.1、v1.10.0-rc.1、v1.10.0-rc.2、v1.10.0-rc.3、v1.10.0-rc.4、v1.11.0-rc.1、v1.12.0-rc.1 和 v1.13.0-rc.1 为候选版本记录
- v1.6.0 已完成 Sealos 统一部署和线上验收
- v1.12.0 已完成 Sealos 统一部署和线上验收

## 交付文档索引
- [用户手册 v1.5.0](docs/USER_MANUAL_v1.5.0.md)
- [运维手册 v1.5.0](docs/ADMIN_OPERATION_v1.5.0.md)
- [现场使用指南 v1.6.0](docs/FIELD_USE_GUIDE_v1.6.0.md)
- [拍照与语音输入说明 v1.9.0](docs/CAMERA_VOICE_GUIDE_v1.9.0.md)
- [连接器参数资料指南 v1.10.0](docs/CONNECTOR_PARAMETERS_GUIDE_v1.10.0.md)
- [备份计划 v1.5.0](docs/BACKUP_PLAN_v1.5.0.md)
- [回滚指南 v1.5.0](docs/ROLLBACK_GUIDE_v1.5.0.md)
- [部署 Smoke Test v1.5.0](docs/SMOKE_TEST_v1.5.0.md)

## 数据不丢验收
1. 上传 PDF/JPG/PNG。
2. 刷新页面仍在。
3. 退出再登录仍在。
4. 换设备登录仍在。
5. 重启/重新部署容器仍在。
6. `resource_files` 有记录。
7. 对象存储有实际文件。
8. 删除后前端隐藏，数据库记录仍保留。
