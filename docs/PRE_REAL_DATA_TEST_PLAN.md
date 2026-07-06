# 平板真机测试前最终预检计划

版本：v1.13.4-tablet-final-pretest

状态：本地开发与上线前预检方案。当前不代表生产上线版本。

## 目标

本计划用于平板 APK / PWA 真机测试前的最后准备，重点验证：

- 平板入口不再依赖浏览器地址栏和标签栏。
- APK / PWA 打开后不会因旧缓存看到过期资料。
- Web 浏览器上传资料后，平板端可通过“同步”按钮刷新当前工单资料。
- 清理旧测试工单数据时，不影响连接器参数资料。
- seed 默认不再自动生成样例工单，避免真实数据测试前被样例数据污染。

## 不变范围

- 不修改数据库结构。
- 不修改 Prisma schema。
- 不改变 PostgreSQL 与 S3 对象存储持久化逻辑。
- 不恢复 DevEco / Harmony ArkTS 路线。
- 不恢复 `/api/native/*`。
- 不写入任何数据库密码、S3 Key、SESSION_SECRET、admin 密码或真实生产密码。

## 平板同步测试

1. 使用 Web 浏览器打开线上系统并登录。
2. 在某个工单和分类下上传 PDF 或图片。
3. 打开平板 APK 或 PWA，进入同一个工单。
4. 点击顶部“同步”按钮，或右侧资料工具窗中的“同步当前工单资料”。
5. 确认：
   - 当前分类文件列表刷新。
   - 资料数量刷新。
   - 右侧资料工具窗状态刷新。
   - 新上传文件可预览、下载。
   - 页面没有反复自动刷新。

## PWA / APK 缓存预检

1. 访问 `/manifest.webmanifest`，确认可返回 JSON。
2. 重新打开 PWA 或 APK。
3. 确认页面进入 `/dashboard`。
4. 上传或同步后刷新页面，确认不是旧文件列表。
5. 确认 Service Worker 只缓存图标和 manifest，不缓存：
   - `/api/*`
   - `/dashboard`
   - 上传响应
   - 下载链接
   - 签名链接
   - 文件内容流

## 旧工单数据清理策略

默认只 dry-run，不删除数据：

```bash
npm run data:clear-workorders:dry
```

真正执行前必须同时满足：

- 只在明确的本地或指定维护窗口执行。
- 已备份 PostgreSQL。
- 已确认 Object Storage Bucket 备份策略。
- 环境变量显式设置 `CONFIRM_CLEAR_WORKORDER_DATA=YES`。
- 如需删除 S3 对象，额外设置 `DELETE_S3_OBJECTS=true`。

执行示例：

```bash
CONFIRM_CLEAR_WORKORDER_DATA=YES npm run data:clear-workorders
```

如需同步删除对应 S3 对象：

```bash
CONFIRM_CLEAR_WORKORDER_DATA=YES DELETE_S3_OBJECTS=true npm run data:clear-workorders
```

脚本只清理：

- `WorkOrder`
- `ResourceFile`
- 工单 / 文件相关 `OperationLog`
- 工单 / 文件相关 `DataChangeSnapshot`
- 可选逐个删除 `ResourceFile.objectKey` 对应 S3 对象

脚本不会清理：

- `User`
- `ResourceCategory`
- `ConnectorParameter`
- `ConnectorParameterFile`
- `ConnectorParameterImportBatch`
- 连接器参数相关日志和批次数据

## Seed 策略

默认配置：

```text
SEED_SAMPLE_WORK_ORDERS=false
SEED_RESET_ADMIN_PASSWORD=false
```

含义：

- 默认创建或保留 admin 账号。
- 默认不重置已修改过的 admin 密码。
- 默认不自动生成样例工单。
- 如需本地演示样例工单，需显式设置 `SEED_SAMPLE_WORK_ORDERS=true`。

## 真机验收清单

- 登录正常。
- 修改密码正常。
- 工单列表正常。
- 当前工单资料状态正常。
- 浏览器端上传 PDF 后，APK / PWA 点击同步可看到新文件。
- 浏览器端上传图片后，APK / PWA 点击同步可看到新文件。
- APK 拍照上传正常。
- PDF 预览正常。
- 图片预览正常。
- 文件下载正常。
- 下载全部 ZIP 正常。
- 连接器参数查询正常。
- 连接器原始资料附件不受工单清理脚本影响。
- `/api/health` 正常。
- `/manifest.webmanifest` 正常。

## 建议上线前命令

```bash
npx prisma generate
npm run data:clear-workorders:dry
npm run build
npm run smoke
docker build -t hongmeng-workorder:pretest-final .
```

## 已知风险

- APK WebView 仍依赖设备是否允许安装 Android APK。
- HarmonyOS NEXT 设备可能不支持 APK，需要改用 PWA 或重新评估 HAP 路线。
- 清理脚本执行真实删除前必须先备份并确认环境变量，禁止在未确认环境中执行。

## 建议

建议进入平板真实数据测试，但生产清理必须单独确认维护窗口和备份状态。
