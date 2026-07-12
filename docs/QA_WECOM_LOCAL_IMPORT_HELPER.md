# v1.16.5 Windows 微盘导入助手 QA

## 范围

- 网页短期任务创建、状态轮询和完成后局部刷新。
- 固定工单 / 分类 / 用户的 10 分钟 HMAC 票据。
- Windows 自定义协议与 `127.0.0.1` loopback 安全交接。
- 拖拽、文件剪贴板、下载目录监控。
- PDF / JPG / JPEG / PNG / WEBP 校验、SHA-256、防重复和新版本。
- 复用现有 S3、`ResourceFile` 与图纸资料库同步链路。
- Windows GitHub Actions self-contained x64 artifact。

## 自动验证

- `dotnet restore`：通过。
- `dotnet build -c Release`：通过，0 warning / 0 error。
- `dotnet test -c Release --no-build`：通过，8/8。
- `dotnet publish -c Release -r win-x64 --self-contained true`：通过，生成单文件 EXE。
- 发布产物进程 smoke：通过，loopback `/health` 返回正常。
- `npx prisma generate`：通过；本轮未修改 schema，未新增 migration。
- `npm run build`：通过，新增 5 个 `/api/local-import/*` 路由均进入 Next.js 构建产物。
- `docker compose -p hongmeng up --build -d`：通过，PostgreSQL、MinIO 和 App 健康运行。
- `npm run smoke`：本地与现有正式地址均通过 `/api/health`、manifest 和登录页检查。
- 协议解析测试：正式 origin 通过，localhost / 非白名单 origin 拒绝，协议 URL 不含 ticket。
- 文件测试：PDF 文件头及 SHA-256 通过；伪 PDF 拒绝；`.tmp` / `.part` / `.crdownload` 拒绝。

## 安全检查

- loopback 只监听 `127.0.0.1:17651`。
- `/handoff` 只允许正式站点 Origin，并校验 handshakeId、taskId、baseUrl 和 30 秒交接窗口。
- 自定义协议不携带 ticket。
- ticket 仅在助手内存中，不写本地配置。
- 本地配置仅保存下载目录。
- API 日志不记录 ticket、Cookie、签名 URL、密码或 S3 Key。

## 隔离环境集成验证

使用独立 Compose project 和一次性 PostgreSQL / MinIO 卷完成小型 PDF fixture 验证，结束后已删除 QA 卷并恢复原本本地环境：

- 首次检查：`new`，上传成功。
- 相同 SHA-256：`duplicate`，默认跳过。
- 同名不同内容：`new_version`，版本为 `V1.0` / `V1.1`。
- 损坏 PDF：HTTP 400，未创建资料文件。
- ticket 错绑其他 taskId：HTTP 403。
- 任务过期后上传：HTTP 410。
- 未登录查询任务：HTTP 401。
- 两条 `ResourceFile` 均写入对象存储并可执行 HeadObject。
- 两条 `DrawingLibraryFile` 均成功关联，并复用对应 `ResourceFile.objectKey`，未二次上传 S3。
- 两个并发上传请求均返回 200，事务锁分配出唯一的 `V1.0` / `V1.1`，未出现重复版本号。
- 21 个并发请求中 20 个返回 200、第 21 个返回 409；数据库仅创建 20 条资料且版本号全部唯一。
- 同一文件先失败再重试成功后，任务摘要为成功 1、失败 0；失败历史日志仍保留。
- 任务创建账号停用后，已有短期票据立即返回 403。
- operation log 包含导入成功、重复跳过、失败与任务状态记录，未记录票据或凭据。

## 人工验收清单

1. Chrome / Edge 从网页唤起助手。
2. 单个和多个 PDF / 图片拖拽。
3. Windows 文件剪贴板 `Ctrl+V`。
4. 文本或链接拖入时不自动抓取。
5. 下载目录新增文件在稳定 3 秒后进入队列。
6. 临时和仍被写入的文件不上传。
7. 相同 SHA 文件默认跳过。
8. 同名不同内容显示新版本。
9. 冲突项未经确认不能上传。
10. 上传完成后网页局部刷新并选中最新文件。
11. `ResourceFile` 与 `DrawingLibraryFile` 关联正确，S3 仅有一份对象。
12. 任务过期后监控和上传停止。
13. Windows 10 / 11 便携式 artifact 运行正常。

## 已知边界

- 不访问企业微信私有数据；用户仍需拖出、复制或点击下载。
- 当前不签发正式代码签名证书，Windows 可能显示未知发布者。
- 未完成队列不跨助手进程持久化，关闭助手后需要重新创建任务。
- 真实浏览器、真实企业微信客户端和生产对象存储链路需在部署包含本版本的 Web 镜像后做非破坏性小文件验收。
