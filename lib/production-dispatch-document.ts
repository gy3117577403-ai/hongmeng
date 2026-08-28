import { productionDateKey, type ProductionControlView } from '@/lib/production-control';

type DispatchEmployee = {
  employeeNo?: string;
  name?: string;
  quantity?: number;
  plannedStandardMilliseconds?: string | number;
};

type DispatchArrangement = {
  id?: string;
  planId?: string;
  workDate?: string;
  shiftCode?: string;
  teamName?: string;
  status?: string;
  plannedQty?: number;
  completedQty?: number;
  remainingQty?: number;
  processNames?: string[];
  employees?: DispatchEmployee[];
};

export type ProductionDispatchDocumentOrder = {
  id?: string;
  code?: string;
  specification?: string | null;
  customerName?: string | null;
  productName?: string | null;
  stageText?: string;
  priority?: string;
  deliveryDay?: string | null;
  plannedAt?: string | null;
  productionControl?: ProductionControlView;
  productionTargetQty?: number | null;
  arrangements?: DispatchArrangement[];
};

export type ProductionDispatchDocumentRow = {
  workOrderId: string;
  specification: string;
  customer: string;
  productName: string;
  productionStatus: string;
  priority: string;
  deliveryDate: string;
  estimatedDate: string;
  baselineDates: string;
  note: string;
  pauseReason: string;
  targetQty: number | string;
  workDate: string;
  shift: string;
  team: string;
  arrangementStatus: string;
  processes: string;
  plannedQty: number | string;
  completedQty: number | string;
  remainingQty: number | string;
  employees: string;
  employeeQuantities: string;
  plannedHours: number;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function buildProductionDispatchDocumentRows(
  orders: readonly ProductionDispatchDocumentOrder[],
  selectedWorkOrderIds: readonly string[] = [],
): ProductionDispatchDocumentRow[] {
  const selected = new Set(selectedWorkOrderIds.map(text).filter(Boolean));
  return orders
    .filter(order => !selected.size || selected.has(text(order.id)))
    .flatMap(order => {
      const arrangements = order.arrangements?.length ? order.arrangements : [null];
      return arrangements.map(arrangement => {
        const employees = arrangement?.employees || [];
        const plannedMilliseconds = employees.reduce(
          (sum, employee) => sum + finiteNumber(employee.plannedStandardMilliseconds),
          0,
        );
        return {
          workOrderId: text(order.id),
          specification: text(order.specification) || text(order.code),
          customer: text(order.customerName),
          productName: text(order.productName),
          productionStatus: order.productionControl?.pausedAt ? '已暂停' : text(order.stageText),
          priority: order.priority === 'urgent' ? '紧急' : order.priority === 'high' ? '高' : '一般',
          deliveryDate: productionDateKey(order.deliveryDay) || '客户交期待确认',
          estimatedDate: order.productionControl?.estimatedCompletionDate || productionDateKey(order.plannedAt) || '',
          baselineDates: `原承诺 ${order.productionControl?.deliveryBaselineDate || '待确认'} / 原计划 ${order.productionControl?.planBaselineDate || productionDateKey(order.plannedAt) || '待确认'}`,
          note: [order.productionControl?.note?.text, order.productionControl?.note?.owner].filter(Boolean).join(' · '),
          pauseReason: order.productionControl?.pause?.reason || '',
          targetQty: order.productionTargetQty ?? '',
          workDate: text(arrangement?.workDate),
          shift: arrangement ? (arrangement.shiftCode === 'NIGHT' ? '夜班' : '白班') : '',
          team: text(arrangement?.teamName),
          arrangementStatus: text(arrangement?.status) || '未安排',
          processes: (arrangement?.processNames || []).join('、'),
          plannedQty: arrangement?.plannedQty ?? '',
          completedQty: arrangement?.completedQty ?? '',
          remainingQty: arrangement?.remainingQty ?? '',
          employees: employees.map(employee => `${text(employee.employeeNo)} ${text(employee.name)}`.trim()).join('、'),
          employeeQuantities: employees.map(employee => `${text(employee.name)} ${finiteNumber(employee.quantity)}`).join('、'),
          plannedHours: Math.round((plannedMilliseconds / 3_600_000) * 100) / 100,
        };
      });
    });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderProductionDispatchPrintHtml(input: {
  rows: readonly ProductionDispatchDocumentRow[];
  title?: string;
  rangeText?: string;
  generatedAt?: Date;
}): string {
  const generatedAt = input.generatedAt || new Date();
  const rows = input.rows.map((row, index) => `<tr>
    <td>${index + 1}</td>
    <td><strong>${escapeHtml(row.specification)}</strong><small>${escapeHtml(row.customer)} · ${escapeHtml(row.productName)}</small></td>
    <td>${escapeHtml(row.workDate || '未安排')}<small>${escapeHtml([row.shift, row.team].filter(Boolean).join(' · '))}</small></td>
    <td>${escapeHtml(row.processes || '待安排')}</td>
    <td>${escapeHtml(row.employees || '待安排')}<small>${escapeHtml(row.employeeQuantities)}</small></td>
    <td>${escapeHtml(row.plannedQty)}</td><td>${escapeHtml(row.completedQty)}</td><td>${escapeHtml(row.remainingQty)}</td>
    <td>${escapeHtml(row.deliveryDate || '待确认')}<small>预计 ${escapeHtml(row.estimatedDate)} · ${escapeHtml(row.productionStatus)}</small><small>${escapeHtml(row.baselineDates)}</small></td>
    <td>${escapeHtml(row.note)}<small>${escapeHtml(row.pauseReason ? `暂停：${row.pauseReason}` : '')}</small></td>
  </tr>`).join('');
  const employeeCount = new Set(input.rows.flatMap(row => row.employees.split('、').map(text).filter(Boolean))).size;
  const arrangementCount = input.rows.filter(row => row.workDate).length;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title || '生产调度排班表')}</title><style>
  @page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{margin:0;color:#172033;font:10px/1.45 "Microsoft YaHei","PingFang SC",Arial,sans-serif}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #e86108;padding-bottom:7px;margin-bottom:8px}h1{margin:0;font-size:20px}header small{display:block;color:#6b778c}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}.metrics div{padding:6px 8px;border:1px solid #dce3ec;background:#f8fafc}.metrics span{display:block;color:#778397}.metrics b{font-size:13px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #dce3ec;padding:5px;vertical-align:top;overflow-wrap:anywhere}th{background:#f3f6fa;text-align:left}td strong{font-size:10.5px}td small{display:block;color:#758196;margin-top:2px}.sign{height:26px}footer{display:flex;justify-content:space-between;margin-top:8px;color:#778397}.no-print{position:fixed;right:12px;top:10px;border:0;border-radius:6px;padding:8px 14px;background:#e86108;color:white;font-weight:700}@media print{.no-print{display:none}}
  </style></head><body><button class="no-print" onclick="window.print()">打印</button><header><div><h1>${escapeHtml(input.title || '生产调度排班表')}</h1><small>${escapeHtml(input.rangeText || '当前筛选范围')}</small></div><small>生成时间 ${escapeHtml(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(generatedAt))}</small></header>
  <section class="metrics"><div><span>工单</span><b>${new Set(input.rows.map(row => row.workOrderId)).size} 单</b></div><div><span>排班记录</span><b>${arrangementCount} 条</b></div><div><span>安排人员</span><b>${employeeCount} 人</b></div><div><span>剩余数量</span><b>${input.rows.reduce((sum,row)=>sum+finiteNumber(row.remainingQty),0)}</b></div></section>
  <table><thead><tr><th style="width:3%">序</th><th style="width:14%">规格 / 产品</th><th style="width:10%">日期 / 班组</th><th style="width:13%">工序</th><th style="width:14%">安排人员</th><th style="width:6%">计划</th><th style="width:6%">完成</th><th style="width:6%">剩余</th><th style="width:10%">交期 / 状态</th><th style="width:18%">现场备注 / 签字</th></tr></thead><tbody>${rows || '<tr><td colspan="10" style="text-align:center">当前范围无排班数据</td></tr>'}</tbody></table><footer><span>调度员：________________　班组长：________________</span><span>杭连电子协同平台 · 服务端数据快照</span></footer></body></html>`;
}
