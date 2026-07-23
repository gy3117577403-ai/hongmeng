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
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  TimerOff,
  Undo2,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  AbnormalTimeReportDTO,
  CurrentUserDTO,
  EmployeeDTO,
  EmployeeAttainmentReportDTO,
  EmployeeAttainmentRowDTO,
  ProcessLaborAccessDTO,
  ProcessLaborPoolDTO,
  ProcessLaborPoolSummaryDTO,
} from '@/types';

type Period = EmployeeAttainmentReportDTO['period'];
type ViewKey = 'employee' | 'abnormal' | 'labor';
type ReportResponse = { ok: boolean; report?: EmployeeAttainmentReportDTO; error?: string };
type AbnormalReportResponse = { ok: boolean; report?: AbnormalTimeReportDTO; error?: string };
type LaborPoolResponse = {
  ok: boolean;
  pools?: ProcessLaborPoolDTO[];
  employees?: EmployeeDTO[];
  summary?: ProcessLaborPoolSummaryDTO;
  access?: ProcessLaborAccessDTO;
  workDate?: string;
  error?: string;
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

function periodLabel(period: Period): string {
  return period === 'month' ? '本月' : period === 'week' ? '本周' : '当日';
}

function safeLocalRoute(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/production';
}

function positiveWholeNumber(value: string): number | null {
  return /^[1-9]\d*$/.test(value.trim()) ? Number(value) : null;
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
    if (params.get('view') === 'manual' || params.get('view') === 'labor') setView('labor');
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
            <p>领取工时进入员工个人明细，达成率按标准完成工时 ÷〔（确认出勤－品质确认免责异常）× 95%〕计算。</p>
          </div>
          <nav aria-label="报表关联入口">
            {user.laborRole !== 'EMPLOYEE' && <a className="hm-workbench-button" href="/workspace/attendance"><CalendarClock size={15} />考勤与异常</a>}
            {user.laborRole !== 'EMPLOYEE' && <a className="hm-workbench-button" href="/workspace/product-times"><Clock3 size={15} />产品工序与工时</a>}
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button>
          </nav>
        </section>

        <section className="employee-report-summary" aria-label="达成率与异常概览">
          <article><UsersRound /><span>参与员工<small>{periodLabel(period)}在用员工</small></span><strong>{summary?.employeeCount || 0}</strong></article>
          <article><CalendarClock /><span>确认出勤<small>{summary?.attendanceConfirmedDays || 0} 人日，缺 {summary?.attendanceMissingDays || 0} 个生产日 / {summary?.attendanceMissingCount || 0} 人</small></span><strong>{formatProcessDuration(summary?.attendanceMilliseconds || 0)}</strong></article>
          <article><TimerOff /><span>免责异常<small>品质确认后扣除个人基数</small></span><strong>{formatProcessDuration(summary?.exemptAbnormalMilliseconds || 0)}</strong></article>
          <article><Clock3 /><span>标准完成工时<small>已匹配考勤；待匹配 {formatProcessDuration(summary?.unmatchedStandardLaborMilliseconds || 0)}</small></span><strong>{formatProcessDuration(summary?.standardLaborMilliseconds || 0)}</strong></article>
          <article className={attainmentClass(summary?.attainmentBasisPoints ?? null)}><Gauge /><span>出勤达成率<small>标准工时 ÷（有效出勤 × 95%）</small></span><strong>{percent(summary?.attainmentBasisPoints ?? null)}</strong></article>
          <article className={abnormalSummary?.openCount ? 'watch' : 'good'}><AlertTriangle /><span>异常影响人时<small>未关闭 {abnormalSummary?.openCount || 0} 条</small></span><strong>{formatProcessDuration(abnormalSummary?.affectedPersonMilliseconds || 0)}</strong></article>
        </section>

        <section className="employee-report-toolbar">
          <div className="employee-report-view" role="tablist" aria-label="报表视图">
            <button className={view === 'employee' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'employee'} onClick={() => setView('employee')}><Gauge size={15} />员工达成率</button>
            <button className={view === 'abnormal' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'abnormal'} onClick={() => setView('abnormal')}><AlertTriangle size={15} />异常汇总</button>
            <button className={view === 'labor' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'labor'} onClick={() => setView('labor')}><ClipboardCheck size={15} />今日工时领取</button>
          </div>
          {view !== 'labor' && <>
            <div className="employee-report-period" role="group" aria-label="报表周期">
              {(['today', 'week', 'month'] as Period[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>)}
            </div>
            <label className="employee-report-date"><span>统计日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
            <label className="employee-report-search"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={view === 'employee' ? '搜索员工编号、姓名、岗位或班组' : '搜索异常、员工或分类'} /></label>
          </>}
          {view === 'labor' && <p className="employee-report-manual-hint">员工领取本人、班组长分配本组、管理员处理全量；领取不会再次推进生产路线。</p>}
        </section>

        {error && view !== 'labor' && <div className="employee-report-error" role="alert">{error}</div>}

        {view === 'employee' ? <section className="employee-report-table" aria-labelledby="employee-report-list-title">
          <header><div><span>员工维度</span><h2 id="employee-report-list-title">{periodLabel(period)}出勤达成率</h2></div><em>{rows.length} 人</em></header>
          <div className="employee-report-scroll hm-scroll-region" tabIndex={0}>
            <div className="employee-report-head" aria-hidden="true"><span>员工</span><span>确认出勤</span><span>免责异常</span><span>标准工时</span><span>工序效率</span><span>出勤达成率</span><span /></div>
            {rows.map(row => <EmployeeReportRow row={row} expanded={expandedEmployeeId === row.employee.id} key={row.employee.id} onToggle={() => setExpandedEmployeeId(current => current === row.employee.id ? '' : row.employee.id)} />)}
            {!loading && !rows.length && <div className="employee-report-empty"><Gauge /><strong>暂无符合条件的员工记录</strong><span>先登记并确认考勤，再从生产调度完成工序并转序后领取工时。</span></div>}
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
        </section> : <ProcessLaborPoolPanel onCommitted={() => setRefreshToken(value => value + 1)} />}
      </div>
    </main>
  );
}

function poolStatusLabel(pool: ProcessLaborPoolDTO): string {
  if (pool.pendingStandard) return '待补标准';
  if (pool.status === 'EXHAUSTED') return '已领完';
  if (pool.status === 'PARTIAL') return '部分领取';
  if (pool.status === 'LOCKED') return '已锁定';
  if (pool.status === 'VOIDED') return '已作废';
  return '待领取';
}

function claimPreview(pool: ProcessLaborPoolDTO | null, quantity: number | null): number | null {
  if (!pool || !quantity || quantity > pool.remainingQty || pool.eligibleQty <= 0) return null;
  if (quantity === pool.remainingQty) return pool.remainingStandardLaborMilliseconds;
  return Number(
    BigInt(pool.remainingStandardLaborMilliseconds) * BigInt(quantity) / BigInt(pool.remainingQty),
  );
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `labor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function canVoidLaborClaim(
  access: ProcessLaborAccessDTO | null,
  employee: EmployeeDTO,
): boolean {
  return access?.role === 'ADMIN'
    || Boolean(
      access?.role === 'TEAM_LEAD'
      && access.team
      && String(employee.team || '').trim() === access.team,
    );
}

function ProcessLaborPoolPanel({ onCommitted }: { onCommitted: () => void }) {
  const [initialized, setInitialized] = useState(false);
  const [workDate, setWorkDate] = useState(todayKey);
  const [returnTo, setReturnTo] = useState('/production');
  const [sourcePage, setSourcePage] = useState('生产调度');
  const [requestedPoolId, setRequestedPoolId] = useState('');
  const [requestedWorkOrderId, setRequestedWorkOrderId] = useState('');
  const [requestedStepId, setRequestedStepId] = useState('');
  const [pools, setPools] = useState<ProcessLaborPoolDTO[]>([]);
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [summary, setSummary] = useState<ProcessLaborPoolSummaryDTO | null>(null);
  const [access, setAccess] = useState<ProcessLaborAccessDTO | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resolvingStandard, setResolvingStandard] = useState(false);
  const [voidingClaimId, setVoidingClaimId] = useState('');
  const [standardForm, setStandardForm] = useState({
    timeBasis: 'per_unit' as 'per_unit' | 'per_batch',
    standardMinutes: '',
    setupMinutes: '0',
    unitsPerProduct: '1',
    countsForEfficiency: true,
    reason: '',
  });
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = String(params.get('workDate') || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setWorkDate(requestedDate);
    setRequestedPoolId(String(params.get('poolId') || ''));
    setRequestedWorkOrderId(String(params.get('workOrderId') || ''));
    setRequestedStepId(String(params.get('stepId') || ''));
    setReturnTo(safeLocalRoute(params.get('returnTo')));
    setSourcePage(params.get('from') === 'workflow' ? '流程中心' : '生产调度');
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ workDate, includeExhausted: 'true' });
    fetch(`/api/process-labor-pools?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json() as LaborPoolResponse;
        if (!response.ok || !body.ok) throw new Error(body.error || '工时池加载失败');
        const nextPools = body.pools || [];
        setPools(nextPools);
        setEmployees(body.employees || []);
        setSummary(body.summary || null);
        setAccess(body.access || null);
        setSelectedPoolId(current => {
          if (nextPools.some(pool => pool.id === current)) return current;
          const requested = nextPools.find(pool => pool.id === requestedPoolId)
            || nextPools.find(pool => pool.workOrderId === requestedWorkOrderId && (!requestedStepId || pool.stepId === requestedStepId));
          return requested?.id || nextPools.find(pool => pool.remainingQty > 0)?.id || nextPools[0]?.id || '';
        });
      })
      .catch(reason => {
        if ((reason as { name?: string }).name === 'AbortError') return;
        setPools([]);
        setSummary(null);
        setAccess(null);
        setError(reason instanceof Error ? reason.message : '工时池加载失败');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [initialized, reloadToken, requestedPoolId, requestedStepId, requestedWorkOrderId, workDate]);

  const selectedPool = useMemo(
    () => pools.find(pool => pool.id === selectedPoolId) || null,
    [pools, selectedPoolId],
  );
  const suggestedEmployeeKey = selectedPool?.suggestedEmployees.map(employee => employee.id).join(',') || '';
  const parsedQuantity = positiveWholeNumber(quantity);
  const preview = claimPreview(selectedPool, parsedQuantity);

  useEffect(() => {
    setQuantity(selectedPool?.remainingQty ? String(selectedPool.remainingQty) : '');
    const suggestedEmployee = selectedPool?.suggestedEmployees.find(suggested => (
      employees.some(employee => employee.id === suggested.id)
    ));
    setEmployeeId(access?.role === 'EMPLOYEE'
      ? access.selfEmployeeId || ''
      : suggestedEmployee?.id || '');
    setIdempotencyKey('');
    setStandardForm({
      timeBasis: selectedPool?.timeBasis || 'per_unit',
      standardMinutes: selectedPool?.standardMillisecondsPerUnit
        ? String(selectedPool.standardMillisecondsPerUnit / 60_000)
        : '',
      setupMinutes: selectedPool?.setupMilliseconds
        ? String(selectedPool.setupMilliseconds / 60_000)
        : '0',
      unitsPerProduct: String(selectedPool?.unitsPerProduct || 1),
      countsForEfficiency: selectedPool?.countsForEfficiency !== false,
      reason: '',
    });
    setError('');
  }, [
    selectedPoolId,
    selectedPool?.countsForEfficiency,
    selectedPool?.remainingQty,
    selectedPool?.setupMilliseconds,
    selectedPool?.standardMillisecondsPerUnit,
    selectedPool?.suggestedEmployees,
    selectedPool?.timeBasis,
    selectedPool?.unitsPerProduct,
    suggestedEmployeeKey,
    access?.role,
    access?.selfEmployeeId,
    employees,
  ]);

  async function resolveStandard(): Promise<void> {
    if (!selectedPool?.pendingStandard) return;
    if (!access?.canResolveStandard) return setError('只有管理员可以补录并解锁工时标准');
    const standardMinutes = Number(standardForm.standardMinutes);
    const setupMinutes = Number(standardForm.setupMinutes);
    const unitsPerProduct = positiveWholeNumber(standardForm.unitsPerProduct);
    const standardMillisecondsPerUnit = Math.round(standardMinutes * 60_000);
    const setupMilliseconds = Math.round(setupMinutes * 60_000);
    if (!Number.isFinite(standardMinutes) || standardMinutes <= 0 || standardMillisecondsPerUnit <= 0) {
      return setError('标准工时必须大于 0 分钟');
    }
    if (!Number.isFinite(setupMinutes) || setupMinutes < 0 || setupMilliseconds < 0) {
      return setError('准备工时不能小于 0 分钟');
    }
    if (!unitsPerProduct) return setError(`每${selectedPool.unitLabel}工序次数必须是正整数`);
    if (standardForm.reason.trim().length < 2) return setError('请填写本次补录标准的原因');

    setResolvingStandard(true);
    setError('');
    try {
      const response = await fetch(`/api/process-labor-pools/${selectedPool.id}/standard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: selectedPool.version,
          timeBasis: standardForm.timeBasis,
          standardMillisecondsPerUnit,
          setupMilliseconds,
          unitsPerProduct,
          countsForEfficiency: standardForm.countsForEfficiency,
          reason: standardForm.reason.trim(),
        }),
      });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || '补录工时标准失败');
      setToast(`${selectedPool.step.processName}标准已补录，工时池现在可以领取`);
      window.setTimeout(() => setToast(''), 3_000);
      onCommitted();
      setReloadToken(value => value + 1);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : '补录工时标准失败');
    } finally {
      setResolvingStandard(false);
    }
  }

  async function submitClaim(): Promise<void> {
    if (!selectedPool) return;
    if (!access?.canClaim) return setError(access?.blockedReason || '当前账号不能领取工时');
    if (!employeeId) return setError('请选择领取员工');
    if (!parsedQuantity || parsedQuantity > selectedPool.remainingQty) {
      return setError(`领取数量必须为 1 至 ${selectedPool.remainingQty} 的整数`);
    }
    const requestKey = idempotencyKey || newIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/process-labor-pools/${selectedPool.id}/claims`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          quantity: parsedQuantity,
          expectedVersion: selectedPool.version,
          idempotencyKey: requestKey,
        }),
      });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || '工时领取失败');
      const employee = employees.find(item => item.id === employeeId);
      setToast(`${employee?.name || '员工'}已领取 ${parsedQuantity} ${selectedPool.unitLabel} · ${selectedPool.step.processName}`);
      window.setTimeout(() => setToast(''), 3_000);
      setIdempotencyKey('');
      onCommitted();
      setReloadToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工时领取失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function voidClaim(claimId: string): Promise<void> {
    if (!selectedPool) return;
    if (!access?.canVoid) return setError('员工领取记录需由班组长或管理员冲销');
    const reason = window.prompt('请输入冲销原因。冲销后数量和标准工时会退回工时池。', '');
    if (reason === null) return;
    if (!reason.trim()) return setError('冲销必须填写原因');
    setVoidingClaimId(claimId);
    setError('');
    try {
      const response = await fetch(`/api/process-labor-claims/${claimId}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedPoolVersion: selectedPool.version,
          reason: reason.trim(),
          idempotencyKey: newIdempotencyKey(),
        }),
      });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || '领取冲销失败');
      setToast('领取记录已冲销，数量已退回工时池');
      window.setTimeout(() => setToast(''), 3_000);
      onCommitted();
      setReloadToken(value => value + 1);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : '领取冲销失败');
    } finally {
      setVoidingClaimId('');
    }
  }

  return <section className="manual-report-panel" aria-labelledby="manual-report-title">
    <header className="manual-report-header">
      <div>
        <span>标准工时池</span>
        <h2 id="manual-report-title">今日完成工时领取</h2>
        <p>{access?.role === 'EMPLOYEE'
          ? '生产调度确认工序完成后形成工时池；当前为本人领取模式，领取不会再次推进生产路线。'
          : access?.role === 'TEAM_LEAD'
            ? `当前为班组长分配模式${access.team ? `（${access.team}）` : ''}；只能分配和冲销本班组工时。`
            : '当前为管理员模式；可跨班组分配、冲销，并补录待补标准工时。'}</p>
      </div>
      <div className="manual-report-header-actions">
        {access && access.role !== 'EMPLOYEE' && <a className="hm-workbench-button" href={returnTo}><ArrowLeft size={15} />返回{sourcePage}</a>}
        <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setReloadToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button>
      </div>
    </header>

    <div className="manual-report-week-tabs labor-pool-toolbar">
      <label><span>完成日期</span><input type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} /></label>
      <span>工时池 <b>{summary?.poolCount || 0}</b></span>
      <span>待补标准 <b>{summary?.pendingStandardPoolCount || 0}</b> 池</span>
      <span>待领取 <b>{pools.filter(pool => pool.remainingQty > 0 && !pool.pendingStandard).length}</b> 池</span>
      <span>已领完 <b>{pools.filter(pool => pool.status === 'EXHAUSTED').length}</b> 池</span>
      <span>剩余标准工时 <b>{formatProcessDuration(summary?.remainingStandardLaborMilliseconds || 0)}</b></span>
    </div>

    {error && <div className="manual-report-error" role="alert"><AlertTriangle size={16} />{error}</div>}

    <div className="manual-report-layout">
      <aside className="manual-report-orders" aria-label="当日工时池">
        <header><span>当日工时池</span><strong>{pools.length}</strong></header>
        <div className="hm-scroll-region" tabIndex={0}>
          {pools.map(pool => <button type="button" className={`${selectedPoolId === pool.id ? 'active' : ''}${pool.pendingStandard ? ' pending-standard' : ''}`} key={pool.id} onClick={() => setSelectedPoolId(pool.id)}>
            <span><strong>{pool.workOrder.code}</strong><small>{pool.workOrder.specification || pool.workOrder.productName}</small></span>
            <em>{poolStatusLabel(pool)}</em>
            <small>{pool.step.processName} · 已领 {pool.claimedQty} / {pool.eligibleQty} {pool.unitLabel} · 剩余 {pool.remainingQty} {pool.unitLabel}</small>
            {!!pool.suggestedEmployees.length && <small>现场推荐：{pool.suggestedEmployees.map(employee => employee.name).join('、')}</small>}
          </button>)}
          {!loading && !pools.length && <div className="manual-report-empty"><ClipboardCheck /><strong>当日暂无可领取工时</strong><span>请先从生产调度确认当前工序完成和良品数量。</span></div>}
          {loading && <div className="manual-report-empty"><Loader2 className="spin" /><strong>正在加载工时池</strong></div>}
        </div>
      </aside>

      <div className="manual-report-workspace labor-pool-workspace">
        {selectedPool && <>
          <section className="manual-report-order-summary">
            <div><span>完成工序</span><strong>{selectedPool.workOrder.code} · {selectedPool.step.processName}</strong><small>{selectedPool.workOrder.customerName || '客户未设置'} · {selectedPool.workOrder.specification || selectedPool.workOrder.productName}</small></div>
            <dl>
              <div><dt>可领取</dt><dd>{selectedPool.eligibleQty} {selectedPool.unitLabel}</dd></div>
              <div><dt>已领取</dt><dd>{selectedPool.claimedQty} {selectedPool.unitLabel}</dd></div>
              <div><dt>剩余</dt><dd>{selectedPool.remainingQty} {selectedPool.unitLabel}</dd></div>
              <div><dt>状态</dt><dd>{poolStatusLabel(selectedPool)}</dd></div>
            </dl>
          </section>

          <section className="manual-report-standard">
            <span><small>{selectedPool.timeBasis === 'per_batch' ? '整批标准工时' : `单${selectedPool.unitLabel}标准工时`}</small><strong>{selectedPool.pendingStandard ? '待补录' : formatProcessDuration(selectedPool.standardMillisecondsPerUnit)}</strong></span>
            <span><small>工时池总标准工时</small><strong>{selectedPool.pendingStandard ? '待补录' : formatProcessDuration(selectedPool.totalStandardLaborMilliseconds)}</strong></span>
            <span><small>已分配标准工时</small><strong>{formatProcessDuration(selectedPool.claimedStandardLaborMilliseconds)}</strong></span>
            <span><small>剩余标准工时</small><strong>{selectedPool.pendingStandard ? '补录后可领取' : formatProcessDuration(selectedPool.remainingStandardLaborMilliseconds)}</strong></span>
          </section>

          <section className="labor-completion-trace" aria-label="现场完成记录">
            <header><strong>现场完成记录</strong><span>仅作领取推荐，不代表已记工</span></header>
            <div>
              <span><small>推荐领取人</small><b>{selectedPool.suggestedEmployees.length ? selectedPool.suggestedEmployees.map(employee => employee.name).join('、') : '未记录'}</b></span>
              <span><small>作业时段</small><b>{selectedPool.workStartedAt && selectedPool.workEndedAt ? `${dateTime(selectedPool.workStartedAt)} 至 ${dateTime(selectedPool.workEndedAt)}` : '未记录'}</b></span>
              <span><small>班组 / 工位</small><b>{[selectedPool.team, selectedPool.workstation].filter(Boolean).join(' · ') || '未记录'}</b></span>
              {selectedPool.completionRemark && <span><small>现场备注</small><b>{selectedPool.completionRemark}</b></span>}
            </div>
          </section>

          {selectedPool.pendingStandard
            ? access?.canResolveStandard
              ? <form className="manual-report-form labor-claim-form labor-standard-resolution" onSubmit={event => { event.preventDefault(); void resolveStandard(); }}>
            <header><strong>补录本次工序标准</strong><span>生产事实已保留；补录后解锁员工领取，并同步到该工单同一道工序。</span></header>
            <div className="manual-report-fields">
              <label><span>工时口径 *</span><select value={standardForm.timeBasis} onChange={event => setStandardForm(current => ({ ...current, timeBasis: event.target.value as 'per_unit' | 'per_batch' }))}><option value="per_unit">按件 / 按套</option><option value="per_batch">按整批</option></select></label>
              <label><span>{standardForm.timeBasis === 'per_batch' ? '整批标准时间（分钟） *' : '单次标准时间（分钟） *'}</span><input type="number" min="0.001" step="0.001" value={standardForm.standardMinutes} onChange={event => setStandardForm(current => ({ ...current, standardMinutes: event.target.value }))} /></label>
              <label><span>准备工时（分钟）</span><input type="number" min="0" step="0.001" value={standardForm.setupMinutes} onChange={event => setStandardForm(current => ({ ...current, setupMinutes: event.target.value }))} /></label>
              <label><span>每{selectedPool.unitLabel}工序次数 *</span><input type="number" min="1" step="1" value={standardForm.unitsPerProduct} onChange={event => setStandardForm(current => ({ ...current, unitsPerProduct: event.target.value }))} disabled={standardForm.timeBasis === 'per_batch'} /></label>
              <label className="labor-standard-reason"><span>补录原因 *</span><input value={standardForm.reason} maxLength={500} placeholder="例如：工艺标准发布滞后，按现场确认值补录" onChange={event => setStandardForm(current => ({ ...current, reason: event.target.value }))} /></label>
              <label className="labor-standard-checkbox"><input type="checkbox" checked={standardForm.countsForEfficiency} onChange={event => setStandardForm(current => ({ ...current, countsForEfficiency: event.target.checked }))} /><span>计入员工达成率</span></label>
            </div>
            <footer>
              <div><span>补录会同步当前工单该工序的后续完成；正式产品标准仍应在产品工序与工时中维护。</span></div>
              <button type="submit" disabled={resolvingStandard}><Clock3 size={16} />{resolvingStandard ? '补录中' : '保存标准并解锁'}</button>
            </footer>
                </form>
              : <div className="manual-report-empty labor-access-notice"><Clock3 /><strong>等待管理员补录标准工时</strong><span>生产完成事实已保留；标准解锁后，员工或班组长即可领取。</span></div>
            : access?.canClaim
              ? <form className="manual-report-form labor-claim-form" onSubmit={event => { event.preventDefault(); void submitClaim(); }}>
            <div className="manual-report-fields">
              <label><span>{access?.role === 'EMPLOYEE' ? '领取员工（本人）' : '领取员工 *'}</span><select value={employeeId} disabled={access?.role === 'EMPLOYEE'} onChange={event => { setEmployeeId(event.target.value); setIdempotencyKey(''); }}><option value="">选择员工</option>{employees.map(employee => <option value={employee.id} key={employee.id}>{selectedPool.suggestedEmployees.some(suggested => suggested.id === employee.id) ? '推荐 · ' : ''}{employee.employeeNo} · {employee.name}{employee.team ? ` · ${employee.team}` : ''}</option>)}</select></label>
              <label><span>领取数量 *</span><input type="number" min="1" max={selectedPool.remainingQty} step="1" value={quantity} onChange={event => { setQuantity(event.target.value); setIdempotencyKey(''); }} /></label>
            </div>
            <footer>
              <div>{preview !== null ? <><span>本次领取 <b>{parsedQuantity} {selectedPool.unitLabel}</b></span><span>计入标准工时 <b>{formatProcessDuration(preview)}</b></span></> : <span>领取量不能超过当前剩余 {selectedPool.remainingQty} {selectedPool.unitLabel}</span>}</div>
              <button type="submit" disabled={submitting || !employeeId || preview === null || selectedPool.remainingQty <= 0 || selectedPool.status === 'LOCKED' || selectedPool.status === 'VOIDED'}><Send size={16} />{submitting ? '提交中' : access?.role === 'EMPLOYEE' ? '确认领取到本人' : '确认分配'}</button>
            </footer>
                </form>
              : <div className="manual-report-empty labor-access-notice"><ShieldCheck /><strong>当前账号暂不能领取工时</strong><span>{access?.blockedReason || '请联系管理员配置工时角色和员工绑定。'}</span></div>}

          <section className="labor-claim-list" aria-label="已领取明细">
            <header><span>已领取明细</span><strong>{selectedPool.claims.length} 笔</strong></header>
            <div>
              {selectedPool.claims.map(claim => <article key={claim.id}>
                <span><strong>{claim.employee.name}</strong><small>{claim.employee.employeeNo}{claim.employee.team ? ` · ${claim.employee.team}` : ''}</small></span>
                <span><small>领取数量</small><b>{claim.quantity} {selectedPool.unitLabel}</b></span>
                <span><small>标准工时</small><b>{formatProcessDuration(claim.standardLaborMilliseconds)}</b></span>
                <span><small>领取时间</small><b>{dateTime(claim.claimedAt)}</b></span>
                {canVoidLaborClaim(access, claim.employee) && <button type="button" disabled={voidingClaimId === claim.id} onClick={() => void voidClaim(claim.id)}><Undo2 size={14} />{voidingClaimId === claim.id ? '冲销中' : '冲销'}</button>}
              </article>)}
              {!selectedPool.claims.length && <div className="manual-report-empty"><UsersRound /><strong>尚无员工领取</strong><span>可先分配部分数量，再由其他员工领取剩余数量。</span></div>}
            </div>
          </section>
        </>}
        {!selectedPool && !loading && <div className="manual-report-empty large"><ClipboardCheck /><strong>请选择工时池</strong><span>工时池按生产完成日期归集，历史补领仍回算至完成当日。</span></div>}
      </div>
    </div>
    {toast && <div className="employee-report-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </section>;
}

function EmployeeReportRow({ row, expanded, onToggle }: { row: EmployeeAttainmentRowDTO; expanded: boolean; onToggle: () => void }) {
  return <article className={`employee-report-row ${expanded ? 'expanded' : ''}`}>
    <button className="employee-report-row-main" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span className="employee-cell"><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.department || '部门未设置'}{row.employee.position ? ` / ${row.employee.position}` : ''}{row.employee.team ? ` / ${row.employee.team}` : ''}</small></span>
      <b>{row.attendanceMissingDays > 0 ? `${formatProcessDuration(row.attendanceMilliseconds)} · 缺 ${row.attendanceMissingDays} 天` : row.attendanceMissing ? '未录考勤' : formatProcessDuration(row.attendanceMilliseconds)}</b>
      <b>{formatProcessDuration(row.exemptAbnormalMilliseconds)}</b>
      <b>{formatProcessDuration(row.standardLaborMilliseconds)}</b>
      <em className={attainmentClass(row.actualLaborMilliseconds > 0 ? row.processEfficiencyBasisPoints : null)}>{row.actualLaborMilliseconds > 0 ? percent(row.processEfficiencyBasisPoints) : '未采集'}</em>
      <em className={attainmentClass(row.attainmentBasisPoints)}>{percent(row.attainmentBasisPoints)}</em>
      {expanded ? <ChevronDown /> : <ChevronRight />}
    </button>
    {expanded && <div className="employee-report-details">
      <div className="employee-report-metric-detail">
        <span><small>有效出勤</small><b>{formatProcessDuration(row.effectiveProductionMilliseconds)}</b></span>
        <span><small>考核工时（95%）</small><b>{formatProcessDuration(row.attainmentCapacityMilliseconds)}</b></span>
        <span><small>原始出勤产出率</small><b>{percent(row.rawAttendanceOutputBasisPoints)}</b></span>
        <span><small>时段覆盖率（仅历史时段记录）</small><b>{percent(row.coverageBasisPoints)}</b></span>
        <span><small>未覆盖时段（仅历史时段记录）</small><b>{row.actualLaborMilliseconds > 0 ? formatProcessDuration(row.unexplainedMilliseconds) : '未采集'}</b></span>
        <span><small>确认考勤</small><b>{row.attendanceConfirmedDays} 人日</b></span>
        <span><small>缺考勤待匹配工时</small><b>{row.attendanceMissingDays > 0 ? `${row.attendanceMissingDays} 天 · ${formatProcessDuration(row.unmatchedStandardLaborMilliseconds)}` : '无'}</b></span>
      </div>
      {row.details.map(detail => <div key={detail.id}>
        <span><strong>{detail.processName}</strong><small>{detail.customerName || '客户未设置'} · {detail.specification || detail.workOrderCode}</small></span>
        <span><small>作业时间</small><b>{dateTime(detail.startedAt)} - {dateTime(detail.endedAt)}</b></span>
        <span><small>标准 / 实际</small><b>{formatProcessDuration(detail.standardLaborMilliseconds)} / {formatProcessDuration(detail.actualLaborMilliseconds)}</b></span>
        <span><small>数量</small><b>合格 {detail.goodQty} · 报废 {detail.scrapQty} · 返工 {detail.reworkQty}</b></span>
        <em className={attainmentClass(detail.attainmentBasisPoints)}>{detail.countsForEfficiency ? percent(detail.attainmentBasisPoints) : '不计入'}</em>
      </div>)}
      {row.claimDetails.map(detail => <div className="employee-report-claim-detail" key={`claim-${detail.id}`}>
        <span><strong>{detail.processName}</strong><small>{detail.customerName || '客户未设置'} · {detail.specification || detail.workOrderCode}</small></span>
        <span><small>工时来源</small><b>{detail.workDate} 完工池领取</b></span>
        <span><small>标准工时</small><b>{formatProcessDuration(detail.standardLaborMilliseconds)}</b></span>
        <span><small>领取数量</small><b>{detail.quantity} {detail.unitLabel}</b></span>
        <em className={detail.attendanceMatched ? 'good' : 'watch'}>{detail.attendanceMatched ? '已计入' : '缺考勤待匹配'}</em>
      </div>)}
      {!row.details.length && !row.claimDetails.length && <p>该员工在当前周期暂无生产工时，考勤仍会保留并显示。</p>}
    </div>}
  </article>;
}
