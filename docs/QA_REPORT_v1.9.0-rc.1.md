# v1.9.0-rc.1 QA 报告

版本：v1.9.0-rc.1

commit：以 `v1.9.0-rc.1` tag 指向的提交为准。

状态：本地验证通过，等待统一部署。本文档不包含任何数据库密码、对象存储密钥、SESSION_SECRET 或账号密码。

## 变更范围

- 新增实时拍照上传弹窗。
- 新增浏览器端语音输入按钮与浮层。
- 拍照上传复用现有上传 API、S3 对象存储和 PostgreSQL 元数据链路。
- 语音输入仅在浏览器端识别，不上传或保存音频。

## 依赖与数据库

- 是否新增依赖：否。
- 是否新增 Prisma migration：否。
- 是否新增 API：否。

## 拍照上传验收

- 拍照上传按钮：通过，已接入右侧上传工具窗、当前分类空状态和上传管理页。
- 后置摄像头优先：通过，默认请求 `facingMode: environment`，失败后回退到任意摄像头。
- 摄像头切换：通过，浏览器可枚举多个 video input 时显示切换能力。
- 拍照预览：通过，使用 canvas 生成 JPEG 预览。
- 重拍 / 继续拍照 / 确认上传：通过。
- 上传链路：通过，生成 File 后复用 `/api/resource-files/upload`。
- 上传后刷新与选中新文件：通过，沿用现有上传队列和刷新逻辑。
- 摄像头释放：通过，关闭弹窗、重拍、确认上传和组件卸载时停止 media tracks。
- capture fallback：通过，不支持 getUserMedia 或摄像头不可用时显示 `input type="file" accept="image/*" capture="environment"`。

## 语音输入验收

- 浏览器支持检测：通过，检测 `SpeechRecognition` / `webkitSpeechRecognition`。
- 默认语言：通过，使用 `zh-CN`。
- interim result：通过，语音浮层显示临时识别文本。
- final result：通过，最终文本写入当前输入框。
- 应用位置：通过，已接入顶部全局搜索、新建 / 编辑工单、编辑文件信息。
- 密码输入框：通过，未接入语音按钮。
- 敏感表单自动提交：通过，不自动提交密码或其他敏感表单。
- 手动输入回退：通过，识别失败不影响手动输入。

## 权限错误处理验收

- 摄像头权限拒绝：通过，提示可使用“上传图片”选择照片。
- 浏览器不支持摄像头：通过，显示 capture fallback。
- 浏览器不支持语音输入：通过，麦克风按钮显示不可用提示。
- 麦克风权限拒绝：通过，前端提示错误，不写操作日志。
- 未检测到语音 / 网络异常 / 语言不可用 / 识别超时：通过，前端显示明确错误。

## 回归测试结果

- `npx prisma generate`：通过。
- `npm run build`：通过。
- `docker build -t hongmeng-workorder:v1-9-camera-voice .`：通过。
- `docker compose -p hongmeng up --build -d`：通过。
- `npm run smoke`：通过。
- `/api/health`：通过。
- 上传 PDF / 图片：通过。
- PDF.js 预览 / 图片预览：通过。
- 单文件下载 / ZIP 下载：通过。
- 工单管理、工单抽屉、状态 / 优先级快捷修改：通过。
- plannedAt / customerName：通过。
- CSV 导入导出、全局搜索、操作日志、账号管理、系统设置、PWA smoke：通过。

## 已知问题

暂无阻塞问题。
