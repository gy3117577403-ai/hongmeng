# Windows 微盘导入助手 1.16.5.4 拖放接收 QA

## 范围

- 版本：`v1.16.5.4-wecom-helper-dragdrop-intake-fix`
- 只修改 Windows WPF 助手、测试、工作流版本和说明文档。
- 不修改 Web、API、Prisma 或数据库结构，不写 S3，不部署 Sealos。

## 根因

主窗口虽然启用了 `AllowDrop`，实际橙色 DropZone 没有显式注册为 Drop Target，也没有使用 Preview 路由捕获子控件上的拖放事件。原 `DragOver` 和 `Ctrl+V` 只识别 `DataFormats.FileDrop`；Shell 虚拟文件的 `FileGroupDescriptorW/FileContents` 一定被判为 `DragDropEffects.None`。提升权限遗留进程没有窗口也未监听 17651，不是本次禁止光标的直接原因。

## 修复结果

- Window 与橙色 DropZone 都为 `AllowDrop=True`，DropZone 使用非空白色背景保证命中。
- DropZone 使用 `PreviewDragEnter/PreviewDragOver/PreviewDragLeave/PreviewDrop`；每次 DragOver 都重新判定 Copy/None。
- Explorer `FileDrop` 支持单个和多个 PDF/JPG/JPEG/PNG/WEBP；目录、EXE、ZIP、快捷方式和脚本不接收。
- 支持 `FileGroupDescriptorW`、`FileGroupDescriptor`、`FileContents`、`FileNameW/FileName`，并尝试将 Shell IDList 自动转换为 FileDrop。
- Shell 虚拟文件按 lindex 读取 Stream/COM IStream/HGLOBAL，流式写入当前任务临时目录。
- 文件名移除路径段、非法字符和 Windows 保留设备名；任务限制控制文件数、单文件和总大小。
- Ctrl+V 与拖放复用同一接收服务；只收到文本或 URL 时不抓取，提示下载目录监控。
- 下载目录任务连接后自动启动，连续稳定 3 秒后进入队列；忽略 `.tmp/.part/.crdownload/.download` 和 0 字节文件。
- 虚拟临时文件在校验失败、重复、上传成功、任务过期、任务移除和退出时清理；用户原文件不删除。
- 拖放诊断只显示 OLE 格式名称和布尔判断，不读取正文、URL、Cookie、任务码或票据。

## 自动验证

- `dotnet restore`：通过。
- Release build：通过，0 warning / 0 error。
- `dotnet test`：61/61 通过。
- self-contained win-x64 publish：通过，398 个运行时文件。
- Explorer 临时 PDF 真实 OLE 拖动：DropZone 识别支持文件并返回 Copy；无任务时明确提示先连接，未上传文件。
- Explorer 脱敏格式诊断：`FileDrop`、`FileGroupDescriptorW`、`FileContents`、`FileNameW/FileName` 与 `Shell IDList Array` 均被识别，当前判断为“本地文件”；诊断未读取文件正文。
- 候选进程：助手、Explorer、企业微信均为中完整性；manifest 保持 `asInvoker`。
- 协议 ping 连续两次后仍为单实例，且仅候选进程监听 `127.0.0.1:17651`。

## 企业微信实测边界

自动化环境不能替代用户在企业微信微盘中发起一次真实拖放，因此本报告不虚构其 OLE 格式。安装新 Artifact 后，启用“拖放诊断”并拖过一个微盘 PDF，即可确认是 FileDrop、FileGroupDescriptorW/FileContents 还是仅链接；仅链接时应使用右侧下载目录推荐方式。
