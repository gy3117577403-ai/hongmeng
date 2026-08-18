'use client';

import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
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
  TimerOff,
  UsersRound,
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
} from '@/types';

type ReportView = 'overview' | 'production' | 'people' | 'quality' | 'sample';
type PeopleView = 'attainment' | 'labor';
type ApiResponse<T> = { ok: boolean; report?: T; error?: string };
type LaborResponse = { ok: boolean; pools?: ProcessLaborPoolDTO[]; error?: string };

const reportTabs: Array<{ key: ReportView; label: string }> = [
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

function rangeText(report: ReportCenterOverviewDTO | null): string {
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
  const [view, setView] = useState<ReportView>('overview');
  const [peopleView, setPeopleView] = useState<PeopleView>('attainment');
  const [period, setPeriod] = useState<ReportCenterPeriodDTO>('week');
  const [date, setDate] = useState(todayKey);
  const [mode, setMode] = useState<ReportCenterModeDTO>('all');
  const [customer, setCustomer] = useState('');
  const [keyword, setKeyword] = useState('');
  const [overview, setOverview] = useState<ReportCenterOverviewDTO | null>(null);
  const [employeeReport, setEmployeeReport] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [abnormalReport, setAbnormalReport] = useState<AbnormalTimeReportDTO | null>(null);
  const [laborPools, setLaborPools] = useState<ProcessLaborPoolDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [laborLoading, setLaborLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedFocus, setSelectedFocus] = useState<ReportCenterFocusItemDTO | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view');
    if (requested === 'labor' || requested === 'manual') {
      setView('people');
      setPeopleView('labor');
    } else if (requested === 'employee') setView('people');
    else if (requested === 'abnormal') setView('quality');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const overviewParams = new URLSearchParams({ period, date, mode });
    if (customer) overviewParams.set('customer', customer);
    const detailParams = new URLSearchParams({ period, date });
    Promise.all([
      fetch(`/api/reports/overview?${overviewParams}`, { cache: 'no-store', signal: controller.signal }),
      fetch(`/api/reports/employee-attainment?${detailParams}`, { cache: 'no-store', signal: controller.signal }),
      fetch(`/api/reports/abnormal-time?${detailParams}`, { cache: 'no-store', signal: controller.signal }),
    ]).then(async ([overviewResponse, employeeResponse, abnormalResponse]) => {
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
    }).catch(reason => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '报表加载失败');
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [customer, date, mode, period, refreshToken]);

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

  const employeeSummary = employeeReport?.summary;
  const abnormalSummary = abnormalReport?.summary;
  const summary = overview?.summary;
  const customerScopedView = view === 'overview' || view === 'production' || view === 'sample';
  const maxTrend = Math.max(1, ...(overview?.dailyTrend || []).flatMap(item => [item.plannedQty, item.completedQty]));
  const maxBottleneck = Math.max(1, ...(overview?.processBottlenecks || []).map(item => item.pendingQty));

  function exportCurrentView(): void {
    const stamp = `${date}-${period}`;
    if (view === 'people') {
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
        <div className="report-center-title"><span><BarChart3 /></span><div><small>数据决策</small><h1>报表中心</h1></div><em>{reportTabs.find(item => item.key === view)?.label}</em></div>
        <div className="report-center-source"><Database /><span><strong>真实业务数据</strong><small>金额类指标未启用</small></span></div>
        <label className="report-center-search"><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索工单、客户、产品或员工" aria-label="搜索报表" /></label>
        <button className="icon" type="button" title="刷新报表" aria-label="刷新报表" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} /></button>
        <button type="button" onClick={exportCurrentView}><Download />导出</button>
      </section>

      <section className="report-center-tabs" aria-label="报表分类">
        <div role="tablist">{reportTabs.map(tab => <button className={view === tab.key ? 'active' : ''} type="button" role="tab" aria-selected={view === tab.key} key={tab.key} onClick={() => setView(tab.key)}>{tab.label}</button>)}</div>
        <div className="report-center-filter-pair">
          {customerScopedView ? <><label><Layers3 /><select value={mode} onChange={event => setMode(event.target.value as ReportCenterModeDTO)} aria-label="生产类型"><option value="all">量产 + 样品</option><option value="mass">仅量产</option><option value="sample">仅样品</option></select></label>
            <label><UsersRound /><select value={customer} onChange={event => setCustomer(event.target.value)} aria-label="客户筛选"><option value="">全部客户</option>{(overview?.customers || []).map(item => <option value={item} key={item}>{item}</option>)}</select></label></> : <span className="report-center-scope-pill"><UsersRound />全厂人员与异常口径</span>}
        </div>
      </section>

      <section className="report-center-period-bar">
        <div>{(['today', 'week', 'month'] as ReportCenterPeriodDTO[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{item === 'today' ? '今日' : item === 'week' ? '本周' : '本月'}</button>)}</div>
        <label><CalendarDays /><input type="date" value={date} onChange={event => setDate(event.target.value)} /><span>{rangeText(overview)}</span></label>
        <p><ShieldCheck />{customer && customerScopedView ? '客户筛选仅作用于量产、样品和资料；人员与异常保持全厂口径' : '成品数量只统计最终工序良品，工序数据仅用于瓶颈和质量分析'}</p>
        <small>{overview ? `更新于 ${dateText(overview.generatedAt).slice(-5)}` : '正在更新'}</small>
      </section>

      <section className="report-center-kpis" aria-label="关键指标">
        <KpiCard icon={<Gauge />} tone="orange" label={overview?.quantityScope.label || '数量达成率'} value={percentText(summary?.completionBasisPoints)} note={`${numberText(summary?.completedQty || 0)} / ${numberText(summary?.plannedQty || 0)} ${overview?.quantityScope.unitLabel || ''}`} />
        <KpiCard icon={<ClipboardCheck />} tone="green" label="完成任务/工单" value={numberText(summary?.completedOrders || 0)} note={`进行中 ${summary?.activeOrders || 0} · 待开始 ${summary?.pendingOrders || 0}`} />
        <KpiCard icon={<Clock3 />} tone="blue" label="全厂出勤达成率" value={percentText(employeeSummary?.attainmentBasisPoints)} note={`标准工时 ${formatProcessDuration(employeeSummary?.standardLaborMilliseconds || 0)}`} />
        <KpiCard icon={<TimerOff />} tone="amber" label="全厂异常影响人时" value={formatProcessDuration(abnormalSummary?.affectedPersonMilliseconds || 0)} note={`未关闭 ${abnormalSummary?.openCount || 0} 条`} />
        <KpiCard icon={<CircleAlert />} tone="red" label="逾期风险" value={numberText(summary?.overdueOrders || 0)} note={`未来 2 天 ${summary?.dueSoonOrders || 0} 项`} />
        <KpiCard icon={<Database />} tone="purple" label={mode === 'sample' ? '审核完成率' : '资料完整率'} value={percentText(summary?.dataCompletenessBasisPoints)} note={mode === 'sample' ? `待审核 ${summary?.pendingSampleReviewItems || 0} 项` : `核心检查：路线 / 工时 / 图纸`} />
      </section>

      {error && <div className="report-center-error" role="alert"><AlertTriangle />{error}<button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}
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

      {loading && !overview && <div className="report-center-loading"><Loader2 className="spin" /><strong>正在汇总真实业务数据</strong><span>成品、工序、人员、异常与样品资料分别按各自口径计算</span></div>}
    </div>
    {selectedFocus && <FocusDrawer item={selectedFocus} onClose={() => setSelectedFocus(null)} />}
    {toast && <div className="report-center-toast"><CheckCircle2 />{toast}</div>}
  </main>;
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
