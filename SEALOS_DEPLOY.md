# Sealos 部署

1. 创建 PostgreSQL：库名 `workorder_resource`。
2. 创建对象存储 Bucket：`workorder-resources`，private。
3. App Deploy 使用镜像：`ghcr.io/gy3117577403-ai/hongmeng:latest`。
4. 端口：`3000`。
5. 环境变量：
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/workorder_resource?schema=public"
SESSION_SECRET="至少32位随机字符串"
S3_ENDPOINT="https://你的对象存储endpoint"
S3_REGION="auto"
S3_BUCKET="workorder-resources"
S3_ACCESS_KEY_ID="xxx"
S3_SECRET_ACCESS_KEY="xxx"
S3_FORCE_PATH_STYLE="true"
APP_BASE_URL="https://你的Sealos访问地址"
MAX_UPLOAD_SIZE_MB="50"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="123"
SEED_RESET_ADMIN_PASSWORD="false"
```
6. 健康检查：`/api/health`。
