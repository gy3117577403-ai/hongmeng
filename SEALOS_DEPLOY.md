# Sealos 部署

1. 创建 PostgreSQL：库名 `workorder_resource`。
2. 创建对象存储 Bucket：`workorder-resources`，private。
3. App Deploy 使用镜像：`ghcr.io/gy3117577403-ai/hongmeng:v1.25.0`（固定版本，避免 `latest` 缓存到旧镜像；生产验收通过后再切换）。
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
# 可选：企业微信群消息推送（原群机器人）的完整 Webhook。
# 必须以 Sealos 密钥环境变量保存，不要写进源码、普通配置表或截图。
WECOM_ROBOT_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=替换为真实密钥"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD=""
SEED_RESET_ADMIN_PASSWORD="false"
```
6. 健康检查：`/api/health`。

### 管理员初始化与重置

- 全新数据库首次启动前，必须在 Sealos 密钥环境变量中为 `SEED_ADMIN_PASSWORD` 填写一次性强密码：至少 8 位，不得使用常见密码、全部重复字符，也不得包含完整管理员账号名。种子脚本不会再提供默认密码。
- 已有管理员且 `SEED_RESET_ADMIN_PASSWORD=false` 时，可以删除或留空 `SEED_ADMIN_PASSWORD`；重启不会读取、校验或改写现有密码，也不会重新启用已停用或暂停的管理员。
- 只有明确需要恢复管理员时，才同时填写新的强密码并临时设置 `SEED_RESET_ADMIN_PASSWORD=true`。该操作会启用账号、使旧会话失效并标记为下次登录需要改密。
- 重置成功后立即把 `SEED_RESET_ADMIN_PASSWORD` 改回 `false`，并从 Sealos 环境变量中清除 `SEED_ADMIN_PASSWORD`。
- 常规启动只会维护“已经是管理员”的引导账号及其 `ADMIN_GLOBAL` 主授权；授权是否启用跟随当前账号状态，因此不会借此绕过停用状态。若 `SEED_ADMIN_USERNAME` 已被普通账号占用，启动会拒绝静默提权；确需提升时必须提供强密码并显式执行一次重置，旧会话也会同步失效。

## 企业微信试发

1. 在需要接收通知的企业微信群中添加“消息推送（原群机器人）”，复制完整 Webhook。
2. 把 Webhook 作为 Sealos 密钥环境变量 `WECOM_ROBOT_WEBHOOK_URL` 保存，并重启应用。
3. 管理员登录系统，打开“系统设置 → 企业微信”。
4. 按员工编号或姓名选择少量已录手机号的在职员工，勾选确认后发送测试消息。
5. 企业微信返回成功表示消息已进入机器人所在群；只有员工在该群内，且人事档案手机号与企业微信通讯录手机号一致时，才能正确提醒该员工。

> Webhook 等同于该群的发送密钥。不要粘贴到聊天、工单、截图、源码或数据库普通配置字段中；如疑似泄露，请立即在企业微信中删除并重建机器人。
