'use client';
import { ChevronRight, Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { CurrentUserDTO } from '@/types';
const SampleModal = dynamic(() => import('@/components/sample/HomeSampleModal'), { ssr: false });
import { useEffect, useRef, useState } from 'react';
import { sampleWarning, type SampleHomeState } from '@/lib/sample-plan-view';
type Item = { id: string; code: string; specificationSnapshot: string; customerNameSnapshot: string; dueDate: string | null; status: string; warningDays: number };
export type SampleHomeCounts = { UNFINISHED: number; COMPLETED: number; SOON: number; TODAY: number; OVERDUE: number };
export default function HomeSampleTasks({ user, state, onChange, onCounts, onNavigate, refreshKey }: { user: CurrentUserDTO; state: SampleHomeState; onChange: (state: SampleHomeState) => void; onCounts: (counts: SampleHomeCounts) => void; onNavigate: (scrollTop: number) => void; refreshKey?: string }) {
  const [modal, setModal] = useState<{ id: string; queue: string[] } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [keyword, setKeyword] = useState(state.keyword);
  const [pagination, setPagination] = useState({ page: state.page, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setRetry(value => value+1); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const scroll = useRef<HTMLDivElement>(null);
  const restoreScroll = useRef<number | null>(state.scrollTop);
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => { const timer = window.setTimeout(() => setKeyword(state.keyword.trim()), 250); return () => clearTimeout(timer); }, [state.keyword]);
  useEffect(() => { restoreScroll.current = stateRef.current.scrollTop; }, [state.view, state.page, keyword]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const query = new URLSearchParams({ compact: 'true', view: state.view, keyword, search: 'model', page: String(state.page), pageSize: '30', sort: state.view === 'COMPLETED' ? 'completed_desc' : 'due_asc' });
    fetch(`/api/sample-tasks?${query}`, { cache: 'no-store', signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || '样品任务加载失败'); if (controller.signal.aborted) return; setItems(body.tasks); setPagination(body.pagination); onCounts(body.viewCounts); }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '样品任务加载失败'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [state.view, state.page, keyword, onCounts, retry, refreshKey]);
  useEffect(() => { if (!loading && scroll.current && restoreScroll.current !== null) { scroll.current.scrollTop = restoreScroll.current; restoreScroll.current = null; } }, [loading]);
  return <div className="hm-hcc-message-pane sample-home-pane">
    <div className="hm-hcc-message-toolbar"><label><Search aria-hidden="true"/><input aria-label="搜索样品产品型号" placeholder="搜索产品型号" value={state.keyword} onChange={event => onChange({ ...state, keyword: event.target.value, page: 1, scrollTop: 0 })}/></label></div>
    {error && <div className="hm-hcc-message-error" role="alert">{error}<button type="button" onClick={() => setRetry(value => value+1)}>重试</button></div>}
    <div ref={scroll} className="hm-hcc-message-list hm-scroll-region sample-home-models" aria-busy={loading}>
      {loading ? <p className="sample-home-empty">正在加载样品任务…</p> : items.map(item => <button type="button" className={`sample-home-model warning-${sampleWarning(item).kind.toLowerCase()}`} key={item.id} onClick={() => { onNavigate(scroll.current?.scrollTop || 0); setModal({ id: item.id, queue: items.map(i => i.id) }); }} title={`${item.specificationSnapshot} · ${item.customerNameSnapshot} · ${item.code} · ${sampleWarning(item).label}`}><span>{item.specificationSnapshot}</span><ChevronRight size={16}/></button>)}
      {!loading && !error && !items.length && <p className="sample-home-empty">{state.keyword ? '没有匹配的产品型号' : state.view === 'COMPLETED' ? '当前没有已完成样品' : '当前没有未完成样品'}</p>}
    </div>
    <footer className="sample-home-pagination"><button type="button" disabled={loading || pagination.page <= 1} onClick={() => onChange({ ...state, page: pagination.page-1, scrollTop: 0 })}>上一页</button><span>{pagination.page} / {pagination.totalPages} · 共 {pagination.total} 项</span><button type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => onChange({ ...state, page: pagination.page+1, scrollTop: 0 })}>下一页</button></footer>
    {modal && <SampleModal user={user} taskId={modal.id} queue={modal.queue} onClose={() => { restoreScroll.current=scroll.current?.scrollTop || 0; setModal(null); setRetry(v => v+1); }}/>}
  </div>;
}
