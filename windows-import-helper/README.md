# 工单资料库微盘导入助手

这是 `v1.16.5-wecom-local-import-helper` 的 Windows 10 / 11 便携式导入助手，使用 .NET 8 WPF 构建。它不会读取企业微信私有缓存、Cookie 或内部协议，而是接收用户主动拖出、复制或下载到本地的真实 PDF / 图片，再上传到网页中当前选定的工单和资料分类。

## 安全边界

- 自定义协议只携带 `handshakeId`、`taskId` 和正式站点地址，不携带票据。
- 短期票据由正式站点通过 `127.0.0.1:17651` 交给助手，仅保存在进程内存中。
- loopback 服务只绑定 `127.0.0.1`，只接受 `https://qdowqencjyph.sealoshzh.site` Origin。
- 助手不保存系统密码、企业微信密码、session cookie、S3 Key、数据库连接串或上传票据。
- 本地仅保存用户选择的下载目录；不会删除、移动、改名或改写本地文件。

## 本地构建

```powershell
dotnet restore .\Hongmeng.WorkOrder.ImportHelper.sln
dotnet build .\Hongmeng.WorkOrder.ImportHelper.sln -c Release
dotnet test .\Hongmeng.WorkOrder.ImportHelper.sln -c Release --no-build
dotnet publish .\src\Hongmeng.WorkOrder.ImportHelper\Hongmeng.WorkOrder.ImportHelper.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
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

解压后直接运行 `Hongmeng.WorkOrder.ImportHelper.exe`。首次运行会在当前 Windows 用户范围注册 `hongmeng-workorder-import://`，不需要管理员权限。当前没有代码签名证书，Windows 可能显示“未知发布者”；不要绕过公司终端安全策略，正式签名包应在后续使用受控证书流程生成。

## 输入方式

- 从企业微信微盘拖出一个或多个真实文件。
- 在微盘中复制文件后，在助手按 `Ctrl+V`。
- 选择企业微信下载目录并开始监控；助手只接收任务启动后新增、连续 3 秒大小稳定的文件。

支持 PDF、JPG、JPEG、PNG、WEBP。PDF 保留原文件、原文件名和全部页面，不拆页、不转图、不重编码。
