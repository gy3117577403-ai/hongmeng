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
