# v1.5.0-rc.1 上线前总验收报告

## 版本信息
- 版本：v1.5.0-rc.1
- 基于功能 commit：`ba4eb98447b55417d8cbd192e0b39fd9e372e230`
- 验收日期：2026-07-01
- 验收范围：本地开发环境、Docker Compose、本地 PostgreSQL、本地 MinIO
- 部署状态：尚未部署 Sealos，尚未作为生产版本发布

## 构建结果
- `npm run build`：通过
- `docker build -t hongmeng-workorder:v1-5-rc .`：通过
- `docker compose -p hongmeng up --build -d`：通过
- `/api/health`：返回 `ok:true`
- 启动方式：standalone server 启动正常，未出现 `next start` standalone 提示

## 数据库结果
- `npx prisma migrate deploy`：通过，3 个 migration 已应用，无 pending migration
- `npx prisma generate`：通过
- fresh database 初始化：通过
- 应用启动时 migration deploy：通过
- seed 初始化：通过
- upgrade path：通过
- seed 密码策略：`SEED_RESET_ADMIN_PASSWORD=false` 时不会重置已修改过的 admin 密码
- seed 数据策略：基础工单只在缺失时创建，不覆盖已有同工单号业务数据

## 安全与敏感信息检查
- Git 已跟踪文件未包含 `.env`、`.env.local`、`.env.*.local`、`node_modules`、`.next`、上传文件、本地数据库文件或本地 MinIO 数据
- README 未写入数据库连接串、对象存储密钥、会话密钥或真实生产密码
- `/api/system/status` 未返回密钥或数据库连接串
- `/api/export/metadata.json` 未导出 `passwordHash`、对象存储密钥、数据库连接串或会话密钥
- `/api/operation-logs` 返回内容已做 detail 脱敏
- 修改密码日志不记录明文密码

## 功能验收结果
- 登录：通过
- 退出登录：通过
- 修改密码：通过，旧密码失效、新密码可登录，本地测试后已恢复默认调试密码
- 工单新增 / 编辑 / 软删除：通过
- 工单搜索 / 筛选 / 进度显示：通过
- 资料完整性状态：通过
- 资源分类：原图、SOP指导书、成品图、辅料规格、注意事项均通过
- 批量上传 PDF / JPG / PNG：通过
- 上传状态与文件版本自动递增：通过
- 最新 / 历史标签与横向文件列表：通过
- 图片缩略图与 PDF 卡片：通过
- 文件信息编辑：通过
- 单文件预览：通过
- 单文件下载：通过
- 当前工单全部资料 ZIP 下载：通过
- ZIP 内部目录按分类组织：通过
- 文件软删除：通过，数据库保留记录，对象存储文件未物理删除
- 刷新后数据仍在：通过
- 上传管理列表、筛选、预览、下载、编辑、删除：通过
- 操作日志：上传、删除、下载、ZIP 下载、工单新增、工单编辑、工单删除、修改密码、导入、导出均通过
- 系统设置：通过
- 系统健康状态：数据库、对象存储、上传大小、支持格式显示正常
- 导出工单 CSV：通过
- 导出文件清单 CSV：通过
- 导出操作日志 CSV：通过
- 导出 metadata JSON：通过
- CSV 中文可读与 Excel 友好：通过
- 下载 CSV 模板：通过
- 中文表头 CSV 导入：通过
- 英文表头 CSV 导入：通过
- 已存在工单更新：通过
- 非法进度、缺少工单号、缺少产品名称提示：通过
- PWA manifest、图标、service worker 缓存排除规则：通过
- 添加到桌面帮助入口：通过
- 当前工单打印摘要：通过
- `window.print` 触发：通过
- print CSS 隐藏导航和按钮、显示摘要与文件清单：通过
- 响应式：1366x1024、1280x800、1024x768 无严重横向溢出
- 弹窗滚动与主按钮触控高度：通过
- 前端 console：无 error / warning

## 已修复问题
- 清空登录页密码框预填，避免默认密码出现在前端页面。
- 调整 seed 工单初始化逻辑，避免启动时覆盖已有同工单号业务数据。
- 增强 `docker-entrypoint.sh`，在执行 Prisma migration 前等待数据库端口就绪，并保留 migration 重试。

## 已知问题
- 暂无阻塞问题。
- 非阻塞提示：构建时仍有 Next.js 对 `<img>` 标签的性能建议，不影响本次 RC 上线前验收。

## 部署说明
- 当前尚未部署 Sealos。
- 当前未修改 Sealos 环境变量。
- 当前未检查 GHCR digest。
- 等待后续统一部署和线上验收。
