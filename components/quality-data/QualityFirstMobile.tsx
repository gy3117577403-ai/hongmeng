'use client';
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, ClipboardCheck, Search, X } from 'lucide-react';
import { beijingInput, isFirstInspectionProcess, RESULT_LABELS, type QualityOrder, type QualityRecord } from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import { qualityRequest } from './client';
import type { FirstOverview } from './QualityPaperWorkbench';
import QualityPaperEditor from './QualityPaperEditor';
import QualityPaperDetail from './QualityPaperDetail';
import './quality-paper.css';

export default function QualityFirstMobile({ user, code, order, initialStepId, initialRecord, onClose }: { user: CurrentUserDTO; code: string; order: QualityOrder; initialStepId?: string; initialRecord?: QualityRecord; onClose: () => void }) {
  const [overview, setOverview] = useState<FirstOverview | null>(null), [stepId, setStepId] = useState(initialStepId || ''), [visited, setVisited] = useState<string[]>([]), [picker, setPicker] = useState(false), [search, setSearch] = useState('');
  const [tab, setTab] = useState<'form' | 'records'>(initialRecord ? 'records' : 'form'), [page, setPage] = useState(1), [records, setRecords] = useState<{ total: number; items: QualityRecord[] }>({ total: 0, items: [] }), [record, setRecord] = useState<QualityRecord | null>(initialRecord || null);
  const [editing, setEditing] = useState<QualityRecord | null>(null), [generation, setGeneration] = useState<Record<string, number>>({}), [refresh, setRefresh] = useState(0), [error, setError] = useState(''), [message, setMessage] = useState('');
  const dirtySteps = useRef(new Set<string>());
  const [busy,setBusy]=useState(false),[leaving,setLeaving]=useState(false);
  function close() { if(busy)return; if(dirtySteps.current.size)setLeaving(true);else onClose(); }
  const step = overview?.steps.find(item => item.id === stepId);
  const first = Boolean(step && isFirstInspectionProcess(step.name));
  useEffect(() => {
    let active = true;
    qualityRequest<FirstOverview>('first-steps/' + order.id).then(value => { if (!active) return; setOverview(value); setStepId(current => value.steps.some(item => item.id === current) ? current : value.steps.find(item => isFirstInspectionProcess(item.name))?.id || ''); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [order.id, refresh]);
  useEffect(() => { if (first) setVisited(items => items.includes(stepId) ? items : [...items, stepId]); }, [first, stepId]);
  useEffect(() => {
    if (!stepId) return; let active = true;
    qualityRequest<{ total: number; items: QualityRecord[] }>('records?' + new URLSearchParams({ period: 'all', type: 'FIRST', scan: '1', workOrderId: order.id, inspectionStepId: stepId, page: String(page) })).then(value => { if (active) setRecords(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [order.id, stepId, page, refresh]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 3200); return () => clearTimeout(timer); }, [message]);
  function saved(value: QualityRecord, done: boolean) { if (done) { setEditing(null); if(!editing)setGeneration(items => ({ ...items, [stepId]: (items[stepId] || 0) + 1 })); setRefresh(count => count + 1); setTab('records'); setMessage('已保存至本工单、本工序'); } }
  return <main className="qd-mobile-root qp-mobile">
    <header><button disabled={busy} onClick={close} aria-label="返回质量登记"><ArrowLeft size={20}/></button><div><small>现场扫码</small><h1>首件检验</h1></div><span>{user.displayName || user.username}</span></header>
    <section className="qp-mobile-order"><small>当前工单{order.batchNo ? ' · 第 ' + order.batchNo + ' 批' : ''}</small><b>{order.specification || order.productName}</b><span>{order.businessCode || order.code}</span></section>
    <button className="qp-mobile-step" disabled={busy} onClick={() => { setPicker(true); setSearch(''); }}><div><small>当前工序</small><b>{step ? '第 ' + String(step.position || '').padStart(2, '0') + ' 道 · ' + step.name : '选择首件检验工序'}</b></div><ChevronDown size={17}/></button>
    {error && <div role="alert" className="qd-alert error">{error}<button onClick={() => setError('')}>关闭</button></div>}{message && <div className="qp-toast" role="status">{message}</div>}
    <><nav hidden={!first}><button disabled={busy} className={tab === 'form' ? 'active' : ''} onClick={() => { setTab('form'); setRecord(null); }}>登记检验</button><button disabled={busy} className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>本工序记录 {records.total}</button></nav><div className="qp-mobile-main">{visited.map(id => { const selectedStep = overview?.steps.find(item => item.id === id); return selectedStep && <div key={id + ':' + (generation[id] || 0)} hidden={!first || id !== stepId || tab !== 'form'} className="qp-mobile-form-cache"><QualityPaperEditor inline type="FIRST" user={user} order={order} step={selectedStep} sourceQrCode={code} onClose={close} onSaved={saved} onBusyChange={setBusy} onDirtyChange={dirty => { if(dirty)dirtySteps.current.add(id);else dirtySteps.current.delete(id); }}/></div>; })}{first && tab === 'records' && (record ? <QualityPaperDetail record={record} user={user} onChanged={value => { setRecord(value); setRefresh(count => count + 1); }} onEdit={() => setEditing(record)}/> : <div className="qp-mobile-history">{records.items.map(item => <button className="qp-record" key={item.id} onClick={() => setRecord(item)}><div><b>{beijingInput(item.inspectedAt).replace('T', ' ')}</b><span className={'qd-badge ' + item.result.toLowerCase()}>{item.status === 'DRAFT' ? '草稿' : RESULT_LABELS[item.result]}</span></div><span>{item.data.context.inspectedBy || item.createdByName}</span><footer>{item.attachments.filter(file => !file.deletedAt).length} 份照片 · {item.data.summary || '查看记录'}</footer><ChevronRight size={16}/></button>)}{!records.items.length && <div className="qp-empty"><ClipboardCheck size={30}/><b>本工序还没有首件记录</b></div>}<div className="qd-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page}</span><button disabled={page * 20 >= records.total} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>)}</div></>{!first && <div className="qp-empty"><ClipboardCheck size={35}/><b>{step ? '当前是 ' + step.name + ' 工序' : '请选择首件检验工序'}</b>{step ? <Link href={'/field-report/' + encodeURIComponent(code) + '?mode=report&stepId=' + encodeURIComponent(step.id)}>进入该工序报工</Link> : <button onClick={() => setPicker(true)}>选择工序</button>}</div>}
    {leaving && <div className="qp-leave-confirm" role="alert"><span>还有未保存内容</span><button onClick={()=>setLeaving(false)}>继续填写</button><button onClick={onClose}>放弃本次修改</button></div>}
    {picker && <div className="qd-modal qp-modal" role="dialog" aria-modal="true" aria-label="选择检验工序"><section className="qp-picker"><header><div><b>选择工序</b><small>{overview?.steps.length || 0} 道 · 同名工序按序号区分</small></div><button aria-label="关闭工序选择" onClick={() => setPicker(false)}><X size={20}/></button></header><div className="qp-list-search"><Search size={17}/><input autoFocus aria-label="搜索工序" placeholder="输入工序名或序号" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="qp-picker-list">{overview?.steps.filter(item => !item.retired && (!search || (String(item.position || '').padStart(2, '0') + ' ' + item.name).includes(search))).map(item => <button key={item.id} className={item.id === stepId ? 'active' : ''} onClick={() => { setStepId(item.id); setPicker(false); setPage(1); setRecord(null); setTab('form'); }}><span className="qp-sequence">{String(item.position || '').padStart(2, '0')}</span><div><b>{item.name}</b><small>{isFirstInspectionProcess(item.name) ? '登记首件结果和检验照片' : '普通工序报工'}</small></div><ChevronRight size={16}/></button>)}</div></section></div>}
    {editing && <div className="qd-modal qp-modal" role="dialog" aria-modal="true" aria-label="编辑首件记录"><QualityPaperEditor type="FIRST" user={user} order={order} step={editing.inspectionStepSnapshot || step} record={editing} onClose={() => setEditing(null)} onSaved={saved}/></div>}
  </main>;
}
