# 日出货计划四分支设计 QA

## 对比目标与证据

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

## Findings

- 无剩余 P0 / P1 / P2 视觉问题。
- 字体与排版：沿用项目现有的中文系统字体栈、字重与紧凑型生产管理信息层级；日期、数量、状态和主操作形成稳定的视觉优先级。长订单号使用受控换行或截断，不挤压操作列。
- 间距与布局：四个分支共用同一导航骨架、日期基准卡、指标网格、提示条和数据表；1366 × 1024 下没有覆盖、横向截断或固定操作区被遮挡。实现比概念图更紧凑，是为保留现有左侧生产系统导航和同屏数据密度的有意调整。
- 色彩与视觉令牌：保留橙色主品牌；预警使用橙红语义色，顺延使用紫色，历史使用蓝灰色。透明玻璃只作用于大容器，配合浅色渐变、内高光和分层阴影形成 2.5D 效果，同时保留不支持 `backdrop-filter` 和高对比模式的回退。
- 图片和资产：参考界面没有产品照片、品牌插画或非标准位图资产；实现使用项目既有 Lucide 图标体系，没有用手绘 SVG、表情或 CSS 图形替换目标资产。
- 文案与内容：明确写出“只显示当前日期应出货及已顺延未出货任务”“未来订单只在预警中提前显示”“出货不影响生产报工结单”，避免把预警清单误认成当日执行清单。
- 状态与交互：四分支切换、日期切换、顺延轨迹展开/收起、发送弹窗打开/关闭均已在浏览器验证；发送弹窗显示正确的待发量和已完工量，验收过程未提交真实出货。
- 可访问性与响应：语义按钮保留键盘焦点，状态不仅依赖颜色；实现包含高对比与减少动画回退。密集表格在窄视口进入可滚动/重排模式，不隐藏核心操作。

## Comparison history

1. 第一轮发现 P2：出货历史表的“操作时间”列宽不足，`2026-09-03 16:25` 被截成 `202…`，无法用于现场追溯。
2. 修复：为历史表增加独立列布局并放宽时间列，保持状态、数量和操作人列不被压缩。
3. 修复后证据：`artifacts/daily-shipment-v134111/implementation-history-1366x1024.png`，完整日期时间可见；复查没有新的 P0 / P1 / P2 问题。

## Open questions

- “出货历史”没有单独的源视觉稿，因此该分支以同一设计系统、同一操作骨架和可追溯性要求作为验收基准，不声明逐像素还原。

## Implementation checklist

- [x] 精确交期关联到对应日期的日出货计划。
- [x] 未来订单仅进入 3 天预警，不提前混入当日清单。
- [x] 未发余量自动连续顺延，并保留逐日轨迹。
- [x] 发送与生产报工结单解耦。
- [x] 四分支共享统一玻璃 2.5D 视觉和操作结构。
- [x] 浏览器错误与警告控制台检查结果为空。

final result: passed
