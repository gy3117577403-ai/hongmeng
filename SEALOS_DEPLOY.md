# Sealos 部署

1. 创建 PostgreSQL：库名 `workorder_resource`。
2. 创建对象存储 Bucket：`workorder-resources`，private。
3. App Deploy 热修候选镜像：`ghcr.io/gy3117577403-ai/hongmeng:v1.29.1`。当前生产仍为 `v1.29.0`；候选镜像完成隔离验收后，生产应固定到其不可变 digest，不使用 `latest` 切换。
4. 端口：`3000`。
5. 环境变量：
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/workorder_resource?schema=public"
SESSION_SECRET="至少32位随机字符串"
# 兼容保留：仅旧版共享终端 PIN 数据维护时需要；v1.29.1 正常报工流程不再使用。
FIELD_REPORT_PIN_PEPPER=""
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

`FIELD_REPORT_PIN_PEPPER` 在 v1.29.1 中仅为旧版共享终端 PIN 数据兼容保留，正常扫码报工不再依赖它。不要删除既有 PIN 数据表或回退数据库迁移。

### 管理员初始化与重置

- 全新数据库首次启动前，必须在 Sealos 密钥环境变量中为 `SEED_ADMIN_PASSWORD` 填写一次性强密码：至少 8 位，不得使用常见密码、全部重复字符，也不得包含完整管理员账号名。种子脚本不会再提供默认密码。
- 已有管理员且 `SEED_RESET_ADMIN_PASSWORD=false` 时，可以删除或留空 `SEED_ADMIN_PASSWORD`；重启不会读取、校验或改写现有密码，也不会重新启用已停用或暂停的管理员。
- 只有明确需要恢复管理员时，才同时填写新的强密码并临时设置 `SEED_RESET_ADMIN_PASSWORD=true`。该操作会启用账号、使旧会话失效并标记为下次登录需要改密。
- 重置成功后立即把 `SEED_RESET_ADMIN_PASSWORD` 改回 `false`，并从 Sealos 环境变量中清除 `SEED_ADMIN_PASSWORD`。
- 常规启动只会维护“已经是管理员”的引导账号及其 `ADMIN_GLOBAL` 主授权；授权是否启用跟随当前账号状态，因此不会借此绕过停用状态。若 `SEED_ADMIN_USERNAME` 已被普通账号占用，启动会拒绝静默提权；确需提升时必须提供强密码并显式执行一次重置，旧会话也会同步失效。

### 生产员工扫码报工

1. 为生产员工建立“扫码报工”账号并绑定员工档案，登录账号使用员工编号。
2. 新建或执行“重置报工密码”后，临时密码为 `123456`。该临时密码只允许纯扫码报工账号使用；主管、组长、部门账号和管理员仍执行强密码策略。
3. 继续使用现有工单二维码，无需重新打印。未登录时会先进入账号登录页，成功后返回原工单报工页面。
4. 扫码账号只拥有现场报工权限，不能进入后台工作台、员工档案、账号管理或其他部门模块。
5. 扫码员工升任或兼岗获得后台权限时，系统会立即让临时密码和旧会话失效；管理员必须重新设置强密码后才可进入对应后台。
6. 员工离职、账号停用或撤销最后一项扫码报工授权，都会立即使原登录会话失效。

`123456` 是按当前现场要求保留的过渡密码，不适合长期使用。建议现场流程稳定后，由管理员分批更换生产员工密码，并避免在共用浏览器中保存管理员密码。

### v1.29.1 回滚边界

- 正式切换前先备份 PostgreSQL，并暂缓创建真实部门、财务和总经办账号，直至候选镜像验收完成。
- v1.29.1 沿用 v1.29.0 的账号状态、会话版本、部门授权和数据库结构。不得只把镜像改回 v1.27.0：旧版本不识别这些权限边界，可能把新增非管理员账号带回旧的宽权限模式。
- 如必须回退，优先回到已验收的 v1.29.0 digest；数据库迁移不回退。若必须回到 v1.27.0，先进入维护窗口并停用或隔离所有新增非管理员账号。

## 企业微信试发

1. 在需要接收通知的企业微信群中添加“消息推送（原群机器人）”，复制完整 Webhook。
2. 把 Webhook 作为 Sealos 密钥环境变量 `WECOM_ROBOT_WEBHOOK_URL` 保存，并重启应用。
3. 管理员登录系统，打开“系统设置 → 企业微信”。
4. 按员工编号或姓名选择少量已录手机号的在职员工，勾选确认后发送测试消息。
5. 企业微信返回成功表示消息已进入机器人所在群；只有员工在该群内，且人事档案手机号与企业微信通讯录手机号一致时，才能正确提醒该员工。

> Webhook 等同于该群的发送密钥。不要粘贴到聊天、工单、截图、源码或数据库普通配置字段中；如疑似泄露，请立即在企业微信中删除并重建机器人。
