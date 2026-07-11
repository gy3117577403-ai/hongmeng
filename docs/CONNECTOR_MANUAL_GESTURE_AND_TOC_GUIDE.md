# 连接器说明书手势预览与快捷目录指南

版本：v1.16.3-connector-manual-gesture-toc

状态：本地构建、接口、Docker 和浏览器视觉验收通过，尚未部署 Sealos。

## PC 滚轮缩放

鼠标位于 PDF 或图片预览区时，滚轮向上放大、向下缩小。缩放以指针位置为中心，指针下的内容保持在相同视觉位置。事件只在预览画布内拦截，页面其他区域仍可正常滚动。缩放范围为 40%-500%。

## PC 双击缩放

在接近“适应窗口”状态时双击预览区，会以双击位置为中心快速放大到适应比例的两倍；已经明显放大时再次双击，会恢复适应窗口并居中。工具栏中的缩放、适宽、整页和原始大小按钮继续保留。

## 平板捏合缩放

PDF 和图片预览使用 Pointer Events 处理双指捏合，以两指中点为缩放中心。手势过程中使用 CSS transform 跟手显示，停止约 160ms 后 PDF 才按最终比例重新渲染当前页，避免每次移动都重建 Canvas。预览区使用局部 `touch-action`，不会触发整个网页缩放。

## 平板拖动

内容放大并超出预览区后，可用单指拖动；PC 可按住鼠标左键拖动。边界约束会保留可见边缘，内容不会被拖到完全看不见。适应窗口且内容未超出画布时，拖动不会生效。

## 双点恢复

单指双点与鼠标双击使用相同的放大 / 恢复逻辑。两次点击需在 300ms 内且距离不超过 24px。双指连续双点会恢复适应窗口，并保留当前旋转角度，以降低复杂手势误判风险。

## 当前页快速加入目录

点击预览工具栏中的“添加至目录”，轻量弹层只显示目录标题、当前页和取消 / 添加按钮。系统会优先把当前页提取到的短标题预填到输入框，用户可以修改；按 Enter 可直接保存。保存后自动使用当前页作为起始页和结束页，右侧目录立即刷新并高亮新增项。

## 目录标题建议

标题建议来自当前 PDF 页可提取文本，优先识别章节编号和页面前部短标题。建议识别失败不会阻止手动输入。图片集不生成 PDF 文本建议，但仍可手动添加当前图片页到目录。

## 从 PDF 生成目录建议

右侧目录面板的“生成目录建议”会依次读取 PDF Outline / Bookmark 和前 3 页的可提取文本。系统只生成候选，不直接保存；用户勾选确认后才批量写入。相同标题和页码会去重，已有目录不会被覆盖。扫描型 PDF 不使用 OCR，无法提取时会提示手动添加。

## 页码范围与排序

快捷添加默认创建单页目录。点击目录条目的“编辑”可修改标题、起始页和结束页，也可一键把当前页设为起始页或结束页。页码必须在文件总页数内，结束页不得小于起始页。目录支持上移、下移和删除；删除目录不会删除说明书、版本或 S3 文件。

## 复制当前页链接

在“更多”中点击“复制当前页链接”，会生成：

```text
/connector-assembly-manuals?manualId=<manualId>&versionId=<versionId>&page=<pageNo>
```

Android WebView 优先使用 `AndroidBridge.copyText`，普通浏览器使用 Clipboard API 和兼容回退。链接不包含登录 Token、签名下载链接或对象存储信息，打开后会定位到对应说明书、版本和页码。

## 阅读位置恢复

系统按当前用户和说明书版本在浏览器本地记录最后阅读页。再次打开同一版本时恢复该页；带 `page` 参数的直达链接优先于本地记录。“从头阅读”会回到第 1 页并恢复适应窗口。系统不在本地保存 PDF 内容、精确平移坐标或敏感信息。

## 目录 API 与日志

目录继续保存在 `ConnectorAssemblyManualVersion.tocJson`，本版本没有新增 Prisma migration。专用接口为：

- `POST /api/connector-assembly-manual-versions/[versionId]/toc`
- `PATCH /api/connector-assembly-manual-versions/[versionId]/toc/[tocId]`
- `DELETE /api/connector-assembly-manual-versions/[versionId]/toc/[tocId]`
- `POST /api/connector-assembly-manual-versions/[versionId]/toc/reorder`

接口要求登录、校验文件总页数，并使用版本更新时间防止并发覆盖。对应操作日志为 `add_connector_manual_toc`、`update_connector_manual_toc`、`delete_connector_manual_toc` 和 `reorder_connector_manual_toc`。API 不返回 `objectKey`、S3 密钥或签名 URL。
