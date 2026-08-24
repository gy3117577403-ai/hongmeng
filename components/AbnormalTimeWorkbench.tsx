'use client';

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileWarning,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerOff,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { ABNORMAL_TIME_CATEGORIES } from '@/lib/attendance';
import type { AbnormalTimeCategory, AbnormalTimeEventDTO, CurrentUserDTO } from '@/types';

type Period = 'today' | 'week' | 'month';

type AbnormalTimeResponse = {
  ok: boolean;
  error?: string;
  events: AbnormalTimeEventDTO[];
  categories: Array<{
    category: AbnormalTimeCategory;
    categoryLabel: string;
    eventCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
    approvedPersonMilliseconds: number;
  }>;
  summary: {
    eventCount: number;
    pendingCount: number;
    confirmedCount: number;
    rejectedCount: number;
    openCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
    approvedPersonMilliseconds: number;
    confirmedExemptPersonMilliseconds: number;
  };
  permissions: { canReview: boolean; scopeLabel: string };
};

type ReviewDraft = {
  event: AbnormalTimeEventDTO;
  note: string;
  error: string;
};

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function durationText(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

function dateTimeText(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(/\//g, '-');
}

function statusLabel(event: AbnormalTimeEventDTO): string {
  if (event.qualityStatus === 'confirmed') return event.employeeExempt ? '已审核 · 计入免责' : '已审核 · 不免责';
  if (event.qualityStatus === 'rejected') return '已驳回';
  return '待主管审核';
}

function periodLabel(period: Period): string {
  return period === 'today' ? '当日' : period === 'week' ? '本周' : '本月';
}

export default function AbnormalTimeWorkbench({ user }: { user: CurrentUserDTO }) {
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<AbnormalTimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<'all' | AbnormalTimeCategory>('all');
  const [status, setStatus] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('all');
  const [review, setReview] = useState<ReviewDraft | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period, date });
      const response = await fetch(`/api/abnormal-time-events?${params}`, { cache: 'no-store', signal });
      const body = await response.json().catch(() => ({})) as AbnormalTimeResponse;
      if (!response.ok) throw new Error(body.error || '异常工时统计加载失败');
      setData(body);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '异常工时统计加载失败');
    } finally {
      setLoading(false);
    }
  }, [date, period]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleEvents = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase('zh-CN');
    return (data?.events || []).filter(event => {
      if (category !== 'all' && event.category !== category) return false;
      if (status !== 'all' && event.qualityStatus !== status) return false;
      if (!query) return true;
      return [
        event.sequence,
        event.categoryLabel,
        event.subcategory,
        event.title,
        event.reason,
        event.workOrder?.code,
        event.workOrder?.specification,
        event.processStep?.processName,
        event.responsibilityDepartment,
        event.responsibilityObject,
        ...event.allocations.flatMap(item => [item.employee.employeeNo, item.employee.name]),
      ].join(' ').toLocaleLowerCase('zh-CN').includes(query);
    });
  }, [category, data?.events, keyword, status]);

  const maxCategoryMilliseconds = Math.max(1, ...(data?.categories || []).map(item => item.affectedPersonMilliseconds));

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  function beginReview(event: AbnormalTimeEventDTO): void {
    setReview({
      event,
      note: '',
      error: '',
    });
  }

  async function approve(event: AbnormalTimeEventDTO): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/abnormal-time-events/${encodeURIComponent(event.id)}/quality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'confirmed',
          employeeExempt: event.source === 'FIELD_REPORT' ? true : event.employeeExempt,
          expectedVersion: event.version,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '异常工时审核失败');
      setToast('异常工时已同意，个人工时口径已同步');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '异常工时审核失败');
    } finally {
      setSaving(false);
    }
  }

  async function submitReview(): Promise<void> {
    if (!review || saving) return;
    if (!review.note.trim()) {
      setReview({ ...review, error: '驳回时请填写审核说明' });
      return;
    }
    setSaving(true);
    setReview({ ...review, error: '' });
    try {
      const response = await fetch(`/api/abnormal-time-events/${encodeURIComponent(review.event.id)}/quality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'rejected',
          note: review.note,
          expectedVersion: review.event.version,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '异常工时审核失败');
      setReview(null);
      setToast('异常工时已驳回，不计入个人工时');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setReview(current => current ? { ...current, error: reason instanceof Error ? reason.message : '异常工时审核失败' } : current);
    } finally {
      setSaving(false);
    }
  }

  const summary = data?.summary;
  return <main className="abnormal-time-workbench hm-workbench-root hm-cockpit-root hm-workbench-navigation-overlay">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/abnormal-times"
      subtitle="现场异常登记、主管审核与原因统计"
      menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => void logout() }]}
      hideHeader
      sidebarTriggerTargetId="abnormal-time-navigation-trigger"
    />
    <div className="abnormal-time-frame">
      <WorkbenchCockpitCommand
        navigationTargetId="abnormal-time-navigation-trigger"
        icon={<TimerOff size={19} />}
        title="异常工时"
        subtitle="登记与报工解耦；审核通过后才进入个人解释工时"
        context={<><span>{data?.permissions.scopeLabel || '数据范围'}</span><span>{summary?.pendingCount || 0} 条待审核</span></>}
        search={<label><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索工单、工序、员工或问题" /></label>}
        actions={<button className="icon-only" type="button" disabled={loading} aria-label="刷新异常工时" title="刷新" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>}
      />

      <section className="abnormal-time-summary" aria-label="异常工时概览">
        <article><FileWarning /><span>异常事件<small>{periodLabel(period)}登记</small></span><strong>{summary?.eventCount || 0}</strong></article>
        <article className={(summary?.pendingCount || 0) ? 'warning' : 'good'}><ShieldCheck /><span>待主管审核<small>不影响正常报工</small></span><strong>{summary?.pendingCount || 0}</strong></article>
        <article><Clock3 /><span>异常影响人时<small>原始登记口径</small></span><strong>{durationText(summary?.affectedPersonMilliseconds || 0)}</strong></article>
        <article><TimerOff /><span>审核认可人时<small>主管确认口径</small></span><strong>{durationText(summary?.approvedPersonMilliseconds || 0)}</strong></article>
        <article><UsersRound /><span>个人解释工时<small>从达成率有效时段扣除</small></span><strong>{durationText(summary?.confirmedExemptPersonMilliseconds || 0)}</strong></article>
      </section>

      <section className="abnormal-time-toolbar">
        <div className="abnormal-time-period" role="group" aria-label="统计周期">{(['today', 'week', 'month'] as Period[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>)}</div>
        <label><span>基准日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label><span>问题分类</span><select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="all">全部分类</option>{ABNORMAL_TIME_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <label><span>审核状态</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="pending">待主管审核</option><option value="confirmed">已审核</option><option value="rejected">已驳回</option></select></label>
        <p><CheckCircle2 size={15} />原因、责任部门和责任对象均可留空</p>
      </section>

      {error && <div className="abnormal-time-error" role="alert"><AlertTriangle size={17} />{error}</div>}
      <section className="abnormal-time-content">
        <aside className="abnormal-time-categories">
          <header><span><BarChart3 size={17} />问题分布</span><small>按受影响人时排序</small></header>
          <div>{(data?.categories || []).map(item => <button className={category === item.category ? 'active' : ''} type="button" key={item.category} onClick={() => setCategory(current => current === item.category ? 'all' : item.category)}>
            <span><strong>{item.categoryLabel}</strong><em>{item.eventCount} 条</em></span>
            <i><b style={{ width: `${Math.max(4, Math.round(item.affectedPersonMilliseconds / maxCategoryMilliseconds * 100))}%` }} /></i>
            <small>{durationText(item.affectedPersonMilliseconds)} · 已认可 {durationText(item.approvedPersonMilliseconds)}</small>
          </button>)}</div>
          {!loading && !data?.categories.length && <p><CheckCircle2 size={24} />当前周期没有异常工时</p>}
        </aside>

        <section className="abnormal-time-ledger">
          <header><div><span>异常明细</span><h2>{periodLabel(period)}记录</h2></div><em>{visibleEvents.length} 条</em></header>
          <div className="abnormal-time-list">{visibleEvents.map(event => <article className={`status-${event.qualityStatus}`} key={event.id}>
            <header><span><em>#{event.sequence}</em><b>{event.categoryLabel}</b>{event.source === 'FIELD_REPORT' && <i>扫码登记</i>}</span><strong>{statusLabel(event)}</strong></header>
            <h3>{event.processStep?.processName || event.title}</h3>
            <p>{event.workOrder ? `${event.workOrder.specification || event.workOrder.code} · ${event.workOrder.customerName || '客户待维护'}` : '未关联工单'} · {dateTimeText(event.startedAt)}–{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(event.endedAt))}</p>
            <dl>
              <div><dt>登记时长</dt><dd>{durationText(event.durationMilliseconds)}</dd></div>
              <div><dt>受影响员工</dt><dd>{event.allocations.map(item => item.employee.name).join('、')}</dd></div>
              <div><dt>审核时长</dt><dd>{event.approvedDurationMilliseconds ? durationText(event.approvedDurationMilliseconds) : '待审核'}</dd></div>
              <div><dt>责任信息</dt><dd>{[event.responsibilityDepartment, event.responsibilityObject].filter(Boolean).join(' · ') || '未填写'}</dd></div>
            </dl>
            {(event.subcategory || event.reason) && <blockquote>{[event.subcategory, event.reason].filter(Boolean).join(' · ')}</blockquote>}
            <footer><span>登记人：{event.reportedByEmployee?.name || '后台登记'}{event.affectedQuantity ? ` · 影响 ${event.affectedQuantity} 件` : ''}</span>{data?.permissions.canReview && event.qualityStatus === 'pending' && <><button type="button" disabled={saving} onClick={() => beginReview(event)}>驳回</button><button className="approve" type="button" disabled={saving} onClick={() => void approve(event)}>{saving ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}同意</button></>}</footer>
          </article>)}</div>
          {!loading && !visibleEvents.length && <div className="abnormal-time-empty"><CheckCircle2 size={34} /><strong>当前筛选没有异常记录</strong><span>扫码登记不会阻断正常报工，也不会改变订单完整性。</span></div>}
        </section>
      </section>
    </div>

    {loading && !data && <div className="abnormal-time-loading"><Loader2 className="spin" /><span>正在汇总异常工时</span></div>}
    {toast && <div className="abnormal-time-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    {review && <div className="abnormal-time-review-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setReview(null); }}>
      <section className="abnormal-time-review" role="dialog" aria-modal="true" aria-labelledby="abnormal-review-title">
        <header><div><span>主管驳回 · #{review.event.sequence}</span><h2 id="abnormal-review-title">{review.event.processStep?.processName || review.event.title}</h2></div><button type="button" disabled={saving} aria-label="关闭审核" onClick={() => setReview(null)}><X size={19} /></button></header>
        <div>
          <section><Clock3 /><span><small>现场登记</small><strong>{durationText(review.event.durationMilliseconds)} · {review.event.allocations.map(item => item.employee.name).join('、')}</strong></span></section>
          <label><span>驳回原因 <b>必填</b></span><textarea rows={4} maxLength={500} value={review.note} disabled={saving} onChange={event => setReview({ ...review, note: event.target.value, error: '' })} placeholder="请说明驳回原因" /></label>
          {review.error && <p role="alert"><AlertTriangle size={15} />{review.error}</p>}
        </div>
        <footer><button type="button" disabled={saving} onClick={() => setReview(null)}>取消</button><button className="primary" type="button" disabled={saving} onClick={() => void submitReview()}>{saving ? <><Loader2 className="spin" size={17} />提交中</> : '确认驳回'}</button></footer>
      </section>
    </div>}
  </main>;
}
