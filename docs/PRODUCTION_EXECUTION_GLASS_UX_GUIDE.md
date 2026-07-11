# 生产执行玻璃工作台实现说明

版本：v1.16.4-production-execution-glass-ux
日期：2026-07-11
发布状态：本地候选，未部署 Sealos

## 滚动结构

生产执行页采用明确的三层滚动边界：

1. `.production-page`：`height: 100dvh`、纵向 Flex、`overflow: hidden`。
2. `.production-execution-main`：占用剩余高度，并设置 `min-height: 0`。
3. `.production-board-shell`：只允许横向滚动，1024px 下容纳最小 300px 的状态列。
4. `.production-column-list`：每列独立 `overflow-y: auto`，具有 `min-height: 0`、`overscroll-behavior-y: contain`、`touch-action: pan-y` 和稳定滚动条槽。

代码没有注册全局 `wheel` 拦截，也没有用普通 Dropdown 遮罩覆盖看板。

## 玻璃设计规则

背景使用低对比浅灰白、暖橙和浅蓝光感。`backdrop-filter` 仅用于顶部导航、周摘要、工具栏、状态列和普通浮层。工单卡片使用接近不透明白色、轻边框和单侧状态色条，不为每张卡片创建模糊图层。

不支持 `backdrop-filter` 时使用不透明背景；检测到 Android WebView 标识时主动关闭工作台模糊。卡片启用 `content-visibility: auto` 和固定内在尺寸，为数百条数据降低屏外绘制成本。

## 服务端筛选参数

| 参数 | 用途 |
| --- | --- |
| `view` | `board`、`today`、`exceptions` |
| `keyword` | 规格、客户、品名、内部订单号、来源订单号、进度备注 |
| `customer` | 可重复参数，支持客户多选 |
| `duePreset` | `today`、`tomorrow`、`overdue`、`week`、`custom` |
| `dueFrom` / `dueTo` | 自定义交期日期范围 |
| `stage` | 四阶段状态 |
| `priority` | `urgent`、`high`、`normal` |
| `drawing` | `issued`、`not_issued`、`unset` |
| `material` | `allocated`、`ready`、`not_ready`、`unset` |
| `documents` | `empty`、`partial`、`complete` |
| `weekStart` | 指定生产周 |

列表 API 和 CSV API 共同调用 `productionFiltersFromSearchParams`，非法枚举会被忽略，日期格式及范围顺序会校验。

## 负责人和工位停用

`WorkOrder.productionOwner`、`WorkOrder.workstation` 和历史 `WorkOrderProgressLog` 保留数据库兼容性。本版本未新增 migration，只从生产执行 UI、搜索、高级筛选、更新表单、批量操作和 CSV 中移除相关入口。PATCH 与旧客户端兼容性不变。

## 菜单管理

共享 `PortalMenu` 使用 `document.pointerdown` capture 判断 trigger 与 portal content 外部点击，支持 Escape、焦点变化、窗口失焦、可见性变化和路由变化关闭。模块级活动菜单管理器保证普通菜单互斥；高级筛选通过 `closeOnSelect={false}` 支持连续选择。

## 工单资料与返回状态

生产卡片跳转到 `/dashboard`，携带 `workOrderId`、`categoryCode=drawing`、`from=production` 和 `returnKey`。Dashboard 优先选中原图分类及最新文件；没有文件时进入原有空态。

跳转前保存 `ProductionExecutionViewState`。URL 保存可分享的查询状态，`sessionStorage` 保存不可分享的精确滚动状态。Next Router 返回 URL 未保留 `returnKey` 时，生产页会按规范化生产 URL 匹配最近的未过期会话记录，确保浏览器后退仍可恢复。

## 批量模式与性能

批量模式默认关闭且不渲染卡片复选框。返回资料预览时不恢复已选工单，降低误操作风险。列表一次最多读取 500 条；请求使用 `AbortController` 和 request id，内存缓存先恢复最近结果，再后台同步。
