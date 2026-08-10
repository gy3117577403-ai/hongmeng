# Sealos 部署

1. 创建 PostgreSQL：库名 `workorder_resource`。
2. 创建对象存储 Bucket：`workorder-resources`，private。
3. App Deploy 候选镜像：`ghcr.io/gy3117577403-ai/hongmeng:v1.29.0`。当前生产仍为 `v1.27.0`；候选镜像完成隔离验收后，生产应固定到其不可变 digest，不使用 `latest` 切换。
4. 端口：`3000`。
5. 环境变量：
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/workorder_resource?schema=public"
SESSION_SECRET="至少32位随机字符串"
FIELD_REPORT_PIN_PEPPER="另一个至少32位随机字符串，不得与SESSION_SECRET相同"
S3_ENDPOINT="https://你的对象存储endpoint"
S3_PUBLIC_ENDPOINT="https://浏览器可访问的对象存储endpoint"
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

`FIELD_REPORT_PIN_PEPPER` 只用于共享终端员工 PIN。生产首次启用前必须作为独立密钥保存；不要写入源码、截图或普通配置。更换该值会使全部既有 PIN 无法验证，轮换时应先进入维护窗口，再由管理员统一重置 PIN。

### 管理员初始化与重置

- 全新数据库首次启动前，必须在 Sealos 密钥环境变量中为 `SEED_ADMIN_PASSWORD` 填写一次性强密码：至少 8 位，不得使用常见密码、全部重复字符，也不得包含完整管理员账号名。种子脚本不会再提供默认密码。
- 已有管理员且 `SEED_RESET_ADMIN_PASSWORD=false` 时，可以删除或留空 `SEED_ADMIN_PASSWORD`；重启不会读取、校验或改写现有密码，也不会重新启用已停用或暂停的管理员。
- 只有明确需要恢复管理员时，才同时填写新的强密码并临时设置 `SEED_RESET_ADMIN_PASSWORD=true`。该操作会启用账号、使旧会话失效并标记为下次登录需要改密。
- 重置成功后立即把 `SEED_RESET_ADMIN_PASSWORD` 改回 `false`，并从 Sealos 环境变量中清除 `SEED_ADMIN_PASSWORD`。
- 常规启动只会维护“已经是管理员”的引导账号及其 `ADMIN_GLOBAL` 主授权；授权是否启用跟随当前账号状态，因此不会借此绕过停用状态。若 `SEED_ADMIN_USERNAME` 已被普通账号占用，启动会拒绝静默提权；确需提升时必须提供强密码并显式执行一次重置，旧会话也会同步失效。

### 共享终端 PIN 启用

1. 先为生产员工建立“扫码报工”账号并绑定员工档案；员工不需要用普通密码进入后台工作台。
2. 管理员在“系统设置 → 账号与部门权限”中为该员工设置 6 位报工 PIN。系统只保存带独立 pepper 的散列，保存后不能查看原 PIN。
3. 在准备作为共享终端的平板浏览器上，由管理员登录一次并选择“绑定本机为共享终端”。绑定成功会立即退出管理员普通账号。
4. 继续使用现有工单二维码，无需重新打印。已绑定终端扫码后输入员工编号和 PIN，身份会话仅绑定当前二维码、最长 5 分钟，并在报工提交后立即失效。
5. 员工离职、PIN 重置、账号停用或终端停用都会使相关终端身份失效；复职不会自动恢复旧 PIN。

不要在共用浏览器中保存管理员密码，也不要把共享终端当作普通后台工作台使用。终端丢失或调离现场后，应立即在账号设置中停用对应终端。

### v1.29.0 回滚边界

- 正式切换前先备份 PostgreSQL，并暂缓创建真实部门、财务和总经办账号，直至候选镜像验收完成。
- v1.29.0 启用新账号或共享终端 PIN 后，不得只把镜像改回 v1.27.0：旧版本不识别新的账号状态、会话版本、部门授权与 PIN 身份链，可能把新增非管理员账号带回旧的宽权限模式。
- 如必须回退，先进入维护窗口，停用或隔离所有 v1.29.0 新增的非管理员账号与共享终端，再切换旧 digest；数据库迁移不回退。优先采用保留新认证底座的前向修复镜像。

## 企业微信试发

1. 在需要接收通知的企业微信群中添加“消息推送（原群机器人）”，复制完整 Webhook。
2. 把 Webhook 作为 Sealos 密钥环境变量 `WECOM_ROBOT_WEBHOOK_URL` 保存，并重启应用。
3. 管理员登录系统，打开“系统设置 → 企业微信”。
4. 按员工编号或姓名选择少量已录手机号的在职员工，勾选确认后发送测试消息。
5. 企业微信返回成功表示消息已进入机器人所在群；只有员工在该群内，且人事档案手机号与企业微信通讯录手机号一致时，才能正确提醒该员工。

> Webhook 等同于该群的发送密钥。不要粘贴到聊天、工单、截图、源码或数据库普通配置字段中；如疑似泄露，请立即在企业微信中删除并重建机器人。
