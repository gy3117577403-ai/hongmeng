'use client';

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Database,
  Download,
  FileCheck2,
  FileWarning,
  Gauge,
  Layers3,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  TimerOff,
  TrendingUp,
  UserCheck,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  AbnormalTimeReportDTO,
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeAttainmentRowDTO,
  ProcessLaborPoolDTO,
  ReportCenterFocusItemDTO,
  ReportCenterModeDTO,
  ReportCenterOverviewDTO,
  ReportCenterPeriodDTO,
  ReportOperationsDTO,
  ReportOperationsEmployeeRowDTO,
  ReportOperationsLaborRowDTO,
} from '@/types';

type ReportView = 'operations' | 'overview' | 'production' | 'people' | 'quality' | 'sample';
type PeopleView = 'attainment' | 'labor';
type OperationsView = 'summary' | 'labor' | 'plan' | 'attendance' | 'matrix';
type ApiResponse<T> = { ok: boolean; report?: T; error?: string };
type LaborResponse = { ok: boolean; pools?: ProcessLaborPoolDTO[]; error?: string };

const reportTabs: Array<{ key: ReportView; label: string }> = [
  { key: 'operations', label: '生产数据总表' },
  { key: 'overview', label: '综合总览' },
  { key: 'production', label: '生产与交付' },
  { key: 'people', label: '人员与工时' },
  { key: 'quality', label: '质量与异常' },
  { key: 'sample', label: '样品资料' },
];

const statusTone: Record<string, string> = {
  completed: 'green',
  in_progress: 'blue',
  review: 'purple',
  pending: 'gray',
  overdue: 'red',
};

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function shiftMonthKey(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function compactHours(milliseconds: number): string {
  const hours = Math.max(0, milliseconds) / 3_600_000;
  return `${hours >= 100 ? Math.round(hours) : Number(hours.toFixed(1))}h`;
}

function attainmentTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'empty';
  if (value > 11_000) return 'over';
  if (value >= 10_000) return 'excellent';
  if (value >= 9_500) return 'good';
  if (value >= 8_500) return 'watch';
  return 'risk';
}

function numberText(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

function percentText(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${(value / 100).toFixed(1)}%`;
}

function dateText(value: string | null | undefined): string {
  if (!value) return '未设置';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed).replaceAll('/', '-');
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return '未设置';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(parsed);
}

function focusDueText(item: ReportCenterFocusItemDTO): string {
  return item.entityType === 'sampleTask' ? dateOnly(item.dueAt) : dateText(item.dueAt);
}

function rangeText(report: { rangeStart: string; rangeEnd: string } | null): string {
  if (!report) return '统计范围加载中';
  const end = new Date(new Date(report.rangeEnd).getTime() - 1);
  return `${dateOnly(report.rangeStart)} 至 ${dateOnly(end.toISOString())}`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '').replaceAll('"', '""');
  return `"${text}"`;
}

function downloadCsv(name: string, rows: unknown[][]): void {
  const content = `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeHref(item: ReportCenterFocusItemDTO): string {
  return item.entityType === 'workOrder'
    ? `/production?workOrderId=${encodeURIComponent(item.id)}`
    : '/weekly-plan-center?branch=samples';
}

export default function ReportCenterDashboard({ user }: { user: CurrentUserDTO }) {
  const fullReportAccess = ['BUSINESS', 'PLANNING', 'PRODUCTION', 'MAJOR_APPROVAL']
    .some(module => user.access.modules.includes(module as CurrentUserDTO['access']['modules'][number]));
  const peopleOnlyAccess = !fullReportAccess && user.access.modules.includes('REPORT_CENTER');
  const availableReportTabs = fullReportAccess
    ? reportTabs
    : reportTabs.filter(tab => tab.key === 'people');
  const [view, setView] = useState<ReportView>(() => fullReportAccess ? 'operations' : 'people');
  const [peopleView, setPeopleView] = useState<PeopleView>('attainment');
  const [operationsView, setOperationsView] = useState<OperationsView>('summary');
  const [period, setPeriod] = useState<ReportCenterPeriodDTO>('week');
  const [date, setDate] = useState(todayKey);
  const [operationsMonth, setOperationsMonth] = useState(() => todayKey().slice(0, 7));
  const [operationsDate, setOperationsDate] = useState(todayKey);
  const [operationsTeam, setOperationsTeam] = useState('');
  const [mode, setMode] = useState<ReportCenterModeDTO>('all');
  const [customer, setCustomer] = useState('');
  const [keyword, setKeyword] = useState('');
  const [overview, setOverview] = useState<ReportCenterOverviewDTO | null>(null);
  const [operationsReport, setOperationsReport] = useState<ReportOperationsDTO | null>(null);
  const [employeeReport, setEmployeeReport] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [abnormalReport, setAbnormalReport] = useState<AbnormalTimeReportDTO | null>(null);
  const [laborPools, setLaborPools] = useState<ProcessLaborPoolDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [laborLoading, setLaborLoading] = useState(false);
  const [error, setError] = useState('');
  const [operationsError, setOperationsError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedFocus, setSelectedFocus] = useState<ReportCenterFocusItemDTO | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view');
    if (requested === 'labor' || requested === 'manual') {
      setView('people');
      setPeopleView('labor');
    } else if (requested === 'employee' || peopleOnlyAccess) setView('people');
    else if (requested === 'abnormal' && fullReportAccess) setView('quality');
  }, [fullReportAccess, peopleOnlyAccess]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const detailParams = new URLSearchParams({ period, date });
    const loadPeopleOnly = async () => {
      const employeeResponse = await fetch(`/api/reports/employee-attainment?${detailParams}`, {
        cache: 'no-store', signal: controller.signal,
      });
      const employeeBody = await employeeResponse.json() as ApiResponse<EmployeeAttainmentReportDTO>;
      if (!employeeResponse.ok || !employeeBody.report) throw new Error(employeeBody.error || '人员报表加载失败');
      setEmployeeReport(employeeBody.report);
    };
    const loadFullReport = async () => {
      const overviewParams = new URLSearchParams({ period, date, mode });
      if (customer) overviewParams.set('customer', customer);
      const [overviewResponse, employeeResponse, abnormalResponse] = await Promise.all([
        fetch(`/api/reports/overview?${overviewParams}`, { cache: 'no-store', signal: controller.signal }),
        fetch(`/api/reports/employee-attainment?${detailParams}`, { cache: 'no-store', signal: controller.signal }),
        fetch(`/api/reports/abnormal-time?${detailParams}`, { cache: 'no-store', signal: controller.signal }),
      ]);
      const [overviewBody, employeeBody, abnormalBody] = await Promise.all([
        overviewResponse.json() as Promise<ApiResponse<ReportCenterOverviewDTO>>,
        employeeResponse.json() as Promise<ApiResponse<EmployeeAttainmentReportDTO>>,
        abnormalResponse.json() as Promise<ApiResponse<AbnormalTimeReportDTO>>,
      ]);
      if (!overviewResponse.ok || !overviewBody.report) throw new Error(overviewBody.error || '综合报表加载失败');
      if (!employeeResponse.ok || !employeeBody.report) throw new Error(employeeBody.error || '人员报表加载失败');
      if (!abnormalResponse.ok || !abnormalBody.report) throw new Error(abnormalBody.error || '异常报表加载失败');
      setOverview(overviewBody.report);
      setEmployeeReport(employeeBody.report);
      setAbnormalReport(abnormalBody.report);
    };
    (fullReportAccess ? loadFullReport() : loadPeopleOnly()).catch(reason => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '报表加载失败');
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [customer, date, fullReportAccess, mode, period, refreshToken]);

  useEffect(() => {
    if (!fullReportAccess || view !== 'operations') return undefined;
    const controller = new AbortController();
    setOperationsLoading(true);
    setOperationsError('');
    fetch(`/api/reports/operations?month=${encodeURIComponent(operationsMonth)}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      const body = await response.json() as ApiResponse<ReportOperationsDTO>;
      if (!response.ok || !body.report) throw new Error(body.error || '生产数据总表加载失败');
      setOperationsReport(body.report);
      setOperationsDate(current => body.report?.dates.some(item => item.date === current)
        ? current
        : body.report?.dates.find(item => !item.isFuture)?.date || body.report?.dates[0]?.date || current);
      setOperationsTeam(current => current && body.report?.teamMonthly.some(item => item.team === current)
        ? current
        : '');
    }).catch(reason => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setOperationsError(reason instanceof Error ? reason.message : '生产数据总表加载失败');
    }).finally(() => setOperationsLoading(false));
    return () => controller.abort();
  }, [fullReportAccess, operationsMonth, refreshToken, view]);

  useEffect(() => {
    if (view !== 'people' || peopleView !== 'labor') return undefined;
    const controller = new AbortController();
    setLaborLoading(true);
    const params = new URLSearchParams({ workDate: date, includeExhausted: 'true' });
    fetch(`/api/process-labor-pools?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json() as LaborResponse;
        if (!response.ok || !body.ok) throw new Error(body.error || '自动记工明细加载失败');
        setLaborPools(body.pools || []);
      })
      .catch(reason => {
        if ((reason as { name?: string }).name === 'AbortError') return;
        setToast(reason instanceof Error ? reason.message : '自动记工明细加载失败');
      })
      .finally(() => setLaborLoading(false));
    return () => controller.abort();
  }, [date, peopleView, refreshToken, view]);

  useEffect(() => {
    if (!selectedFocus) return undefined;
    function close(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelectedFocus(null);
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedFocus]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
  const focusItems = useMemo(() => {
    const items = overview?.focusItems || [];
    if (!normalizedKeyword) return items;
    return items.filter(item => `${item.code} ${item.customerName} ${item.productName} ${item.specification} ${item.owner || ''}`
      .toLocaleLowerCase('zh-CN').includes(normalizedKeyword));
  }, [normalizedKeyword, overview?.focusItems]);
  const employeeRows = useMemo(() => {
    const rows = employeeReport?.rows || [];
    if (!normalizedKeyword) return rows;
    return rows.filter(row => `${row.employee.employeeNo} ${row.employee.name} ${row.employee.department || ''} ${row.employee.team || ''}`
      .toLocaleLowerCase('zh-CN').includes(normalizedKeyword));
  }, [employeeReport?.rows, normalizedKeyword]);
  const abnormalEvents = useMemo(() => {
    const events = abnormalReport?.events || [];
    if (!normalizedKeyword) return events;
    return events.filter(event => `${event.sequence} ${event.categoryLabel} ${event.title} ${event.reason || ''}`
      .toLocaleLowerCase('zh-CN').includes(normalizedKeyword));
  }, [abnormalReport?.events, normalizedKeyword]);
  const operationsRows = useMemo(() => {
    const rows = operationsReport?.employeeMatrix || [];
    return rows.filter(row => (!operationsTeam || row.team === operationsTeam)
      && (!normalizedKeyword || `${row.employee.employeeNo} ${row.employee.name} ${row.team} ${row.position}`
        .toLocaleLowerCase('zh-CN').includes(normalizedKeyword)));
  }, [normalizedKeyword, operationsReport?.employeeMatrix, operationsTeam]);
  const operationsTeams = operationsReport?.teamMonthly.map(item => item.team) || [];

  const employeeSummary = employeeReport?.summary;
  const abnormalSummary = abnormalReport?.summary;
  const summary = overview?.summary;
  const customerScopedView = view === 'overview' || view === 'production' || view === 'sample';
  const maxTrend = Math.max(1, ...(overview?.dailyTrend || []).flatMap(item => [item.plannedQty, item.completedQty]));
  const maxBottleneck = Math.max(1, ...(overview?.processBottlenecks || []).map(item => item.pendingQty));

  function exportCurrentView(): void {
    const stamp = `${date}-${period}`;
    if (view === 'operations') {
      const report = operationsReport;
      if (!report) {
        setToast('生产数据尚未加载完成');
        return;
      }
      if (operationsView === 'matrix') {
        downloadCsv(`个人达成率矩阵-${operationsMonth}.csv`, [
          ['岗位', '班组', '员工编号', '姓名', ...report.dates.map(item => `${item.day}号`), '月均达成率', '确认天数', '待匹配标准工时'],
          ...operationsRows.map(row => [
            row.position,
            row.team,
            row.employee.employeeNo,
            row.employee.name,
            ...row.days.map(day => day.attainmentBasisPoints === null ? '' : percentText(day.attainmentBasisPoints)),
            percentText(row.attainmentBasisPoints),
            row.confirmedDays,
            compactHours(row.unmatchedStandardLaborMilliseconds),
          ]),
        ]);
      } else if (operationsView === 'plan') {
        downloadCsv(`周计划达成率-${operationsMonth}.csv`, [
          ['周次', '日期范围', '计划批次', '完成批次', '批次达成率', '计划数量', '完成数量', '数量达成率'],
          ...report.weeklyPlan.map(week => [week.label, `${week.startDate} 至 ${week.endDate}`, week.plannedBatches, week.completedBatches, percentText(week.batchCompletionBasisPoints), week.plannedQuantity, week.completedQuantity, percentText(week.quantityCompletionBasisPoints)]),
        ]);
      } else if (operationsView === 'attendance') {
        downloadCsv(`生产车间出勤率-${operationsMonth}.csv`, [
          ['日期', '应出勤人数', '实际出勤人数', '请假人数', '缺勤人数', '休息人数', '草稿记录', '人数出勤率', '工时出勤率'],
          ...report.dailyAttendance.map(day => [day.date, day.plannedPeople, day.attendancePeople, day.leavePeople, day.absentPeople, day.restPeople, day.draftRecords, percentText(day.attendanceBasisPoints), percentText(day.hoursBasisPoints)]),
        ]);
      } else {
        const laborRows = operationsView === 'labor'
          ? report.teamDaily.filter(row => row.date === operationsDate && (!operationsTeam || row.team === operationsTeam))
          : report.teamMonthly.filter(row => !operationsTeam || row.team === operationsTeam);
        downloadCsv(`生产车间工时数据-${operationsView === 'labor' ? operationsDate : operationsMonth}.csv`, [
          ['班组', '人数', '出勤人数', '应出勤工时', '有效出勤工时', '标准产出工时', '免责异常', '待匹配标准工时', '出勤工时率', '工时达成率'],
          ...laborRows.map(row => [row.team, row.employeeCount, row.attendancePeople, compactHours(row.plannedMilliseconds), compactHours(row.attendanceMilliseconds), compactHours(row.standardLaborMilliseconds), compactHours(row.exemptAbnormalMilliseconds), compactHours(row.unmatchedStandardLaborMilliseconds), percentText(row.attendanceBasisPoints), percentText(row.attainmentBasisPoints)]),
        ]);
      }
    } else if (view === 'people') {
      downloadCsv(`人员与工时-${stamp}.csv`, [
        ['员工编号', '姓名', '班组', '确认出勤', '标准工时', '异常免责', '达成率'],
        ...employeeRows.map(row => [row.employee.employeeNo, row.employee.name, row.employee.team || '', formatProcessDuration(row.attendanceMilliseconds), formatProcessDuration(row.standardLaborMilliseconds), formatProcessDuration(row.exemptAbnormalMilliseconds), percentText(row.attainmentBasisPoints)]),
      ]);
    } else if (view === 'quality') {
      downloadCsv(`质量与异常-${stamp}.csv`, [
        ['序号', '异常类别', '标题', '事件时长', '影响人时', '品质状态', '处理状态'],
        ...abnormalEvents.map(event => [event.sequence, event.categoryLabel, event.title, formatProcessDuration(event.durationMilliseconds), formatProcessDuration(event.affectedPersonMilliseconds), event.qualityStatus, event.resolutionStatus]),
      ]);
    } else {
      const exportItems = view === 'sample'
        ? focusItems.filter(item => item.entityType === 'sampleTask')
        : view === 'production'
          ? focusItems.filter(item => item.entityType === 'workOrder')
          : focusItems;
      downloadCsv(`报表中心-${view}-${stamp}.csv`, [
        ['类型', '任务/工单', '客户', '产品', '规格', '计划数量', '完成数量', '状态', '当前环节', '交期', '风险', '资料缺口'],
        ...exportItems.map(item => [item.entityType === 'workOrder' ? '量产' : '样品', item.code, item.customerName, item.productName, item.specification, item.plannedQty ?? '', item.completedQty ?? '', item.statusLabel, item.currentProcess || '', focusDueText(item), item.riskLabel, item.missingData.join('；')]),
      ]);
    }
    setToast('报表已按当前筛选导出');
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return <main className="report-center-workbench hm-workbench-root hm-cockpit-root hm-workbench-navigation-overlay">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/reports"
      subtitle="生产、交付、人员、异常与样品资料统一分析"
      hideHeader
      sidebarTriggerTargetId="report-center-navigation-trigger"
      menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => void logout() }]}
    />
    <div className="report-center-frame">
      <section className="report-center-command" aria-label="报表中心命令栏">
        <span id="report-center-navigation-trigger" className="report-center-nav-trigger" />
        <div className="report-center-title"><span><BarChart3 /></span><div><small>数据决策</small><h1>报表中心</h1></div><em>{availableReportTabs.find(item => item.key === view)?.label}</em></div>
        <div className="report-center-source"><Database /><span><strong>真实业务数据</strong><small>金额类指标未启用</small></span></div>
        <label className="report-center-search"><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={view === 'operations' ? '搜索员工、工号、岗位或班组' : '搜索工单、客户、产品或员工'} aria-label="搜索报表" /></label>
        <button className="icon" type="button" title="刷新报表" aria-label="刷新报表" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} /></button>
        <button type="button" onClick={exportCurrentView}><Download />导出</button>
      </section>

      <section className="report-center-tabs" aria-label="报表分类">
        <div role="tablist">{availableReportTabs.map(tab => <button className={view === tab.key ? 'active' : ''} type="button" role="tab" aria-selected={view === tab.key} key={tab.key} onClick={() => setView(tab.key)}>{tab.label}</button>)}</div>
        <div className="report-center-filter-pair">
          {view === 'operations' ? <label><UsersRound /><select value={operationsTeam} onChange={event => setOperationsTeam(event.target.value)} aria-label="班组筛选"><option value="">全部班组</option>{operationsTeams.map(team => <option value={team} key={team}>{team}</option>)}</select></label> : customerScopedView ? <><label><Layers3 /><select value={mode} onChange={event => setMode(event.target.value as ReportCenterModeDTO)} aria-label="生产类型"><option value="all">量产 + 样品</option><option value="mass">仅量产</option><option value="sample">仅样品</option></select></label>
            <label><UsersRound /><select value={customer} onChange={event => setCustomer(event.target.value)} aria-label="客户筛选"><option value="">全部客户</option>{(overview?.customers || []).map(item => <option value={item} key={item}>{item}</option>)}</select></label></> : <span className="report-center-scope-pill"><UsersRound />全厂人员与异常口径</span>}
        </div>
      </section>

      {view === 'operations' ? <section className="report-center-period-bar operations-period-bar">
        <div className="operations-month-nav"><button type="button" aria-label="上个月" onClick={() => setOperationsMonth(value => shiftMonthKey(value, -1))}><ChevronLeft /></button><button type="button" className="active" onClick={() => setOperationsMonth(todayKey().slice(0, 7))}>本月</button><button type="button" aria-label="下个月" onClick={() => setOperationsMonth(value => shiftMonthKey(value, 1))}><ChevronRight /></button></div>
        <label><CalendarRange /><input type="month" value={operationsMonth} onChange={event => event.target.value && setOperationsMonth(event.target.value)} /><span>{operationsReport ? `${operationsReport.month.replace('-', ' 年 ')} 月 · ${operationsReport.dates.length} 天` : '月度数据加载中'}</span></label>
        <p><ShieldCheck />正式指标只使用已确认考勤；达成率超过 110% 会提示复核，不作为越高越好</p>
        <small>{operationsReport ? `截止 ${dateText(operationsReport.cutoffAt)}` : '正在更新'}</small>
      </section> : <section className="report-center-period-bar">
        <div>{(['today', 'week', 'month'] as ReportCenterPeriodDTO[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{item === 'today' ? '今日' : item === 'week' ? '本周' : '本月'}</button>)}</div>
        <label><CalendarDays /><input type="date" value={date} onChange={event => setDate(event.target.value)} /><span>{rangeText(peopleOnlyAccess ? employeeReport : overview)}</span></label>
        <p><ShieldCheck />{peopleOnlyAccess ? '人事只读口径：全厂确认考勤、标准工时与免责异常' : customer && customerScopedView ? '客户筛选仅作用于量产、样品和资料；人员与异常保持全厂口径' : '成品数量只统计最终工序良品，工序数据仅用于瓶颈和质量分析'}</p>
        <small>{peopleOnlyAccess ? (employeeReport ? '人员数据已同步' : '正在更新') : overview ? `更新于 ${dateText(overview.generatedAt).slice(-5)}` : '正在更新'}</small>
      </section>}

      {view === 'operations' ? <section className="report-center-kpis operations-kpis" aria-label="生产数据关键指标">
        <KpiCard icon={<Gauge />} tone={attainmentTone(operationsReport?.summary.attainmentBasisPoints)} label="工时达成率" value={percentText(operationsReport?.summary.attainmentBasisPoints)} note={`目标 95% · 标准产出 ${compactHours(operationsReport?.summary.standardLaborMilliseconds || 0)}`} />
        <KpiCard icon={<UserCheck />} tone={attainmentTone(operationsReport?.summary.attendanceBasisPoints)} label="出勤工时率" value={percentText(operationsReport?.summary.attendanceBasisPoints)} note={`${compactHours(operationsReport?.summary.attendanceMilliseconds || 0)} / ${compactHours(operationsReport?.summary.plannedMilliseconds || 0)}`} />
        <KpiCard icon={<Workflow />} tone={attainmentTone(operationsReport?.summary.batchCompletionBasisPoints)} label="周计划批次达成" value={percentText(operationsReport?.summary.batchCompletionBasisPoints)} note={`${operationsReport?.summary.completedBatches || 0} / ${operationsReport?.summary.plannedBatches || 0} 批`} />
        <KpiCard icon={<PackageCheck />} tone={attainmentTone(operationsReport?.summary.quantityCompletionBasisPoints)} label="周计划数量达成" value={percentText(operationsReport?.summary.quantityCompletionBasisPoints)} note={`${numberText(operationsReport?.summary.completedQuantity || 0)} / ${numberText(operationsReport?.summary.plannedQuantity || 0)}`} />
        <KpiCard icon={<Activity />} tone="blue" label="有效出勤工时" value={compactHours(operationsReport?.summary.attendanceMilliseconds || 0)} note={`免责异常 ${compactHours(operationsReport?.summary.exemptAbnormalMilliseconds || 0)}`} />
        <KpiCard icon={<Database />} tone={attainmentTone(operationsReport?.summary.dataCoverageBasisPoints)} label="考勤确认覆盖" value={percentText(operationsReport?.summary.dataCoverageBasisPoints)} note={`确认 ${operationsReport?.summary.confirmedAttendanceRecords || 0} · 草稿 ${operationsReport?.summary.draftAttendanceRecords || 0}`} />
        <KpiCard icon={<CircleAlert />} tone={(operationsReport?.summary.unmatchedStandardLaborMilliseconds || 0) > 0 ? 'red' : 'green'} label="待匹配标准工时" value={compactHours(operationsReport?.summary.unmatchedStandardLaborMilliseconds || 0)} note="有报工但缺确认考勤" />
      </section> : peopleOnlyAccess ? <section className="report-center-kpis" aria-label="人员效率关键指标">
        <KpiCard icon={<UsersRound />} tone="blue" label="统计员工" value={numberText(employeeSummary?.employeeCount || 0)} note={`确认出勤 ${employeeSummary?.attendanceConfirmedDays || 0} 人日`} />
        <KpiCard icon={<Gauge />} tone={attainmentTone(employeeSummary?.attainmentBasisPoints)} label="全厂出勤达成率" value={percentText(employeeSummary?.attainmentBasisPoints)} note="标准工时 ÷ 有效产能工时" />
        <KpiCard icon={<Clock3 />} tone="green" label="标准产出工时" value={formatProcessDuration(employeeSummary?.standardLaborMilliseconds || 0)} note={`工时记录 ${employeeSummary?.claimCount || 0} 笔`} />
        <KpiCard icon={<UserCheck />} tone="purple" label="有效出勤工时" value={formatProcessDuration(employeeSummary?.attendanceMilliseconds || 0)} note={`覆盖率 ${percentText(employeeSummary?.coverageBasisPoints)}`} />
        <KpiCard icon={<TimerOff />} tone="amber" label="免责异常工时" value={formatProcessDuration(employeeSummary?.exemptAbnormalMilliseconds || 0)} note="仅统计品质已确认记录" />
        <KpiCard icon={<CircleAlert />} tone={(employeeSummary?.unmatchedStandardLaborMilliseconds || 0) > 0 ? 'red' : 'green'} label="待匹配标准工时" value={formatProcessDuration(employeeSummary?.unmatchedStandardLaborMilliseconds || 0)} note="有报工但缺确认考勤" />
      </section> : <section className="report-center-kpis" aria-label="关键指标">
        <KpiCard icon={<Gauge />} tone="orange" label={overview?.quantityScope.label || '数量达成率'} value={percentText(summary?.completionBasisPoints)} note={`${numberText(summary?.completedQty || 0)} / ${numberText(summary?.plannedQty || 0)} ${overview?.quantityScope.unitLabel || ''}`} />
        <KpiCard icon={<ClipboardCheck />} tone="green" label="完成任务/工单" value={numberText(summary?.completedOrders || 0)} note={`进行中 ${summary?.activeOrders || 0} · 待开始 ${summary?.pendingOrders || 0}`} />
        <KpiCard icon={<Clock3 />} tone="blue" label="全厂出勤达成率" value={percentText(employeeSummary?.attainmentBasisPoints)} note={`标准工时 ${formatProcessDuration(employeeSummary?.standardLaborMilliseconds || 0)}`} />
        <KpiCard icon={<TimerOff />} tone="amber" label="全厂异常影响人时" value={formatProcessDuration(abnormalSummary?.affectedPersonMilliseconds || 0)} note={`未关闭 ${abnormalSummary?.openCount || 0} 条`} />
        <KpiCard icon={<CircleAlert />} tone="red" label="逾期风险" value={numberText(summary?.overdueOrders || 0)} note={`未来 2 天 ${summary?.dueSoonOrders || 0} 项`} />
        <KpiCard icon={<Database />} tone="purple" label={mode === 'sample' ? '审核完成率' : '资料完整率'} value={percentText(summary?.dataCompletenessBasisPoints)} note={mode === 'sample' ? `待审核 ${summary?.pendingSampleReviewItems || 0} 项` : `核心检查：路线 / 工时 / 图纸`} />
      </section>}

      {error && <div className="report-center-error" role="alert"><AlertTriangle />{error}<button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}
      {operationsError && view === 'operations' && <div className="report-center-error" role="alert"><AlertTriangle />{operationsError}<button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}
      {view === 'operations' && <OperationsWorkspace report={operationsReport} rows={operationsRows} subview={operationsView} onSubview={setOperationsView} selectedDate={operationsDate} onSelectedDate={setOperationsDate} team={operationsTeam} loading={operationsLoading} />}
      {view === 'overview' && <section className="report-center-body overview-view">
        <div className="report-center-top-grid">
          <Panel className="trend-panel" kicker="生产与交付" title="计划与最终工序完成趋势" action={<span>{overview?.quantityScope.note}</span>}>
            <div className="report-trend-scroll" tabIndex={0}><div className="report-trend-chart" style={{ '--trend-columns': Math.max(1, overview?.dailyTrend.length || 1) } as CSSProperties}>
              {(overview?.dailyTrend || []).map(item => <div className="report-trend-day" key={item.date} title={`${item.date}：计划 ${item.plannedQty}，完成 ${item.completedQty}`}>
                <div><i className="planned" style={{ height: `${Math.max(item.plannedQty ? 8 : 1, Math.round((item.plannedQty / maxTrend) * 100))}%` }} /><i className="completed" style={{ height: `${Math.max(item.completedQty ? 8 : 1, Math.round((item.completedQty / maxTrend) * 100))}%` }} /></div>
                <span>{item.label}</span><small>{numberText(item.completedQty)}</small>
              </div>)}
              {!overview?.dailyTrend.length && <EmptyState icon={<BarChart3 />} title="当前周期没有趋势数据" />}
            </div></div>
            <footer><strong>{numberText(summary?.plannedQty || 0)}</strong><span>计划</span><strong>{numberText(summary?.completedQty || 0)}</strong><span>最终工序良品</span></footer>
          </Panel>
          <Panel className="status-panel" kicker="任务状态" title="当前状态分布" action={<span>{focusItems.length} 项</span>}>
            <div className="status-rate"><strong>{percentText(summary?.completionBasisPoints)}</strong><span>当前达成率</span></div>
            <div className="status-stack">{(overview?.statusDistribution || []).map(item => <i className={statusTone[item.key]} style={{ width: `${item.basisPoints / 100}%` }} key={item.key} />)}</div>
            <div className="status-legend">{(overview?.statusDistribution || []).map(item => <span key={item.key}><i className={statusTone[item.key]} /><b>{item.label}</b><em>{item.count}</em><small>{percentText(item.basisPoints)}</small></span>)}</div>
          </Panel>
        </div>
        <div className="report-center-mid-grid">
          <Panel kicker="负荷监控" title="瓶颈工序待处理量" action={<span>工序口径，不计入成品总量</span>}>
            <div className="bottleneck-list">{(overview?.processBottlenecks || []).map((item, index) => <article key={item.processCode || item.processName}><span><b>{item.processName}</b><small>{item.workOrderCount} 单 · 逾期 {item.overdueWorkOrderCount} 单</small></span><div><i style={{ width: `${Math.max(4, Math.round((item.pendingQty / maxBottleneck) * 100))}%` }} /></div><strong>{numberText(item.pendingQty)}</strong><em>{index + 1}</em></article>)}{!overview?.processBottlenecks.length && <EmptyState icon={<Layers3 />} title="没有待处理工序" />}</div>
          </Panel>
          <Panel className="abnormal-panel" kicker="质量与异常" title="全厂已确认异常原因" action={<strong>{formatProcessDuration(abnormalSummary?.affectedPersonMilliseconds || 0)}</strong>}>
            <div className="abnormal-stack">{(abnormalReport?.categories || []).map((item, index) => <i className={`tone-${index % 5}`} style={{ width: `${abnormalSummary?.affectedPersonMilliseconds ? (item.affectedPersonMilliseconds / abnormalSummary.affectedPersonMilliseconds) * 100 : 0}%` }} key={item.category} />)}</div>
            <div className="abnormal-legend">{(abnormalReport?.categories || []).slice(0, 5).map((item, index) => <span key={item.category}><i className={`tone-${index % 5}`} /><b>{item.categoryLabel}</b><em>{formatProcessDuration(item.affectedPersonMilliseconds)}</em><small>{item.eventCount} 条</small></span>)}{!abnormalReport?.categories.length && <EmptyState icon={<ShieldCheck />} title="当前周期没有异常记录" />}</div>
          </Panel>
          <Panel kicker="数据治理" title="资料完整性" action={<strong>{percentText(summary?.dataCompletenessBasisPoints)}</strong>}>
            <div className="completeness-grid">{(overview?.completeness || []).map(item => <Link href={item.route} prefetch={false} key={item.key}><span>{item.key === 'route' ? <Layers3 /> : item.key === 'standard' ? <Clock3 /> : item.key === 'drawing' ? <FileWarning /> : item.key === 'material' ? <PackageCheck /> : <ClipboardCheck />}</span><div><small>{item.label}</small><strong>{item.count}</strong><em>{item.note}</em></div><ChevronRight /></Link>)}</div>
          </Panel>
        </div>
        <FocusTable items={focusItems} title="交付、异常与资料待办" onSelect={setSelectedFocus} />
      </section>}

      {view === 'production' && <section className="report-center-body production-view">
        <div className="production-insight-grid">
          <Panel kicker="计划趋势" title="计划与最终工序完成量"><CompactTrend report={overview} max={maxTrend} /></Panel>
          <Panel kicker="工序负荷" title="待处理量最高工序"><div className="bottleneck-list">{(overview?.processBottlenecks || []).map(item => <article key={item.processCode || item.processName}><span><b>{item.processName}</b><small>{item.workOrderCount} 单 · 逾期 {item.overdueWorkOrderCount}</small></span><div><i style={{ width: `${Math.max(4, Math.round((item.pendingQty / maxBottleneck) * 100))}%` }} /></div><strong>{numberText(item.pendingQty)}</strong></article>)}</div></Panel>
        </div>
        <FocusTable items={focusItems.filter(item => item.entityType === 'workOrder')} title="量产工单明细" onSelect={setSelectedFocus} />
      </section>}

      {view === 'people' && <section className="report-center-body people-view">
        <div className="report-subtabs" role="tablist"><button className={peopleView === 'attainment' ? 'active' : ''} type="button" onClick={() => setPeopleView('attainment')}>员工达成率</button><button className={peopleView === 'labor' ? 'active' : ''} type="button" onClick={() => setPeopleView('labor')}>自动记工明细</button><span>人员效率仅使用确认考勤与已匹配标准工时</span></div>
        {peopleView === 'attainment' ? <EmployeeTable rows={employeeRows} loading={loading} /> : <LaborLedger pools={laborPools} loading={laborLoading} />}
      </section>}

      {view === 'quality' && <section className="report-center-body quality-view">
        <div className="quality-summary-grid">{(abnormalReport?.categories || []).slice(0, 6).map(item => <article key={item.category}><span><AlertTriangle /></span><div><small>{item.categoryLabel}</small><strong>{formatProcessDuration(item.affectedPersonMilliseconds)}</strong><em>{item.eventCount} 条 · 事件 {formatProcessDuration(item.incidentMilliseconds)}</em></div></article>)}{!abnormalReport?.categories.length && <EmptyState icon={<ShieldCheck />} title="当前周期没有异常记录" />}</div>
        <section className="quality-event-panel"><header><div><small>异常明细</small><h2>品质确认与处理状态</h2></div><em>{abnormalEvents.length} 条</em></header><div>{abnormalEvents.map(event => <article key={event.id}><span><em>#{event.sequence}</em><strong>{event.title}</strong><small>{event.categoryLabel} · {event.allocations.map(item => item.employee.name).join('、') || '未分配员工'}</small></span><span><small>事件时长</small><b>{formatProcessDuration(event.durationMilliseconds)}</b></span><span><small>影响人时</small><b>{formatProcessDuration(event.affectedPersonMilliseconds)}</b></span><span><small>品质状态</small><b>{event.qualityStatus === 'pending' ? '待确认' : event.qualityStatus === 'rejected' ? '已驳回' : event.employeeExempt ? '已确认免责' : '已确认不免责'}</b></span><span><small>处理状态</small><b>{event.resolutionStatus === 'resolved' ? '已关闭' : '处理中'}</b></span></article>)}{!abnormalEvents.length && <EmptyState icon={<ShieldCheck />} title="没有符合筛选条件的异常" />}</div></section>
      </section>}

      {view === 'sample' && <section className="report-center-body sample-view">
        {mode === 'mass' && <div className="report-center-info"><CircleAlert />当前筛选为“仅量产”，切换到“量产 + 样品”或“仅样品”后显示样品任务。</div>}
        <div className="sample-report-summary">
          <KpiCard icon={<PackageCheck />} tone="orange" label="样品任务" value={numberText(overview?.sample.taskCount || 0)} note={`进行中 ${overview?.sample.activeCount || 0}`} />
          <KpiCard icon={<ClipboardCheck />} tone="purple" label="待分项审核" value={numberText(overview?.sample.pendingReviewCount || 0)} note="仅提交项；空白字段不计缺项" />
          <KpiCard icon={<FileCheck2 />} tone="green" label="已发布资料" value={numberText(overview?.sample.publishedItemCount || 0)} note={`已完成任务 ${overview?.sample.completedCount || 0}`} />
          <KpiCard icon={<Gauge />} tone="blue" label="审核完成率" value={percentText(overview?.sample.reviewBasisPoints)} note="已审核 ÷（已审核 + 待审核）" />
        </div>
        <div className="sample-rule-note"><ShieldCheck /><span><strong>样品采集字段全部选填</strong><small>没有填写不算缺项，也不要求员工选择固定原因；只有实际提交的数据和照片才进入分项审核。</small></span></div>
        <FocusTable items={focusItems.filter(item => item.entityType === 'sampleTask')} title="样品任务与审核进度" onSelect={setSelectedFocus} />
      </section>}

      {view !== 'operations' && loading && !(peopleOnlyAccess ? employeeReport : overview) && <div className="report-center-loading"><Loader2 className="spin" /><strong>正在汇总真实业务数据</strong><span>{peopleOnlyAccess ? '确认考勤、标准工时与异常免责分别按正式口径计算' : '成品、工序、人员、异常与样品资料分别按各自口径计算'}</span></div>}
    </div>
    {selectedFocus && <FocusDrawer item={selectedFocus} onClose={() => setSelectedFocus(null)} />}
    {toast && <div className="report-center-toast"><CheckCircle2 />{toast}</div>}
  </main>;
}

const operationsTabs: Array<{ key: OperationsView; label: string; icon: ReactNode }> = [
  { key: 'summary', label: '数据总览', icon: <TrendingUp /> },
  { key: 'labor', label: '班组工时', icon: <Clock3 /> },
  { key: 'plan', label: '周计划达成', icon: <Workflow /> },
  { key: 'attendance', label: '出勤分析', icon: <UserCheck /> },
  { key: 'matrix', label: '个人达成矩阵', icon: <Table2 /> },
];

function OperationsWorkspace({
  report,
  rows,
  subview,
  onSubview,
  selectedDate,
  onSelectedDate,
  team,
  loading,
}: {
  report: ReportOperationsDTO | null;
  rows: ReportOperationsEmployeeRowDTO[];
  subview: OperationsView;
  onSubview: (view: OperationsView) => void;
  selectedDate: string;
  onSelectedDate: (date: string) => void;
  team: string;
  loading: boolean;
}) {
  const dailyTeams = (report?.teamDaily || [])
    .filter(row => row.date === selectedDate && (!team || row.team === team))
    .sort((left, right) => (right.attainmentBasisPoints ?? -1) - (left.attainmentBasisPoints ?? -1));
  const monthlyTeams = (report?.teamMonthly || []).filter(row => !team || row.team === team);
  const recentDates = (report?.dates || []).filter(item => !item.isFuture).slice(-8);
  const previewRows = rows.slice(0, 8);

  return <section className="report-center-body operations-view">
    <div className="operations-subtabs" role="tablist" aria-label="生产数据报表分类">
      <div>{operationsTabs.map(tab => <button type="button" role="tab" aria-selected={subview === tab.key} className={subview === tab.key ? 'active' : ''} key={tab.key} onClick={() => onSubview(tab.key)}>{tab.icon}{tab.label}</button>)}</div>
      <span><i className="tone-risk" />低于 85% <i className="tone-watch" />85–94.9% <i className="tone-good" />95–100% <i className="tone-over" />高于 110% 复核</span>
    </div>

    {subview === 'summary' && <div className="operations-summary-layout">
      <OperationsCard className="operations-team-card" kicker="日工时利用" title={`${selectedDate} 班组工时`} action={<DatePicker report={report} value={selectedDate} onChange={onSelectedDate} />}>
        <OperationsLaborTable rows={dailyTeams} compact />
      </OperationsCard>
      <OperationsCard className="operations-week-card" kicker="月度计划" title="周计划批次 / 数量达成" action={<button type="button" onClick={() => onSubview('plan')}>查看明细<ChevronRight /></button>}>
        <OperationsWeeklyPlan report={report} compact />
      </OperationsCard>
      <OperationsCard className="operations-attendance-card" kicker="考勤趋势" title="每日出勤人数达成率" action={<button type="button" onClick={() => onSubview('attendance')}>查看明细<ChevronRight /></button>}>
        <OperationsAttendanceChart report={report} selectedDate={selectedDate} onSelectedDate={onSelectedDate} />
      </OperationsCard>
      <OperationsCard className="operations-matrix-card" kicker="个人表现" title={`最近 ${recentDates.length} 天达成热力图`} action={<button type="button" onClick={() => onSubview('matrix')}>完整矩阵<ChevronRight /></button>}>
        <OperationsMatrix report={report} rows={previewRows} dates={recentDates.map(item => item.date)} compact />
      </OperationsCard>
    </div>}

    {subview === 'labor' && <div className="operations-detail-layout labor-detail">
      <OperationsDateStrip report={report} selectedDate={selectedDate} onSelectedDate={onSelectedDate} />
      <OperationsCard kicker="按班组拆分" title={`${selectedDate} 生产车间工时利用率`} action={<span>{dailyTeams.length} 个班组</span>}>
        <OperationsLaborTable rows={dailyTeams} />
      </OperationsCard>
      <OperationsCard kicker="本月累计" title="班组月度工时达成" action={<span>{monthlyTeams.length} 个班组</span>}>
        <OperationsLaborTable rows={monthlyTeams} />
      </OperationsCard>
    </div>}

    {subview === 'plan' && <div className="operations-detail-layout plan-detail">
      <OperationsCard kicker="批次与数量" title={`${report?.month || ''} 周计划达成率`} action={<span>完成量按最终工序良品封顶</span>}>
        <OperationsWeeklyPlan report={report} />
      </OperationsCard>
      <OperationsCard kicker="对比趋势" title="各周计划 / 完成数量" action={<span>截至统计截止时点</span>}>
        <OperationsWeeklyBars report={report} />
      </OperationsCard>
    </div>}

    {subview === 'attendance' && <div className="operations-detail-layout attendance-detail">
      <OperationsCard kicker="每日趋势" title={`${report?.month || ''} 生产车间出勤率`} action={<span>人数与工时双口径</span>}>
        <OperationsAttendanceChart report={report} selectedDate={selectedDate} onSelectedDate={onSelectedDate} />
      </OperationsCard>
      <OperationsCard kicker="出勤台账" title="每日人数、请假与确认状态" action={<span>{report?.dailyAttendance.length || 0} 天</span>}>
        <OperationsAttendanceTable report={report} />
      </OperationsCard>
    </div>}

    {subview === 'matrix' && <div className="operations-detail-layout matrix-detail">
      <OperationsCard kicker="员工 × 日期" title={`${report?.month || ''} 个人达成率矩阵`} action={<span>{rows.length} 人 · 空白代表无正式达成数据</span>}>
        <OperationsMatrix report={report} rows={rows} dates={(report?.dates || []).map(item => item.date)} />
      </OperationsCard>
    </div>}

    {loading && !report && <div className="operations-loading"><Loader2 className="spin" /><strong>正在汇总月度生产数据</strong><span>考勤、标准工时、最终工序与周计划分别校验</span></div>}
    {report && <div className="operations-method-note"><ShieldCheck /><strong>统计口径</strong><span>{report.dataNotes[0]}</span><em>{report.dataNotes.length} 条口径说明</em></div>}
  </section>;
}

function OperationsCard({ kicker, title, action, className = '', children }: { kicker: string; title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`operations-card ${className}`.trim()}><header><div><small>{kicker}</small><h2>{title}</h2></div>{action && <aside>{action}</aside>}</header><div className="operations-card-body">{children}</div></section>;
}

function DatePicker({ report, value, onChange }: { report: ReportOperationsDTO | null; value: string; onChange: (date: string) => void }) {
  return <label className="operations-date-picker"><CalendarDays /><input type="date" value={value} min={report?.dates[0]?.date} max={report?.dates.at(-1)?.date} onChange={event => event.target.value && onChange(event.target.value)} /></label>;
}

function OperationsDateStrip({ report, selectedDate, onSelectedDate }: { report: ReportOperationsDTO | null; selectedDate: string; onSelectedDate: (date: string) => void }) {
  return <div className="operations-date-strip" tabIndex={0}>{(report?.dates || []).map(day => <button type="button" disabled={day.isFuture} className={`${selectedDate === day.date ? 'active' : ''} ${day.isWeekend ? 'weekend' : ''}`} key={day.date} onClick={() => onSelectedDate(day.date)}><small>{day.weekday}</small><strong>{day.day}</strong><span>{day.isFuture ? '未来' : '查看'}</span></button>)}</div>;
}

function OperationsLaborTable({ rows, compact = false }: { rows: ReportOperationsLaborRowDTO[]; compact?: boolean }) {
  return <div className={`operations-labor-table ${compact ? 'compact' : ''}`} tabIndex={0}>
    <div className="operations-labor-head"><span>班组</span><span>出勤人数</span><span>应出勤工时</span><span>有效出勤</span><span>标准产出</span><span>免责异常</span><span>工时达成率</span><span>出勤工时率</span><span>数据状态</span></div>
    {rows.map(row => <article key={row.team}><span><strong>{row.team}</strong><small>{row.employeeCount} 人 · {row.confirmedRecords} 条确认</small></span><span><b>{row.attendancePeople}</b><small>人</small></span><span><b>{compactHours(row.plannedMilliseconds)}</b></span><span><b>{compactHours(row.attendanceMilliseconds)}</b></span><span><b>{compactHours(row.standardLaborMilliseconds)}</b></span><span><b>{compactHours(row.exemptAbnormalMilliseconds)}</b></span><span><em className={`metric-tone tone-${attainmentTone(row.attainmentBasisPoints)}`}>{percentText(row.attainmentBasisPoints)}</em></span><span><em className={`metric-tone tone-${attainmentTone(row.attendanceBasisPoints)}`}>{percentText(row.attendanceBasisPoints)}</em></span><span>{row.unmatchedStandardLaborMilliseconds > 0 ? <em className="data-warning">待匹配 {compactHours(row.unmatchedStandardLaborMilliseconds)}</em> : <em className="data-ready">已匹配</em>}</span></article>)}
    {!rows.length && <EmptyState icon={<Clock3 />} title="所选日期或班组没有正式工时数据" />}
  </div>;
}

function OperationsWeeklyPlan({ report, compact = false }: { report: ReportOperationsDTO | null; compact?: boolean }) {
  return <div className={`operations-weekly-plan ${compact ? 'compact' : ''}`}>{(report?.weeklyPlan || []).map(week => <article key={week.key}><header><span>{week.label}</span><small>{week.startDate.slice(5)}—{week.endDate.slice(5)}</small></header><div><span><small>批次</small><strong>{week.completedBatches}<em> / {week.plannedBatches}</em></strong><i><b style={{ width: `${Math.min(100, (week.batchCompletionBasisPoints || 0) / 100)}%` }} /></i></span><span><small>数量</small><strong>{numberText(week.completedQuantity)}<em> / {numberText(week.plannedQuantity)}</em></strong><i><b style={{ width: `${Math.min(100, (week.quantityCompletionBasisPoints || 0) / 100)}%` }} /></i></span></div><footer><em className={`metric-tone tone-${attainmentTone(week.batchCompletionBasisPoints)}`}>{percentText(week.batchCompletionBasisPoints)}</em><em className={`metric-tone tone-${attainmentTone(week.quantityCompletionBasisPoints)}`}>{percentText(week.quantityCompletionBasisPoints)}</em></footer></article>)}{!report?.weeklyPlan.length && <EmptyState icon={<Workflow />} title="本月没有周计划批次" />}</div>;
}

function OperationsWeeklyBars({ report }: { report: ReportOperationsDTO | null }) {
  const max = Math.max(1, ...(report?.weeklyPlan || []).flatMap(week => [week.plannedQuantity, week.completedQuantity]));
  return <div className="operations-weekly-bars" style={{ '--week-count': Math.max(1, report?.weeklyPlan.length || 1) } as CSSProperties}>{(report?.weeklyPlan || []).map(week => <article key={week.key}><div><i className="planned" style={{ height: `${Math.max(2, (week.plannedQuantity / max) * 100)}%` }} /><i className="completed" style={{ height: `${Math.max(2, (week.completedQuantity / max) * 100)}%` }} /></div><strong>{week.label}</strong><small>{percentText(week.quantityCompletionBasisPoints)}</small></article>)}</div>;
}

function OperationsAttendanceChart({ report, selectedDate, onSelectedDate }: { report: ReportOperationsDTO | null; selectedDate: string; onSelectedDate: (date: string) => void }) {
  return <div className="operations-attendance-chart" tabIndex={0}>{(report?.dailyAttendance || []).map(day => <button type="button" className={selectedDate === day.date ? 'active' : ''} key={day.date} onClick={() => onSelectedDate(day.date)} title={`${day.date}：出勤 ${day.attendancePeople}/${day.plannedPeople}，${percentText(day.attendanceBasisPoints)}`}><span><i className={`tone-${attainmentTone(day.attendanceBasisPoints)}`} style={{ height: `${Math.max(day.attendanceBasisPoints === null ? 1 : 5, Math.min(100, (day.attendanceBasisPoints || 0) / 100))}%` }} /></span><strong>{day.date.slice(-2)}</strong><small>{day.attendanceBasisPoints === null ? '—' : `${Math.round(day.attendanceBasisPoints / 100)}%`}</small></button>)}</div>;
}

function OperationsAttendanceTable({ report }: { report: ReportOperationsDTO | null }) {
  return <div className="operations-attendance-table" tabIndex={0}><div className="operations-attendance-head"><span>日期</span><span>应出勤</span><span>实际出勤</span><span>请假</span><span>缺勤</span><span>休息</span><span>草稿</span><span>人数出勤率</span><span>工时出勤率</span></div>{(report?.dailyAttendance || []).map(day => <article key={day.date}><span><strong>{day.date.slice(5)}</strong><small>{report?.dates.find(item => item.date === day.date)?.weekday}</small></span><span><b>{day.plannedPeople}</b></span><span><b>{day.attendancePeople}</b></span><span><b>{day.leavePeople}</b></span><span><b>{day.absentPeople}</b></span><span><b>{day.restPeople}</b></span><span><b className={day.draftRecords ? 'warning-text' : ''}>{day.draftRecords}</b></span><span><em className={`metric-tone tone-${attainmentTone(day.attendanceBasisPoints)}`}>{percentText(day.attendanceBasisPoints)}</em></span><span><em className={`metric-tone tone-${attainmentTone(day.hoursBasisPoints)}`}>{percentText(day.hoursBasisPoints)}</em></span></article>)}</div>;
}

function matrixCell(row: ReportOperationsEmployeeRowDTO, date: string) {
  return row.days.find(day => day.date === date);
}

function OperationsMatrix({ report, rows, dates, compact = false }: { report: ReportOperationsDTO | null; rows: ReportOperationsEmployeeRowDTO[]; dates: string[]; compact?: boolean }) {
  const dailyAverage = new Map((report?.dailyAttainmentAverage || []).map(item => [item.date, item]));
  return <div className={`operations-matrix-scroll ${compact ? 'compact' : ''}`} tabIndex={0}><table style={{ '--matrix-days': dates.length } as CSSProperties}><thead><tr><th>班组</th><th>岗位</th><th>姓名</th>{dates.map(date => { const meta = report?.dates.find(item => item.date === date); return <th className={meta?.isWeekend ? 'weekend' : ''} key={date}><strong>{meta?.day}号</strong><small>{meta?.weekday}</small></th>; })}<th>月均</th></tr></thead><tbody>{rows.map(row => <tr key={row.employee.id}><td><strong>{row.team}</strong></td><td><span>{row.position}</span></td><td><strong>{row.employee.name}</strong><small>{row.employee.employeeNo}</small></td>{dates.map(date => { const day = matrixCell(row, date); const tone = attainmentTone(day?.attainmentBasisPoints); const text = day?.status === 'draft' ? '草稿' : day?.status === 'rest' ? '休' : day?.attainmentBasisPoints === null || day?.attainmentBasisPoints === undefined ? '—' : percentText(day.attainmentBasisPoints); return <td className={`matrix-metric tone-${tone} status-${day?.status || 'missing'}`} key={date} title={`${row.employee.name} ${date}：${text}${day ? `，标准 ${compactHours(day.standardLaborMilliseconds)}，出勤 ${compactHours(day.attendanceMilliseconds)}` : ''}`}><strong>{text}</strong>{!compact && day?.attainmentBasisPoints !== null && day?.attainmentBasisPoints !== undefined && <small>{compactHours(day.standardLaborMilliseconds)}</small>}</td>; })}<td className={`matrix-average tone-${attainmentTone(row.attainmentBasisPoints)}`}><strong>{percentText(row.attainmentBasisPoints)}</strong><small>{row.confirmedDays} 天</small></td></tr>)}{!rows.length && <tr><td colSpan={dates.length + 4}><EmptyState icon={<Table2 />} title="没有符合筛选条件的员工数据" /></td></tr>}</tbody>{!compact && <tfoot><tr><td colSpan={3}><strong>车间每日平均达成率</strong></td>{dates.map(date => <td className={`tone-${attainmentTone(dailyAverage.get(date)?.attainmentBasisPoints)}`} key={date}><strong>{percentText(dailyAverage.get(date)?.attainmentBasisPoints)}</strong></td>)}<td><strong>{percentText(report?.summary.attainmentBasisPoints)}</strong></td></tr></tfoot>}</table></div>;
}

function KpiCard({ icon, tone, label, value, note }: { icon: ReactNode; tone: string; label: string; value: string; note: string }) {
  return <article className={`report-kpi tone-${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></article>;
}

function Panel({ kicker, title, action, className = '', children }: { kicker: string; title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`report-panel ${className}`.trim()}><header><div><small>{kicker}</small><h2>{title}</h2></div>{action && <aside>{action}</aside>}</header>{children}</section>;
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="report-empty">{icon}<span>{title}</span></div>;
}

function CompactTrend({ report, max }: { report: ReportCenterOverviewDTO | null; max: number }) {
  return <div className="compact-trend">{(report?.dailyTrend || []).map(item => <article key={item.date}><span>{item.label}</span><div><i className="planned" style={{ width: `${Math.round((item.plannedQty / max) * 100)}%` }} /><i className="completed" style={{ width: `${Math.round((item.completedQty / max) * 100)}%` }} /></div><strong>{numberText(item.completedQty)}</strong></article>)}{!report?.dailyTrend.length && <EmptyState icon={<BarChart3 />} title="暂无趋势数据" />}</div>;
}

function FocusTable({ items, title, onSelect }: { items: ReportCenterFocusItemDTO[]; title: string; onSelect: (item: ReportCenterFocusItemDTO) => void }) {
  return <section className="focus-table"><header><div><small>重点关注</small><h2>{title}</h2></div><span>{items.length} 项</span></header><div className="focus-table-scroll" tabIndex={0}><div className="focus-table-head"><span>任务 / 工单</span><span>完成进度</span><span>当前环节</span><span>责任人</span><span>交期</span><span>风险</span><span /></div>{items.map(item => <button type="button" key={`${item.entityType}-${item.id}`} onClick={() => onSelect(item)}><span className="focus-order"><em>{item.entityType === 'workOrder' ? '量产' : '样品'}</em><strong>{item.code}</strong><small>{item.customerName} · {item.specification}</small></span><span className="focus-progress"><b>{percentText(item.progressBasisPoints)}</b><i><em style={{ width: `${(item.progressBasisPoints || 0) / 100}%` }} /></i><small>{item.completedQty ?? '—'} / {item.plannedQty ?? '—'} {item.unitLabel}</small></span><span><strong>{item.currentProcess || item.statusLabel}</strong><small>{item.nextProcess ? `下一步：${item.nextProcess}` : item.productName}</small></span><span><strong>{item.owner || '待安排'}</strong><small>{item.missingData.length ? item.missingData[0] : '资料已核对'}</small></span><span><strong>{focusDueText(item)}</strong><small>{item.statusLabel}</small></span><span><em className={`risk-${item.risk}`}>{item.riskLabel}</em></span><ChevronRight /></button>)}{!items.length && <EmptyState icon={<ClipboardCheck />} title="当前筛选没有任务或工单" />}</div></section>;
}

function EmployeeTable({ rows, loading }: { rows: EmployeeAttainmentRowDTO[]; loading: boolean }) {
  return <section className="people-table"><header><div><small>人员维度</small><h2>出勤达成率与标准工时</h2></div><span>{rows.length} 人</span></header><div tabIndex={0}><div className="people-table-head"><span>员工</span><span>确认出勤</span><span>标准工时</span><span>免责异常</span><span>工序报工</span><span>出勤达成率</span></div>{rows.map(row => <article key={row.employee.id}><span><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.team || row.employee.department || '未分组'}</small></span><span><b>{formatProcessDuration(row.attendanceMilliseconds)}</b><small>{row.attendanceConfirmedDays} 人日</small></span><span><b>{formatProcessDuration(row.standardLaborMilliseconds)}</b><small>待匹配 {formatProcessDuration(row.unmatchedStandardLaborMilliseconds)}</small></span><span><b>{formatProcessDuration(row.exemptAbnormalMilliseconds)}</b><small>品质确认口径</small></span><span><b>{row.claimCount + row.executionCount} 笔</b><small>良品 {numberText(row.goodQty)}</small></span><span className="attainment"><b>{percentText(row.attainmentBasisPoints)}</b><i><em style={{ width: `${(row.attainmentBasisPoints || 0) / 100}%` }} /></i></span></article>)}{!loading && !rows.length && <EmptyState icon={<UsersRound />} title="当前周期没有员工工时记录" />}</div></section>;
}

function LaborLedger({ pools, loading }: { pools: ProcessLaborPoolDTO[]; loading: boolean }) {
  const rows = pools.flatMap(pool => pool.claims.map(claim => ({ pool, claim })));
  return <section className="labor-ledger"><header><div><small>标准工时自动入账</small><h2>报工与员工工时映射</h2></div><span>{rows.length} 笔</span></header><div tabIndex={0}>{rows.map(({ pool, claim }) => <article key={claim.id}><span><strong>{pool.workOrder.code}</strong><small>{pool.workOrder.customerName || '客户未填写'} · {pool.workOrder.specification || pool.workOrder.productName}</small></span><span><small>工序</small><b>{pool.step.processName}</b></span><span><small>作业员工</small><b>{claim.employee.name}</b></span><span><small>报工数量</small><b>{claim.quantity} {pool.unitLabel}</b></span><span><small>标准工时</small><b>{formatProcessDuration(claim.standardLaborMilliseconds)}</b></span><span><small>入账时间</small><b>{dateText(claim.claimedAt)}</b></span></article>)}{loading && <div className="report-empty"><Loader2 className="spin" /><span>正在加载自动记工</span></div>}{!loading && !rows.length && <EmptyState icon={<Clock3 />} title="所选日期没有自动记工记录" />}</div></section>;
}

function FocusDrawer({ item, onClose }: { item: ReportCenterFocusItemDTO; onClose: () => void }) {
  return <div className="focus-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="focus-drawer" role="dialog" aria-modal="true" aria-label={`${item.code}详情`}><header><div><small>{item.entityType === 'workOrder' ? '量产工单' : '样品任务'}</small><h2>{item.code}</h2><p>{item.customerName} · {item.productName}</p></div><button type="button" aria-label="关闭详情" onClick={onClose}><X /></button></header><div className="focus-drawer-status"><span className={`risk-${item.risk}`}><AlertTriangle />{item.riskLabel}</span><strong>{item.statusLabel}</strong></div><dl><div><dt>规格</dt><dd>{item.specification}</dd></div><div><dt>完成进度</dt><dd>{percentText(item.progressBasisPoints)} · {item.completedQty ?? '—'} / {item.plannedQty ?? '—'} {item.unitLabel}</dd></div><div><dt>当前环节</dt><dd>{item.currentProcess || '未进入流程'}</dd></div><div><dt>下一环节</dt><dd>{item.nextProcess || '无后续环节'}</dd></div><div><dt>责任人</dt><dd>{item.owner || '待安排'}</dd></div><div><dt>计划交期</dt><dd>{focusDueText(item)}</dd></div></dl><section><h3>资料与风险</h3>{item.missingData.length ? item.missingData.map(text => <p key={text}><FileWarning />{text}</p>) : <p className="ready"><FileCheck2 />核心资料检查已通过</p>}</section><footer><Link href={safeHref(item)} prefetch={false}>打开业务详情<ChevronRight /></Link></footer></aside></div>;
}
