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
- 文件版本显示、文件信息编辑、跨分类 / 跨工单移动
- 网页版拍照上传、浏览器语音输入
- 连接器参数资料、Excel / CSV 导入预览、导入批次回滚
- 原始资料附件上传 / 下载 / 删除
- 操作日志、回收站、数据变更快照、生产稳定中心
- PWA、系统设置、数据导出、打印摘要、错误页

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

## 交付文档索引

- [用户手册 v1.5.0](docs/USER_MANUAL_v1.5.0.md)
- [运维手册 v1.5.0](docs/ADMIN_OPERATION_v1.5.0.md)
- [现场使用指南 v1.6.0](docs/FIELD_USE_GUIDE_v1.6.0.md)
- [拍照与语音输入说明 v1.9.0](docs/CAMERA_VOICE_GUIDE_v1.9.0.md)
- [连接器参数资料指南 v1.10.0](docs/CONNECTOR_PARAMETERS_GUIDE_v1.10.0.md)
- [生产稳定性指南 v1.12.0](docs/PRODUCTION_STABILITY_GUIDE_v1.12.0.md)
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
