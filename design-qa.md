# 日出货计划启用日与预警窗口视觉验收

## 验收范围

- 当日出货计划：仅承接 `2026-09-01` 起、交期不晚于所选日的未完成订单；按原客户交期分组，逾期余额滚动到当天。
- 未来 3 天预警：固定从启用日开始，覆盖基准日后 3 天；同时保留已完成、未完成和历史预期订单。
- 信息层级：客户名称和产品规格为主信息，工单号缩写为辅助信息，悬停或聚焦显示完整工单号，点击可复制。
- 状态安全：内部技术值不直接显示给用户；`frontend` 等值统一转换为中文业务状态。

## 对照材料

- 原始当日空白状态：`C:/Windows/TEMP/codex-clipboard-fb7580c0-9f6c-48d6-a8b1-410377a3b85c.png`
- 原始预警污染状态：`C:/Windows/TEMP/codex-clipboard-4ef54c34-1348-43cf-9938-e991bb2b0cfc.png`
- 当日实现截图：`artifacts/daily-shipment-cutover-v134113/implementation-today-iab.jpg`（1057 × 898）
- 预警实现截图：`artifacts/daily-shipment-cutover-v134113/implementation-warning-iab.jpg`（1280 × 720）
- 同图对照：`artifacts/daily-shipment-cutover-v134113/comparison-today.png`、`artifacts/daily-shipment-cutover-v134113/comparison-warning.png`

## 可见性与交互验收

- [x] 当日页不再是无数据空白态，展示 9/1、9/2、9/3 三个交期分组及真实样例数据。
- [x] 9/4 交期订单不会混入 9/3 当日操作清单；未来订单仅在预警页展示。
- [x] 预警页标题、指标和列表范围统一为 9/1—9/6（基准日 9/3 + 未来 3 天）。
- [x] 预警列表同时展示已完成、部分已发、生产中和未开工状态。
- [x] 点击“已完成 1”后列表从 `5 / 5 批` 收敛为 `1 / 5 批`，筛选状态和结果同步。
- [x] 长工单号在窄屏缩写，不挤压客户和产品规格；完整值仍可通过悬停、键盘聚焦和点击复制访问。
- [x] 1057 × 898 与 1280 × 720 实际浏览器视口下未发现文本重叠、横向溢出、卡片裁切或不可点击主操作。
- [x] 沿用现有橙色、圆角、玻璃高光和 2.5D 阴影，不引入另一套视觉语言。

## 问题分级

- P0：0
- P1：0
- P2：0
- P3：0

## 验收历史

1. 原始问题：当日计划为空；预警把启用日前订单纳入，出现大量 7 月历史订单和内部技术状态。
2. 第一次实现：加入 2026-09-01 启用边界、自动修复关联、当日累计窗口和完整预警状态。
3. 最终复核：同图比较确认主要信息层级、日期范围、分组结构和玻璃质感符合本项目既有设计；已完成筛选交互单独验证通过。

## 历史设计验收记录：v1.34.111 四分支初版

### 对比目标与证据

- source visual truth path:
  - `C:\Users\31175\.codex\generated_images\01a05fe5-fde4-7013-9ca0-6fd16f31f27f\exec-6b1dfd97-74ba-4833-af9e-6dbb1e33b0d2.png`（当日出货计划）
  - `C:\Users\31175\.codex\generated_images\01a05fe5-fde4-7013-9ca0-6fd16f31f27f\exec-c773eb55-6c18-43f2-8926-0bbce7b668bd.png`（未来 3 天预警）
  - `C:\Users\31175\.codex\generated_images\01a05fe5-fde4-7013-9ca0-6fd16f31f27f\exec-963daf8f-fd3e-4518-9bc9-d5563ddfa13c.png`（连续顺延）
- implementation screenshot path:
  - `artifacts/daily-shipment-v134111/implementation-today-1366x1024.png`
  - `artifacts/daily-shipment-v134111/implementation-warning-1366x1024.png`
  - `artifacts/daily-shipment-v134111/implementation-carryover-expanded-1366x1024.png`
  - `artifacts/daily-shipment-v134111/implementation-history-1366x1024.png`
- viewport: `1366 × 1024` CSS px，deviceScaleFactor `1`。
- pixel dimensions and normalization:
  - 当日参考图 `1448 × 1086`，按同一宽高比归一化为 `1366 × 1024`。
  - 预警与顺延参考图均为 `1449 × 1086`，归一化为 `1366 × 1024`。
  - 浏览器实现截图均原生输出 `1366 × 1024`，未二次缩放。
- state: 基准日 `2026-09-03`；使用同一组可重复的设计验收夹具，覆盖今日到期、部分已发、历史逾期、明日到期、连续顺延和已发送历史。
- full-view comparison evidence:
  - `artifacts/daily-shipment-v134111/comparison-today-full.png`
  - `artifacts/daily-shipment-v134111/comparison-warning-full.png`
  - `artifacts/daily-shipment-v134111/comparison-carryover-full.png`
- focused region comparison evidence:
  - `artifacts/daily-shipment-v134111/comparison-warning-focus.png`
  - `artifacts/daily-shipment-v134111/comparison-carryover-focus.png`
  - 当日页不另做局部图：全屏对比中日期条、指标区、提示条、表头和所有数据行均可辨认。

### Findings

- 无剩余 P0 / P1 / P2 视觉问题。
- 字体与排版：沿用项目现有的中文系统字体栈、字重与紧凑型生产管理信息层级；日期、数量、状态和主操作形成稳定的视觉优先级。长订单号使用受控换行或截断，不挤压操作列。
- 间距与布局：四个分支共用同一导航骨架、日期基准卡、指标网格、提示条和数据表；1366 × 1024 下没有覆盖、横向截断或固定操作区被遮挡。实现比概念图更紧凑，是为保留现有左侧生产系统导航和同屏数据密度的有意调整。
- 色彩与视觉令牌：保留橙色主品牌；预警使用橙红语义色，顺延使用紫色，历史使用蓝灰色。透明玻璃只作用于大容器，配合浅色渐变、内高光和分层阴影形成 2.5D 效果，同时保留不支持 `backdrop-filter` 和高对比模式的回退。
- 图片和资产：参考界面没有产品照片、品牌插画或非标准位图资产；实现使用项目既有 Lucide 图标体系，没有用手绘 SVG、表情或 CSS 图形替换目标资产。
- 文案与内容：明确写出“只显示当前日期应出货及已顺延未出货任务”“未来订单只在预警中提前显示”“出货不影响生产报工结单”，避免把预警清单误认成当日执行清单。
- 状态与交互：四分支切换、日期切换、顺延轨迹展开/收起、发送弹窗打开/关闭均已在浏览器验证；发送弹窗显示正确的待发量和已完工量，验收过程未提交真实出货。
- 可访问性与响应：语义按钮保留键盘焦点，状态不仅依赖颜色；实现包含高对比与减少动画回退。密集表格在窄视口进入可滚动/重排模式，不隐藏核心操作。

### Comparison history

1. 第一轮发现 P2：出货历史表的“操作时间”列宽不足，`2026-09-03 16:25` 被截成 `202…`，无法用于现场追溯。
2. 修复：为历史表增加独立列布局并放宽时间列，保持状态、数量和操作人列不被压缩。
3. 修复后证据：`artifacts/daily-shipment-v134111/implementation-history-1366x1024.png`，完整日期时间可见；复查没有新的 P0 / P1 / P2 问题。

### Open questions

- “出货历史”没有单独的源视觉稿，因此该分支以同一设计系统、同一操作骨架和可追溯性要求作为验收基准，不声明逐像素还原。

### Implementation checklist

- [x] 精确交期关联到对应日期的日出货计划。
- [x] 未来订单仅进入 3 天预警，不提前混入当日清单。
- [x] 未发余量自动连续顺延，并保留逐日轨迹。
- [x] 发送与生产报工结单解耦。
- [x] 四分支共享统一玻璃 2.5D 视觉和操作结构。
- [x] 浏览器错误与警告控制台检查结果为空。

final result: passed
