# 工单资料库微盘导入助手

这是 `v1.16.5.1-wecom-helper-protocol-fix` 的 Windows 10 / 11 便携式导入助手，使用 .NET 8 WPF 构建。它不会读取企业微信私有缓存、Cookie 或内部协议，而是接收用户主动拖出、复制或下载到本地的真实 PDF / 图片，再上传到网页中当前选定的工单和资料分类。

## 安全边界

- 自定义协议只携带 `handshakeId`、`taskId` 和正式站点地址，不携带票据。
- 短期票据由正式站点通过 `127.0.0.1:17651` 交给助手，仅保存在进程内存中。
- loopback 服务只绑定 `127.0.0.1`，只接受 `https://qdowqencjyph.sealoshzh.site` Origin。
- 助手不保存系统密码、企业微信密码、session cookie、S3 Key、数据库连接串或上传票据。
- 本地仅保存用户选择的下载目录；不会删除、移动、改名或改写本地文件。
- 应用清单固定为 `asInvoker`，协议只注册在 `HKEY_CURRENT_USER\Software\Classes`，不申请管理员权限或写入 HKLM。
- 手动任务码只在任务有效期内使用一次；任务 ticket 仍只保存在进程内存中。

## 本地构建

```powershell
dotnet restore .\Hongmeng.WorkOrder.ImportHelper.sln
dotnet build .\Hongmeng.WorkOrder.ImportHelper.sln -c Release
dotnet test .\Hongmeng.WorkOrder.ImportHelper.sln -c Release --no-build
dotnet publish .\src\Hongmeng.WorkOrder.ImportHelper\Hongmeng.WorkOrder.ImportHelper.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=false `
  -o .\artifacts\publish
```

## GitHub Actions 下载

1. 打开仓库 `Actions`。
2. 选择 `Windows WeCom Import Helper`。
3. 运行 workflow，或等待 `main` 中 `windows-import-helper/**` 变更自动触发。
4. 从成功 run 的 Artifacts 下载：

```text
hongmeng-workorder-wecom-import-helper-win-x64
```

完整解压后运行文件夹内的 `Hongmeng.WorkOrder.ImportHelper.exe`，不要在 ZIP 内运行，也不要只单独复制 EXE。Artifact 是包含 .NET 运行时的自包含便携目录，不需要预先安装 .NET，也不需要启动前解压运行时到受保护缓存。首次普通双击会在当前 Windows 用户范围注册 `hongmeng-workorder-import://`；移动整个助手文件夹后再次普通启动会自动修复协议路径，不需要管理员权限、PowerShell 或手工修改注册表。

建议把 EXE 放在固定目录，例如 `%USERPROFILE%\Apps\工单资料库微盘导入助手\`。当前没有代码签名证书，Windows 可能显示“未知发布者”；仅在确认文件来自本仓库成功的 GitHub Actions 后，按公司终端安全策略处理。不要关闭 Windows Defender，企业策略阻止时应联系 IT 放行。

## 浏览器协议与手动连接

- 网页点击“从微盘导入”后，允许 Chrome / Edge 打开外部应用。
- 助手“连接诊断”内可查看协议状态，并使用“注册 / 修复浏览器协议”和“测试浏览器协议”。
- 测试使用 `hongmeng-workorder-import://ping`，不会创建任务或上传文件。
- 协议被企业策略拦截时，普通双击助手，把网页显示的 6 位一次性任务码输入“手动任务码”即可连接。
- 助手采用当前 Windows 用户单实例；协议冷启动和已运行时再次唤起都会转交给同一窗口。

## 输入方式

- 从企业微信微盘拖出一个或多个真实文件。
- 在微盘中复制文件后，在助手按 `Ctrl+V`。
- 选择企业微信下载目录并开始监控；助手只接收任务启动后新增、连续 3 秒大小稳定的文件。

支持 PDF、JPG、JPEG、PNG、WEBP。PDF 保留原文件、原文件名和全部页面，不拆页、不转图、不重编码。
