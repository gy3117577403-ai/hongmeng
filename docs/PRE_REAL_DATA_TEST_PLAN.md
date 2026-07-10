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
- 后续真实工单可使用周计划 Excel 批量导入，并先预览再确认。
- 周计划导入后只会关联已有长期图纸资料库记录，不再自动创建空图纸资料；图纸资料库不显示周计划状态字段。

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
- 周计划 `.xls` / `.xlsx` / `.csv` 导入预览正常。
- 周计划确认导入正常。
- SO 单号错位行能正确解析业务员和客户。
- 合计行、空行能正确跳过。
- 当前工单资料状态正常。
- 浏览器端上传 PDF 后，APK / PWA 点击同步可看到新文件。
- 浏览器端上传图片后，APK / PWA 点击同步可看到新文件。
- APK 拍照上传正常。
- PDF 预览正常。
- 图片预览正常。
- 文件下载正常。
- 下载全部 ZIP 正常。
- 连接器参数查询正常。
- 图纸资料库首页正常打开，只显示客户、规格、品名、资料完整度和最近更新。
- 图纸资料库不显示图纸已发、配料、未交量、交期、工时、业务员或订单日期。
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

## 周计划真实工单导入建议

1. 先执行 `npm run data:clear-workorders:dry` 查看旧工单数据规模。
2. 如需清空旧测试工单，必须先备份并显式确认执行清理脚本。
3. 清理脚本不会删除连接器参数、连接器附件或连接器导入批次。
4. 在系统设置中选择“周计划 Excel 导入”。
5. 上传周计划文件，检查预览里的可导入、跳过、异常和重复行。
6. 确认 SO 单号错位行的客户和业务员无误。
7. 点击“确认导入”后，再在工单抽屉中搜索客户、品名、规格或 SO 单号验收。
8. 打开“图纸资料库”，确认周计划导入不会生成大量空图纸资料记录。
9. 如果同客户同规格已有长期图纸资料，确认生产工单可关联；如果没有，则保持生产工单规格信息，不污染图纸资料库首页。

## v1.14.6 周计划工单中心预检

1. 导入周计划后，确认工单卡片主标题显示 Excel “规格”，例如 `D010304-8233-V02`。
2. 确认工单抽屉默认显示当前周，且可切换下周草稿、历史周。
3. 确认快速筛选只有全部、今日交期、缺资料、异常，状态通过下拉筛选。
4. 确认工单卡片不再显示进度条和百分比。
5. 点击“导入下周”，确认系统设置默认选择“保存为下周草稿”。
6. 保存草稿后切换到“下周草稿”，确认草稿不进入当前周生产列表。
7. 点击“结束本周”，预览归档范围，确认不会删除文件、图纸资料库和连接器参数。
8. 不输入 `CLOSE_WEEK` 时确认不能归档。
9. 输入 `CLOSE_WEEK` 后归档当前周，确认默认列表不再显示已归档周计划工单。
10. 点击“启用下周”，输入 `START_NEXT_WEEK` 后确认下周草稿进入当前周。
11. 归档 / 启用后确认已上传 PDF / 图片仍保留，连接器参数页面不受影响。
12. 该归档不同于 `scripts/clear-workorder-data.mjs`，不做物理删除，不删除 S3 对象。

## 已知风险

- APK WebView 仍依赖设备是否允许安装 Android APK。
- HarmonyOS NEXT 设备可能不支持 APK，需要改用 PWA 或重新评估 HAP 路线。
- 清理脚本执行真实删除前必须先备份并确认环境变量，禁止在未确认环境中执行。

## v1.14.7 周计划差异中心预检

1. 导入下周 Excel，确认只保存为下周草稿，不直接覆盖当前周。
2. 确认导入完成后进入 `/weekly-plan-center`。
3. 使用本地测试数据确认新增、延续、变更、下周取消统计准确。
4. 确认变更行显示字段前后值，不使用百分比进度条。
5. 确认稳定键重复、规格缺失、客户缺失会进入阻断异常。
6. 确认未关联图纸资料、资料 0/5、图纸 / 配料 / 未交量为空只显示警告。
7. 阻断异常存在时，确认 `activate-next/commit` 返回 `409`。
8. 警告存在但没有阻断时，输入 `START_NEXT_WEEK` 可以继续。
9. 确认周切换后当前周进入历史、下周草稿成为当前周。
10. 确认历史周按周只读查看，不混入当前生产列表。
11. 下载差异 CSV，确认中文表头、前后值和异常信息正常。
12. 周切换前后确认 PDF、图片、图纸资料库文件、S3 对象和连接器参数均未删除。

## 建议

建议进入平板真实数据测试，但生产清理必须单独确认维护窗口和备份状态。
