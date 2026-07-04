# QA Harmony Native DevEco Sync Fix

## 当前问题
- DevEco Studio 打开 `C:\Dev\hongmeng\harmony-tablet` 后同步失败。
- 关键错误：`@ohos/hvigor-ohos-plugin@latest not found`，`Fetch Pkg Info Failed`。
- 原因：根 `oh-package.json5` 将 DevEco 内置的 Hvigor 插件写成 `latest` 远程依赖，当前 ohpm 源无法解析该包版本。

## 本机模板查找
- 已搜索：
  - `C:\Program Files\Huawei`
  - `C:\Program Files\DevEco Studio`
  - `C:\Users\31175\AppData\Local\Huawei`
  - `C:\Users\31175\AppData\Roaming\Huawei`
  - `C:\Users\31175\AppData\Local\DevEcoStudio`
  - `C:\Users\31175\AppData\Roaming\DevEcoStudio`
- 找到本机 DevEco 模板：
  - `C:\Users\31175\AppData\Local\Huawei\DevEcoStudio26.0\tmp\previewProject`
- 模板特征：
  - `modelVersion`: `5.0.0`
  - `compatibleSdkVersion`: `5.0.0(12)`
  - 根 `oh-package.json5` 不声明 `@ohos/hvigor-ohos-plugin`
  - 根 `hvigorfile.ts` 继续使用 `appTasks`
  - `entry/hvigorfile.ts` 继续使用 `hapTasks`
  - `entry/build-profile.json5` 使用 `stageMode`

## 修复的配置文件
- `harmony-tablet/oh-package.json5`
  - 增加 `modelVersion: 5.0.0`
  - 移除 `@ohos/hvigor-ohos-plugin: latest`
  - 移除 `@ohos/hvigor: latest`
  - 对齐模板测试依赖 `@ohos/hypium` 和 `@ohos/hamock`
- `harmony-tablet/hvigorfile.ts`
  - 对齐 DevEcoStudio26.0 模板格式
  - 保留内置 `appTasks`
- `harmony-tablet/build-profile.json5`
  - `compatibleSdkVersion` 对齐为 `5.0.0(12)`
- `harmony-tablet/entry/build-profile.json5`
  - 对齐模板的 `buildOption`、`buildOptionSet`、`targets`
- `harmony-tablet/entry/hvigorfile.ts`
  - 对齐 DevEcoStudio26.0 模板格式
  - 保留内置 `hapTasks`
- `harmony-tablet/hvigor/hvigor-config.json5`
  - 新增本机模板同款 Hvigor 配置
- `harmony-tablet/entry/obfuscation-rules.txt`
  - 新增 release 构建引用文件
- `.gitignore`
  - 忽略 `harmony-tablet-backup-before-deveco-fix/`
- `tsconfig.json`
  - 排除备份目录，避免 Next.js Web 构建扫描备份中的 hvigorfile

## 保留内容
- 保留 ArkTS 页面、组件、services、stores、models、constants、utils。
- 未新增业务页面。
- 未使用 WebView 套现有网站。
- 未修改现有 Web / Sealos 后端业务功能。

## 缓存清理
已删除或确认不存在：
- `harmony-tablet/oh_modules`
- `harmony-tablet/build`
- `harmony-tablet/.hvigor`
- `harmony-tablet/.idea`
- `harmony-tablet/local.properties`

## ohpm / hvigor 命令结果
- `where ohpm`：未找到。
- `where hvigor`：未找到。
- `where hvigorw`：未找到。
- `harmony-tablet/hvigorw.bat`：不存在。
- `ohpm install --all`：未执行，原因是本机未提供 `ohpm` 命令。
- DevEco 命令行构建：未执行，原因是本机未提供命令行构建工具。

## Web 回归
- `npm run build`：通过。
- `npm run smoke`：通过。

## 用户下一步验证
1. 打开 DevEco Studio。
2. 选择 Open Project。
3. 打开 `C:\Dev\hongmeng\harmony-tablet`。
4. 等待 Sync 完成。
5. 如果 DevEco 提示工程升级，优先使用内置升级工具。
6. 选择 `entry` 模块，在 Tablet 模拟器或鸿蒙平板真机执行 Build / Run。

## 已知问题
- 当前机器命令行没有 `ohpm` / `hvigor` / `hvigorw`，无法在终端确认 HAP 构建结果。
- 需要在 DevEco Studio 内完成最终 Sync / Build 验证。
