# 视觉验收记录

## 2026-08-07 工时完成进度、报工时间与流转单小时产能

- 验收视口：1366 × 1024 横向平板。
- 参考图：
  - `C:\Windows\TEMP\codex-clipboard-a2e08f87-0ba7-4522-957e-cacd827c81ed.png`
  - `C:\Windows\TEMP\codex-clipboard-85e02515-39a0-4508-9726-752c1b3201f9.png`
  - `C:\Windows\TEMP\codex-clipboard-2adad100-1caa-485c-b659-e829af7f163d.png`
- 实现截图：
  - `artifacts/labor-progress-qa-20260807/production-labor-progress-1366x1024.png`
  - `artifacts/labor-progress-qa-20260807/employee-report-empty-1366x1024.png`

### 生产执行

- 表头已改为“工时完成进度”。
- 每行同时显示工时比例、已完成标准工时、剩余标准工时和总标准工时。
- 第一次对照发现总工时在窄列中被截断，已改为“剩余 / 总计”两行展示后重新截图。
- 0% 状态使用橙色进度条；缺标准工时或待补标准快照时显示维护提示，不伪装成 0%。
- 1366 × 1024 下未发现进度文字遮挡、重叠或截断。

### 员工报表

- 自动记工明细新增完整报工时间，格式为 `YYYY-MM-DD HH:mm`，时区为 Asia/Shanghai。
- 隔离验收库当前没有员工、报工和工时池数据，因此只能核验页面空状态、接口映射与组件格式化逻辑，无法生成含真实报工时间的行截图。
- 页面在 1366 × 1024 下布局正常，无乱码或操作遮挡。

### 二维码流转单

- 工序表新增“标准小时产能”列；按件计时的工序显示“套/小时”理论值。
- 按批计时没有批量基数，显示“按批计时”，不虚构小时套数。
- 本地生成的打印任务 DOM 已核验列名和 6 条工序产能值：600、900、720、900、600、3600 套/小时。
- 浏览器原生 PDF iframe 截图为空，且浏览器安全策略不允许直接打开 blob 地址，因此本次无法取得最终 PDF 像素截图；打印 DOM、PDF 生成状态、单元测试与生产构建均已通过。

final result: blocked（生产执行视觉通过；员工明细真实行与原生 PDF 像素验收受隔离数据和浏览器策略限制）

## 2026-08-07 计划中心订单池抽屉与日出货计划

- 目标视口：1366 × 1024 横向平板；补充检查 1024 × 768。
- 用户参考图：
  - `C:\Windows\TEMP\codex-clipboard-284f8028-dc22-41b6-a1fa-a7b81c6b59a2.png`
  - `C:\Windows\TEMP\codex-clipboard-248a69aa-71bc-4745-b859-9e42b771529b.png`
- 最终实现截图：
  - `output/design-audit/2026-08-07-daily-shipping-plan/implementation-plan-center-drawer-open-1366x1024.png`
  - `output/design-audit/2026-08-07-daily-shipping-plan/implementation-partial-shipment-1366x1024.png`
  - `output/design-audit/2026-08-07-daily-shipping-plan/implementation-loading-skeleton-1366x1024.png`
  - `output/design-audit/2026-08-07-daily-shipping-plan/implementation-inline-error-1366x1024.png`
- 同屏对照输入：
  - `output/design-audit/2026-08-07-daily-shipping-plan/comparison-plan-center.png`
  - `output/design-audit/2026-08-07-daily-shipping-plan/comparison-daily-shipment.png`
- 原参考图无法重新采集成 1366 × 1024；对照图将参考和实现按原比例放入相同的 1366 × 1024 面板，未拉伸内容。实现端单独在目标视口完成像素与交互验收。

### 计划中心

- 固定左侧订单池已改为覆盖式抽屉，关闭时排单表格占满工作区，打开时保留背景上下文并通过遮罩区分层级。
- 订单池入口显示待安排数量；抽屉支持关闭按钮、遮罩关闭和 Escape 关闭。
- Escape 后焦点返回“订单池”触发按钮；关闭状态下 DOM 中没有残留的隐藏 dialog 或可聚焦抽屉控件。
- 对照检查未发现遮挡、裁切、错位、异常圆角或文字溢出。

### 日出货计划

- 原人员排程模块已替换为按周选日的日出货工作台；支持从本周生产批次多选、填写数量和计划时间后加入当日计划。
- 列表同时展示计划数量、生产进度、出货进度、计划时间、实际时间、客户交期和实发流水。
- 已实测完整主路径：多选三批 → 生成计划 → 确认 → 实发 30 件 → 撤销 5 件，最终净实发 25 件。
- 已实测后端业务拦截：当完成良品数降低后，20 件实发被拒绝，错误只显示在当前弹窗一次；测试数据随后恢复。
- 慢请求验收通过：暂停隔离验收库后切换日期，页面显示“同步中”、7 个日期骨架和 6 个指标骨架，不显示“未创建”或 0 值假状态；恢复数据库后正常落入真实空状态。
- 首次进入由服务端直接返回完整工作台数据，没有二次客户端首屏请求；同日刷新保留当前数据并后台更新，访问过的日期使用内存缓存，减少表格整块闪烁。
- “已完工可备货”按批次完工良品扣除全周净实发后再受当日待出数量约束；全量撤销后主列表实际出货时间恢复为“尚未出货”，原流水仍完整保留。

### 验证结论

- 1366 × 1024 主视口、1024 × 768 补充视口均可完成核心操作。
- 真实 PostgreSQL 集成测试覆盖跨日拆分、累计数量上限、完工良品上限、幂等重放、实发撤销和关闭后重开。
- 当前没有未解决的 P0、P1 或 P2 视觉/交互问题。

final result: passed

## 2026-08-14 线束制造能力展厅

### 验收对象与证据

- 用户选定参考图：`C:\Users\31175\.codex\generated_images\019ffdba-e78a-7b03-9221-077ebc3c072b\exec-27ac93fe-3c25-4255-a0e0-95fba831dfa9.png`（1487 × 1058）。
- 内容维护端：`artifacts/capability-showcase-admin-1366x1024.png`，浏览器视口 1366 × 1024。
- 公开只读页：`artifacts/capability-showcase-public-1366x1024.png`，浏览器视口 1366 × 1024；浏览器截图去除滚动条后的像素为 1351 × 1013。
- 手机端：`artifacts/capability-showcase-public-390x844.png`，浏览器视口 390 × 844；内容区宽度 375 px，无横向溢出。
- 同屏对照：`artifacts/capability-showcase-source-implementation-comparison.png`；参考图与目标视口实现均保持原比例，未做单轴拉伸。

### 视觉与内容核验

- 延续参考图的白色工业展示页、橙色主操作、深蓝标题、真实质感设备照片和左右分栏首屏；增加品牌区、演示资料提醒和资料入口，用于满足独立分享页面的来源与风险说明。
- 顶部补齐产品介绍、工艺流程、设备与技术、质量管控和合作支持；首屏下方优先进入产品介绍，符合本次新增产品展示的要求。
- 维护端使用三栏编辑结构：分类、条目、详情同屏；分类和条目支持新增、改名、排序、显隐和删除，图片槽位可从 S3 素材库替换。
- 公开页没有输入框、编辑、删除、上传、保存或发布控件；演示状态持续显示“图片与参数需核实”，未把样例设备或检验能力表述为已确认事实。
- 1366 × 1024 和 390 × 844 下未发现文字裁切、面板重叠、按钮跑位、页面级横向滚动或低清晰度图片。

### 交互与运行验收

- 产品分类切换、工艺步骤切换、设备自动化筛选、桌面锚点导航和手机折叠菜单均已在真实页面点击验证。
- 上传图片已实际绑定高压动力线束，并通过分享凭证专用媒体接口返回 `image/png`；公开分享页及媒体均可匿名读取，错误凭证和已停用凭证均返回 404。
- 发布 V2 后既有有效分享链接自动读取最新不可变快照；临时分享链接停用后立即失效，原有效链接保持可用。
- 公开页包含 `noindex, nofollow, nocache`，且浏览器 error 日志为空。
- 最终严重度检查：P0 无，P1 无，P2 无。

final result: passed
## 2026-08-12 变更管理高级工作台（方案二）

### Sources and target

- 选定设计稿：`artifacts/change-management-ui-redesign-20260812/target-option-2.png`，1449 × 1086 像素。
- 最终实现截图：`artifacts/change-management-ui-redesign-20260812/implementation-final.png`，1449 × 1086 像素。
- 主验收视口：1449 × 1086 CSS 像素；浏览器页面 `devicePixelRatio` 为 1。Codex 浏览器底层捕获面为 2174 × 1629，先完整捕获再按同一比例归一化到 CSS 视口尺寸，未裁切、未做非等比拉伸。
- 验收状态：平台导航展开、范围为“全部变更”、已启用的专用工艺变更被选中、影响与责任面板展开。

### Full-view and focused comparison evidence

- 全视图同屏对照：`artifacts/change-management-ui-redesign-20260812/comparison-final.png`。
- 详情与流程局部同屏对照：`artifacts/change-management-ui-redesign-20260812/comparison-focus.png`。
- 参考稿与实现均使用 1449 × 1086 最终画布；局部对照仅裁取各自详情工作区并等比归一化，用于检查进度、摘要、路线差异、责任栏和底部操作区。
- 最终实现保留了现有系统真实导航和业务数据，因此工序名称、负责人、附件数量等内容与概念稿不同；信息层级、操作位置、状态表达和三栏关系按方案二落地。

### Required fidelity surfaces

- 删除原页面上方重复的大标题占位，页面内容从紧凑命令栏直接开始。
- 顶部命令栏包含页面识别、我的待办/全部变更/已完成、局部搜索、流程中心、刷新和新建变更；主要操作在一个视线层级内完成。
- 左侧收件箱使用状态数字、筛选器、进行中/已完成分组和高辨识度选中态；中间详情使用四步进度、结构化摘要、完整路线前后对比和活动记录；右侧保留可折叠的影响与责任、关联来源和附件。
- 延续项目既有深蓝导航、橙色主操作、绿色完成状态、浅灰工作台背景和 Lucide 图标，没有引入新的视觉体系或伪造图形资产。
- 1449 × 1086 下无页面级横向溢出、主按钮裁切、列表与详情重叠、责任栏被遮挡或底部评论区不可达。

### Interaction and diagnostics

- `Ctrl+K` 与 `/` 聚焦当前页面搜索框；已修复全局搜索抢占快捷键并跳转首页的问题。
- 搜索 `CHG-000004` 后队列准确收敛为 1 项，清除搜索后恢复全部 4 项。
- “已完成”页签显示 3 项已完成记录，返回“全部变更”后恢复 4 项。
- 影响与责任面板可以关闭并通过“上下文”按钮重新展开。
- “新建变更”弹窗可打开、具备完整表单与 dialog 语义，并可无副作用关闭。
- 待审核的专用工艺变更提供精确深链：携带 `processRouteChangeId` 与 `workOrderId` 进入流程中心。
- 队列支持 ArrowDown 键盘移动选中项；焦点与 URL 中的 `changeId` 同步更新。
- 浏览器 error 日志为空。

### Iteration history

1. 去除隐藏共享标题仍残留的 64px 空洞，建立紧凑命令栏与收件箱/详情工作台。
2. 调整平台导航、队列和详情的宽度，在横向平板视口内稳定显示右侧责任栏。
3. 将专用工艺变更从单个插入节点扩展为完整路线前后对比，并补齐工时差异、活动记录和持久底部操作区。
4. 真实交互验收发现 `Ctrl+K` 被全局搜索抢占，改为捕获阶段拦截后复测通过。
5. 使用完整物理捕获面重新生成最终截图，避免操作系统显示缩放造成的右侧裁切；再次完成全视图与详情局部同屏比较。

final result: passed

## 2026-08-12 产品工序与工时快速插入及排序

### Sources and target

- 用户参考图：`C:\Windows\TEMP\codex-clipboard-ec1da35e-7b3b-4527-9ed3-3d01a30ebadb.png`（2048 × 1152 像素）。
- 主验收视口：1366 × 1024 CSS 像素，截图密度 1×；补充视口：1024 × 768。
- 浏览器：Codex 应用内浏览器，本地已登录隔离验收环境。
- 数据状态：FW-mini_CT_XS、25 道初始工序、包含一组并行工序；在第 24 道“检验”前插入“穿防水塞”并填写 50 秒标准工时后，路线自动变为 26 道。

### Rendered evidence

- 普通编辑模式：`output/product-time-route-editor-qa-normal.png`。
- 精确插入后的有效状态：`output/product-time-route-editor-qa-inserted-valid.png`。
- 紧凑排序模式：`output/product-time-route-editor-qa-reorder-final.png`。
- 一次移动到位弹窗：`output/product-time-route-editor-qa-move-dialog.png`。
- 1024 × 768 响应式检查：`output/product-time-route-editor-qa-1024.png`。
- 参考图与实现同屏对照：`output/product-time-route-editor-comparison.png`。

参考图和实现图的原始视口不同，因此同屏对照使用两张图中相同的后段工序编辑区域进行等高裁切，未拉伸单个方向。实现端另外在原生 1366 × 1024 和 1024 × 768 视口独立完成完整页面检查。

### Required fidelity surfaces

- 字体与排版：延续现有系统字体、字重、橙色标题和蓝色工序序号；紧凑排序行仍保留工序名称、顺序/并行属性和工时摘要。
- 间距与布局：普通模式新增“前加、后加、移至”后仍保持单行操作区；排序模式把 26 道工序压缩为更易扫读的行，主操作区没有遮挡底部发布按钮。
- 颜色与视觉令牌：复用现有橙色主题、蓝色工序边线、浅灰边框、圆角和阴影，没有引入新的视觉体系。
- 图片与图标：未新增栅格素材；拖拽、上移、下移和定位均使用项目现有 Lucide 图标库。
- 文案：新增“调整顺序”“快速调整顺序”“前加”“后加”“移至”“撤销上一步”等短文案；插入位置和移动位置均显示具体工序名称，避免只看数字误选。
- 交互与无障碍：拖拽手柄具备可访问名称，键盘 Space/ArrowDown/Space 可完成排序；图标按钮保留可访问文本；弹窗使用 dialog 语义。

### Interaction and state checks

- 从工序库选择“第 24 道前 · 检验”，点击“穿防水塞”后得到 26 道工序，附近顺序为“卡扣安装 → 导通 → 穿防水塞 → 检验 → 包装”，新增工序实际位置为第 24 道。
- 行内“前加/后加”可直接把工序库锚定到目标组前后；工序库同时支持路线末尾和“与前一工序组并行”。
- “移至”将第一道“裁线”一次移动到路线末尾后，首道变为“穿号码管”、末道变为“裁线”；“撤销上一步”完整恢复原顺序。
- 键盘拖拽将“裁线”下移一组后顺序发生变化，撤销后恢复；并行工序在纯函数和界面模型中始终作为整组移动。
- 1024 × 768 下 `documentElement.scrollWidth === clientWidth === 1024`，没有页面级横向溢出。
- 浏览器 error/warning 日志为空。

### Iteration history

1. 第一轮保留相邻上/下按钮，同时增加精确插入位置、行内前加/后加和一次移动到位，解决漏工序需要连续点击的问题。
2. 增加紧凑拖拽排序模式、整组移动和一步撤销，避免长路线编辑时在大卡片之间反复滚动。
3. 使用真实第 24 道插入场景检查后，补齐 50 秒标准工时并重新截图，确认有效状态下没有错误边框或校验文字。
4. 在 1366 × 1024 与 1024 × 768 两个视口复测，未发现未解决的 P0、P1 或 P2 视觉/交互问题。

final result: passed

## 2026-08-10 仓库与物料异常同步

## Sources and target

- Annotated warehouse reference: `C:\Windows\TEMP\codex-clipboard-56a06c48-1ac5-491a-99cc-e9a8bf3392f3.png`
- Annotated material follow-up reference: `C:\Windows\TEMP\codex-clipboard-27a5a49b-6ac9-4c90-9925-a1c93629fa09.png`
- Required implementation viewport: 1366 x 1024 CSS pixels
- Browser: Codex in-app browser, local authenticated application
- Data state: realistic current-week, next-week, history-week, overdue, waiting, warehouse-confirmation, and resolved exception records

## Rendered evidence

- `artifacts/material-sync-qa/warehouse-1366x1024.png` — current warehouse scope with 11 synchronized active exceptions
- `artifacts/material-sync-qa/material-active-1366x1024.png` — current material scope with 11 active follow-ups
- `artifacts/material-sync-qa/material-resolved-1366x1024.png` — resolved list with green closed-loop treatment and resolution timestamps
- `artifacts/material-sync-qa/material-roundtrip-new-event-1366x1024.png` — the same work order after resolving event 1 and creating independent event 2
- `artifacts/material-sync-qa/compare-warehouse.jpg` — annotated warehouse source and implementation in one comparison image
- `artifacts/material-sync-qa/compare-material-resolved.jpg` — annotated resolved source and implementation in one comparison image

The annotated sources were normalized into 1366 x 1024 comparison panels without cropping. The implementation panels are native 1366 x 1024 captures.

## Interaction and state checks

- Current week: warehouse active exceptions = 11; active material follow-ups = 11.
- Next week: 2 preparation exceptions and 2 material follow-ups.
- History scope: 2 active follow-ups plus 1 resolved record; week selector exposes the historical production week.
- Resolved filter: active queue is cleared and 3 resolved records appear in a dedicated list.
- Resolution detail: green terminal flow, resolution timestamp, confirming warehouse user, resolution note, and warehouse deep link are visible.
- Procurement update: a real progress submission succeeded and appeared immediately in warehouse activity and follow-up panels.
- ETA ownership: warehouse drawer renders procurement ETA as read-only and displays the synchronized 08/13 value.
- Deep links: material-to-warehouse navigation preserved the requested task and opened its detail drawer.
- Real close/reopen round trip: resolving event 1 changed warehouse/material active counts from 11 to 10 and resolved from 3 to 4; reporting a later event restored active counts to 11 while resolved stayed 4, and the new detail displayed `异常 #2`.

## Visual review

- P0 blocking issues: none.
- P1 major layout or state issues: none.
- P2 visible polish issues: none after the final iteration.
- No clipped primary controls, overlapping panels, horizontal page overflow, or hidden status counts at 1366 x 1024.
- The redundant large page headers marked for deletion are absent; compact command bars preserve navigation and context.
- Existing orange theme, sidebar, card geometry, typography, icons, and spacing language are preserved.
- Resolved records use green without changing the product's established palette.

## Iteration history

1. Replaced the redundant top page headings with compact command bars and shared week controls.
2. Separated active and resolved task lists; added resolution time and green closed-loop state.
3. Made procurement the sole ETA editor and warehouse the synchronized read-only consumer.
4. Corrected local QA fixture encoding, repeated current/resolved comparisons, and rechecked all core controls.

final result: passed

## 2026-08-10 仓库管理与物料异常页顶部空白修复

### Sources and target

- 用户标注图：`artifacts/layout-gap-qa/reference-annotated.png`（2212 × 1422 像素，96 DPI）。
- 同视口修复前基线：`artifacts/layout-gap-qa/material-before-1366x1024.png`。
- 物料异常修复后：`artifacts/layout-gap-qa/material-after-1366x1024.png`。
- 仓库管理修复后：`artifacts/layout-gap-qa/warehouse-after-1366x1024.png`。
- 实现视口：1366 × 1024 CSS 像素，浏览器缩放与截图密度均为 1×。
- 状态：已登录、本周范围、真实仓库及物料异常数据已完成加载。

### Full-view and focused comparison evidence

- 用户标注图、1366 × 1024 修复前基线、1366 × 1024 修复后页面已放入同一次视觉比较输入；原图因像素尺寸和数据状态不同，仅用于确认标注区域，不对业务数字做像素级比较。
- 修复前共用工作台外壳仍预留 64px 隐藏标题栏高度：物料页首卡片顶部为 74px，仓库页首卡片顶部为 72px。
- 修复后两页根节点顶部内边距均为 0px；物料页首卡片顶部为 10px，仓库页首卡片顶部为 8px，内容框底部均落在 1024px 视口边界内。
- 重点区域仅为页面顶部占位与首行内容衔接；字体、状态卡、侧栏、表单和三栏详情未改，因此不需要额外局部裁切。

### Required fidelity surfaces

- 字体与排版：字体、字号、字重、行高、截断规则均未改变；顶部标题与统计卡在上移后无裁切或换行漂移。
- 间距与布局：删除无可见标题时残留的 64px 占位，保留页面自身 8px/10px 安全边距；未发现横向溢出、面板重叠或底部控件被挤出。
- 颜色与视觉令牌：橙色主题、状态色、边框、阴影及背景令牌均保持原样。
- 图片与图标：没有新增、替换或降质任何图片和图标资产。
- 文案与内容：业务文案、统计数字、筛选条件和异常记录内容均未修改。

### Interaction and diagnostics

- 仓库管理与物料异常两条路由均重新加载成功；本周范围、统计卡、列表、详情和操作区正常显示。
- 物料异常页真实加载 11 条记录，加载态正常退出。
- 页面控制台没有应用错误或警告；仅有开发环境 Fast Refresh 信息。

### Iteration history

1. 初始发现 P2：`hideHeader` 只隐藏标题组件，但共用根布局仍保留 `--hm-shell-header: 64px`，形成整页顶部空洞。
2. 在仓库与物料页面根选择器中显式将标题高度和顶部内边距设为 0，不改变其他工作台。
3. 重新加载两页并在 1366 × 1024 复测，顶部空洞消失，首行内容完整填充且无新增 P0/P1/P2 问题。

final result: passed

## 2026-08-12 五板块任务驾驶舱（第二套）

### 目标与范围

- 选定方向：第二套“任务驾驶舱”。
- 验收视口：1366 × 1024 横向平板。
- 覆盖重大质量审批、问题管理、考勤与异常、知识库、生产部效率报表五个板块。
- 参考与实现在同一对照输入中检查：紧凑单层命令栏、状态阶段带、业务工作区和上下文操作区。

### 实现与交互

- 五页均使用共享 `WorkbenchCockpitCommand`；隐藏原全局标题栏并移除页面内重复标题，页面只保留一层命令栏。
- 重大审批与问题管理使用紧凑阶段带；知识库保留资料来源、结果、预览三栏；考勤与报表按数据密度保留指标带与主表。
- 审批/问题状态筛选、考勤页签、知识来源与报表视图均在浏览器中完成真实点击验证。
- 五条路由均无页面级横向溢出，每页恰有一个 `.hm-cockpit-command`，且不存在旧页面标题组件。

### 最终严重度检查

- P0：无。
- P1：无。
- P2：无。
- 非阻断说明：本地知识库 PDF 样例产生一条既存 PDF.js 网络错误；命令栏、三栏布局和资料元数据均正常，判定与本次工作台布局改造无关。

final result: passed

## 2026-08-14 产品工时 UI 设计验收

### 验收对象

- 源图：`C:\Windows\TEMP\codex-clipboard-7831f9d6-4d71-4a1f-b693-f16e549ea985.png`
- 最终实现（目标视口）：`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\product-time-v1341-final-1366x1024.png`
- 最终实现（源图同尺寸）：`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\product-time-v1341-final-2226x1399.png`
- 全屏同输入对照：`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\product-time-source-final-comparison.png`
- 重点区域同输入对照：`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\product-time-source-final-focus-comparison.png`
- 交互状态：`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\product-time-v1341-unsaved-dialog-1366x1024.png`、`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\product-time-v1341-copy-preview-1366x1024.png`

### 捕获条件

- 源图像素：2226 × 1399；源图未提供浏览器 CSS 视口或 DPR，视觉密度高于当前本地浏览器，密度值无法从静态图片反推为已核实事实。
- 主验收视口：1366 × 1024 CSS px，DPR 约 1；截图像素 1366 × 1024。
- 同尺寸对照视口：2226 × 1399 CSS px，DPR 约 1；截图像素 2226 × 1399。
- 状态：横向平板、产品总库、空工序路线产品 `EHPS-4-4L616A-610`；另复验有工序路线、未保存确认、复制预览和字段错误状态。
- 本地依赖：隔离 PostgreSQL、MinIO；`/api/ready` 的 database 与 storage 均为 true。

### 迭代记录

1. 源图审查：两条橙色规则卡占用主编辑区，产品标题右侧存在空白；顶部导入、导出、刷新按钮的图标与文字基线不稳定。
2. 第一轮实现：规则压缩并上移，原卡片删除；在 1366 × 1024 有工序状态中发现报工规则横排过挤。
3. 第二轮修正：报工规则改为紧凑上下结构；工具栏按钮统一 36 px 高度、最小宽度、图标伸缩和文字不换行；最终 DOM 测量无横向溢出。
4. 交互补强：报价秒数即时换算，未保存修改改用明确确认层，复制路线增加来源/目标/覆盖范围预览，发布入口改为“预览发布影响”，字段错误改为逐项说明。

### 五项保真检查

- 字体与排版：沿用项目既有中文字体栈和字号层级；标题、规则标签、按钮文字、长规格截断和产品列表两行显示均无裁切。源图与本地截图的整体视觉密度差异被归类为源图缩放信息缺失造成的不可直接核实差异，不影响指定区域结构验收。
- 间距与布局节奏：规则已进入标题栏中部，指标区紧随其后，原两条提示卡不再占用编辑区；1366 视口下页面、路线头部和工具栏的 `scrollWidth` 均不超过 `clientWidth`。
- 颜色与视觉 token：保留项目橙色主操作、浅橙规则面板、灰蓝信息层级和红色危险确认；未引入新的品牌色或无关装饰。
- 图像质量与资产：本次范围无照片、插画或品牌位图替换；图标继续使用项目既有 Lucide 组件，没有手绘 SVG、占位图或 CSS 仿图。
- 文案与内容：规则简化后仍保留“自由/严格报工”与“按件/按批”两个必要决策；计时细则转入可展开说明。按钮文案准确区分预览、保存、正式发布和复制影响。

### 行为、响应式与可访问性

- 1366 × 1024：导入、导出、刷新等高同基线；空路线和有路线头部均无重叠或横向滚动。
- 报价输入 `150` 秒实时显示“折合 2.5 分钟”；放弃修改可同时恢复工序和报价状态。
- 未保存确认会区分工序路线修改与报价修改，关闭后焦点返回原触发按钮；弹层支持 Escape 和 Tab 焦点循环。
- 复制预览明确展示来源版本、来源/目标客户与规格、草稿覆盖结果和“不会直接发布到现场”。
- 无效标准时间会设置 `aria-invalid=true` 并显示字段级错误。
- 最终浏览器控制台 error/warn：0。

### 最终结论

指定修改已在真实页面、目标视口、源图同尺寸对照和关键交互状态下复验；剩余视觉差异来自项目现有导航、测试数据以及源图未知缩放密度，不属于本次指定区域的回归。

final result: passed

## 2026-08-21 问题闭环人员选择窗口遮挡修复

### Sources and target

- 用户问题截图：`C:\Windows\TEMP\codex-clipboard-db501dd4-d89d-401f-bc1d-70eaa2c2cb13.png`（2549 × 1384 像素）。
- 最终实测截图：`artifacts/issue-picker-overlay-qa-20260821/implementation-focused-open.jpg`（1366 × 700 可见区域）。
- 全视图同屏对照：`artifacts/issue-picker-overlay-qa-20260821/comparison-full-before-after.jpg`。
- 责任与验证区域局部对照：`artifacts/issue-picker-overlay-qa-20260821/comparison-focused-before-after.jpg`。
- 验收状态：问题 `PVC管大小用错` 已选中，右侧闭环控制台展开，“独立验证人”员工选择器打开；隔离验收库使用合成员工与问题数据，未写入现有业务数据。
- 页面几何分别在 1366 × 1024 与 1366 × 700 CSS 视口测量；Codex 应用内浏览器本轮可导出的完整可见截图面为 1366 × 700，因此全视图截图按该可见区域归档，1024 高度结果以 DOM 几何测量和交互验证补充。

### Root cause and implementation

- 根因判断：用户截图中的白色人员菜单不属于应用 DOM，外观、项目代码和浏览器行为共同表明它是 Chrome 对人员搜索字段触发的身份/地址自动填充层；该层不受应用 z-index 或容器裁切控制。此结论有充分实现与复现证据，但无法从静态截图直接读取浏览器内部类型。
- 员工搜索输入改为非身份语义的搜索字段，使用唯一业务字段名、`autocomplete="one-time-code"`、`data-form-type="other"`、主流密码管理器忽略标记以及关闭自动纠错/自动大写，降低浏览器将其识别为姓名或地址字段的概率。
- 应用内员工列表改为 `position: fixed` 的自适应弹层，实时测量输入框、右侧控制台和可视视口；宽度被限制在所属业务面板内，并监听窗口、可视视口、滚动和尺寸变化。
- 当下方空间不足时自动向上展开；上下两种方向都限制最大高度并保留内部滚动，不再覆盖面板外的发布、开始处理或关联应用区域。
- 新增 ArrowUp、ArrowDown、Enter、Escape 键盘操作和活动项语义；单选与多选员工组件共用同一边界策略。

### Visual and interaction verification

- 1366 × 1024 实测：右侧控制台范围 `x=1050..1356`，菜单范围 `x=1058.67..1347.33`；菜单相对视口和控制台的左、右、上、下越界量全部为 0。
- 1366 × 700 实测：下方空间不足时菜单切换为 `placement-up`，范围 `y=175.68..485.34`；视口和控制台四边越界量仍全部为 0。
- 键盘实测：打开验证人列表后 ArrowDown 移动活动项，Enter 选择员工并关闭列表；本次仅修改页面草稿状态，没有点击保存。
- 独立新标签页重新加载后，浏览器控制台 error 为 0、warning 为 0；页面中的人员菜单为应用自有列表，未再次出现浏览器身份/地址建议层。
- 同屏局部对照确认：修复前浏览器菜单横跨业务面板且遮住后续字段；修复后菜单与右侧控制台等宽内缩，层级、滚动条、分组标题和员工行均完整可见。

### Iteration history

1. 第一轮把列表改为自适应定位后，真实测量发现旧 `.employees` 最小宽度仍覆盖行内宽度，菜单超出控制台 31.33 px、超出视口 12.67 px。
2. 增加 `.employees.adaptive { min-width: 0; }` 并统一 `box-sizing: border-box`，第二轮在目标视口复测，所有越界指标归零。
3. 在矮视口补测向上展开，在独立新标签补测控制台日志，并把参考图与最终实测图放入同一对照输入后完成最终视觉判断。

### Final severity check

- P0：无。
- P1：无。
- P2：无。

final result: passed

## 2026-08-19 生产数据总表交互化报表中心

### 来源与统计边界

- 用户 Excel 参考图：`C:\Users\31175\.codex\attachments\988c3ea7-f112-4d66-864b-b7b4edca1b83\image-1.png`、`C:\Users\31175\.codex\attachments\988c3ea7-f112-4d66-864b-b7b4edca1b83\image-2.png`。
- 参考内容已完整映射为班组工时利用率、周计划批次达成、周计划数量达成、每日出勤、员工逐日达成率、月均和每日平均。
- Excel 中重复的 `2026-08-18` 区块按模板重复处理，界面改为动态月份与日期，不复制错误日期。
- 金额、产值和单价没有权威数据源，因此本版不展示虚构金额；正式达成仅使用已确认考勤、标准工时和最终工序良品数据。

### 实现与视觉证据

- 主验收截图：`artifacts/report-center-data-20260819/summary-1366x1024.png`。
- 完整个人矩阵：`artifacts/report-center-data-20260819/matrix-1366x1024.png`。
- 补充平板视口：`artifacts/report-center-data-20260819/summary-1024x1024.png`。
- Excel 来源与实现同屏对照：`artifacts/report-center-data-20260819/source-implementation-comparison.png`；两张来源图保持原比例并放入左侧上下区域，实现图保持原生 1366 × 1024，不做单轴拉伸。
- 1366 × 1024 主视口和 1024 × 1024 补充视口均无页面级横向或纵向溢出；卡片内部对大表格使用明确滚动区，固定班组、岗位、姓名列。
- 低于 85%、85–94.9%、95–100%、100–110% 和高于 110% 分别使用红、黄、绿、蓝紫语义色；高于 110% 明确标记为复核，不作为单纯优秀状态。
- 总览采用紧凑四区布局，班组工时行自动填满可用高度，周计划、出勤趋势和最近八天个人热力图同屏无留白。

### 交互与回归

- 浏览器真实点击通过：数据总览、班组工时、周计划达成、出勤分析、个人达成矩阵。
- 月份前后切换、本月恢复、日期切换、班组筛选、关键字筛选和当前视图 CSV 导出均已验证；导出成功提示可见。
- 实际 PostgreSQL 验收数据返回 12 名员工、4 个班组、月度考勤、工时、13 个计划批次和最终工序完成数据；接口与页面统计一致。
- 1366 × 1024 与 1024 × 1024 下 `document.body.scrollWidth === clientWidth`、`scrollHeight === clientHeight`。
- 浏览器应用 error 日志为 0；TypeScript、生产构建和相关单元测试通过。
- P0：无；P1：无；P2：无。

passed

## 2026-08-19 报表中心分支工作台 v1.34.24

### 目标、事实边界与验收环境

- 用户问题图：`C:\Windows\TEMP\codex-clipboard-13826a0f-8545-4379-9984-4a875db29fdb.png`。原页面把多个分析域、七张指标卡、图表和宽矩阵同时压进单页；问题不是“没有数据”，而是数据层级、分析任务和可用宽度没有分开。
- 主验收视口：1366 × 1024 CSS px；补充视口：1024 × 1024 CSS px；浏览器为 Codex 应用内浏览器。
- 验收数据来自任务专用 PostgreSQL 容器，完整应用 84 个 Prisma migration，并写入 12 名员工、12 个量产订单、6 类异常和 6 个样品任务。未修改生产数据库，也未切换当前 Sealos 部署。
- 金额类指标继续明确显示“未启用”；当前数据模型没有可靠单价或产值字段，不用估算金额伪装真实经营数据。

### 分支结构与交互

- 报表中心拆分为七个一级分支：决策总览、生产总表、生产交付、人员工时、质量异常、数据治理、样品资料；每个分支只加载对应接口和数据域，避免切换单一页面时预加载无关接口并产生伪错误。
- 每个分支最多保留四张上下文 KPI，指标卡可点击下钻；生产、人员、质量和样品分支具备二级视图，宽表与矩阵只在其专属分支出现。
- 周期、日期、月份、客户、班组、生产类型、密度、一级分支和二级视图写入 URL；刷新、前进/后退和复制链接可以恢复相同分析状态。
- 标准/舒展密度切换、专注模式、关键词筛选、客户/班组筛选、详情抽屉、CSV 导出和内部滚动区均完成真实浏览器点击验证。
- 样品字段继续全部选填；未填写不算缺项，不要求固定原因。分项审核同时显示逾期审核项和普通待审核项，只让实际提交的数据进入审核。

### 视觉证据与同屏对照

- 生产总表：`artifacts/report-center-v13424/operations-summary-1366x1024.png`；1024 px 复验：`operations-summary-1024x1024.png`。
- 决策总览：`overview-1366x1024.png`；生产趋势与工单：`production-trend-1366x1024.png`、`production-orders-1366x1024.png`。
- 人员、质量、数据治理：`people-attainment-1366x1024.png`、`quality-overview-1366x1024.png`、`governance-1366x1024.png`。
- 样品任务与分项审核：`sample-tasks-1366x1024.png`、`sample-review-1366x1024.png`；后者真实显示一条逾期审核和一条普通待审核。
- 专注模式与详情抽屉：`focus-mode-1366x1024.png`、`detail-drawer-1366x1024.png`。
- 问题图与最终实现同屏输入：`source-implementation-comparison.png`。参考图保持原比例放入 1366 × 1024 面板，没有单轴拉伸；实现端为原生 1366 × 1024 截图。

### 可读性、密度与响应式结论

- 原页面七张横向指标卡改为最多四张；表格标题、关键数值、状态与辅助信息建立稳定层级，不再把所有维度压在一张巨型报表上。
- 1366 × 1024 下七个分支都占满有效工作区，没有无意义的大面积首屏留白；数据较少的分项审核保留自然空区，不伪造任务填充页面。
- 1024 × 1024 下页面级 `scrollWidth === clientWidth === 1024`，宽表仅在自身容器中横向滚动，不推动整页溢出。
- 同屏对照后未发现主操作遮挡、表头重叠、内容裁切、按钮跑位、异常圆角或页面级横向溢出。

### 诊断与发布前检查

- 浏览器真实交互覆盖七个一级分支、生产工单、样品分项审核、密度切换、专注模式、详情抽屉和 URL 状态恢复；应用页面未出现加载失败提示。
- TypeScript 通过；报表与导航专项测试 13 / 13 通过；完整单元测试 783 项中 743 通过、40 项数据库条件测试按环境跳过、0 失败；Linux Docker 生产构建完整通过。ESLint 仅保留 3 条本次未改文件中的既有 `<img>` 性能提醒。
- P0：无；P1：无；P2：无。

final result: passed

## 2026-08-19 全局导航与计划类型默认收起 v1.34.22

### 对照对象与验收环境

- 变更前基线：`artifacts/workbench-navigation-defaults-v13422/00-before-sidebar-and-mode-open-1366x1024.png`，由提交 `3c44b7482dcc405fc538cf406ac0d5f2988993fe` 的隔离工作树复现“平台侧栏与计划类型同时展开”。
- 变更后默认态：`artifacts/workbench-navigation-defaults-v13422/01-plan-default-collapsed-1366x1024.png`。
- 交互状态：`02-plan-sidebar-open-1366x1024.png`、`03-plan-mode-drawer-open-1366x1024.png`。
- 跨模块与样品分支：`04-drawing-library-default-collapsed-1366x1024.png`、`05-sample-plan-default-collapsed-1366x1024.png`。
- 参考和实现以同一浏览器、同一输入完成并排复核；视口为 1366 × 1024 CSS px。

### 行为与布局检查

- 计划中心直接进入时，平台导航保持 72 px 收起栏，计划类型抽屉不渲染，URL 不再自动附加 `chooseMode=1`。
- 打开平台导航后宽度为 224 px；再打开计划类型时平台导航自动收回 72 px。反向操作同样成立：计划类型打开时展开平台导航，类型抽屉立即关闭。
- 从展开的平台导航进入图纸资料库后，新模块以 72 px 收起栏加载；样品计划和生产执行直接进入时也均为 72 px 收起栏，模式抽屉为关闭状态。
- 1366 × 1024 下计划中心、样品计划、生产执行和图纸资料库均无整页横向溢出；计划表格保留自身的受控横向滚动，不再由左侧导航和顶部类型区共同挤压工作区。
- 页面仍保留明确的展开入口；用户主动打开的侧栏和计划类型状态均可正常操作，不以持久化的旧侧栏偏好覆盖新页面默认态。

### 视觉与可用性检查

- 字体、橙色主题、卡片圆角、阴影、间距和既有图标体系全部沿用项目设计系统，没有引入新的视觉语言。
- 默认态释放左侧 152 px 和顶部模式区高度，计划表头、筛选区、数据对账区及主表获得完整可用宽度。
- 展开态与类型抽屉态分别单独占用空间，不再出现变更前两层同时展开造成的内容压缩。
- 所有目标页面控制台 error：0；根页面 `scrollWidth` 等于 1366 px。

### 最终严重度检查

- P0：无。
- P1：无。
- P2：无。

final result: passed

## 2026-08-19 生产执行默认聚焦布局

### Sources and target

- 用户问题截图：`C:\Windows\TEMP\codex-clipboard-df06a6f3-ee1e-44c2-9f0f-594f98edac67.png`。
- 目标视口：1366 × 1024 横向平板，设备像素比 1。
- 最终默认态：`artifacts/production-execution-default-layout-qa-20260819/01-default-1366x1024.png`。
- 交互态截图：
  - `artifacts/production-execution-default-layout-qa-20260819/02-sidebar-open-1366x1024.png`
  - `artifacts/production-execution-default-layout-qa-20260819/03-mode-drawer-1366x1024.png`
  - `artifacts/production-execution-default-layout-qa-20260819/04-insights-overlay-1366x1024.png`
- 用户截图和最终默认态已在同一视觉比较输入中按原比例核对；未对截图做非等比拉伸。

### Required fidelity surfaces

- 首次进入生产执行时，左侧导航固定为收起态，不再继承其他页面的展开偏好。
- 顶部业务模式默认不展开；仍可通过标题旁“量产”触发器主动打开。
- 右侧调度建议默认不展开；1366 宽度下主动打开时使用覆盖式侧栏，不压缩工单列表。
- 默认态工单区域宽 1276 px；调度侧栏打开后仍为 1276 px，页面无横向文档溢出。
- 左侧导航、业务模式和调度侧栏实行互斥：打开任意一项会收起另外两项。

### Interaction and diagnostics

- 真实点击通过：导航展开、点击当前“生产执行”收起导航且不打开业务模式、业务模式打开、调度侧栏打开/关闭。
- 调度侧栏在 1366 宽度下计算样式为 `position: fixed`，打开时锁定背景滚动，关闭后恢复。
- 页面默认态、导航态、业务模式态和调度侧栏态均无页面级横向溢出。
- 验收使用隔离 PostgreSQL，完整应用 82 个 Prisma migration；隔离库无当前周生产工单，因此本次只核验布局和交互，不把空数据当作生产数据结论。
- Codex 应用内浏览器对本机地址连续导航超时，按降级路径使用独立无用户资料的 Chrome Headless/CDP 会话完成同尺寸渲染与交互验证。

### Iteration history

1. 将生产执行的平台导航改为受控状态，确保每次进入默认收起，同时保留手动展开和 Escape 收起。
2. 移除 1280 px 自动打开调度侧栏的副作用，并将 1920 px 以下改为覆盖式侧栏。
3. 将生产执行侧栏入口改为只收起当前导航，不再联动打开业务模式；计划中心和仓库的既有入口行为保持不变。
4. 增加三面板互斥逻辑和源代码契约测试，再以 1366 × 1024 真实页面逐项复测。

### Final severity check

- P0：无。
- P1：无。
- P2：无。

final result: passed

## 2026-08-19 日出货计划优先级与上日遗留（方案三）

### 验收对象与状态

- 选定参考图：`C:\Users\31175\.codex\generated_images\019ffdba-e78a-7b03-9221-077ebc3c072b\exec-2e18a095-824d-451a-9a93-a7e51854a8c3.png`（用户确认的第三种方案）。
- 最终实现：`artifacts/daily-shipment-priority-qa-20260819/implementation-1366x1024-final.png`。
- 同视口全屏对照：`artifacts/daily-shipment-priority-qa-20260819/comparison-final.png`。
- 添加订单与优先级交互：`artifacts/daily-shipment-priority-qa-20260819/drawer-priority-selection-1366x1024.png`。
- 验收视口：1366 × 1024 CSS px；截图像素 1366 × 1024；浏览器 DPR 1.5。状态为展开平台导航、2026-08-19 已确认计划、红黄蓝三档订单、2 批上日遗留、1 批已完成。

### 业务实现

- 日出货计划项独立保存紧急、优先、常规三档优先级，展示为红、黄、蓝，并在服务端稳定按优先级、遗留状态和完成状态排序，不能只依赖前端排序。
- KPI 区拆分计划订单、计划数量、三档优先级、上日遗留、已完成和实际已出货；工具栏可按优先级、进度、关键词及“仅看遗留”组合筛选。
- 上一日已确认计划只结转未出货数量；历史实发流水留在原日期。目标日继承优先级、来源日期、连续遗留天数和来源计划项，来源计划标记为“已结转关闭”。
- 重复打开目标日使用确定性对账，不重复创建遗留项；批次可排数量按“历史实发 + 当前有效计划”计算，避免结转前后重复占用。
- 已结转来源禁止撤销历史实发，避免已形成的来源/目标链数量失真；人工结转与首次打开次日自动对账共用同一服务逻辑和审计记录。
- Prisma 迁移新增优先级、结转状态和自关联来源链，文件元数据及业务数据仍使用既有 PostgreSQL 体系，没有新增本地持久化文件方案。

### 五项保真检查

- 字体与排版：沿用项目现有中文字体、橙色主题和 Lucide 图标；KPI、遗留横幅、筛选栏和连续表格的层级与参考图一致。
- 间距与布局：侧栏保持展开，主区从周日期、KPI、遗留提示、工具栏到列表连续排列；最终表格行高由 78 px 收紧到 68 px，使已完成分区在 1024 px 高度内完整出现。
- 颜色与表面：紧急红、优先黄、常规蓝同时用于标签与左边缘，遗留使用浅暖背景，实发使用绿色，语义不只依赖文字。
- 图像与图标：本页没有照片或插画需求；导航、提醒、出货、完成等图标全部复用项目已有 Lucide 图标，没有手绘 SVG、占位图或 CSS 图案资产。
- 文案与内容：明确区分“上日遗留”“已结转至次日”“部分出货”“已完成”；参考图与实现中的批次数量差异来自隔离验收数据，不是布局或业务口径差异。

### 同屏比较与迭代

1. 第一轮对照发现实现处于收起侧栏状态，与方案三参考图不一致；恢复展开导航后重新截图。
2. 第二轮发现完成订单仍混在主列表末尾，信息分组不够清晰；新增“已完成”分区条，同时保留完成订单及历史流水。
3. 第二轮还发现 78 px 行高导致完成区只露出一部分；收紧到 68 px 后，8 条进行中记录、完成分区和完成记录均在同屏可见。
4. 最终全屏对照已经覆盖顶部、KPI、遗留横幅、筛选、优先级表格和完成分区。未另做局部裁切，因为参考素材是单张完整页面且关键区域在同一比例下均可直接判读；参考图未包含添加抽屉，因此抽屉以独立真实交互截图验收。

### 交互、响应式与诊断

- 真实浏览器点击：紧急筛选后只剩 3 条紧急记录且无非紧急记录；“查看遗留”后只剩 2 / 9 批且全部带来源标记。
- 8 月 20 日空计划可打开“添加本周订单”抽屉，勾选可排批次后显示紧急/优先/常规三档，实际切换为“优先”后 `aria-checked=true`；验收未提交测试订单。
- 1366 × 1024 最终测量：页面与文档 `scrollWidth=1366`，主列表 `clientWidth=scrollWidth=1111`，无页面横向溢出或内部遮挡；浏览器控制台 error 为 0。
- TypeScript、ESLint、8 项日出货规则单测和生产构建通过；ESLint 仅保留 3 条与本功能无关的既有 `<img>` 性能提醒。
- 新迁移已在空 PostgreSQL 上顺序应用；日出货数据库集成测试 2 / 2 通过，覆盖只结转待出数量、优先级继承、来源链、容量释放和幂等。

### 最终严重度检查

- P0：无。
- P1：无。
- P2：无（侧栏状态、完成分区和列表密度均已修正并复验）。

final result: passed

## 2026-08-18 历史计划直接删除玻璃弹窗

### 验收对象

- 选定源图：`C:\Users\31175\.codex\generated_images\019ffdba-e78a-7b03-9221-077ebc3c072b\exec-6e2e52f8-4ad3-42ce-9ff5-35817d50f3b5.png`（方案二，中置确认弹窗）。
- 最终实现：`artifacts/production-plan-direct-delete-20260818/modal-1366x1024-final.png`。
- 确认码有效状态：`artifacts/production-plan-direct-delete-20260818/modal-1366x1024-confirmed.png`。
- 窄屏适配：`artifacts/production-plan-direct-delete-20260818/modal-390x844-fixed.png`。
- 同输入对照：`artifacts/production-plan-direct-delete-20260818/source-implementation-comparison.png`。
- 主验收视口：1366 × 1024 CSS px，DPR 约 1；窄屏复验视口：390 × 844 CSS px。

### 设计与功能

- 历史计划行新增“删除订单”，不再按计划、仓库、工艺、开工或完成状态阻断。
- 弹窗保留源图的居中危险确认、订单身份、自动处理清单、选填说明、确认码和双操作区，并按用户要求强化为半透明玻璃表面、背景模糊、内高光、空间阴影和指针跟随的 3D 轻微倾斜。
- 删除说明可为空且最长 300 字；确认码少于或不等于 `111` 时“立即删除”保持禁用，精确输入 `111` 后启用。
- 后端在一个 Serializable 事务内软删除计划订单、批次及关联工单，关闭未完成的日计划、出货和物料跟进任务，撤销遗留项；图纸、产品资料、报工台账和审计快照保留。
- `111` 仅作为防误操作确认码，不被描述为账户安全密码；操作仍要求登录，并记录操作者、时间、选填说明、删除前快照和影响范围。

### 五项保真检查

- 字体与排版：沿用项目既有中文字体栈；标题、订单规格、四条处理项、字段标签和底部操作层级清晰，1366 视口无裁切或异常换行。
- 间距与布局：弹窗宽 640 px、高约 658 px，居中且与源图比例接近；说明与确认码在横屏并排，390 px 下自动改为单列，页面 `scrollWidth` 等于视口宽度。
- 颜色与表面：保留白、灰蓝和危险红语义，同时加入透明玻璃、28 px 模糊、柔和高光和 3D 阴影；未用装饰性插图转移危险操作注意力。
- 图像与图标：本功能没有照片或插画；删除、完成、归档、审计、关闭图标均使用项目既有 Lucide 图标，尺寸和描边一致，没有手绘 SVG 或占位资产。
- 文案与内容：明确区分“后续执行移除”和“产品资料、报工与审计记录保留”，说明为选填；不可恢复提示指向变更记录快照，避免把软删除误解为无审计的物理清除。

### 行为、响应式与可访问性

- 浏览器真实验证：历史周进入、删除弹窗打开、`11` 禁用、`111` 启用、Escape 关闭、关闭后焦点返回原“删除订单”按钮。
- 指针从中心移动到弹窗右上区域时，玻璃表面的 computed transform 从近零旋转变化为实际 `matrix3d`，确认 3D 反馈不是静态装饰。
- 弹窗具备 `role=dialog`、`aria-modal`、标题/说明关联、焦点循环、输入帮助、错误提示和 `prefers-reduced-motion` 降级。
- 390 × 844 初验发现 P2：平台侧栏层级高于弹窗，遮挡弹窗左侧并未被背景模糊覆盖；将计划弹层统一提升到全局 modal 层级后复验，弹窗完整可见且全应用背景一致变暗。
- 1366 × 1024 最终测量：弹窗边界 x=363..1003、y=183..841，页面无横向溢出；弹窗 z-index 2001，高于平台侧栏 602。
- 浏览器控制台 error/warn：0。真实 PostgreSQL 集成测试覆盖已完成历史订单、空删除说明、关联遗留撤销及资料/台账保留，并在事务内回滚测试夹具。

### 最终严重度检查

- P0：无。
- P1：无。
- P2：无（侧栏遮挡已修复并复验）。

final result: passed

## 2026-08-18 量产/样品下拉抽屉

### 验收范围

- 参考问题图：`codex-clipboard-cdff8573-706d-4a9b-892e-7663d2e7d508.png`。
- 实现截图：`output/module-mode-drawer-v1348/production-mass-drawer-1366x1024.png`。
- 对照图：`output/module-mode-drawer-v1348/source-vs-production-comparison.png`。
- 覆盖生产执行、计划中心和仓库管理；模式统一为量产/样品，仓库样品模式命名为“样品物料准备”。

### 视觉与布局

- 在 1366×1024、1024×768、760×900 三组视口完成真实页面检查。
- 抽屉使用正常文档流向下展开，不使用 fixed/absolute 覆盖业务内容。
- 生产执行打开抽屉后，工作区整体下移 140 px；抽屉与后续内容保持 6–10 px 可见间距。
- 计划中心抽屉底部与后续内容间距 8 px；样品执行抽屉底部与空状态间距 10 px。
- 1024 px 和 760 px 宽度下选项可自适应，未出现横向滚动、裁切或重叠。
- 生产调度中心标题完整显示；仓库工作区不再保留多余空白网格行。
- 与问题图并排复核后，原先顶部控件互相遮挡的问题已消除。

### 交互与业务边界

- 点击当前模块入口或页面模式按钮可展开/收起抽屉；`Escape` 可关闭，当前模式具备选中态与键盘焦点。
- 跨模块导航会保留量产/样品上下文，并在目标模块打开模式抽屉；关闭时清理一次性的 `chooseMode=1` 参数。
- 样品物料准备仅展示可选辅料、过程照片与正式资料状态，不提供正式领料、库存扣减、必填原因或任务启停动作。
- 最终页面控制台 error 为 0；TypeScript、ESLint、生产构建、单元测试和数据库集成测试通过。
- 测试数据库和对象存储均使用独立临时环境，未写入生产数据。

### 验收中修正

- 修正仓库页面在抽屉展开后预留隐藏网格行、导致内容区高度被压缩的问题。
- 修正生产执行标题在窄列中被截断的问题。

final result: passed

## 2026-08-18 报表中心数据驾驶舱 v1.34.9

### 验收对象与数据边界

- 已确认设计稿：`C:\Users\31175\.codex\visualizations\2026\08\14\019ffdba-e78a-7b03-9221-077ebc3c072b\report-center-dashboard-v1\report-center-1366x1024-final.png`。
- 真实实现：`artifacts/report-center-v1349/report-center-implementation-1366x1024.png`。
- 同输入全屏对照：`artifacts/report-center-v1349/report-center-source-implementation-comparison.png`。
- 分视图取证：`artifacts/report-center-v1349/report-center-people-1366x1024.png`、`artifacts/report-center-v1349/report-center-sample-1366x1024.png`。
- 验收视口：1366 × 1024 CSS 像素，横向平板；隔离 PostgreSQL 已应用全部 79 个 Prisma 迁移并加载量产、工序、考勤、异常与样品审核数据。
- 当前数据模型没有可靠的单价、销售额或产值字段，因此金额指标明确显示为“未启用”，未用估算数伪装真实产值。

### 数据口径与功能

- 数量达成率：计划优先读取已下达计划批次，无批次时读取工单计划量；完成量只汇总每条路线最终工序良品，避免多工序重复计数。
- 生产与交付：展示周期趋势、任务状态、工序待处理量、交期风险和工单详情抽屉。
- 人员与工时：复用已确认考勤、标准工时与自动记工台账，不把未匹配或未确认记录伪装为效率。
- 质量与异常：展示真实异常分类、事件时长、影响人时、品质确认与关闭状态。
- 数据治理：分开呈现工艺路线、标准工时、当前图纸、辅料规则和样品分项审核；辅料与样品空白字段保持选填，不计作缺项。
- 样品资料：只对已实际提交的数据和照片计算审核进度；未填写字段不产生固定原因或强制补录。

### 视觉对照与修正

1. 第一轮实现保持设计稿的单层命令栏、五分类导航、周期带、六指标、趋势/状态双区、三块诊断面板和底部重点表格。
2. 同屏对照发现测试数据使人员指标超过 100%，调整隔离样本后保持合理演示范围，不改变生产算法。
3. 业务复核发现已完成任务仍可能被标成“临近交期”，修正为低风险“已完成”并增加单元测试。
4. 样品交期是数据库日期字段，原显示会附带时区产生的 `08:00`；最终样品交期只显示日期，量产计划时间仍保留时分。
5. 客户筛选仅影响量产、样品和资料数据；人员与异常明确标注全厂口径，人员/质量页用口径标签替代无效筛选控件。
6. 无计划批次的历史未完成工单并入周期首日计划量，避免当期完成量包含遗留工单而计划分母遗漏。
7. 1366 × 1024 下命令栏、筛选、图表、资料完整度内滚动区和重点表格均无重叠、横向溢出或内容遮挡。

### 交互与诊断

- 浏览器真实点击通过：综合总览、生产与交付、人员与工时、自动记工明细、质量与异常、样品资料。
- 筛选通过：今日/本周/本月、量产+样品/仅量产/仅样品、客户筛选、关键词过滤和刷新。
- 操作通过：详情抽屉打开/关闭、当前筛选 CSV 导出、样品仅量产提示、业务详情入口。
- 隔离数据验收：量产工单 10 条、生产员工 5 人、异常事件 5 条、样品任务 5 条；自动记工和分项审核均有真实持久化记录。
- 浏览器控制台应用 error/warn：0；服务端请求日志无报表异常。
- TypeScript、ESLint、生产构建和完整单元测试通过；单元测试 746 项，710 通过、36 项数据库条件测试按环境跳过、0 失败。

### 最终严重度检查

- P0：无。
- P1：无。
- P2：无。

final result: passed

passed

## 2026-08-21 问题协同作战室（方案三）

### 验收对象与数据状态

- 选定概念图：`C:\Users\31175\.codex\generated_images\019ffdba-e78a-7b03-9221-077ebc3c072b\exec-a8597e9a-d762-4057-b6c2-892086004981.png`。
- 概念图归档：`artifacts/issue-collaboration-case-room-20260821/selected-concept-3.png`。
- 最终实现截图：`artifacts/issue-collaboration-case-room-20260821/implementation-1366x1024.png`。
- 同屏对照：`artifacts/issue-collaboration-case-room-20260821/source-vs-implementation.png`。
- 验收视口：1366 × 1024 CSS px，截图密度 1×。
- 验收状态：一条处理中质量问题；包含已完成任务、待办任务、待决策事项和缺少现场证据的闭环阻断；桌面端闭环控制台默认展开。

### 设计与结构对照

- 方案三的三栏协同骨架已经真实落地：左侧按“需我处理 / 等待他人 / 待验证”分组的问题队列，中间连续协作时间线，右侧闭环控制台。
- 中间时间线不再只是静态处理记录；回复、任务、决策和附件均使用同一持久化活动流，任务卡、决策卡和证据卡在上下文中连续呈现。
- 右侧控制台集中展示生命周期、闭环清单、负责人、协同人、验证人、优先级、截止时间、关联工单/图纸/变更和证据资料，不再把闭环信息拆散到多个无反馈区域。
- 延续项目既有深蓝导航、橙色主操作、浅灰工作台、白色卡片和 Lucide 图标；在 1366 × 1024 下保持高密度但可读，未发现页面级横向溢出、主栏遮挡、按钮裁切或异常留白。
- 概念图中的照片和文件是设计示意；验收数据没有真实附件，因此实现不伪造现场照片。生产使用时仅通过既有 S3 对象存储附件接口呈现真实证据。

### 闭环与协同能力

- 新增结构化协同动作：普通回复、创建任务、完成任务、发起决策、同意决策、退回补充；活动详情以不可变 JSON 记录在问题时间线中。
- 任务绑定真实员工，完成动作校验当前用户；任务记录保存负责人姓名，后续人员资料变化也不会破坏历史可读性。
- 决策卡显示待决策或已形成结论，响应后立即写入共享时间线并刷新所有登录账号可见的同一问题数据。
- 问题新增独立验证人。非重大问题从处理中进入待验证前必须具备负责人、原因分析、处理方案、证据附件和验证人；最终关闭由选定验证人或质量流程人员执行。
- 闭环清单不是前端装饰：同一组服务端规则阻止证据或责任信息不完整的问题越级进入验证，并通过通知系统提醒负责人、协同人和验证人。
- 关联工单、图纸资料和变更管理保留真实深链；没有关联数据时明确显示未关联，不构造虚假业务入口。

### 真实交互与诊断

- 筛选抽屉已实测打开与关闭，关闭后页面不残留遮挡层。
- 回复、任务和决策三个编辑模式已实测切换，输入区和操作文案随模式同步变化。
- 实测决策同意后待决策数量归零；实测任务完成后待办按钮归零，生命周期同步从 5 / 7 更新为 6 / 7（86%）。
- 缺少证据时“提交验证”保持禁用，验证清单明确定位缺项，未允许前端绕过。
- 桌面闭环控制台默认展开，`aria-expanded=true`；窄屏仍可收起为抽屉式上下文区。
- 浏览器控制台应用 error/warning：0。
- `npx tsc --noEmit`、问题管理单元测试 12 / 12、生产构建和 `git diff --check` 均通过；构建仅保留 3 条与本功能无关的既有 `<img>` 性能提醒。
- 新 Prisma 迁移已在本地隔离 PostgreSQL 上按顺序应用并通过 schema 验证；没有修改线上或生产数据库。

### 迭代记录

1. 第一轮真实页面发现活动流暴露 `created` 等内部动作值和技术来源码，改为中文业务标签与可读来源名称。
2. 任务负责人原来只依赖当前员工列表解析，补充持久化负责人姓名，避免历史记录出现“未识别”。
3. 桌面端右栏视觉已展开但 `aria-expanded` 仍为 false，统一断点状态同步后重新验证。
4. 完成任务和通过决策后重新加载页面，确认生命周期、待办数量和活动流来自服务端持久化结果，而非临时前端状态。

### 最终严重度检查

- P0：无。
- P1：无。
- P2：无。

final result: passed
