# QA Harmony Native v2.0.0-rc.1

## 版本
- 版本：v2.0.0-native-rc.1
- commit：75156affac126dc622a28aed61df445b11173da1
- 验证目录：`C:\Dev\hongmeng\harmony-tablet`
- 验证范围：DevEco Studio 可打开的 ArkTS / ArkUI 原生鸿蒙平板工程结构检查

## 工程结构检查结果
- `harmony-tablet/AppScope/app.json5`：存在
- `harmony-tablet/entry/src/main/module.json5`：存在
- `harmony-tablet/entry/src/main/ets/entryability/EntryAbility.ets`：存在
- `harmony-tablet/entry/src/main/ets/pages/LoginPage.ets`：存在
- `harmony-tablet/entry/src/main/ets/pages/WorkbenchPage.ets`：存在
- `harmony-tablet/entry/src/main/ets/pages/ConnectorParametersPage.ets`：存在
- `harmony-tablet/entry/src/main/ets/pages/SettingsPage.ets`：存在
- `harmony-tablet/oh-package.json5`：存在
- `harmony-tablet/build-profile.json5`：存在
- `harmony-tablet/hvigorfile.ts`：存在

## ArkTS / ArkUI 检查结果
- ArkTS 页面、组件、services、stores、models、constants、utils 已按工程目录拆分。
- UI 使用 ArkUI 原生组件实现。
- `entry/build-profile.json5` 配置为 Stage 模型。
- `entry/src/main/module.json5` 包含 `entry` 模块和 `EntryAbility`。
- `deviceTypes` 已配置为 `tablet`。

## WebView 检查
- 是否使用 WebView：否。
- 未发现 WebView 组件或 webview 模块导入。
- 主界面未套用现有网页。

## API_BASE_URL 检查
- `harmony-tablet/entry/src/main/ets/constants/api.ets` 存在。
- `API_BASE_URL` 为 `https://qdowqencjyph.sealoshzh.site`。
- 该值为公开服务地址。

## 敏感信息检查
- 未发现数据库连接、对象存储凭据、会话签名密钥或真实密码写入 Harmony 工程、native 文档或 README。
- native 登录接口服务端只读取登录校验所需字段，不向客户端返回密码哈希，不写入操作日志。

## DevEco 命令行构建结果
- `where ohpm`：未找到。
- `where hvigor`：未找到。
- `where hvigorw`：未找到。
- `harmony-tablet/hvigorw.bat`：不存在。
- 命令行 HAP 构建：未执行。
- 原因：本机缺少 DevEco CLI / ohpm / hvigor，需要在 DevEco Studio 内打开 `C:\Dev\hongmeng\harmony-tablet` 后同步并构建。

## Web 回归
- `npm run build`：通过。
- `npm run smoke`：通过。
- smoke 检查项：
  - `/api/health`
  - `/manifest.webmanifest`
  - `/login`

## 已知问题
- 本机未安装 DevEco 命令行构建工具，暂不能在命令行验证 HAP 编译。
- 上传 PDF、上传图片、拍照上传在原生工程中为入口占位，后续需在 DevEco 真机环境接入文件选择和相机能力。
- PDF 第一版为文件卡片和打开入口，尚未实现原生 PDF 完整渲染。

## 下一步建议
- 在 DevEco Studio 中打开 `C:\Dev\hongmeng\harmony-tablet`。
- 按本机 SDK 提示同步 ohpm / hvigor。
- 在 Tablet 模拟器或鸿蒙平板真机运行 `entry`。
- 优先验证登录、工单列表、资料分类、图片预览、PDF 卡片、连接器参数表格。
- 下一轮再接入文件选择、相机拍照上传和原生 PDF 渲染。
