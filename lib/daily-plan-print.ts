export type DailyPlanPrintMode = 'team' | 'employee';

type PrintEmployee = {
  id?: string;
  employeeNo?: string | null;
  name?: string;
  team?: string | null;
  position?: string | null;
};

type PrintAssignment = {
  id?: string;
  quantity?: number;
  plannedStandardMilliseconds?: string | number;
  regularStartAt?: string | null;
  regularEndAt?: string | null;
  overtimeStartAt?: string | null;
  overtimeEndAt?: string | null;
  status?: string;
  employee?: PrintEmployee;
  assignedTeam?: { name?: string; code?: string };
};

type PrintTask = {
  id?: string;
  processName?: string;
  processCode?: string;
  sequenceGroup?: number;
  plannedQty?: number;
  availableQty?: number;
  priority?: number;
  status?: string;
  unitLabel?: string;
  riskWarnings?: unknown;
  workOrder?: {
    code?: string;
    customerName?: string;
    specification?: string;
    productName?: string;
  };
  assignments?: PrintAssignment[];
};

type DailyPlanPrintSnapshot = {
  generatedAt?: string;
  employee?: PrintEmployee | null;
  plan?: {
    id?: string;
    workDate?: string;
    shiftCode?: string;
    status?: string;
    version?: number;
    team?: { name?: string; code?: string };
    tasks?: PrintTask[];
  };
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayDate(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function displayTime(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function displayDuration(value: unknown): string {
  const milliseconds = Number(value ?? 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0 小时';
  const hours = milliseconds / 3_600_000;
  return `${hours.toFixed(hours >= 10 ? 1 : 2)} 小时`;
}

function taskWarnings(task: PrintTask): string {
  if (!Array.isArray(task.riskWarnings) || task.riskWarnings.length === 0) return '—';
  return task.riskWarnings
    .map((warning) => {
      if (typeof warning === 'string') return warning;
      if (warning && typeof warning === 'object') {
        const record = warning as Record<string, unknown>;
        return String(record.message ?? record.label ?? record.code ?? '预警');
      }
      return String(warning);
    })
    .join('；');
}

function pageShell(input: {
  title: string;
  subtitle: string;
  orientation: 'landscape' | 'portrait';
  body: string;
  generatedAt?: string;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    @page { size: A4 ${input.orientation}; margin: 11mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; background: #fff; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10px; line-height: 1.45; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 2px solid #e86108; }
    h1 { margin: 0 0 2px; font-size: 20px; letter-spacing: .05em; }
    .subtitle { color: #5d687b; font-size: 10px; }
    .meta { text-align: right; color: #5d687b; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { padding: 7px 6px; color: #3a4659; background: #f3f6fa; border: 1px solid #dce3ec; text-align: left; font-weight: 700; }
    td { padding: 7px 6px; border: 1px solid #dce3ec; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) { background: #fbfcfe; }
    .strong { font-weight: 700; font-size: 11px; }
    .muted { color: #6f7b8e; }
    .warning { color: #c54632; }
    .tag { display: inline-block; padding: 1px 6px; border: 1px solid #d8e1ec; border-radius: 999px; background: #f7f9fc; white-space: nowrap; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 16px; }
    .signature { min-height: 34px; padding-top: 18px; border-bottom: 1px solid #8e98a8; }
    .employee-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 10px; }
    .summary-cell { padding: 8px; border: 1px solid #dce3ec; border-radius: 6px; background: #fbfcfe; }
    .summary-label { color: #6f7b8e; margin-bottom: 2px; }
    .summary-value { font-weight: 700; font-size: 12px; }
    footer { margin-top: 8px; color: #7c8797; font-size: 8px; text-align: right; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <header>
    <div><h1>${escapeHtml(input.title)}</h1><div class="subtitle">${escapeHtml(input.subtitle)}</div></div>
    <div class="meta">服务端快照生成<br>${escapeHtml(displayDate(input.generatedAt))}</div>
  </header>
  ${input.body}
  <footer>杭连电子协同平台 · 日计划中心</footer>
</body>
</html>`;
}

function renderTeamPlan(snapshot: DailyPlanPrintSnapshot): string {
  const plan = snapshot.plan ?? {};
  const tasks = plan.tasks ?? [];
  const rows = tasks.flatMap((task, taskIndex) => {
    const assignments = task.assignments?.length ? task.assignments : [{}];
    return assignments.map((assignment, assignmentIndex) => `
      <tr>
        <td>${taskIndex + 1}.${assignmentIndex + 1}</td>
        <td><div class="strong">${escapeHtml(task.workOrder?.code || '—')}</div><div class="muted">${escapeHtml(task.workOrder?.productName || task.workOrder?.specification || '')}</div></td>
        <td><div class="strong">${escapeHtml(task.processName || task.processCode || '—')}</div><div class="muted">顺序组 ${escapeHtml(task.sequenceGroup ?? '—')}</div></td>
        <td>${escapeHtml(task.plannedQty ?? 0)} ${escapeHtml(task.unitLabel || '')}</td>
        <td>${escapeHtml(assignment.employee?.name || '未分配')}<div class="muted">${escapeHtml(assignment.employee?.employeeNo || '')}</div></td>
        <td>${escapeHtml(assignment.quantity ?? 0)}</td>
        <td>${escapeHtml(displayDuration(assignment.plannedStandardMilliseconds))}</td>
        <td>${escapeHtml(displayTime(assignment.regularStartAt))}–${escapeHtml(displayTime(assignment.regularEndAt))}</td>
        <td><span class="tag">${escapeHtml(task.status || '—')}</span></td>
        <td class="warning">${escapeHtml(taskWarnings(task))}</td>
      </tr>`);
  }).join('');

  return pageShell({
    title: `${plan.team?.name || '生产班组'}日计划总表`,
    subtitle: `${displayDate(plan.workDate)} · ${plan.shiftCode || 'DAY'} · 版本 ${plan.version ?? 0}`,
    orientation: 'landscape',
    generatedAt: snapshot.generatedAt,
    body: `
      <table>
        <thead><tr>
          <th style="width:4%">序号</th><th style="width:14%">工单 / 产品</th><th style="width:12%">工序</th>
          <th style="width:8%">计划数量</th><th style="width:10%">员工</th><th style="width:7%">分配数量</th>
          <th style="width:9%">计划工时</th><th style="width:11%">作业区间</th><th style="width:9%">状态</th><th style="width:16%">风险 / 备注</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="10" style="text-align:center">当前无日计划任务</td></tr>'}</tbody>
      </table>
      <div class="signatures"><div class="signature">车间主管确认：</div><div class="signature">班组长：</div><div class="signature">打印时间：</div></div>`,
  });
}

function renderEmployeePlan(snapshot: DailyPlanPrintSnapshot): string {
  const plan = snapshot.plan ?? {};
  const employee = snapshot.employee ?? null;
  const tasks = (plan.tasks ?? []).flatMap((task) =>
    (task.assignments ?? [])
      .filter((assignment) => !employee?.id || assignment.employee?.id === employee.id)
      .map((assignment) => ({ task, assignment })),
  );
  const totalMilliseconds = tasks.reduce(
    (sum, row) => sum + Number(row.assignment.plannedStandardMilliseconds ?? 0),
    0,
  );
  const rows = tasks.map(({ task, assignment }, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><div class="strong">${escapeHtml(task.workOrder?.code || '—')}</div><div class="muted">${escapeHtml(task.workOrder?.productName || task.workOrder?.specification || '')}</div></td>
      <td><div class="strong">${escapeHtml(task.processName || task.processCode || '—')}</div><div class="muted">顺序组 ${escapeHtml(task.sequenceGroup ?? '—')}</div></td>
      <td>${escapeHtml(assignment.quantity ?? 0)} ${escapeHtml(task.unitLabel || '')}</td>
      <td>${escapeHtml(displayDuration(assignment.plannedStandardMilliseconds))}</td>
      <td>${escapeHtml(displayTime(assignment.regularStartAt))}–${escapeHtml(displayTime(assignment.regularEndAt))}</td>
      <td><span class="tag">${escapeHtml(task.status || '—')}</span></td>
      <td class="warning">${escapeHtml(taskWarnings(task))}</td>
    </tr>`).join('');

  return pageShell({
    title: '员工个人日任务单',
    subtitle: `${displayDate(plan.workDate)} · ${plan.team?.name || '未配置班组'} · ${plan.shiftCode || 'DAY'}`,
    orientation: 'portrait',
    generatedAt: snapshot.generatedAt,
    body: `
      <div class="employee-summary">
        <div class="summary-cell"><div class="summary-label">员工</div><div class="summary-value">${escapeHtml(employee?.name || '未指定')}</div></div>
        <div class="summary-cell"><div class="summary-label">工号</div><div class="summary-value">${escapeHtml(employee?.employeeNo || '—')}</div></div>
        <div class="summary-cell"><div class="summary-label">任务数</div><div class="summary-value">${tasks.length}</div></div>
        <div class="summary-cell"><div class="summary-label">计划标准工时</div><div class="summary-value">${escapeHtml(displayDuration(totalMilliseconds))}</div></div>
      </div>
      <table>
        <thead><tr><th style="width:6%">序号</th><th style="width:20%">工单 / 产品</th><th style="width:16%">工序</th><th style="width:10%">数量</th><th style="width:12%">计划工时</th><th style="width:15%">作业区间</th><th style="width:10%">状态</th><th style="width:11%">备注</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center">当前员工无已分配任务</td></tr>'}</tbody>
      </table>
      <div class="signatures"><div class="signature">班组长：</div><div class="signature">员工确认：</div><div class="signature">完成备注：</div></div>`,
  });
}

export function renderDailyPlanPrintHtml(
  snapshot: DailyPlanPrintSnapshot,
  mode: DailyPlanPrintMode,
): string {
  return mode === 'employee' ? renderEmployeePlan(snapshot) : renderTeamPlan(snapshot);
}
