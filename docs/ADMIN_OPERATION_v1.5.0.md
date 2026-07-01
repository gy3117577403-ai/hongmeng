# 运维手册 v1.5.0

## Sealos 应用组成
生产环境由以下部分组成：
- Next.js 应用容器：提供登录、工单管理、文件管理、导入导出和 API。
- Sealos PostgreSQL：保存用户、工单、资源分类、文件元数据和操作日志。
- Sealos Object Storage：保存 PDF、JPG、PNG 等实际文件。
- GHCR 镜像仓库：保存应用容器镜像。

## PostgreSQL 作用
PostgreSQL 保存业务元数据，包括：
- 用户账号和密码哈希
- 工单信息
- 资源分类
- 文件元数据
- 操作日志
- Prisma migration 状态

不要直接删除生产数据库。所有结构变更必须通过 Prisma migration。

## Object Storage 作用
Object Storage 保存实际上传文件。数据库只保存文件元数据和对象 key。文件软删除不会物理删除对象存储中的文件。

不要删除生产 Bucket。删除 Bucket 会导致历史文件无法预览或下载。

## 环境变量说明
只列变量名和用途，不记录真实值。

- `DATABASE_URL`：PostgreSQL 连接地址。
- `SESSION_SECRET`：登录 session 签名密钥。
- `S3_ENDPOINT`：服务端访问对象存储的 endpoint。
- `S3_PUBLIC_ENDPOINT`：浏览器访问对象存储签名链接时使用的 endpoint。
- `S3_REGION`：对象存储区域。
- `S3_BUCKET`：对象存储 Bucket 名称。
- `S3_ACCESS_KEY_ID`：对象存储访问 Key ID。
- `S3_SECRET_ACCESS_KEY`：对象存储访问 Secret。
- `S3_FORCE_PATH_STYLE`：是否使用 path-style S3 访问。
- `APP_BASE_URL`：应用对外访问地址。
- `MAX_UPLOAD_SIZE_MB`：允许上传的最大文件大小。
- `SEED_ADMIN_USERNAME`：初始化管理员账号名。
- `SEED_ADMIN_PASSWORD`：仅用于首次初始化或显式重置。
- `SEED_RESET_ADMIN_PASSWORD`：是否在启动时重置管理员密码，生产应保持 `false`。

## 如何重新部署
1. 确认目标镜像来自正式发布或已验收的 digest。
2. 在 Sealos 应用中更新镜像地址。
3. 保持现有环境变量不变，除非本次发布明确要求修改。
4. 重新部署应用。
5. 部署后执行 15 分钟 smoke test。

## 如何查看日志
在 Sealos 应用详情中查看容器日志，重点关注：
- Prisma migration 是否成功
- seed 是否完成
- Next.js 是否 Ready
- 是否存在数据库连接错误
- 是否存在对象存储错误
- 是否存在上传或下载异常

## 如何确认 /api/health
访问：

```text
https://qdowqencjyph.sealoshzh.site/api/health
```

返回中应包含 `ok:true`。如果 health 失败，先查看应用日志和数据库连接状态。

## 如何处理上传失败
1. 确认文件格式是 PDF、JPG 或 PNG。
2. 确认文件大小未超过 `MAX_UPLOAD_SIZE_MB`。
3. 检查 `S3_BUCKET` 是否存在。
4. 检查对象存储 endpoint 是否可访问。
5. 检查 `S3_ACCESS_KEY_ID` 和 `S3_SECRET_ACCESS_KEY` 是否有效。
6. 查看应用日志中的上传错误。

## 如何处理数据库连接失败
1. 检查 PostgreSQL 实例是否运行。
2. 检查 `DATABASE_URL` 是否指向正确实例。
3. 检查网络连通性。
4. 查看 Prisma migration 日志。
5. 若刚启动时数据库尚未就绪，entrypoint 会等待数据库端口并重试 migration。

## 如何处理对象存储错误
1. 检查 Bucket 是否存在。
2. 检查 endpoint 和 public endpoint 是否配置正确。
3. 检查访问凭证是否有效。
4. 检查 Bucket 权限和签名链接访问。
5. 用系统设置中的对象存储状态辅助判断。

## 如何处理镜像拉取失败
1. 确认镜像地址拼写正确。
2. 优先使用完整 digest 镜像地址。
3. 确认 GHCR package 可被 Sealos 拉取。
4. 如果 package 非公开，需在 Sealos 配置镜像拉取凭证。
5. 不要把 GitHub Token 写入代码仓库或文档。

## 如何修改 APP_BASE_URL
1. 在 Sealos 环境变量中修改 `APP_BASE_URL`。
2. 值应为当前公网访问地址。
3. 保存后重新部署应用。
4. 验证登录、预览、下载和系统设置状态。

## 如何保持 SEED_RESET_ADMIN_PASSWORD=false
生产环境应保持：

```text
SEED_RESET_ADMIN_PASSWORD=false
```

该设置可避免容器重启或重新部署时重置已修改过的管理员密码。只有在明确需要恢复管理员密码时，才可临时调整，并在完成后立刻改回 `false`。

## 如何做备份
### PostgreSQL
- 使用 Sealos PostgreSQL 提供的备份能力。
- 保留每日备份。
- 重要上线前手动创建快照。

### Object Storage
- 保留生产 Bucket。
- 对重要资料做跨 Bucket 或离线归档。
- 不要用清理脚本删除未知对象。

## 如何恢复
1. 确认需要恢复的时间点。
2. 恢复 PostgreSQL 到目标备份。
3. 确认 Object Storage Bucket 中对应文件仍存在。
4. 重新部署应用。
5. 验证 `/api/health`、登录、工单列表、上传、预览和下载。

恢复演练应在非生产环境进行，确认流程可靠后再用于生产故障处理。
