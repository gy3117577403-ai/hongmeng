'use client';

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  LoaderCircle,
  LogOut,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProcessCompletionContext } from '@/lib/process-completion-service';
import type { FieldReportTicketView } from '@/lib/work-order-qr-service';
import type { CurrentUserDTO } from '@/types';

type EmployeeOption = ProcessCompletionContext['employees'][number];
type FieldReportPayload = {
  ticket: FieldReportTicketView;
  context: ProcessCompletionContext | null;
  currentEmployee: EmployeeOption | null;
  identityMessage: string;
};

type ReportForm = {
  processedQty: string;
  defectQty: string;
  defectDisposition: 'rework' | 'scrap_replenish' | 'quality_pending';
  workDate: string;
  employeeIds: string[];
  team: string;
  workstation: string;
  remark: string;
};

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function quantity(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.max(0, value || 0));
}

function dateText(value: string | null): string {
  if (!value) return '待维护';
  const normalized = value.replace(/\//g, '-');
  const parts = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return parts ? `${parts[1]}/${parts[2].padStart(2, '0')}/${parts[3].padStart(2, '0')}` : value;
}

function standardTime(milliseconds: number | null, basis: string | null, units: number): string {
  if (!milliseconds || milliseconds <= 0) return '标准工时待维护';
  const seconds = milliseconds / 1000;
  const shown = Number.isInteger(seconds) ? seconds : seconds.toFixed(1);
  return basis === 'per_batch' ? `${shown} 秒/批` : `${shown} 秒 × ${Math.max(1, units)}`;
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `qr-${crypto.randomUUID()}`
    : `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formFor(context: ProcessCompletionContext, currentEmployee: EmployeeOption): ReportForm {
  return {
    processedQty: String(context.reportableQty),
    defectQty: '0',
    defectDisposition: 'rework',
    workDate: todayKey(),
    employeeIds: [currentEmployee.id],
    team: currentEmployee.team || '',
    workstation: '',
    remark: '',
  };
}

function stateLabel(step: ProcessCompletionContext['routeSteps'][number], targetQty: number): { label: string; tone: string } {
  if (step.status === 'completed' || step.reportedQty >= targetQty) return { label: '已报完成', tone: 'completed' };
  if (step.pendingCoverageQty > 0) return { label: '待前序覆盖', tone: 'coverage' };
  if (step.reportedQty > 0) return { label: '部分报工', tone: 'partial' };
  if (step.status === 'current') return { label: '当前工序', tone: 'current' };
  return { label: '可选择报工', tone: 'ready' };
}

export default function FieldReportMobile({ code, user }: { code: string; user: CurrentUserDTO }) {
  const [payload, setPayload] = useState<FieldReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<ReportForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [exceptionConfirmed, setExceptionConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [success, setSuccess] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async (stepId?: string, quiet = false): Promise<FieldReportPayload | null> => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    setError('');
    try {
      const query = stepId ? `?stepId=${encodeURIComponent(stepId)}` : '';
      const response = await fetch(`/api/field-report/tickets/${encodeURIComponent(code)}${query}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        sessionStorage.setItem('hm-login-notice', '登录已过期，请重新使用员工编号登录');
        location.href = `/login?next=${encodeURIComponent(`/field-report/${code}`)}`;
        return null;
      }
      if (!response.ok) throw new Error(body.error || '工单加载失败');
      const nextPayload = body.data as FieldReportPayload;
      setPayload(nextPayload);
      return nextPayload;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工单加载失败');
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  const routeSteps: ProcessCompletionContext['routeSteps'] = payload?.context?.routeSteps
    || payload?.ticket.route?.steps.map(step => ({
      id: step.id,
      processName: step.processName,
      position: step.position,
      sequenceGroup: step.sequenceGroup,
      status: step.status,
      unitLabel: step.unitLabel,
      inputQty: payload.ticket.workOrder.targetQty,
      processedQty: step.processedQty,
      reportedQty: step.processedQty,
      coveredReportedQty: step.processedQty,
      pendingCoverageQty: 0,
      reportableQty: 0,
      availableCoverageQty: 0,
    }))
    || [];
  const completedSteps = routeSteps.filter(step => step.status === 'completed' || step.reportedQty >= (payload?.ticket.workOrder.targetQty || 0)).length;
  const progress = routeSteps.length ? Math.round(completedSteps / routeSteps.length * 100) : 0;
  const selectedStep = payload?.context?.step || null;
  const selectedStepSnapshot = payload?.ticket.route?.steps.find(step => step.id === selectedStep?.id) || null;
  const currentEmployeeId = payload?.currentEmployee?.id || '';
  const preferredIds = new Set(payload?.context?.workerPreset?.employees.map(employee => employee.id) || []);
  const selectedEmployees = payload?.context && form
    ? payload.context.employees.filter(employee => form.employeeIds.includes(employee.id))
    : [];
  const nonPreferredCollaborators = selectedEmployees.filter(employee => employee.id !== currentEmployeeId && !preferredIds.has(employee.id));
  const searchedEmployees = (payload?.context?.employees || []).filter(employee => {
    const key = employeeSearch.trim().toLocaleLowerCase();
    return !key || `${employee.employeeNo} ${employee.name} ${employee.team || ''} ${employee.position || ''}`.toLocaleLowerCase().includes(key);
  });
  const orderedEmployees = [...searchedEmployees].sort((left, right) => {
    if (left.id === currentEmployeeId) return -1;
    if (right.id === currentEmployeeId) return 1;
    const leftPreferred = preferredIds.has(left.id) ? 0 : 1;
    const rightPreferred = preferredIds.has(right.id) ? 0 : 1;
    return leftPreferred - rightPreferred || left.employeeNo.localeCompare(right.employeeNo);
  });
  const visibleEmployees = employeeSearch || showAllEmployees ? orderedEmployees : orderedEmployees.slice(0, 8);
  const processedQty = Number(form?.processedQty || 0);
  const defectQty = Number(form?.defectQty || 0);
  const goodQty = Math.max(0, processedQty - defectQty);
  const advanceReporting = Boolean(payload?.context && (
    payload.context.step.status !== 'current' || processedQty > payload.context.remainingInputQty
  ));
  const invalid = !payload?.context || !payload.currentEmployee || !form
    || !Number.isSafeInteger(processedQty) || processedQty <= 0 || processedQty > payload.context.reportableQty
    || !Number.isSafeInteger(defectQty) || defectQty < 0 || defectQty > processedQty
    || !form.workDate || !form.employeeIds.includes(currentEmployeeId)
    || (nonPreferredCollaborators.length > 0 && !exceptionConfirmed);

  async function openReport(stepId: string): Promise<void> {
    if (!payload?.currentEmployee) return;
    setFormError('');
    setEmployeeSearch('');
    setShowAllEmployees(false);
    setExceptionConfirmed(false);
    const nextPayload = await load(stepId);
    if (!nextPayload?.context || !nextPayload.currentEmployee) return;
    setForm(formFor(nextPayload.context, nextPayload.currentEmployee));
    setIdempotencyKey(newIdempotencyKey());
    setSheetOpen(true);
  }

  async function submit(): Promise<void> {
    if (invalid || !payload?.context || !form || !payload.currentEmployee) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(`/api/field-report/tickets/${encodeURIComponent(code)}/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepId: payload.context.step.id,
          processedQty,
          defectQty,
          defectDisposition: defectQty > 0 ? form.defectDisposition : null,
          workDate: form.workDate,
          employeeIds: form.employeeIds,
          team: form.team,
          workstation: form.workstation,
          remark: form.remark,
          idempotencyKey,
          expectedRouteVersion: payload.context.routeVersion,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '报工提交失败');
      const pending = Number(body.data?.pendingCoverageQty || 0);
      const employeeCount = Number(body.data?.autoAssignedEmployeeCount || form.employeeIds.length);
      setSheetOpen(false);
      setForm(null);
      setSuccess({
        title: `${payload.context.step.processName} 报工成功`,
        detail: pending > 0
          ? `${quantity(goodQty)} ${payload.ticket.workOrder.unitLabel}已登记，另有 ${quantity(pending)} 待前序自动覆盖；已为 ${employeeCount} 人自动记工。`
          : `${quantity(goodQty)} ${payload.ticket.workOrder.unitLabel}已正常流转；已为 ${employeeCount} 人自动记工。`,
      });
      await load(undefined, true);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '报工提交失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = `/login?next=${encodeURIComponent(`/field-report/${code}`)}`;
  }

  if (loading && !payload) return <main className="field-report-loading"><LoaderCircle className="spin" size={34} /><strong>正在读取工单二维码</strong><span>核对最新工艺路线与生产数量...</span></main>;
  if (!payload) return <main className="field-report-failure"><AlertTriangle size={40} /><strong>无法打开工单</strong><p>{error || '二维码无效或工单不存在'}</p><button type="button" onClick={() => void load()}>重新读取</button></main>;

  const ticket = payload.ticket;
  return <main className="field-report-app">
    <header className="field-report-topbar">
      <div className="field-report-mark">杭</div>
      <span><small>现场扫码报工</small><strong>{ticket.workOrder.specification || ticket.workOrder.productName}</strong></span>
      <button type="button" onClick={() => void logout()} aria-label="切换登录账号"><LogOut size={18} /><em>切换</em></button>
    </header>

    <section className="field-report-identity">
      {payload.currentEmployee ? <><UserRoundCheck size={20} /><span><small>当前报工身份</small><strong>{payload.currentEmployee.employeeNo} · {payload.currentEmployee.name}</strong></span><BadgeCheck size={20} /></> : <><AlertTriangle size={20} /><span><small>当前账号</small><strong>{user.displayName}</strong></span><em>只读</em></>}
    </section>

    <section className="field-report-order-card">
      <header><span>生产工单</span><b className={`priority-${ticket.workOrder.priority}`}>{ticket.workOrder.priority === 'urgent' ? '紧急' : ticket.workOrder.priority === 'high' ? '高优先' : '一般'}</b></header>
      <h1>{ticket.workOrder.specification || ticket.workOrder.productName}</h1>
      <p>{ticket.workOrder.customerName || '客户待维护'} · {ticket.workOrder.productName}</p>
      <dl>
        <div><dt>工单号</dt><dd>{ticket.workOrder.code}</dd></div>
        <div><dt>计划数量</dt><dd>{quantity(ticket.workOrder.targetQty)} {ticket.workOrder.unitLabel}</dd></div>
        <div><dt>计划交期</dt><dd>{dateText(ticket.workOrder.deliveryDay)}</dd></div>
        <div><dt>二维码短码</dt><dd>{ticket.shortCode}</dd></div>
      </dl>
      <div className="field-report-progress"><span><b>工序进度</b><em>{completedSteps}/{routeSteps.length || ticket.route?.steps.length || 0}</em></span><i><b style={{ width: `${progress}%` }} /></i></div>
    </section>

    {ticket.route?.paperOutdated && <section className="field-report-alert warning"><AlertTriangle size={20} /><span><strong>纸面工艺版本已过期</strong><small>纸面 V{ticket.route.printedVersion}，系统最新 V{ticket.route.version}；请按手机端工序报工并通知主管重新打印。</small></span></section>}
    {!ticket.access.canReport && <section className={`field-report-alert state-${ticket.access.state.toLowerCase()}`}><ShieldCheck size={20} /><span><strong>{ticket.access.state === 'COMPLETED' ? '工单已完成' : '当前仅可查看'}</strong><small>{ticket.access.message}</small></span></section>}
    {ticket.access.canReport && !payload.currentEmployee && <section className="field-report-alert danger"><AlertTriangle size={20} /><span><strong>账号未关联生产员工</strong><small>请联系管理员把当前登录账号绑定到在职生产员工档案后再报工。</small></span></section>}

    <section className="field-report-route">
      <header><span><small>工艺流程</small><strong>{ticket.route?.name || '工艺路线待确认'}</strong></span><button type="button" disabled={refreshing} onClick={() => void load(undefined, true)}><RefreshCw className={refreshing ? 'spin' : ''} size={17} />刷新</button></header>
      <div className="field-report-step-list">
        {routeSteps.map((step, index) => {
          const snapshot = ticket.route?.steps.find(item => item.id === step.id);
          const state = stateLabel(step, ticket.workOrder.targetQty);
          const isLast = index === routeSteps.length - 1;
          return <article className={`field-report-step tone-${state.tone}`} key={step.id}>
            <div className="field-report-step-rail"><b>{state.tone === 'completed' ? <Check size={17} /> : step.position}</b>{!isLast && <i />}</div>
            <div className="field-report-step-card">
              <header><span><small>第 {step.position} 道 · 顺序组 {step.sequenceGroup}</small><strong>{step.processName}</strong></span><em>{state.label}</em></header>
              <div className="field-report-step-facts"><span><Clock3 size={14} />{standardTime(snapshot?.standardMillisecondsPerUnit || null, snapshot?.timeBasis || null, snapshot?.unitsPerProduct || 1)}</span><span>{quantity(step.reportedQty)} / {quantity(ticket.workOrder.targetQty)} {step.unitLabel || ticket.workOrder.unitLabel}</span></div>
              <div className="field-report-step-meter"><i style={{ width: `${Math.min(100, ticket.workOrder.targetQty ? step.reportedQty / ticket.workOrder.targetQty * 100 : 0)}%` }} /></div>
              {step.pendingCoverageQty > 0 && <p><AlertTriangle size={14} />已提前报工 {quantity(step.pendingCoverageQty)}，等待前序数量补齐后自动覆盖</p>}
              <button type="button" disabled={!ticket.access.canReport || !payload.currentEmployee || step.reportableQty <= 0} onClick={() => void openReport(step.id)}>{step.reportableQty <= 0 ? <><CheckCircle2 size={17} />该工序已报完成</> : <><CircleDot size={17} />选择此工序报工<ArrowRight size={17} /></>}</button>
            </div>
          </article>;
        })}
        {!routeSteps.length && <div className="field-report-no-route"><AlertTriangle size={24} /><strong>暂无可显示工序</strong><span>{ticket.access.message}</span></div>}
      </div>
    </section>

    <footer className="field-report-footer"><PackageCheck size={17} /><span>一工单一码 · 所有报工记录实时同步生产执行、流程中心和员工达成率</span></footer>

    {success && <div className="field-report-success" role="dialog" aria-modal="true"><section><CheckCircle2 size={48} /><strong>{success.title}</strong><p>{success.detail}</p><button type="button" onClick={() => setSuccess(null)}>知道了，继续报工</button></section></div>}

    {sheetOpen && payload.context && form && <div className="field-report-sheet-backdrop" role="presentation">
      <section className="field-report-sheet" role="dialog" aria-modal="true" aria-labelledby="field-report-sheet-title">
        <header><span><small>工序自由报工</small><strong id="field-report-sheet-title">{payload.context.step.processName}</strong><em>第 {payload.context.step.position} 道</em></span><button type="button" disabled={saving} aria-label="关闭报工窗口" onClick={() => setSheetOpen(false)}><X size={22} /></button></header>
        <div className="field-report-sheet-scroll">
          <section className="field-report-date-card"><CalendarDays size={24} /><label><span>生产日期</span><input type="date" value={form.workDate} disabled={saving} onChange={event => setForm({ ...form, workDate: event.target.value })} /></label><strong>请务必核对</strong></section>

          {advanceReporting && <section className="field-report-advance"><AlertTriangle size={21} /><span><strong>本次属于提前报工</strong><small>允许先报当前工序，数量不会变成负数；前序补齐后系统自动覆盖并恢复正常流转。</small></span></section>}

          <section className="field-report-quantity-card">
            <header><span><strong>本次报工数量</strong><small>剩余可报 {quantity(payload.context.reportableQty)} {ticket.workOrder.unitLabel}</small></span><em>已到料可覆盖 {quantity(payload.context.remainingInputQty)}</em></header>
            <div><label><span>实际报工</span><div><input inputMode="numeric" pattern="[0-9]*" min="1" max={payload.context.reportableQty} value={form.processedQty} disabled={saving} onChange={event => setForm({ ...form, processedQty: event.target.value })} /><em>{ticket.workOrder.unitLabel}</em></div></label><label><span>不良品</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" max={processedQty} value={form.defectQty} disabled={saving} onChange={event => setForm({ ...form, defectQty: event.target.value })} /><em>{ticket.workOrder.unitLabel}</em></div></label></div>
            <footer><span>本次良品</span><strong>{quantity(goodQty)} <small>{ticket.workOrder.unitLabel}</small></strong></footer>
          </section>

          {defectQty > 0 && <fieldset className="field-report-defect"><legend>不良品处理方式</legend>{([
            ['rework', '返工', '从当前工序重新处理'],
            ...(!ticket.workOrder.parentWorkOrderId ? [['scrap_replenish', '报废补产', '创建补产分支工单'] as const] : []),
            ['quality_pending', '质量待判', '暂停并等待质量确认'],
          ] as const).map(option => <label className={form.defectDisposition === option[0] ? 'selected' : ''} key={option[0]}><input type="radio" name="field-defect" checked={form.defectDisposition === option[0]} disabled={saving} onChange={() => setForm({ ...form, defectDisposition: option[0] })} /><span><strong>{option[1]}</strong><small>{option[2]}</small></span></label>)}</fieldset>}

          <section className="field-report-workers">
            <header><span><strong>作业人员</strong><small>本人已锁定，协作人员可继续添加；工时自动平均分配。</small></span><em>{form.employeeIds.length} 人</em></header>
            {payload.currentEmployee && <div className="field-report-self"><UserRoundCheck size={20} /><span><small>登录身份自动带入</small><strong>{payload.currentEmployee.employeeNo} · {payload.currentEmployee.name}</strong></span><b>本人</b></div>}
            {payload.context.workerPreset && <div className="field-report-preset"><Users size={18} /><span><strong>本周预选人员</strong><small>{payload.context.workerPreset.employees.map(employee => employee.name).join('、') || '暂无'}</small></span><button type="button" disabled={saving || !payload.context.workerPreset.employees.length} onClick={() => setForm({ ...form, employeeIds: [...new Set([currentEmployeeId, ...payload.context!.workerPreset!.employees.map(employee => employee.id)])] })}>一键添加</button></div>}
            <label className="field-report-worker-search"><Search size={17} /><input value={employeeSearch} disabled={saving} onChange={event => setEmployeeSearch(event.target.value)} placeholder="搜索姓名、工号或班组" /></label>
            <div className="field-report-worker-grid">{visibleEmployees.filter(employee => employee.id !== currentEmployeeId).map(employee => {
              const checked = form.employeeIds.includes(employee.id);
              const preferred = preferredIds.has(employee.id);
              return <label className={`${checked ? 'selected ' : ''}${preferred ? 'preferred' : ''}`} key={employee.id}><input type="checkbox" checked={checked} disabled={saving} onChange={() => { setExceptionConfirmed(false); setForm({ ...form, employeeIds: checked ? form.employeeIds.filter(id => id !== employee.id) : [...form.employeeIds, employee.id] }); }} /><span><strong>{employee.name}{preferred && <em>预选</em>}</strong><small>{employee.employeeNo} · {employee.team || employee.position || '班组待维护'}</small></span></label>;
            })}</div>
            {!employeeSearch && orderedEmployees.length > 8 && <button className="field-report-show-workers" type="button" onClick={() => setShowAllEmployees(value => !value)}>{showAllEmployees ? '收起人员列表' : `查看全部 ${orderedEmployees.length} 名生产员工`}<ChevronDown size={16} /></button>}
            {nonPreferredCollaborators.length > 0 && <label className="field-report-worker-confirm"><input type="checkbox" checked={exceptionConfirmed} disabled={saving} onChange={event => setExceptionConfirmed(event.target.checked)} /><AlertTriangle size={18} /><span><strong>包含非预选协作人员</strong><small>请确认 {nonPreferredCollaborators.map(employee => employee.name).join('、')} 确实参与本次作业。</small></span></label>}
          </section>

          <details className="field-report-more"><summary>补充现场信息 <span>班组、工位、备注</span></summary><div><label><span>班组</span><input value={form.team} maxLength={80} disabled={saving} onChange={event => setForm({ ...form, team: event.target.value })} /></label><label><span>工位 / 设备</span><input value={form.workstation} maxLength={80} disabled={saving} onChange={event => setForm({ ...form, workstation: event.target.value })} /></label><label><span>现场备注</span><textarea value={form.remark} rows={2} maxLength={500} disabled={saving} onChange={event => setForm({ ...form, remark: event.target.value })} /></label></div></details>
          {formError && <div className="field-report-form-error" role="alert">{formError}</div>}
        </div>
        <footer><span>{invalid ? nonPreferredCollaborators.length && !exceptionConfirmed ? '请核对非预选协作人员' : '请核对数量、人员与生产日期' : `将为 ${form.employeeIds.length} 人自动记入标准工时`}</span><button type="button" disabled={saving || invalid} onClick={() => void submit()}>{saving ? <><LoaderCircle className="spin" size={19} />正在提交...</> : <><CheckCircle2 size={19} />确认报工并自动记工</>}</button></footer>
      </section>
    </div>}
  </main>;
}
