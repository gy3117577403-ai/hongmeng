'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Clock3, Info, Layers, ListChecks, RefreshCw, UsersRound, X } from 'lucide-react';
import { workloadTotals, workloadCapacityBalance, type ProductionWorkloadReport, type WorkloadTask } from '@/lib/production-workload';
import styles from './ProductionWorkload.module.css';
import { ProductionTimeComparison } from './ProductionTimeComparison';
import { PlanningDetailDrawer } from './PlanningDetailDrawer';

export type WorkloadView = 'plan' | 'remaining' | 'people' | 'capacity';
const hours = (value: number) => (value / 3_600_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const percent = (value: number | null) => value === null ? '—' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
const capacityEquation = (capacity: number, demand: number, ratio: number | null, missing: number) => missing ? '待补标准后测算' : !demand ? '当前无待做工时' : `${hours(capacity)} ÷ ${hours(demand)} = ${percent(ratio)}`;
const kindLabel = (task: WorkloadTask) => task.kind === 'wip' ? '半成品接续' : task.kind === 'carryover' ? '遗留任务' : '本周计划';
function useWorkload(week: string | null | undefined, initial?: ProductionWorkloadReport) {
  const [data, setData] = useState<ProductionWorkloadReport | null>(initial || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initial);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!week) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/production/workload?${new URLSearchParams({ weekStart: week })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async res => { const body = await res.json(); if (!res.ok || !body.ok) throw new Error(body.error || '生产工时加载失败'); return body.data as ProductionWorkloadReport; })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week, revision]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision(n => n + 1); };
    const storage = (event: StorageEvent) => { if (event.key === 'hongmeng:hours-changed') refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh); window.addEventListener('storage', storage); window.addEventListener('hongmeng:hours-changed', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('storage', storage); window.removeEventListener('hongmeng:hours-changed', refresh); };
  }, []);
  return { data: data?.weekStart === week ? data : null, error, loading, refresh: () => setRevision(n => n + 1) };
}

export function PlanningTimeComparison({ week, batchIds, inline = false }: { week?: string; batchIds: string[]; inline?: boolean }) {
  const { data, error, loading, refresh } = useWorkload(week);
  const [open, setOpen] = useState(false);
  return <div className={inline ? styles.planningInline : styles.planningComparison}>
    {error ? <p className={styles.error}>工时对照加载失败<button type="button" onClick={refresh}>重试</button></p>
      : data ? <ProductionTimeComparison data={data} batchIds={batchIds} inline={inline} onOpen={() => setOpen(true)} />
        : <p className={styles.message} role="status">{loading ? '正在核对计划与执行工时…' : '请选择生产周'}</p>}
    {open && data && <PlanningDetailDrawer title="工时明细" subtitle={`${week} 所选正常批次 · 原始计划与当前工序标准`} onClose={() => setOpen(false)}>
      <ProductionTimeComparison data={data} batchIds={batchIds} detailsOpen />
    </PlanningDetailDrawer>}
  </div>;
}

export function ProductionWorkloadCards({ week, onOpen }: { week?: string | null; onOpen: (data: ProductionWorkloadReport, view: WorkloadView) => void }) {
  const { data, error, loading, refresh } = useWorkload(week);
  const balance = data ? workloadCapacityBalance(data.capacity, data.all.missingStandard > 0) : null;
  return <section className={styles.section} aria-label="新增生产工时与人员能力">
    <header className={styles.sectionHead}><strong>生产工时与人员能力</strong><span>按计划工序统计 · 无需等待考勤</span><button type="button" onClick={refresh} disabled={loading} aria-label="刷新生产工时"><RefreshCw size={14} /></button></header>
    {!week ? <p className={styles.message}>请选择一个生产周查看计划工时与人员能力。</p> : error ? <p className={styles.error} role="alert">{error}<button type="button" onClick={refresh}>重试</button></p> : !data ? <p className={styles.message} role="status">正在汇总本周计划、遗留工序及人员范围…</p> : <>
      <ProductionTimeComparison data={data} compact onOpen={() => onOpen(data, 'plan')} />
      <div className={styles.cards}>
        <button type="button" className={`${styles.metric} ${styles.plan}`} onClick={() => onOpen(data, 'plan')}>
          <span className={styles.title}><ListChecks size={17} />本周执行工时达成率<ChevronRight size={14} /></span>
          <strong className={styles.value}>{data.plan.missingStandard ? '待补标准' : data.plan.planned ? percent(data.plan.percentage) : '暂无计划'}</strong>
          <span className={styles.meta}>已完成 {hours(data.plan.completed)} / 执行基准 {hours(data.plan.planned)} 小时</span>
          <span className={styles.bar}><i style={{ width: `${data.plan.percentage || 0}%` }} /></span>
          <span className={styles.split}><span>本周计划剩余</span><b>{hours(data.plan.remaining)}h</b></span>
          <span className={styles.cardFooter}><span>{data.plan.pending ? `含待匹配 ${hours(data.plan.pending)}h` : '含本周半成品接续'}</span><em>计划明细 ›</em></span>
        </button>
        <button type="button" className={styles.metric} onClick={() => onOpen(data, 'remaining')}>
          <span className={styles.title}><Layers size={17} />当前待做总工时<ChevronRight size={14} /></span>
          <strong className={styles.value}>{hours(data.all.remaining)}<small>小时{data.all.missingStandard ? '（已知）' : ''}</small></strong>
          <span className={styles.meta}>全部任务推进 {data.all.missingStandard ? '待补标准' : percent(data.all.percentage)} · {hours(data.all.completed)} / {hours(data.all.planned)}h</span>
          <span className={styles.split}><span>本周计划剩余</span><b>{hours(data.plan.remaining)}h</b></span>
          <span className={styles.split}><span>遗留任务剩余</span><b>{hours(data.carryover.remaining)}h</b></span>
          <span className={styles.cardFooter}><span>仅含排入本周的任务</span><em>剩余工序 ›</em></span>
        </button>
        <button type="button" className={styles.metric} onClick={() => onOpen(data, 'people')}>
          <span className={styles.title}><UsersRound size={17} />本周预计人员工时<ChevronRight size={14} /></span>
          <strong className={styles.value}>{hours(data.capacity.planned)}<small>小时</small></strong>
          <span className={styles.meta}>{data.capacity.count} 人 · 正常 6 天 × 8 小时{data.people.some(p => p.included && p.days !== 6) ? ' · 含任职天数调整' : ''}</span>
          <span className={styles.ratios}><span><small>覆盖本周计划</small><b>{percent(data.capacity.planCoverage)}</b></span><span><small>覆盖当前待做</small><b>{!data.all.remaining && !data.all.missingStandard ? '已完成' : percent(data.capacity.outstandingCoverage)}</b></span></span>
          <span className={styles.cardFooter}><span>整周人员能力参考</span><em>人员范围 ›</em></span>
        </button>
      </div>
      <button type="button" className={styles.capacityStrip} onClick={() => onOpen(data, 'capacity')}><span><Clock3 size={16} /><b>本周剩余人员能力</b></span><span>可用 <b>{hours(data.capacity.remaining)}h</b></span><span>覆盖 <b>{!data.all.remaining && !data.all.missingStandard ? '已完成' : percent(data.capacity.remainingCoverage)}</b></span><span>{balance?.label} <strong>{balance?.value == null ? '待补标准' : `${hours(balance.value)}h`}</strong></span><ChevronRight size={15} /></button>
      {data.all.missingStandard > 0 && <p className={styles.warning}><AlertTriangle size={14} />{data.all.missingStandard} 道工序待补标准，当前工时为已知合计，覆盖率暂不作完整判断。</p>}
    </>}
  </section>;
}

export function ProductionWorkloadDrawer({ initial, initialView, onClose, onBack }: {
  initial: ProductionWorkloadReport; initialView: WorkloadView; onClose: () => void; onBack: () => void;
}) {
  const { data: refreshed, error, loading, refresh } = useWorkload(initial.weekStart, initial);
  const data = refreshed || initial;
  const balance = workloadCapacityBalance(data.capacity, data.all.missingStandard > 0);
  const [view, setView] = useState(initialView);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [peopleFilter, setPeopleFilter] = useState('included');
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, summary') || [])].filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = bodyOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  const tasks = data.tasks.filter(t => view !== 'plan' || t.kind !== 'carryover').filter(t => filter === 'all' || (filter === 'carryover' ? t.kind === 'carryover' : t.kind !== 'carryover'));
  const totals = workloadTotals(tasks);
  const metric = view === 'plan' ? data.plan : data.all;
  const setTab = (next: WorkloadView) => { setView(next); setFilter('all'); setExpanded(null); };
  const people = data.people.filter(p => peopleFilter === 'included' ? p.included : !p.included);
  return createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="production-workload-title" ref={dialog} tabIndex={-1}>
      <header className={styles.drawerHead}><button type="button" onClick={onBack}><ArrowLeft size={16} />达成率总览</button><div><small>{data.weekStart} — {data.weekEnd}</small><h2 id="production-workload-title">生产工时与人员能力</h2></div><button type="button" onClick={onClose} aria-label="关闭生产工时明细"><X size={20} /></button></header>
      <nav className={styles.tabs} aria-label="工时明细分类">{([['plan', '本周计划'], ['remaining', '全部待做'], ['people', '人员范围'], ['capacity', '能力测算']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <div className={styles.drawerBody}>
        <div className={styles.update}><span>{new Date(data.calculatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 更新</span><button type="button" disabled={loading} onClick={refresh}><RefreshCw size={14} />{loading ? '更新中' : '刷新'}</button></div>
        {error && <p className={styles.error} role="alert">{error} · 暂时保留上次成功结果</p>}
        {(view === 'plan' || view === 'remaining') && <>
          {view === 'plan' && <ProductionTimeComparison data={data} />}
          <div className={styles.result}><div><small>{view === 'plan' ? '本周执行工时达成率' : '当前待做总工时'}</small><strong>{view === 'plan' ? metric.missingStandard ? '待补标准' : percent(metric.percentage) : `${hours(data.all.remaining)} 小时`}</strong></div><div><small>本周已完成 / 本周执行基准</small><b>{hours(metric.completed)} / {hours(metric.planned)} 小时</b><span>{view === 'remaining' ? `全部任务推进 ${percent(metric.percentage)}` : `剩余 ${hours(metric.remaining)} 小时`}</span></div></div>
          <p className={styles.note}><Info size={15} />{view === 'plan' ? '本周计划含排入本周的半成品接续；遗留任务单列。' : '待做 = 本周计划剩余 + 排入本周的遗留剩余。推进率分母为本周任务基准。'}半成品及待匹配报工已计入。</p>
          {metric.missingStandard > 0 && <p className={styles.warning}><AlertTriangle size={15} />{metric.missingStandard} 道工序缺标准工时，当前仅显示已知合计。</p>}
          {(metric.movedOut > 0 || metric.excess > 0) && <p className={styles.note}>原基准 {hours(metric.original)}h；转仓 / 改排移出 {hours(metric.movedOut)}h；超出当前工序计划的已报工时 {hours(metric.excess)}h 单列，不重复冲抵其他工序。</p>}
          {view === 'remaining' && <div className={styles.filters}>{[['all', '全部任务'], ['plan', '本周计划'], ['carryover', '遗留任务']].map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setExpanded(null); }}>{label}</button>)}</div>}
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>规格 / 工单</th><th>来源</th><th>基准 h</th><th>已完成 h</th><th>剩余 h</th><th>明细</th></tr></thead><tbody>{tasks.map(task => { const total = workloadTotals([task]); return <Fragment key={task.id}><tr><td><strong>{task.specification}</strong><small>{task.customer}</small><small>{task.code}</small></td><td><span className={task.kind === 'carryover' ? styles.legacy : styles.source}>{kindLabel(task)}</span><small>{task.sourceWeek}</small></td><td>{hours(total.planned)}</td><td>{hours(total.completed)}</td><td><b>{hours(total.remaining)}</b>{total.missingStandard > 0 && <small>待补标准</small>}</td><td><button type="button" aria-label={`展开 ${task.specification} 工序`} aria-expanded={expanded === task.id} onClick={() => setExpanded(expanded === task.id ? null : task.id)}>工序<ChevronDown size={13} /></button></td></tr>{expanded === task.id && <tr className={styles.steps}><td colSpan={6}><div className={styles.stepHead}><b>工序标准快照 · 路线版本 {task.routeVersion ?? '待绑定'}</b><span>匹配前后只计一次</span></div>{task.steps.map(step => <div className={styles.step} key={step.id}><span>{step.position || '—'}. {step.name}</span><span>基准 {hours(step.planned)}h</span><span>已完成 {hours(step.completed)}h</span><b>{step.missingStandard ? '待补标准' : `剩余 ${hours(step.remaining)}h`}</b>{step.pending > 0 && <small>待匹配 {hours(step.pending)}h · 已计入</small>}</div>)}</td></tr>}</Fragment>; })}</tbody><tfoot><tr><td colSpan={2}>合计 · {tasks.length} 项</td><td>{hours(totals.planned)}</td><td>{hours(totals.completed)}</td><td>{hours(totals.remaining)}</td><td /></tr></tfoot></table>{!tasks.length && <p className={styles.message}>该生产周暂无符合条件的任务。</p>}</div>
        </>}
        {view === 'people' && <>
          <div className={styles.result}><div><small>整周预计人员能力</small><strong>{hours(data.capacity.planned)}<em>小时</em></strong></div><div><b>计入 {data.capacity.count} 人 · 排除 {data.capacity.excludedCount} 人</b><span>完整任职周：每人 6 天 × 8 小时</span></div></div>
          <p className={styles.note}>生产人员排除样品、组长、主管及档案标记排除者；跨周入职、离职、调岗按生效日期计算。考勤是否填写不影响此项。</p>
          <div className={styles.filters}><button type="button" aria-pressed={peopleFilter === 'included'} onClick={() => setPeopleFilter('included')}>计入 {data.capacity.count} 人</button><button type="button" aria-pressed={peopleFilter === 'excluded'} onClick={() => setPeopleFilter('excluded')}>排除 {data.capacity.excludedCount} 人</button></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>员工</th><th>班组 / 岗位</th><th>统计依据</th><th>天数</th><th>预计 h</th></tr></thead><tbody>{people.map(person => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.employeeNo}</small></td><td>{person.team || '未分组'}<small>{person.position || '未填写岗位'}</small></td><td>{person.reason}</td><td>{person.days}</td><td>{hours(person.planned)}</td></tr>)}</tbody></table>{!people.length && <p className={styles.message}>当前分类没有人员。</p>}</div>
        </>}
        {view === 'capacity' && <>
          <div className={styles.result}><div><small>本周剩余人员覆盖率</small><strong>{!data.all.remaining && !data.all.missingStandard ? '已完成' : percent(data.capacity.remainingCoverage)}</strong></div><div><small>{balance.label}</small><b>{balance.value == null ? '补齐标准后测算' : `${hours(balance.value)} 小时`}</b></div></div>
          {data.all.missingStandard > 0 && <p className={styles.warning}>存在缺标准工序；下面需求只含已知工时，不能据此判定人员足够。</p>}
          <div className={styles.calculations}><article><small>本周计划人员覆盖率</small><b>{capacityEquation(data.capacity.planned, data.plan.planned, data.capacity.planCoverage, data.plan.missingStandard)}</b><span>整周预计人员工时 / 本周执行基准</span></article><article><small>当前待做覆盖参考</small><b>{capacityEquation(data.capacity.planned, data.all.remaining, data.capacity.outstandingCoverage, data.all.missingStandard)}</b><span>整周预计人员工时 / 当前待做总工时</span></article><article><small>本周剩余人员覆盖率</small><b>{capacityEquation(data.capacity.remaining, data.all.remaining, data.capacity.remainingCoverage, data.all.missingStandard)}</b><span>尚未过去的正常班次工时 / 当前待做总工时</span></article></div>
          <p className={styles.note}>正常班次按周一至周六 08:00—12:00、13:00—17:00，北京时间计算；已经过去的时间不再计入剩余能力。每人每天 8 小时，不折算 95%，不默认加入加班。</p>
          <p className={styles.note}>总工时覆盖是人员能力参考；缺料、关键工序及设备限制仍需结合生产安排判断。</p>
        </>}
      </div>
    </aside>
  </div>, document.body);
}
