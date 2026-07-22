'use client';

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  TimerOff,
  UsersRound,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  AbnormalTimeReportDTO,
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeAttainmentRowDTO,
  ProcessExecutionContextDTO,
  WorkflowItemDTO,
  WorkflowSummaryDTO,
  WorkflowTemplateDTO,
  WorkflowWeekScope,
} from '@/types';

type Period = EmployeeAttainmentReportDTO['period'];
type ViewKey = 'employee' | 'abnormal' | 'manual';
type ReportResponse = { ok: boolean; report?: EmployeeAttainmentReportDTO; error?: string };
type AbnormalReportResponse = { ok: boolean; report?: AbnormalTimeReportDTO; error?: string };
type WorkflowResponse = {
  ok: boolean;
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  templates: WorkflowTemplateDTO[];
  error?: string;
};
type ProcessExecutionForm = {
  employeeId: string;
  startedAt: string;
  endedAt: string;
  breakMinutes: string;
  goodQty: string;
  scrapQty: string;
  reworkQty: string;
  remark: string;
};

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function percent(value: number | null): string {
  return value === null ? '无有效生产时段' : `${(value / 100).toFixed(1)}%`;
}

function attainmentClass(value: number | null): string {
  if (value === null) return 'empty';
  if (value >= 10_000) return 'good';
  if (value >= 8_000) return 'watch';
  return 'low';
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function shortDate(value: string): string {
  const dateOnly = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly.slice(5).replace('-', '/') : value;
}

function periodLabel(period: Period): string {
  return period === 'month' ? '本月' : period === 'week' ? '本周' : '当日';
}

function safeLocalRoute(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/production';
}

function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function positiveWholeNumber(value: string): number | null {
  return /^[1-9]\d*$/.test(value.trim()) ? Number(value) : null;
}

function nonnegativeWholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

function executionPreview(context: ProcessExecutionContextDTO | null, form: ProcessExecutionForm | null): {
  standardMilliseconds: number;
  actualMilliseconds: number;
  attainmentBasisPoints: number;
} | null {
  if (!context?.standard || !form) return null;
  const goodQty = positiveWholeNumber(form.goodQty);
  const breakMinutes = Number(form.breakMinutes || 0);
  const startedAt = new Date(form.startedAt);
  const endedAt = new Date(form.endedAt);
  if (!goodQty || !Number.isFinite(breakMinutes) || breakMinutes < 0 || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
  const actualMilliseconds = endedAt.getTime() - startedAt.getTime() - Math.round(breakMinutes * 60_000);
  if (actualMilliseconds <= 0) return null;
  const standardMilliseconds = context.standard.source === 'product_profile'
    ? context.standard.standardMillisecondsPerUnit * goodQty
    : context.standard.setupMilliseconds + (
      context.standard.timeBasis === 'per_batch'
        ? context.standard.standardMillisecondsPerUnit
        : context.standard.standardMillisecondsPerUnit * context.standard.unitsPerProduct * goodQty
    );
  return {
    standardMilliseconds,
    actualMilliseconds,
    attainmentBasisPoints: Math.round(standardMilliseconds * 10_000 / actualMilliseconds),
  };
}

export default function EmployeeAttainmentReportShell({ user }: { user: CurrentUserDTO }) {
  const [view, setView] = useState<ViewKey>('employee');
  const [period, setPeriod] = useState<Period>('today');
  const [date, setDate] = useState(todayKey);
  const [report, setReport] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [abnormalReport, setAbnormalReport] = useState<AbnormalTimeReportDTO | null>(null);
  const [keyword, setKeyword] = useState('');
  const [expandedEmployeeId, setExpandedEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'manual') setView('manual');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ period, date });
    Promise.all([
      fetch(`/api/reports/employee-attainment?${params}`, { cache: 'no-store', signal: controller.signal }),
      fetch(`/api/reports/abnormal-time?${params}`, { cache: 'no-store', signal: controller.signal }),
    ]).then(async ([employeeResponse, abnormalResponse]) => {
      const employeeBody = await employeeResponse.json() as ReportResponse;
      const abnormalBody = await abnormalResponse.json() as AbnormalReportResponse;
      if (!employeeResponse.ok || !employeeBody.report) throw new Error(employeeBody.error || '员工达成率报表加载失败');
      if (!abnormalResponse.ok || !abnormalBody.report) throw new Error(abnormalBody.error || '异常工时汇总加载失败');
      setReport(employeeBody.report);
      setAbnormalReport(abnormalBody.report);
    }).catch(reason => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '报表加载失败');
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [date, period, refreshToken]);

  const rows = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return report?.rows || [];
    return (report?.rows || []).filter(row =>
      `${row.employee.employeeNo} ${row.employee.name} ${row.employee.department || ''} ${row.employee.position || ''} ${row.employee.team || ''}`
        .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [keyword, report?.rows]);

  const abnormalEvents = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return abnormalReport?.events || [];
    return (abnormalReport?.events || []).filter(event =>
      `${event.sequence} ${event.categoryLabel} ${event.title} ${event.reason || ''} ${event.allocations.map(item => item.employee.name).join(' ')}`
        .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [abnormalReport?.events, keyword]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  const summary = report?.summary;
  const abnormalSummary = abnormalReport?.summary;

  return (
    <main className="employee-report-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/reports"
        subtitle="出勤达成率、工序效率与异常损失"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => void logout() }]}
      />
      <div className="employee-report-frame">
        <section className="employee-report-command" aria-labelledby="employee-attainment-title">
          <div>
            <span>报表中心</span>
            <h1 id="employee-attainment-title">员工效率与异常工时</h1>
            <p>报工进入个人明细，达成率按标准完成工时 ÷〔（确认出勤－品质确认免责异常）× 95%〕计算。</p>
          </div>
          <nav aria-label="报表关联入口">
            <a className="hm-workbench-button" href="/workspace/attendance"><CalendarClock size={15} />考勤与异常</a>
            <a className="hm-workbench-button" href="/workspace/product-times"><Clock3 size={15} />产品工序与工时</a>
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button>
          </nav>
        </section>

        <section className="employee-report-summary" aria-label="达成率与异常概览">
          <article><UsersRound /><span>参与员工<small>{periodLabel(period)}在用员工</small></span><strong>{summary?.employeeCount || 0}</strong></article>
          <article><CalendarClock /><span>确认出勤<small>{summary?.attendanceConfirmedDays || 0} 人日，缺失 {summary?.attendanceMissingCount || 0} 人</small></span><strong>{formatProcessDuration(summary?.attendanceMilliseconds || 0)}</strong></article>
          <article><TimerOff /><span>免责异常<small>品质确认后扣除个人基数</small></span><strong>{formatProcessDuration(summary?.exemptAbnormalMilliseconds || 0)}</strong></article>
          <article><Clock3 /><span>标准完成工时<small>已完成工序标准时间</small></span><strong>{formatProcessDuration(summary?.standardLaborMilliseconds || 0)}</strong></article>
          <article className={attainmentClass(summary?.attainmentBasisPoints ?? null)}><Gauge /><span>出勤达成率<small>标准工时 ÷（有效出勤 × 95%）</small></span><strong>{percent(summary?.attainmentBasisPoints ?? null)}</strong></article>
          <article className={abnormalSummary?.openCount ? 'watch' : 'good'}><AlertTriangle /><span>异常影响人时<small>未关闭 {abnormalSummary?.openCount || 0} 条</small></span><strong>{formatProcessDuration(abnormalSummary?.affectedPersonMilliseconds || 0)}</strong></article>
        </section>

        <section className="employee-report-toolbar">
          <div className="employee-report-view" role="tablist" aria-label="报表视图">
            <button className={view === 'employee' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'employee'} onClick={() => setView('employee')}><Gauge size={15} />员工达成率</button>
            <button className={view === 'abnormal' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'abnormal'} onClick={() => setView('abnormal')}><AlertTriangle size={15} />异常汇总</button>
            <button className={view === 'manual' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'manual'} onClick={() => setView('manual')}><ClipboardCheck size={15} />手工报工</button>
          </div>
          {view !== 'manual' && <>
            <div className="employee-report-period" role="group" aria-label="报表周期">
              {(['today', 'week', 'month'] as Period[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>)}
            </div>
            <label className="employee-report-date"><span>统计日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
            <label className="employee-report-search"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={view === 'employee' ? '搜索员工编号、姓名、岗位或班组' : '搜索异常、员工或分类'} /></label>
          </>}
          {view === 'manual' && <p className="employee-report-manual-hint">选择当前生产工序和一名员工，登记数量与实际作业时间。</p>}
        </section>

        {error && view !== 'manual' && <div className="employee-report-error" role="alert">{error}</div>}

        {view === 'employee' ? <section className="employee-report-table" aria-labelledby="employee-report-list-title">
          <header><div><span>员工维度</span><h2 id="employee-report-list-title">{periodLabel(period)}出勤达成率</h2></div><em>{rows.length} 人</em></header>
          <div className="employee-report-scroll hm-scroll-region" tabIndex={0}>
            <div className="employee-report-head" aria-hidden="true"><span>员工</span><span>确认出勤</span><span>免责异常</span><span>标准工时</span><span>工序效率</span><span>出勤达成率</span><span /></div>
            {rows.map(row => <EmployeeReportRow row={row} expanded={expandedEmployeeId === row.employee.id} key={row.employee.id} onToggle={() => setExpandedEmployeeId(current => current === row.employee.id ? '' : row.employee.id)} />)}
            {!loading && !rows.length && <div className="employee-report-empty"><Gauge /><strong>暂无符合条件的员工记录</strong><span>先登记并确认考勤，再从生产执行完成工序报工。</span></div>}
            {loading && <div className="employee-report-empty"><RefreshCw className="spin" /><strong>正在加载报表</strong></div>}
          </div>
        </section> : view === 'abnormal' ? <section className="employee-report-table abnormal-report-table" aria-labelledby="abnormal-report-list-title">
          <header><div><span>异常损失</span><h2 id="abnormal-report-list-title">{periodLabel(period)}异常工时汇总</h2></div><em>{abnormalEvents.length} 条</em></header>
          <div className="abnormal-report-body hm-scroll-region" tabIndex={0}>
            <div className="abnormal-report-categories">{(abnormalReport?.categories || []).map(category => <article key={category.category}><span>{category.categoryLabel}</span><strong>{formatProcessDuration(category.affectedPersonMilliseconds)}</strong><small>{category.eventCount} 条 · 事件 {formatProcessDuration(category.incidentMilliseconds)}</small></article>)}</div>
            <div className="abnormal-report-list">{abnormalEvents.map(event => <article key={event.id}>
              <div><em>#{event.sequence}</em><strong>{event.title}</strong><small>{event.categoryLabel} · {event.allocations.map(item => item.employee.name).join('、')}</small></div>
              <span><small>事件时长</small><b>{formatProcessDuration(event.durationMilliseconds)}</b></span>
              <span><small>影响人时</small><b>{formatProcessDuration(event.affectedPersonMilliseconds)}</b></span>
              <span><small>品质口径</small><b>{event.qualityStatus === 'pending' ? '待确认' : event.qualityStatus === 'rejected' ? '已驳回' : event.employeeExempt ? '已确认免责' : '已确认不免责'}</b></span>
              <span><small>处理状态</small><b>{event.resolutionStatus === 'resolved' ? '已关闭' : '处理中'}</b></span>
            </article>)}</div>
            {!loading && !abnormalEvents.length && <div className="employee-report-empty"><ShieldCheck /><strong>当前周期没有异常工时</strong><span>已登记的异常会同时显示事件时长和受影响员工人时。</span></div>}
          </div>
        </section> : <ManualEmployeeReportPanel onCommitted={() => setRefreshToken(value => value + 1)} />}
      </div>
    </main>
  );
}

const workflowWeekOptions: Array<{ key: WorkflowWeekScope; label: string }> = [
  { key: 'carryover', label: '遗留未完' },
  { key: 'current', label: '本周' },
  { key: 'next', label: '下周' },
  { key: 'history', label: '历史周' },
  { key: 'all', label: '全部' },
];

function workflowItemKey(item: WorkflowItemDTO): string {
  return item.workOrderId || item.entityId;
}

function processStageLabel(stage: WorkflowItemDTO['steps'][number]['stageGroup']): string {
  if (stage === 'frontend') return '前端';
  if (stage === 'backend') return '后端';
  if (stage === 'finish') return '完工';
  return '工序';
}

function ManualEmployeeReportPanel({ onCommitted }: { onCommitted: () => void }) {
  const [initialized, setInitialized] = useState(false);
  const [weekScope, setWeekScope] = useState<WorkflowWeekScope>('current');
  const [returnTo, setReturnTo] = useState('/production');
  const [sourcePage, setSourcePage] = useState('生产执行');
  const [requestedWorkOrderId, setRequestedWorkOrderId] = useState('');
  const [requestedStepId, setRequestedStepId] = useState('');
  const [items, setItems] = useState<WorkflowItemDTO[]>([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('');
  const [selectedStepId, setSelectedStepId] = useState('');
  const [context, setContext] = useState<ProcessExecutionContextDTO | null>(null);
  const [form, setForm] = useState<ProcessExecutionForm | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingContext, setLoadingContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedScope = params.get('weekScope') as WorkflowWeekScope | null;
    if (requestedScope && workflowWeekOptions.some(option => option.key === requestedScope)) setWeekScope(requestedScope);
    setRequestedWorkOrderId(String(params.get('workOrderId') || ''));
    setRequestedStepId(String(params.get('stepId') || ''));
    setReturnTo(safeLocalRoute(params.get('returnTo')));
    setSourcePage(params.get('from') === 'workflow' ? '流程中心' : '生产执行');
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    setLoadingItems(true);
    setError('');
    const params = new URLSearchParams({ entityType: 'production', weekScope });
    fetch(`/api/workflows?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json() as WorkflowResponse;
        if (!response.ok || !body.ok) throw new Error(body.error || '生产工序加载失败');
        const actionable = body.items.filter(item => (
          Boolean(item.processRouteId)
          && item.routeSource === 'product_time_profile'
          && item.productTimeProfileVersion !== null
          && item.steps.some(step => step.state === 'current')
        ));
        setItems(actionable);
        setSelectedWorkOrderId(current => {
          if (actionable.some(item => workflowItemKey(item) === current)) return current;
          const requested = actionable.find(item => item.workOrderId === requestedWorkOrderId || item.entityId === requestedWorkOrderId);
          return requested ? workflowItemKey(requested) : actionable[0] ? workflowItemKey(actionable[0]) : '';
        });
      })
      .catch(reason => {
        if ((reason as { name?: string }).name === 'AbortError') return;
        setItems([]);
        setError(reason instanceof Error ? reason.message : '生产工序加载失败');
      })
      .finally(() => setLoadingItems(false));
    return () => controller.abort();
  }, [initialized, reloadToken, requestedWorkOrderId, weekScope]);

  const selectedItem = useMemo(
    () => items.find(item => workflowItemKey(item) === selectedWorkOrderId) || null,
    [items, selectedWorkOrderId],
  );
  const currentSteps = useMemo(
    () => selectedItem?.steps.filter(step => step.state === 'current') || [],
    [selectedItem],
  );
  const selectedStep = useMemo(
    () => currentSteps.find(step => step.key === selectedStepId) || null,
    [currentSteps, selectedStepId],
  );

  useEffect(() => {
    setSelectedStepId(current => {
      if (currentSteps.some(step => step.key === current)) return current;
      if (currentSteps.some(step => step.key === requestedStepId)) return requestedStepId;
      return currentSteps[0]?.key || '';
    });
  }, [currentSteps, requestedStepId]);

  useEffect(() => {
    if (!selectedStepId) {
      setContext(null);
      setForm(null);
      return;
    }
    const controller = new AbortController();
    setLoadingContext(true);
    setError('');
    fetch(`/api/process-executions/context?stepId=${encodeURIComponent(selectedStepId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json() as { ok: boolean; context?: ProcessExecutionContextDTO; error?: string };
        if (!response.ok || !body.context) throw new Error(body.error || '报工上下文加载失败');
        setContext(body.context);
        setForm({
          employeeId: '',
          startedAt: dateTimeLocalValue(body.context.suggestedStartedAt),
          endedAt: dateTimeLocalValue(body.context.suggestedEndedAt),
          breakMinutes: '0',
          goodQty: body.context.remainingGoodQuantity > 0 ? String(body.context.remainingGoodQuantity) : '',
          scrapQty: '0',
          reworkQty: '0',
          remark: '',
        });
      })
      .catch(reason => {
        if ((reason as { name?: string }).name === 'AbortError') return;
        setContext(null);
        setForm(null);
        setError(reason instanceof Error ? reason.message : '报工上下文加载失败');
      })
      .finally(() => setLoadingContext(false));
    return () => controller.abort();
  }, [selectedStepId, reloadToken]);

  const preview = executionPreview(context, form);

  function updateForm<K extends keyof ProcessExecutionForm>(key: K, value: ProcessExecutionForm[K]): void {
    setForm(current => current ? { ...current, [key]: value } : current);
  }

  async function submitExecution(): Promise<void> {
    if (!selectedItem?.processRouteId || selectedItem.routeVersion === null || selectedItem.routeVersion === undefined || !selectedStep || !context || !form) return;
    const goodQty = positiveWholeNumber(form.goodQty);
    const scrapQty = nonnegativeWholeNumber(form.scrapQty);
    const reworkQty = nonnegativeWholeNumber(form.reworkQty);
    const breakMinutes = Number(form.breakMinutes || 0);
    const startedAt = new Date(form.startedAt);
    const endedAt = new Date(form.endedAt);
    if (!form.employeeId) return setError('请选择一名报工员工');
    if (!context.standard) return setError('当前工序没有可用的产品标准工时，请先维护并发布产品工序与工时');
    if (!goodQty || goodQty > context.remainingGoodQuantity) return setError(`合格数量必须为 1 至 ${context.remainingGoodQuantity} 的整数`);
    if (scrapQty === null || reworkQty === null) return setError('报废数量和返工数量必须为非负整数');
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0) return setError('休息时间不能小于 0');
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt <= startedAt) return setError('结束时间必须晚于开始时间');
    if (endedAt.getTime() - startedAt.getTime() <= breakMinutes * 60_000) return setError('休息时间必须小于本次作业时长');

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/process-management/routes/${selectedItem.processRouteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'advance',
          version: selectedItem.routeVersion,
          stepId: selectedStep.key,
          execution: {
            employeeId: form.employeeId,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            breakMilliseconds: Math.round(breakMinutes * 60_000),
            goodQty,
            scrapQty,
            reworkQty,
            remark: form.remark.trim() || null,
          },
        }),
      });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || '报工提交失败');
      setToast(`${selectedItem.code} · ${selectedStep.label} 已完成报工`);
      window.setTimeout(() => setToast(''), 3_000);
      onCommitted();
      setReloadToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '报工提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="manual-report-panel" aria-labelledby="manual-report-title">
    <header className="manual-report-header">
      <div>
        <span>生产报工</span>
        <h2 id="manual-report-title">单员工手工报工</h2>
        <p>只登记当前可执行工序，提交后同步路线进度和员工报表。</p>
      </div>
      <div className="manual-report-header-actions">
        <a className="hm-workbench-button" href={returnTo}><ArrowLeft size={15} />返回{sourcePage}</a>
        <a className="hm-workbench-button" href="/workspace/workflows"><Workflow size={15} />流程中心</a>
      </div>
    </header>

    <div className="manual-report-week-tabs" role="tablist" aria-label="生产周范围">
      {workflowWeekOptions.map(option => <button type="button" role="tab" aria-selected={weekScope === option.key} className={weekScope === option.key ? 'active' : ''} key={option.key} onClick={() => setWeekScope(option.key)}>{option.label}</button>)}
    </div>

    {error && <div className="manual-report-error" role="alert"><AlertTriangle size={16} />{error}</div>}

    <div className="manual-report-layout">
      <aside className="manual-report-orders" aria-label="可报工生产订单">
        <header><span>待报工工单</span><strong>{items.length}</strong></header>
        <div className="hm-scroll-region" tabIndex={0}>
          {items.map(item => <button type="button" className={selectedWorkOrderId === workflowItemKey(item) ? 'active' : ''} key={item.id} onClick={() => setSelectedWorkOrderId(workflowItemKey(item))}>
            <span><strong>{item.code}</strong><small>{item.title}</small></span>
            <em>{item.currentStep}</em>
            <small>{item.weekStartDate && item.weekEndDate ? `${shortDate(item.weekStartDate)} - ${shortDate(item.weekEndDate)}` : '生产周未设置'} · {item.quantity || 0} 件</small>
          </button>)}
          {!loadingItems && !items.length && <div className="manual-report-empty"><ClipboardCheck /><strong>当前范围没有可报工工序</strong><span>已完成、未发布工艺或尚未进入当前节点的工单不会显示。</span></div>}
          {loadingItems && <div className="manual-report-empty"><Loader2 className="spin" /><strong>正在加载生产工序</strong></div>}
        </div>
      </aside>

      <div className="manual-report-workspace">
        {selectedItem && <>
          <section className="manual-report-order-summary">
            <div><span>当前工单</span><strong>{selectedItem.code}</strong><small>{selectedItem.title} · {selectedItem.subtitle}</small></div>
            <dl><div><dt>目标数量</dt><dd>{selectedItem.quantity || 0}</dd></div><div><dt>路线版本</dt><dd>R{selectedItem.routeVersion || 0}</dd></div><div><dt>当前节点</dt><dd>{selectedItem.currentStep}</dd></div><div><dt>下一节点</dt><dd>{selectedItem.nextStep || '完成归档'}</dd></div></dl>
          </section>

          <section className="manual-report-step-selector" aria-label="当前可报工工序">
            {currentSteps.map(step => <button type="button" className={selectedStepId === step.key ? 'active' : ''} key={step.key} onClick={() => setSelectedStepId(step.key)}>
              <span>{processStageLabel(step.stageGroup)}</span><strong>{step.label}</strong><small>已报 {step.reportedGoodQuantity || 0} · 剩余 {step.remainingGoodQuantity ?? selectedItem.quantity ?? 0}</small>
            </button>)}
          </section>

          <section className="manual-report-notes" aria-label="产品与订单工艺备注">
            <article><FileText size={15} /><span><strong>产品标准备注</strong><small>{selectedStep?.productRemark || selectedItem.productRemark || '暂无产品标准备注'}</small></span></article>
            <article><ClipboardCheck size={15} /><span><strong>当前订单临时备注</strong><small>{selectedStep?.remark || selectedItem.orderRemark || '暂无当前订单临时备注'}</small></span></article>
          </section>

          {loadingContext && <div className="manual-report-loading"><Loader2 className="spin" />正在读取报工标准</div>}
          {!loadingContext && context && form && <form className="manual-report-form" onSubmit={event => { event.preventDefault(); void submitExecution(); }}>
            <div className="manual-report-standard">
              <span><small>工序</small><strong>{context.processName}</strong></span>
              <span><small>单件 / 套标准</small><strong>{context.standard ? formatProcessDuration(context.standard.standardMillisecondsPerUnit) : '未维护'}</strong></span>
              <span><small>已报 / 剩余</small><strong>{context.reportedGoodQuantity} / {context.remainingGoodQuantity}</strong></span>
              <span><small>达成率预估</small><strong>{preview ? percent(preview.attainmentBasisPoints) : '待填写'}</strong></span>
            </div>
            <div className="manual-report-fields">
              <label><span>报工员工 *</span><select value={form.employeeId} onChange={event => updateForm('employeeId', event.target.value)}><option value="">选择一名员工</option>{context.employees.map(employee => <option value={employee.id} key={employee.id}>{employee.employeeNo} · {employee.name}{employee.position ? ` · ${employee.position}` : ''}</option>)}</select></label>
              <label><span>合格数量 *</span><input type="number" min="1" max={context.remainingGoodQuantity} step="1" value={form.goodQty} onChange={event => updateForm('goodQty', event.target.value)} /></label>
              <label><span>开始时间 *</span><input type="datetime-local" value={form.startedAt} onChange={event => updateForm('startedAt', event.target.value)} /></label>
              <label><span>结束时间 *</span><input type="datetime-local" value={form.endedAt} onChange={event => updateForm('endedAt', event.target.value)} /></label>
              <label><span>休息（分钟）</span><input type="number" min="0" step="1" value={form.breakMinutes} onChange={event => updateForm('breakMinutes', event.target.value)} /></label>
              <label><span>报废数量</span><input type="number" min="0" step="1" value={form.scrapQty} onChange={event => updateForm('scrapQty', event.target.value)} /></label>
              <label><span>返工数量</span><input type="number" min="0" step="1" value={form.reworkQty} onChange={event => updateForm('reworkQty', event.target.value)} /></label>
              <label className="manual-report-remark"><span>本次报工说明</span><input value={form.remark} maxLength={300} placeholder="选填，只记录本次报工情况" onChange={event => updateForm('remark', event.target.value)} /></label>
            </div>
            <footer>
              <div>{preview ? <><span>标准完成工时 <b>{formatProcessDuration(preview.standardMilliseconds)}</b></span><span>实际有效工时 <b>{formatProcessDuration(preview.actualMilliseconds)}</b></span></> : <span>填写数量和有效时间后实时预估达成率</span>}</div>
              <button type="submit" disabled={submitting || !context.standard}><Send size={16} />{submitting ? '提交中' : '确认报工'}</button>
            </footer>
          </form>}
        </>}
        {!selectedItem && !loadingItems && <div className="manual-report-empty large"><ClipboardCheck /><strong>请选择可报工工单</strong><span>可从生产执行卡片或流程中心直接带入当前工单和工序。</span></div>}
      </div>
    </div>
    {toast && <div className="employee-report-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </section>;
}

function EmployeeReportRow({ row, expanded, onToggle }: { row: EmployeeAttainmentRowDTO; expanded: boolean; onToggle: () => void }) {
  return <article className={`employee-report-row ${expanded ? 'expanded' : ''}`}>
    <button className="employee-report-row-main" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span className="employee-cell"><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.department || '部门未设置'}{row.employee.position ? ` / ${row.employee.position}` : ''}{row.employee.team ? ` / ${row.employee.team}` : ''}</small></span>
      <b>{row.attendanceMissing ? '未录考勤' : formatProcessDuration(row.attendanceMilliseconds)}</b>
      <b>{formatProcessDuration(row.exemptAbnormalMilliseconds)}</b>
      <b>{formatProcessDuration(row.standardLaborMilliseconds)}</b>
      <em className={attainmentClass(row.processEfficiencyBasisPoints)}>{percent(row.processEfficiencyBasisPoints)}</em>
      <em className={attainmentClass(row.attainmentBasisPoints)}>{percent(row.attainmentBasisPoints)}</em>
      {expanded ? <ChevronDown /> : <ChevronRight />}
    </button>
    {expanded && <div className="employee-report-details">
      <div className="employee-report-metric-detail">
        <span><small>有效出勤</small><b>{formatProcessDuration(row.effectiveProductionMilliseconds)}</b></span>
        <span><small>考核工时（95%）</small><b>{formatProcessDuration(row.attainmentCapacityMilliseconds)}</b></span>
        <span><small>原始出勤产出率</small><b>{percent(row.rawAttendanceOutputBasisPoints)}</b></span>
        <span><small>时间覆盖率</small><b>{percent(row.coverageBasisPoints)}</b></span>
        <span><small>未解释时间</small><b>{formatProcessDuration(row.unexplainedMilliseconds)}</b></span>
        <span><small>确认考勤</small><b>{row.attendanceConfirmedDays} 人日</b></span>
      </div>
      {row.details.map(detail => <div key={detail.id}>
        <span><strong>{detail.processName}</strong><small>{detail.customerName || '客户未设置'} · {detail.specification || detail.workOrderCode}</small></span>
        <span><small>作业时间</small><b>{dateTime(detail.startedAt)} - {dateTime(detail.endedAt)}</b></span>
        <span><small>标准 / 实际</small><b>{formatProcessDuration(detail.standardLaborMilliseconds)} / {formatProcessDuration(detail.actualLaborMilliseconds)}</b></span>
        <span><small>数量</small><b>合格 {detail.goodQty} · 报废 {detail.scrapQty} · 返工 {detail.reworkQty}</b></span>
        <em className={attainmentClass(detail.attainmentBasisPoints)}>{detail.countsForEfficiency ? percent(detail.attainmentBasisPoints) : '不计入'}</em>
      </div>)}
      {!row.details.length && <p>该员工在当前周期暂无生产报工，考勤仍会保留并显示。</p>}
    </div>}
  </article>;
}
