# QA_HARMONY_NATIVE_ARKTS_COMPILE_FIX

## 当前 DevEco 错误摘要

DevEco 已通过 `module.json5`、权限和资源编译阶段，失败位置进入 `:entry:default@CompileArkTS`。

本轮针对 ArkTS 严格模式错误做兼容修复，范围仅限 `harmony-tablet` 原生工程，不修改 Web 后端、Next.js、Prisma schema 或 Sealos 配置。

## 修复类型

- object literal typing：为 `Routes`、`Colors`、HTTP 请求、service query / request / response 增加显式 interface。
- no any：静态搜索未发现显式 `any`。
- no unknown：移除页面中显式 `unknown` 参数。
- no delete operator：移除 `delete obj[key]`，`PreferencesAdapter` 改用 `Map<string, string>`。
- no TextEncoder：移除 multipart 文本拼接和 `TextEncoder`，原生上传暂保留安全占位，等待 DevEco 真机 adapter 接入。
- CommonButton prop conflict：`enabled` 改名为 `isEnabled`，并同步调用位置。
- minHeight：`ConnectorParameterTable` 中 `.minHeight()` 改为 `.height()`。
- return type：页面、组件、store 的普通方法补充显式返回类型。
- no spread：`WorkbenchPage` 和 `ResourceStore` 中数组 / 对象 spread 改为 `slice()` 或显式循环赋值。

## WebView 检查

- 未使用 WebView。
- 未新增 `webview` 或 `@ohos.web` 引用。
- 页面仍为 ArkUI 原生组件结构。

## Web build / smoke

- `npm run build`：通过。
- `npm run smoke`：通过。
- 仅存在历史 `<img>` ESLint warning，不阻塞构建。

## Harmony Build 情况

当前命令行环境未发现：

- `ohpm`
- `hvigor`
- `hvigorw`
- `harmony-tablet/hvigorw.bat`

因此本轮未在命令行执行 HAP 构建，不假装 DevEco Build 成功。需要用户在 DevEco Studio 中重新 Sync + Build 验证。

## 已知 warning

以下 warning 当前不作为阻塞项：

- `replaceUrl` deprecated
- `pushUrl` deprecated
- `showToast` deprecated
- `getContext` deprecated
- `PATCH` SDK warning
- Function may throw exceptions

## 下一步

在 DevEco Studio 中重新 Build。如仍有 ArkTS 严格模式错误，继续按编译日志逐条修复，优先保持原生工程结构和现有业务页面不被删除。
