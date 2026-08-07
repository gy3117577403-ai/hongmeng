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
