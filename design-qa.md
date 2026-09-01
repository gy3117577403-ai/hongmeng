# v1.34.77 首页与消息生命周期 Design QA

## 验收目标

- 视觉事实源：`C:\Users\31175\.codex\visualizations\2026\08\29\01a04b69-5239-7921-b42a-30c1b60984f5\homepage-redesign-v2-five-concepts\homepage-redesign-v2-1.png`
- 用户问题截图：`C:\Windows\TEMP\codex-clipboard-be420916-bdb6-4258-aae8-008632966f65.png`
- 首页地址：`http://127.0.0.1:3500/home`
- 完整消息中心：`http://127.0.0.1:3500/workspace/messages`
- 基准视口：`1366 × 1024` CSS px，设备像素比 `1`
- 验收环境：隔离 PostgreSQL / MinIO，已登录管理员，135 条待处理与 125 条已完成测试数据；未连接 Sealos 或生产数据库。

## 最终证据

- 首页最终图：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\implementation-final-1366x1024.jpg`
- 样板与最终实现全图对照：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\comparison-final.jpg`
- 运行中枢聚焦对照：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\comparison-focus-operations.jpg`
- 消息区聚焦对照：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\comparison-focus-inbox.jpg`
- 平板证据：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\implementation-tablet-1024x768.jpg`
- 手机证据：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\implementation-mobile-390x844.jpg`
- 完整消息中心：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\message-center-1366x1024.jpg`
- 完整消息中心手机端：`C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13477\message-center-mobile-390x844.jpg`

## 视觉一致性

- 信息架构：保留样板的“顶部风险带 + 左侧业务导航 + 六节点协同中枢 + 右侧分类消息 + 底部洞察”结构，并保留现有真实业务路由。
- 比例：1366 宽度下主区约为 `57 / 43`，消息区比旧实现更宽；页面、body 与视口均为 `1366 × 1024`，无横向或整页滚动。
- 2.5D 层级：节点、中控核心、底座、投影、连线与工业蓝图底纹形成可辨识的前后景；中控环和状态色由真实数据驱动。
- 颜色：沿用品牌橙、深海军蓝、暖白、青绿色正常、橙色预警和红色紧急；按钮、焦点和选中态具备可见对比。
- 字体与图标：使用产品既有 CJK 系统字体和 Lucide 图标体系；动态用户名、日期、数量和空状态来自真实 API，没有抄入概念图的虚构数字。
- 响应式：1024×768 维持双栏压缩布局；390×844 采用 58px 导航轨，中控核心后依次自然堆叠 01–06 节点，取消绝对连线与重叠，不产生横向溢出。

## 消息生命周期验收

- 首页和完整消息中心都提供“待处理 / 已完成”选择。
- 手工“完成”后消息立即离开待处理，顶部统计和预览同步更新，刷新后仍保持。
- `MANUAL` 完成项可以恢复；`SOURCE_RESOLVED` 与 `SYSTEM_RECONCILED` 明确显示自动收口原因且不提供恢复。
- 已完成列表按个人 `completedAt DESC, notificationId DESC` 排序，旧通知刚完成后会出现在历史顶部。
- 工艺变更后续阶段会收口已经失效的旧阶段通知；乱序、重放和并发投递不会让旧待办重新出现。
- `ACTIVATING` 与 `FAILED` 采用保守策略，未确认结束的事项不会被迁移脚本误归档。
- 完整消息中心支持 5 类业务分类、搜索、未读筛选和游标分页；已用超过 100 条数据验证加载与搜索。
- 网络异常统一为中文可重试提示，不直接显示 `Failed to fetch`。

## 浏览器与数据验证

- 1366×1024 首页：`scrollWidth = 1366`、`scrollHeight = 1024`。
- 1024×768 首页：`scrollWidth = 1024`，无横向溢出。
- 390×844 首页与消息中心：页面宽度为可用视口宽度，无横向溢出；长列表采用自然纵向滚动。
- 浏览器控制台：最终记录只有 React 开发提示与 Fast Refresh 信息，没有 error 或 warning。
- 全新数据库：118 个 Prisma migration 全部应用；生命周期 PostgreSQL 集成测试 7/7 通过。

## 对照轮次与问题关闭

### Pass 1 — blocked

- [P1] 旧实现仅有“已读”，已处理事项仍累计在待处理；修复为持久化完成状态、人工完成/恢复与业务自动收口。
- [P2] 主区比例、节点尺寸、导航标签与底部洞察高度偏离样板；修复为 57/43 分栏、紧凑六节点、完整导航标签和 146px 洞察带。
- [P2] 消息区超过 100 条时只取前 100 条且缺少已完成分类；修复为服务端全量统计、游标分页和独立完成态。

### Pass 2 — blocked

- [P2] 390px 首页中控核心覆盖首节点，绝对网格造成异常大空白；修复为小屏自然流、中控在前、六节点 16px 间距并隐藏连线。
- [P2] 原始浏览器网络错误可能直接显示英文；修复为统一中文错误与重试入口。

### Pass 3 — passed

- 重新打开全图、运行中枢聚焦、消息区聚焦、平板、手机和完整消息中心证据。
- 未发现剩余 P0、P1 或 P2 问题。

## 已接受差异与边界

- 概念图中的 76%、88%、342.5 等是假数据；实现使用真实数据，无数据时显示 `--` 或 `0`。
- 自动业务源对账当前落地在工艺路线变更通知；其他来源支持人工完成，但不会凭通知文字猜测业务终态。
- 生成的工业蓝图只作为低透明度装饰层，所有状态、控件和文字仍是可访问的原生交互 UI。
- 本次发布 GHCR 镜像，不自动切换 Sealos、正式数据库或生产流量。

final result: passed

---

# v1.34.85 手机样品扫码采集 Design QA

## 验收目标

- 用户选定参考稿：`C:\Users\31175\Desktop\鸿蒙软件\artifacts\sample-mobile-v13485\reference-selected-optional-390x844.png`
- 最终实现截图：`C:\Users\31175\Desktop\鸿蒙软件\artifacts\sample-mobile-v13485\implementation-390x844-final.png`
- 逻辑视口：`390 × 844` CSS px；内置浏览器导出的可用内容区为 `375 × 812` px。
- 验收环境：隔离 PostgreSQL / MinIO / 应用容器；未连接 Sealos 或正式数据库。

## 对照证据

- 同尺寸全页对照：`C:\Users\31175\Desktop\鸿蒙软件\artifacts\sample-mobile-v13485\source-implementation-comparison.png`
- 底部动作与全部选填提示聚焦对照：`C:\Users\31175\Desktop\鸿蒙软件\artifacts\sample-mobile-v13485\source-implementation-actions-comparison.png`
- 参考稿与实现稿均归一到 `390 × 844` 后放入同一张对照图检查。

## 视觉与交互结果

- 信息层级保持参考稿的“任务标题、产品身份、同步状态、六类采集、主操作、全部选填提示”。
- 六类入口最终采用单列紧凑卡片，分类状态位于右侧；品牌橙、暖白底、轻投影、圆角与 Lucide 图标沿用既有产品设计语言。
- `390 × 844` 首屏能看到全部六类入口、继续采集、提交本次记录和“所有内容均为选填”说明，无横向溢出。
- 工序与工时入口、采集首页返回和记录列表均完成真实点击验证；浏览器控制台最终为 0 条错误。
- 文字草稿使用 localStorage，待上传照片使用 IndexedDB；页面离开前会提示未同步内容。
- 空内容可提交审核；有文字草稿或照片时，提交动作会先自动同步实际内容，再提交任务。

## 数据闭环与可靠性

- 所有分类及字段均为选填，不再要求缺失原因；数量只表示实际采集项，不代表完整度。
- 照片分类覆盖工序工时、剥皮参数、辅料、注意事项、半成品、成品、过程、测量与异常参考。
- 照片进入 S3 兼容对象存储，数据库只保存元数据；照片可关联某条文字采集记录。
- 文字、照片和任务提交都带客户端 mutation ID；同一照片请求重放两次仅生成 1 条数据库记录和 1 个对象键。
- 修复强制照片归一化时“小 PNG 内容 + JPG 文件名”的不一致；手机端现在生成真实 JPEG 内容、JPEG MIME 与 `.jpg` 文件名。
- 管理员或具备工艺/产品工时执行能力的人员可以逐项审批；未授权登录用户不能发布审核结果。

## 对照轮次

### Pass 1 — blocked

- [P2] 两列分类卡片与选定参考稿的单列结构偏差过大；改为单列紧凑卡片。
- [P2] 两个主操作与“全部选填”说明未同时进入手机首屏；隐藏概览页非必要事实栏并压缩卡片高度。
- [P1] 小 PNG 强制归一化后沿用 `.jpg` 文件名，导致 JPEG 文件头校验失败；统一强制输出真实 JPEG。

### Pass 2 — passed

- 完整对照图与底部聚焦图重新检查，未发现剩余 P0、P1 或 P2 视觉问题。
- 生产构建、类型检查、样品单元测试、全新迁移、数据库就绪、对象存储就绪、照片上传与幂等重试均通过。

## 已接受差异与边界

- 参考稿里的数量、文件名、进度百分比属于概念数据；实现只显示当前任务的真实采集和同步数量。
- 实现保留产品现有字体、路由、登录和服务端业务 DTO，不复制概念图中的虚构业务状态。
- 本次发布镜像，不自动切换 Sealos、正式数据库或生产流量。

final result: passed
