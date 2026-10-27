'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { OtherHoursDialog } from './OtherHoursDialog';
import { api, hours, queryFor, type Filters, type Row } from './model';

type Selection = Pick<Row, 'id' | 'version' | 'employeeNameSnapshot' | 'employeeNoSnapshot' | 'workDate' | 'requestedMinutes' | 'categoryNameSnapshot'>;
type Result = { id: string; outcome: 'approved' | 'skipped' | 'failed'; message: string; replayed?: boolean; name?: string };
export function useOtherHoursBatch({ filters, rows, enabled, busy, loading, onBusyChange, onComplete, onError, onView }: {
  filters: Filters; rows: Row[]; enabled: boolean; busy: boolean; loading: boolean;
  onBusyChange: (busy: boolean) => void; onComplete: () => void; onError: (error: unknown) => void;
  onView: (id: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map());
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [notice, setNotice] = useState('');
  const batchId = useRef('');
  const filterKey = JSON.stringify(filters);
  const previousFilter = useRef(filterKey);
  const running = useRef(false);
  useEffect(() => {
    if (previousFilter.current !== filterKey) {
      previousFilter.current = filterKey;
      setSelected(new Map()); setResults([]); setConfirm(false); batchId.current = '';
      setNotice('筛选范围已变化，已清除原选择');
    }
    if (!enabled) setActive(false);
  }, [filterKey, enabled]);
  const eligible = rows.filter(row => row.status === 'PENDING' && row.permissions.review);
  const allPage = eligible.length > 0 && eligible.every(row => selected.has(row.id));
  const toggle = (row: Selection) => {
    if (busy || loading || running.current) return;
    batchId.current = ''; setResults([]);
    setSelected(current => { const next = new Map(current); if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row); return next; });
  };
  async function selectAll() {
    if (running.current || busy || loading) return;
    running.current = true; onBusyChange(true);
    try {
      const response = await api<{ rows: Selection[]; skipped: number }>('/api/other-work-times?' + queryFor(filters, 1) + '&part=selection');
      batchId.current = ''; setResults([]); setSelected(new Map(response.rows.map(row => [row.id, row])));
      setNotice(`已选择当前筛选下 ${response.rows.length} 笔可审批记录${response.skipped ? `，排除 ${response.skipped} 笔本人或不可审批记录` : ''}`);
    } catch (error) { onError(error); }
    finally { running.current = false; onBusyChange(false); }
  }
  async function approve() {
    if (running.current || busy || !selected.size) return;
    running.current = true; onBusyChange(true); setConfirm(false);
    const snapshot = [...selected.values()];
    const key = batchId.current ||= crypto.randomUUID();
    const completed: Result[] = [];
    setResults([]); setProgress({ done: 0, total: snapshot.length });
    try {
      for (let offset = 0; offset < snapshot.length; offset += 30) {
        const chunk = snapshot.slice(offset, offset + 30);
        try {
          const response = await api<{ results: Result[] }>('/api/other-work-times/batch-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId: key, items: chunk.map(({ id, version }) => ({ id, version })) }) });
          if (response.results.length !== chunk.length || new Set(response.results.map(item => item.id)).size !== chunk.length || response.results.some(item => !chunk.some(row => row.id === item.id))) throw new Error('批次响应不完整，请重试核对结果');
          completed.push(...response.results.map(result => ({ ...result, name: chunk.find(row => row.id === result.id)!.employeeNameSnapshot })));
          const approved = new Set(response.results.filter(result => result.outcome === 'approved').map(result => result.id));
          setSelected(current => new Map([...current].filter(([id]) => !approved.has(id))));
          setProgress({ done: Math.min(offset + chunk.length, snapshot.length), total: snapshot.length });
        } catch (error) {
          completed.push(...snapshot.slice(offset).map(row => ({ id: row.id, outcome: 'failed' as const, name: row.employeeNameSnapshot,
            message: '未确认处理结果，保留选择后重试；已通过项不会重复审批' })));
          onError(error); break;
        }
      }
      setResults(completed); onComplete();
    } finally { setProgress(null); running.current = false; onBusyChange(false); }
  }
  const total = [...selected.values()].reduce((sum, row) => sum + row.requestedMinutes, 0);
  return { active: active && enabled, selected, toggle,
    trigger: enabled && <button type="button" className="oh-quiet" disabled={busy || loading} aria-pressed={active} onClick={() => {
      setActive(!active); setSelected(new Map()); setResults([]); setNotice(''); batchId.current = '';
    }}>{active ? '退出批量' : '批量审批'}</button>,
    toolbar: active && enabled && <div className="oh-batch-select"><label><input type="checkbox" checked={allPage} disabled={busy || loading || !eligible.length} onChange={() => {
      batchId.current = ''; setResults([]); setSelected(current => { const next = new Map(current); for (const row of eligible) { if (allPage) next.delete(row.id); else next.set(row.id, row); } return next; });
    }} />全选本页</label><button type="button" className="oh-quiet" disabled={busy || loading} onClick={() => void selectAll()}>选择当前筛选全部</button>
      {notice && <small role="status">{notice}</small>}</div>,
    footer: active && enabled && <div className="oh-batch-footer" aria-live="polite">
      <div><strong>已选 {selected.size} 笔</strong><span>合计 {hours(total)}</span><button type="button" className="oh-quiet" disabled={busy || !selected.size} onClick={() => { setSelected(new Map()); batchId.current = ''; }}><X size={14} />清空</button></div>
      <button type="button" className="primary" disabled={busy || loading || !selected.size} onClick={() => setConfirm(true)}><Check size={17} />{progress ? `处理中 ${progress.done} / ${progress.total}` : '一键同意'}</button>
      {!!results.length && <div className="oh-batch-results" role="status"><strong>通过 {results.filter(r => r.outcome === 'approved').length} 笔 · 跳过 {results.filter(r => r.outcome === 'skipped').length} 笔 · 失败 {results.filter(r => r.outcome === 'failed').length} 笔</strong>
        {results.some(r => r.outcome !== 'approved') && <details open><summary>查看未通过原因，剩余记录已保留选择</summary>{results.filter(r => r.outcome !== 'approved').map(r => <p key={r.id}>{r.name}：{r.message}<br /><button type="button" className="oh-quiet" disabled={busy} onClick={() => onView(r.id)}>查看该笔</button><button type="button" className="oh-quiet" disabled={busy || !selected.has(r.id)} onClick={() => setSelected(current => { const next = new Map(current); next.delete(r.id); return next; })}>取消该笔选择</button></p>)}</details>}</div>}
    </div>,
    dialog: confirm && <OtherHoursDialog title="确认批量同意" onClose={() => setConfirm(false)} busy={busy}>
      <div className="oh-batch-confirm"><p>即将通过 <strong>{selected.size} 笔</strong>申报，合计 <strong>{hours(total)}</strong>。</p>
        <p>全部按各自原申报时长通过，保留每笔审批轨迹。需核减或退回的记录，请先取消选择再单独处理。</p>
        <p className="oh-secondary">当前范围：{filters.from || '不限开始日期'} 至 {filters.to || '不限结束日期'}{filters.search ? ` · 搜索“${filters.search}”` : ''}。选择已固定，之后新增的申报不会加入。</p>
        <p className="oh-secondary">批量通过不会再次增加已计入的员工工时；考勤未完善仍需另行核对。</p>
        <details><summary>核对所选明细</summary><div className="oh-batch-review-list">{[...selected.values()].map(row => <p key={row.id}>{row.workDate} · {row.employeeNameSnapshot} {row.employeeNoSnapshot} · {row.categoryNameSnapshot} · {row.requestedMinutes} 分钟</p>)}</div></details>
        <div className="oh-dialog-actions"><button type="button" onClick={() => setConfirm(false)}>返回核对</button><button type="button" className="primary" onClick={() => void approve()}>确认同意 {selected.size} 笔</button></div>
      </div></OtherHoursDialog>,
  };
}
