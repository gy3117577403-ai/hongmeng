'use client';

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Layers3,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Search,
  Send,
  UserRoundCheck,
  UsersRound,
  Warehouse,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  CurrentUserDTO,
  IssueUserDTO,
  MaterialFollowUpStatusDTO,
  MaterialFollowUpSummaryDTO,
  MaterialFollowUpTaskDTO,
} from '@/types';

type StatusFilter = 'ALL' | MaterialFollowUpStatusDTO;
type FollowUpPayload = {
  ok?: boolean;
  tasks?: MaterialFollowUpTaskDTO[];
  summary?: MaterialFollowUpSummaryDTO;
  users?: IssueUserDTO[];
  error?: string;
};

type UpdateForm = {
  ownerId: string;
  status: 'IN_PROGRESS' | 'WAITING_ARRIVAL' | 'WAITING_WAREHOUSE';
  expectedAt: string;
  note: string;
};

const emptySummary: MaterialFollowUpSummaryDTO = {
  total: 0,
  pending: 0,
  inProgress: 0,
  waitingArrival: 0,
  waitingWarehouse: 0,
  resolved: 0,
  overdue: 0,
  unassigned: 0,
};

const statusOptions: Array<{ value: UpdateForm['status']; label: string }> = [
  { value: 'IN_PROGRESS', label: '跟进中' },
  { value: 'WAITING_ARRIVAL', label: '等待物料' },
  { value: 'WAITING_WAREHOUSE', label: '待仓库确认' },
];

const stageNodes = [
  { key: 'PENDING', label: '仓库反馈', hint: '待接收' },
  { key: 'IN_PROGRESS', label: '跟进处理', hint: '已接收' },
  { key: 'WAITING_ARRIVAL', label: '等待物料', hint: '持续跟踪' },
  { key: 'WAITING_WAREHOUSE', label: '仓库确认', hint: '等待复核' },
  { key: 'RESOLVED', label: '反馈闭环', hint: '已解决' },
] as const;

function stageIndex(status: MaterialFollowUpStatusDTO): number {
  if (status === 'IN_PROGRESS') return 1;
  if (status === 'WAITING_ARRIVAL') return 2;
  if (status === 'WAITING_WAREHOUSE') return 3;
  if (status === 'RESOLVED') return 4;
  return 0;
}

function dateText(value?: string | null): string {
  if (!value) return '待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateTimeText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function quantityText(task: MaterialFollowUpTaskDTO): string {
  return task.workOrder.productionTargetQty?.toLocaleString('zh-CN')
    || task.workOrder.uncompletedQty?.trim()
    || '待补充';
}

function formFor(task: MaterialFollowUpTaskDTO | null, currentUserId: string): UpdateForm {
  const status = task?.status === 'WAITING_ARRIVAL' || task?.status === 'WAITING_WAREHOUSE'
    ? task.status
    : 'IN_PROGRESS';
  return {
    ownerId: task?.owner?.id || currentUserId,
    status,
    expectedAt: task?.expectedAt?.slice(0, 10) || '',
    note: '',
  };
}

export default function MaterialFollowUpShell({ user }: { user: CurrentUserDTO }) {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [owner, setOwner] = useState('');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<MaterialFollowUpTaskDTO[]>([]);
  const [summary, setSummary] = useState<MaterialFollowUpSummaryDTO>(emptySummary);
  const [users, setUsers] = useState<IssueUserDTO[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<MaterialFollowUpTaskDTO | null>(null);
  const [form, setForm] = useState<UpdateForm>(() => formFor(null, user.id));
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const canManage = user.laborRole === 'ADMIN' || user.laborRole === 'TEAM_LEAD';

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('taskId');
    if (requested) setSelectedId(requested);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(keyword.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status });
    if (owner) params.set('owner', owner);
    if (query) params.set('keyword', query);
    setLoading(true);
    setError('');
    fetch(`/api/material-follow-ups?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as FollowUpPayload;
        if (response.status === 401) {
          location.href = '/login?next=%2Fworkspace%2Fprocurement';
          return null;
        }
        if (!response.ok) throw new Error(body.error || '缺料跟进任务加载失败');
        return body;
      })
      .then(body => {
        if (!body) return;
        const nextTasks = body.tasks || [];
        setTasks(nextTasks);
        setSummary(body.summary || emptySummary);
        setUsers(body.users || []);
        setSelectedId(current => current && nextTasks.some(task => task.id === current)
          ? current
          : nextTasks[0]?.id || '');
      })
      .catch(reason => {
        if ((reason as { name?: string }).name !== 'AbortError') {
          setError(reason instanceof Error ? reason.message : '缺料跟进任务加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [owner, query, reloadToken, status]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setFormError('');
    fetch(`/api/material-follow-ups/${selectedId}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { ok?: boolean; task?: MaterialFollowUpTaskDTO; error?: string };
        if (!response.ok || !body.task) throw new Error(body.error || '跟进详情加载失败');
        return body.task;
      })
      .then(task => {
        setSelected(task);
        setForm(formFor(task, user.id));
      })
      .catch(reason => {
        if ((reason as { name?: string }).name !== 'AbortError') {
          setFormError(reason instanceof Error ? reason.message : '跟进详情加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, user.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeStage = selected ? stageIndex(selected.status) : 0;
  const visibleActivities = useMemo(() => selected?.activities || [], [selected?.activities]);
  const updateDisabled = !canManage
    || saving
    || !selected
    || selected.status === 'RESOLVED'
    || selected.status === 'CANCELLED'
    || !form.ownerId
    || !form.note.trim()
    || (form.status === 'WAITING_ARRIVAL' && !form.expectedAt);

  async function mutate(body: Record<string, unknown>): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(`/api/material-follow-ups/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, version: selected.version }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; task?: MaterialFollowUpTaskDTO; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error || '缺料跟进更新失败');
      setSelected(result.task);
      setForm(formFor(result.task, user.id));
      setTasks(current => current.map(task => task.id === result.task?.id ? result.task : task));
      setToast(body.action === 'claim' ? '已接收缺料反馈' : '跟进进度已保存');
      setReloadToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '缺料跟进更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return (
    <main className="material-follow-up-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/procurement"
        subtitle="仓库缺料反馈与进度跟进"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => void logout() },
        ]}
      />

      <div className="mf-page-frame">
        <section className="mf-command-deck" aria-labelledby="material-follow-up-title">
          <div>
            <span><Layers3 size={15} aria-hidden="true" />物料协同</span>
            <h1 id="material-follow-up-title">缺料反馈与跟进</h1>
            <p>仓库提交反馈，负责人持续更新进展，最终由仓库确认异常解决。</p>
          </div>
          <div className="mf-command-actions">
            <a href="/workspace/warehouse"><Warehouse size={16} />返回仓库</a>
            <button type="button" disabled={loading} onClick={() => setReloadToken(value => value + 1)}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />刷新
            </button>
          </div>
        </section>

        <section className="mf-summary-deck" aria-label="缺料跟进统计">
          <button className={status === 'ALL' ? 'active' : ''} type="button" onClick={() => setStatus('ALL')}>
            <ClipboardCheck /><span>全部反馈<small>累计跟进任务</small></span><strong>{summary.total}</strong>
          </button>
          <button className={status === 'PENDING' ? 'active warning' : 'warning'} type="button" onClick={() => setStatus('PENDING')}>
            <UsersRound /><span>待接收<small>未分派 {summary.unassigned}</small></span><strong>{summary.pending}</strong>
          </button>
          <button className={status === 'IN_PROGRESS' ? 'active blue' : 'blue'} type="button" onClick={() => setStatus('IN_PROGRESS')}>
            <CircleDot /><span>跟进中<small>正在协调处理</small></span><strong>{summary.inProgress}</strong>
          </button>
          <button className={status === 'WAITING_ARRIVAL' ? 'active orange' : 'orange'} type="button" onClick={() => setStatus('WAITING_ARRIVAL')}>
            <PackageOpen /><span>等待物料<small>逾期 {summary.overdue}</small></span><strong>{summary.waitingArrival}</strong>
          </button>
          <button className={status === 'WAITING_WAREHOUSE' ? 'active green' : 'green'} type="button" onClick={() => setStatus('WAITING_WAREHOUSE')}>
            <PackageCheck /><span>待仓库确认<small>物料反馈已到</small></span><strong>{summary.waitingWarehouse}</strong>
          </button>
          <button className={status === 'RESOLVED' ? 'active muted' : 'muted'} type="button" onClick={() => setStatus('RESOLVED')}>
            <CheckCircle2 /><span>已解决<small>仓库确认闭环</small></span><strong>{summary.resolved}</strong>
          </button>
        </section>

        <section className="mf-toolbar">
          <label className="mf-search"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格、品名、工单或反馈内容" /></label>
          <label><span>负责人</span><select value={owner} onChange={event => setOwner(event.target.value)}><option value="">全部负责人</option><option value="unassigned">待认领</option>{users.map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label>
          {(status !== 'ALL' || owner || keyword) && <button className="mf-clear" type="button" onClick={() => { setStatus('ALL'); setOwner(''); setKeyword(''); }}>清除筛选</button>}
          <span className="mf-toolbar-count">当前 {tasks.length} 项</span>
        </section>

        {error && <div className="mf-error" role="alert"><AlertTriangle size={17} />{error}</div>}

        <section className="mf-workspace">
          <aside className="mf-task-queue" aria-label="缺料反馈队列">
            <header><div><span>反馈队列</span><strong>{loading ? '加载中' : `${tasks.length} 项`}</strong></div><small>按风险和预计时间查看</small></header>
            <div className="mf-task-list hm-scroll-region" tabIndex={0}>
              {tasks.map(task => <button type="button" className={`mf-task-card ${selectedId === task.id ? 'active' : ''} risk-${task.risk}`} key={task.id} onClick={() => setSelectedId(task.id)}>
                <span className="mf-task-risk">{task.riskText}</span>
                <div><small>{task.workOrder.customerName || '客户待补充'}</small><strong>{task.workOrder.specification || task.workOrder.code}</strong><p>{task.workOrder.productName}</p></div>
                <dl><div><dt>反馈</dt><dd>{task.warehouseTask.exceptionNote || '缺料待处理'}</dd></div><div><dt>负责人</dt><dd>{task.owner?.displayName || task.owner?.username || '待认领'}</dd></div></dl>
                <footer><span className={`status-${task.status.toLowerCase()}`}>{task.statusText}</span><time>{task.expectedAt ? `预计 ${dateText(task.expectedAt)}` : dateText(task.updatedAt)}</time><ChevronRight size={15} /></footer>
              </button>)}
              {!loading && !tasks.length && <div className="mf-empty"><PackageCheck /><strong>当前没有缺料反馈</strong><span>仓库登记“缺料”或“数量不足”后会自动进入这里。</span></div>}
              {loading && <div className="mf-empty"><RefreshCw className="spin" /><strong>正在加载反馈任务</strong></div>}
            </div>
          </aside>

          <section className="mf-detail-stage" aria-live="polite">
            {selected && <>
              <header className="mf-detail-header">
                <div><span>仓库缺料反馈</span><h2>{selected.workOrder.specification || selected.workOrder.code}</h2><p>{selected.workOrder.customerName || '客户待补充'} · {selected.workOrder.productName}</p></div>
                <div><span className={`mf-risk-badge risk-${selected.risk}`}>{selected.riskText}</span><strong>{selected.statusText}</strong></div>
              </header>

              <section className="mf-flow-rail" aria-label="缺料跟进流程">
                <div className="mf-flow-line"><i style={{ '--mf-progress': `${Math.max(0, activeStage) * 25}%` } as React.CSSProperties} /></div>
                {stageNodes.map((node, index) => {
                  const nodeState = selected.status === 'CANCELLED'
                    ? index === 0 ? 'cancelled' : 'future'
                    : index < activeStage ? 'done' : index === activeStage ? 'current' : 'future';
                  return <div className={`mf-flow-node ${nodeState}`} key={node.key}><span>{nodeState === 'done' ? <CheckCircle2 /> : index + 1}</span><strong>{node.label}</strong><small>{nodeState === 'done' ? '已完成' : nodeState === 'current' ? node.hint : '待进入'}</small></div>;
                })}
              </section>

              <section className="mf-fact-grid">
                <article><span>生产工单</span><strong>{selected.workOrder.code}</strong><small>计划数量 {quantityText(selected)}</small></article>
                <article><span>仓库反馈</span><strong>{selected.warehouseTask.exceptionNote || '缺料待处理'}</strong><small>{selected.warehouseTask.exceptionType === 'insufficient_quantity' ? '数量不足' : '缺料'}</small></article>
                <article><span>负责人</span><strong>{selected.owner?.displayName || selected.owner?.username || '尚未认领'}</strong><small>{selected.lastFollowedAt ? `最近跟进 ${dateTimeText(selected.lastFollowedAt)}` : '等待接收任务'}</small></article>
                <article><span>预计解决</span><strong>{dateText(selected.expectedAt)}</strong><small>{selected.workOrder.deliveryDay ? `计划交期 ${selected.workOrder.deliveryDay}` : '计划交期待补充'}</small></article>
              </section>

              <section className="mf-latest-progress">
                <div><Clock3 /><span><small>最新进展</small><strong>{selected.latestProgress || selected.warehouseTask.exceptionNote || '等待跟进更新'}</strong></span></div>
                <time>{dateTimeText(selected.updatedAt)}</time>
              </section>

              {selected.status !== 'RESOLVED' && selected.status !== 'CANCELLED' ? canManage ? <section className="mf-update-console">
                <header><div><span>推进任务</span><strong>更新本次跟进结果</strong></div>{!selected.owner && <button type="button" disabled={saving} onClick={() => void mutate({ action: 'claim' })}><UserRoundCheck size={15} />接收任务</button>}</header>
                <div className="mf-update-grid">
                  <label><span>负责人</span><select value={form.ownerId} onChange={event => setForm(current => ({ ...current, ownerId: event.target.value }))}><option value="">选择负责人</option>{users.map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label>
                  <label><span>跟进状态</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as UpdateForm['status'] }))}>{statusOptions.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
                  <label><span>{form.status === 'WAITING_ARRIVAL' ? '预计解决时间 *' : '预计解决时间'}</span><input type="date" value={form.expectedAt} onChange={event => setForm(current => ({ ...current, expectedAt: event.target.value }))} /></label>
                  <label className="wide"><span>本次进展 *</span><textarea rows={3} maxLength={600} value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="例如：已协调调拨，预计周一上午到仓；到料后等待仓库复核。" /></label>
                </div>
                {formError && <div className="mf-form-error" role="alert">{formError}</div>}
                <footer><span>任务只能由仓库确认异常解决后闭环。</span><button type="button" disabled={updateDisabled} onClick={() => void mutate({ action: 'update', ...form })}><Send size={15} />{saving ? '保存中' : '保存跟进进度'}</button></footer>
              </section> : <section className="mf-readonly-note"><UsersRound /><span><strong>当前为只读查看</strong><small>缺料跟进更新由主管或管理员处理。</small></span></section> : <section className="mf-closed-note"><CheckCircle2 /><span><strong>{selected.statusText}</strong><small>{selected.latestProgress || '仓库已经确认本次反馈结束。'}</small></span><a href={`/workspace/warehouse?taskId=${encodeURIComponent(selected.warehouseTaskId)}`}>查看仓库记录</a></section>}

              <section className="mf-mobile-history"><header><strong>最近动态</strong><span>{visibleActivities.length} 条</span></header>{visibleActivities.slice(0, 4).map(activity => <article key={activity.id}><i /><div><strong>{activity.content || '更新缺料跟进'}</strong><small>{activity.actor?.displayName || activity.actor?.username || '系统'} · {dateTimeText(activity.createdAt)}</small></div></article>)}</section>
            </>}
            {!selected && !detailLoading && <div className="mf-detail-empty"><Layers3 /><strong>请选择一条缺料反馈</strong><span>这里会显示任务阶段、当前风险和跟进操作。</span></div>}
            {detailLoading && <div className="mf-detail-empty"><RefreshCw className="spin" /><strong>正在加载任务详情</strong></div>}
          </section>

          <aside className="mf-activity-panel">
            <header><div><span>协同记录</span><strong>动态时间轴</strong></div><Clock3 size={17} /></header>
            {selected && <section className={`mf-risk-orbit risk-${selected.risk}`}>
              <span><AlertTriangle size={16} /></span>
              <div><small>当前风险</small><strong>{selected.riskText}</strong><p>{selected.risk === 'overdue' ? '预计解决时间已超过，请优先更新进展。' : selected.risk === 'unassigned' ? '任务尚无负责人，请及时接收。' : '任务正在正常跟进。'}</p></div>
            </section>}
            <div className="mf-activity-list hm-scroll-region" tabIndex={0}>
              {visibleActivities.map(activity => <article key={activity.id}><i /><div><strong>{activity.content || '更新缺料跟进'}</strong><span>{activity.actor?.displayName || activity.actor?.username || '系统'}</span><time>{dateTimeText(activity.createdAt)}</time></div></article>)}
              {selected && !visibleActivities.length && <div className="mf-activity-empty"><Clock3 /><span>暂无跟进动态</span></div>}
            </div>
            {selected && <footer><a href={`/workspace/warehouse?taskId=${encodeURIComponent(selected.warehouseTaskId)}`}><Warehouse size={15} />打开仓库配料任务</a><div><CalendarClock size={15} /><span>计划交期</span><strong>{selected.workOrder.deliveryDay || dateText(selected.workOrder.plannedAt)}</strong></div></footer>}
          </aside>
        </section>
      </div>

      {toast && <div className="mf-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    </main>
  );
}
