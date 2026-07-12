# Windows 微盘导入助手 1.16.5.3 服务来源修复 QA

## 版本范围

- 版本：`v1.16.5.3-wecom-helper-service-origin-fix`
- Windows 助手版本：`1.16.5.3`
- 正式服务 Origin：`https://qdowqencjyph.sealoshzh.site`
- 本轮不修改数据库结构，不上传文件，不写入 S3，不部署 Sealos。

## 根因

Windows 助手此前在 API 客户端、协议解析和 loopback handoff 中分别实现来源比较；网页任务创建、手动配对响应和浏览器 handoff 又分别从 `APP_BASE_URL`、反向代理请求 origin 或 `window.location.origin` 推导地址。Sealos 反向代理场景下，网页可能把内部请求 origin 返回给已经通过第一步配对的助手，导致第二次配置校验报“任务服务地址不在允许列表中”。这不是助手版本冲突，也不是放宽 allowlist 可以解决的问题。

## 修复

- Windows 端新增统一 `ServiceOriginPolicy`，手动任务码、协议唤起、API 客户端和 loopback handoff 共用同一策略。
- 只允许正式 HTTPS 主机和 443 端口，使用 `Uri.IdnHost` 与精确、不区分大小写的主机比较。
- 尾斜杠、主机名大小写、显式 `:443` 和同源 API path 统一规范为正式 Origin。
- 严格拒绝 HTTP、userinfo、非 443 端口、相似前后缀恶意域名、相对 URL、`file`、`ftp` 与 `javascript` URL。
- Web 端任务创建、配对响应和浏览器 handoff 统一下发正式 Origin，不再使用反向代理内部 origin 或浏览器当前位置替代任务服务地址。
- Release 构建不允许 localhost；`127.0.0.1:17651` 仅用于受正式网页 Origin 约束的本机 handoff。

## 自动验证

- `.NET restore`：通过。
- `.NET Release build`：通过，0 warning / 0 error。
- `.NET test`：46/46 通过。
- `.NET self-contained publish`：通过，版本为 `1.16.5.3`。
- Web 本地来源与配对状态测试：22/22 通过。
- `npx prisma generate`：通过；未新增 migration。
- `npm run build`：通过，仅保留既有非阻塞前端 lint warning。
- `docker build`：通过。
- `docker compose -p hongmeng up --build -d`：App、PostgreSQL、MinIO 正常运行。
- `npm run smoke`：`/api/health`、`/manifest.webmanifest`、`/login` 全部通过。
- 本地 `/api/local-import/tasks/pair` 未授权/无效码响应为 `401 application/json`，不是 HTML。

## 线上验收边界

本次 Web 任务载荷有实际修改，因此在包含本提交的新 GHCR 镜像部署到 Sealos 前，不能把线上手动任务码、协议唤起和网页“助手已连接”状态标记为已验证。部署后仅需创建一个不上传文件的短期任务，分别验证手动任务码、协议唤起、幂等重连和 `ping`；不得在诊断或文档中记录任务码、票据或完整协议 URI。
