# QA_HARMONY_NATIVE_FULL_PARITY_v2.0.0-rc.5

## 基本信息
- 版本：v2.0.0-native-rc.5
- 目标：鸿蒙平板原生 App 功能完整对齐 Web 端核心生产流程
- 工程目录：`harmony-tablet`
- 技术栈：ArkTS / ArkUI / Stage 模型
- 后端地址：`https://qdowqencjyph.sealoshzh.site`
- 是否使用 WebView：否

## 本次对齐范围
- 登录、退出登录、token 保存、401 回登录页。
- 工作台顶部导航、工单抽屉、当前工单信息条、资料分类栏、主预览区、右侧资料工具窗。
- 工单列表、搜索、默认选中第一条、新建、编辑、软删除、恢复接口、当前工单全部资料 ZIP 下载。
- 资源文件上传入口、图片预览、PDF 文件卡片、下载/打开入口、软删除、恢复接口、显示名/备注编辑和分类移动。
- 连接器参数查询、筛选、新增、编辑、删除、恢复、批量标重点、批量取消重点、批量删除。
- 连接器参数 CSV 粘贴导入预览、确认导入、重复行策略、导入批次列表和导入批次回滚。
- 连接器参数 CSV 导出、模板下载、原始资料附件列表、附件下载和附件删除入口。
- 设置页：生产健康、账号管理、修改密码、操作日志、回收站、数据快照和诊断信息。

## Native API 检查
- `/api/native/auth/login`
- `/api/native/auth/me`
- `/api/native/auth/logout`
- `/api/native/auth/change-password`
- `/api/native/work-orders`
- `/api/native/work-orders/[id]`
- `/api/native/work-orders/[id]/resources`
- `/api/native/work-orders/[id]/restore`
- `/api/native/work-orders/[id]/download-all`
- `/api/native/resource-files/upload`
- `/api/native/resource-files/[id]`
- `/api/native/resource-files/[id]/content`
- `/api/native/resource-files/[id]/download`
- `/api/native/resource-files/[id]/restore`
- `/api/native/connector-parameters`
- `/api/native/connector-parameters/[id]`
- `/api/native/connector-parameters/[id]/restore`
- `/api/native/connector-parameters/batch`
- `/api/native/connector-parameters/import/preview`
- `/api/native/connector-parameters/import/commit`
- `/api/native/connector-parameters/export.csv`
- `/api/native/connector-parameters/template.csv`
- `/api/native/connector-parameter-files`
- `/api/native/connector-parameter-files/upload`
- `/api/native/connector-parameter-files/[id]`
- `/api/native/connector-parameter-files/[id]/download`
- `/api/native/connector-parameter-import-batches`
- `/api/native/connector-parameter-import-batches/[id]/rollback`
- `/api/native/users`
- `/api/native/users/[id]`
- `/api/native/users/[id]/reset-password`
- `/api/native/operation-logs`
- `/api/native/trash`
- `/api/native/change-snapshots`
- `/api/native/system/status`
- `/api/native/system/diagnostics.json`

## 验证结果
- `npm run build`：通过。
- `npm run smoke`：通过。
- smoke 覆盖：
  - `/api/health`
  - `/manifest.webmanifest`
  - `/login`
  - `/api/native/system/status`
  - `/api/native/auth/login` 返回 JSON 格式检查
- Harmony 命令行构建：未执行。
- 未执行原因：本机 PATH 未发现 `ohpm`、`hvigor`、`hvigorw`，且 `harmony-tablet` 内没有 `hvigorw.bat`。

## ArkTS Strict 静态检查
- 未新增 `any`。
- 未新增 `unknown`。
- 未使用 `delete`。
- 未使用 `TextEncoder`。
- 未使用 WebView。
- 未发现 TODO、mock、待适配或待补齐用户可见文案。
- 普通对象动态索引未新增；数组下标访问保留。

## 受限能力说明
- 原生文件选择、相机拍照和系统级保存/打开能力继续通过 platform adapter 承接。
- 如果设备不支持对应原生能力，App 会提示使用上传图片或 Web 端上传，不会写入本地永久文件。
- ZIP、单文件下载和附件下载后端均由 S3 对象流返回，不长期保存在容器本地。

## 敏感信息检查
- 文档未写入数据库密码。
- 文档未写入 `DATABASE_URL`。
- 文档未写入 S3 Key 或 Secret。
- 文档未写入 `SESSION_SECRET`。
- 文档未写入 admin 密码或任何真实密码。

## 下一步建议
1. 在 DevEco Studio 中打开 `C:\Dev\hongmeng\harmony-tablet`。
2. 执行 Sync。
3. 执行 Clean Project。
4. 执行 Build / Make Project。
5. 安装到鸿蒙平板实机。
6. 验证登录、工作台、工单管理、资料管理、连接器参数、设置页和退出登录。
