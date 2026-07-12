# v1.16.5.2 Windows 微盘导入助手配对状态机修复 QA

## 范围

- 网页短期任务创建、状态轮询和完成后局部刷新。
- 固定工单 / 分类 / 用户的 10 分钟 HMAC 票据。
- Windows 自定义协议与 `127.0.0.1` loopback 安全交接。
- 拖拽、文件剪贴板、下载目录监控。
- PDF / JPG / JPEG / PNG / WEBP 校验、SHA-256、防重复和新版本。
- 复用现有 S3、`ResourceFile` 与图纸资料库同步链路。
- Windows GitHub Actions self-contained x64 artifact。
- `asInvoker` 普通用户启动、HKCU 协议自动注册 / 修复、`ping` 自测和当前用户单实例。
- 服务端显式 `connect` 握手、一次性手动任务码、过期和错误尝试限流。
- 助手协议状态、版本 / commit、连接状态和脱敏诊断信息。

## 自动验证

- `dotnet restore`：通过。
- `dotnet build -c Release`：通过，0 warning / 0 error。
- `dotnet test -c Release`：通过，21/21。
- `dotnet publish -c Release -r win-x64 --self-contained true`：通过，生成无需运行时自解压的自包含便携目录。
- 应用清单二进制检查：包含 `requestedExecutionLevel=asInvoker`，不包含 `requireAdministrator` 或 `highestAvailable`。
- `npx prisma generate`：通过；本轮未修改 schema，未新增 migration。
- `npm run build`：通过，`/api/local-import/tasks/pair` 与 `/api/local-import/tasks/[taskId]/connect` 均进入 Next.js 构建产物。
- `docker compose -p hongmeng up --build -d`：通过，PostgreSQL、MinIO 和 App 健康运行。
- `npm run smoke`：本地通过 `/api/health`、manifest 和登录页检查。
- 协议解析测试：正式 origin 通过，localhost / 非白名单 origin 拒绝，协议 URL 不含 ticket；支持 `launch`、兼容旧 `open` 并支持安全 `ping`。
- 协议注册测试：HKCU 根键、`URL Protocol`、`DefaultIcon`、带双引号 command 和移动路径修复通过。
- 单实例测试：当前用户锁、版本化 Named Pipe、消息长度上限、外部 scheme 拒绝和无主实例超时通过。
- connect 客户端测试：稳定 helperInstanceId 随配对和连接请求发送，受限 Bearer ticket 绑定正确 taskId，返回 connected 概要。
- 配对状态机测试：首次配对、同助手幂等、双击、协议与手动并发、提交前失败重试、其他助手拒绝和任务过期 7/7 通过。
- 文件测试：PDF 文件头及 SHA-256 通过；伪 PDF 拒绝；`.tmp` / `.part` / `.crdownload` 拒绝。

## 安全检查

- loopback 只监听 `127.0.0.1:17651`。
- `/handoff` 只允许正式站点 Origin，并校验 handshakeId、taskId、baseUrl 和 30 秒交接窗口。
- 自定义协议不携带 ticket。
- ticket 仅在助手内存中，不写本地配置。
- pairingCode 明文仅返回给创建任务的登录页面；数据库只保存 HMAC 摘要，成功配对后立即标记使用。
- pairingCode、helperInstanceId、connected 和使用时间在同一 PostgreSQL transaction 内提交；事务失败不会永久消费任务码。
- 同一 helperInstanceId 重复连接幂等成功，只有其他助手实例才返回 409；错误尝试按客户端来源限流，operation log 不记录明文码。
- 本地配置仅保存下载目录。
- API 日志不记录 ticket、Cookie、签名 URL、密码或 S3 Key。

## 普通用户协议实测

- 当前测试进程为普通非提升令牌，`Administrators` 仅为 deny-only；启动新助手未出现 UAC。
- 普通启动后协议写入 `HKEY_CURRENT_USER\Software\Classes\hongmeng-workorder-import`，command 和 DefaultIcon 均指向当前 EXE。
- `hongmeng-workorder-import://ping` 可激活已有窗口，界面显示“浏览器协议测试成功”。
- ping 后新版助手长期进程数保持 1，二次进程通过当前用户 Named Pipe 转发后退出。
- 将完整发布目录移动到临时路径后，协议 command 自动更新；移回原目录后再次自动恢复。
- 便携包改为自包含多文件目录，普通启动不依赖单文件 bundle 解压缓存；用户必须完整解压并保留目录内运行时文件。
- 测试机仍有两个此前管理员运行产生的旧版后台进程，普通权限遵循要求未尝试提升或强制结束；新版使用版本化激活 Pipe，避免旧 Pipe 截获新版 URI。

Chrome 自动外部协议验证在桌面控制无法可靠确认当前 URL 时被安全停止，未绕过保护。Edge 未继续自动操作。两项需要在新 Artifact 下载后按人工清单确认浏览器弹窗和允许按钮。

## 手动任务码集成验证

使用本地 Compose 的现有工单与分类创建临时任务，不上传文件、不写 S3，并在结束后删除测试任务日志：

- 第一次配对：HTTP 200，任务在同一事务内进入 `connected`。
- 同一助手重复配对：HTTP 200，`alreadyConnected=true`。
- 双击并发配对：两次均为 HTTP 200，只有一次执行首次绑定。
- 协议 handoff 与手动任务码并发：两次均为 HTTP 200，并返回同一任务。
- 其他助手使用同一码：HTTP 409，错误码为 `PAIRING_CODE_USED_BY_OTHER_HELPER`。
- 人工把第二个临时任务过期后配对：HTTP 410。
- 成功连接后网页任务详情返回 `pairingAvailable=false`，不再展示旧任务码。
- 测试记录清理完成，未创建 `ResourceFile`、未上传对象、未改工单或分类。

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

1. Chrome / Edge 从网页唤起助手，确认浏览器外部应用弹窗后网页状态进入“助手已连接”。
2. 普通用户首次启动不出现 UAC，协议状态为“已注册”。
3. 点击“测试浏览器协议”显示成功，且任务列表不变化。
4. 协议被阻止时输入网页手动任务码；确认连接中按钮禁用，成功后输入框清空，同一助手重试仍返回当前任务。
5. 单个和多个 PDF / 图片拖拽。
6. Windows 文件剪贴板 `Ctrl+V`。
7. 文本或链接拖入时不自动抓取。
8. 下载目录新增文件在稳定 3 秒后进入队列。
9. 临时和仍被写入的文件不上传。
10. 相同 SHA 文件默认跳过。
11. 同名不同内容显示新版本。
12. 冲突项未经确认不能上传。
13. 上传完成后网页局部刷新并选中最新文件。
14. `ResourceFile` 与 `DrawingLibraryFile` 关联正确，S3 仅有一份对象。
15. 任务过期后监控和上传停止。
16. Windows 10 / 11 便携式 artifact 运行正常。

## 已知边界

- 不访问企业微信私有数据；用户仍需拖出、复制或点击下载。
- 当前不签发正式代码签名证书，Windows 可能显示未知发布者。
- 未完成队列不跨助手进程持久化，关闭助手后需要重新创建任务。
- Chrome / Edge 外部应用确认和真实企业微信客户端需使用 Actions 新 Artifact 人工验证。
- 生产对象存储链路需在部署包含本版本的 Web 镜像后做非破坏性小文件验收。
