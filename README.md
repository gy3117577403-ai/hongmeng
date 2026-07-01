# 工单资料库 / 鸿蒙平板资料管理系统

生产版 v1.0：账号登录后按工单管理 PDF/JPG/PNG 资料。数据存 PostgreSQL，文件存 S3 兼容对象存储，容器重启或重新部署后数据不丢。

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

## 生产部署状态
- 当前版本：v1.0.1
- 上线地址：https://qdowqencjyph.sealoshzh.site
- 部署平台：Sealos
- 镜像：`ghcr.io/gy3117577403-ai/hongmeng`
- 当前镜像 digest：`sha256:226b2b6268882e99cf04c69903d3e94b5333d923e5ef12184a980eb9f6bef7da`
- 数据库：Sealos PostgreSQL
- 文件存储：Sealos Object Storage
- 登录账号：`admin`
- 说明：v1.0.1 修复生产 standalone 启动方式

## 数据不丢验收
1. 上传 PDF/JPG/PNG。
2. 刷新页面仍在。
3. 退出再登录仍在。
4. 换设备登录仍在。
5. 重启/重新部署容器仍在。
6. `resource_files` 有记录。
7. 对象存储有实际文件。
8. 删除后前端隐藏，数据库记录仍保留。
