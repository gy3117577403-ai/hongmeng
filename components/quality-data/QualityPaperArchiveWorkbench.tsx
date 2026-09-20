'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, ClipboardCheck, Download, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { GlassNotice } from '@/components/GlassNotice';
import { requestPreviewLeave } from '@/components/DocumentOrientation';
import { beijingInput, QUALITY_DATA_TYPES, QUALITY_LABELS, type QualityRecord } from '@/lib/quality-data';
import { firstTime } from '@/lib/quality-first-types';
import { paperName, type PaperArchiveList, type PaperArchiveRecord, type PaperArchiveType } from '@/lib/quality-paper-archive';
import type { CurrentUserDTO } from '@/types';
import QualityPaperEditor from './QualityPaperEditor';
import QualityPaperDetail from './QualityPaperDetail';
import { downloadQuality, qualityRequest } from './client';
import './quality-paper.css';
import './quality-paper-archive.css';

type Props = { user: CurrentUserDTO; type: PaperArchiveType; initialRecordId?: string; onTypeChange: (type: string) => void; onReferences: () => void };
const empty: PaperArchiveList = { items: [], total: 0, page: 1, counts: { all: 0, submitted: 0, draft: 0 }, uploaders: [] };
export default function QualityPaperArchiveWorkbench({ user, type, initialRecordId, onTypeChange, onReferences }: Props) {
  const today = beijingInput().slice(0, 10);
  const [list, setList] = useState(empty), [selected, setSelected] = useState<PaperArchiveRecord | null>(null);
  const [period, setPeriod] = useState('all'), [date, setDate] = useState(today), [start, setStart] = useState(today), [end, setEnd] = useState(today);
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [status, setStatus] = useState('ALL');
  const [mine, setMine] = useState(false), [uploader, setUploader] = useState(''), [timeField, setTimeField] = useState('inspection'), [sort, setSort] = useState('date');
  const [deleted, setDeleted] = useState(false), [page, setPage] = useState(1), [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ record?: QualityRecord } | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [exporting, setExporting] = useState(false);
  const [advanced, setAdvanced] = useState(false), [reading, setReading] = useState(false), [mobilePreview, setMobilePreview] = useState(false), [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const preferred = useRef(initialRecordId || '');
  useEffect(() => { const timer = setTimeout(() => { setSearch(q); setPage(1); }, 280); return () => clearTimeout(timer); }, [q]);
  const query = new URLSearchParams({ type, period, date, startDate: start, endDate: end, status, q: search, mine: mine ? '1' : '0', uploader, timeField, sort, deleted: deleted ? '1' : '0', page: String(page) }).toString();
  useEffect(() => {
    let active = true; setLoading(true);
    qualityRequest<PaperArchiveList>('paper-records?' + query).then(async result => {
      if (!active) return;
      if (page > 1 && !result.items.length) { setPage(1); return; }
      setList(result);
      const wanted = result.items.find(item => item.id === preferred.current);
      if (!wanted && preferred.current) {
        const pinned = await qualityRequest<PaperArchiveList>('paper-records?' + new URLSearchParams({ type, period: 'all', recordId: preferred.current, deleted: deleted ? '1' : '0' }));
        if (active) setSelected(pinned.items[0] || result.items[0] || null);
      } else setSelected(wanted || result.items[0] || null);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, refresh, page, type, deleted]);
  function changeType(next: string) { requestPreviewLeave(() => { const url = new URL(location.href); url.searchParams.set('type', next); url.searchParams.delete('recordId'); history.replaceState(null, '', url); onTypeChange(next); }); }
  function link(id = '') { const url = new URL(location.href); url.searchParams.set('type', type); if (id) url.searchParams.set('recordId', id); else url.searchParams.delete('recordId'); history.replaceState(null, '', url); }
  function change(action: () => void, resetPage = true) { requestPreviewLeave(() => { preferred.current = ''; setSelected(null); action(); if (resetPage) setPage(1); setError(''); link(); }); }
  function clear() { change(() => { setQ(''); setSearch(''); setPeriod('all'); setStatus('ALL'); setMine(false); setUploader(''); setTimeField('inspection'); setDeleted(false); setSort('date'); }); }
  function choose(record: PaperArchiveRecord) { requestPreviewLeave(() => { preferred.current = record.id; setSelected(record); setMobilePreview(true); link(record.id); }); }
  function changed(record: QualityRecord) { preferred.current = record.id; setSelected(previous => ({ ...record, activity: previous?.id === record.id ? previous.activity : { firstUploadedAt: null, lastUploadedAt: null, uploadedBy: '', changedAt: record.updatedAt } })); setRefresh(value => value + 1); link(record.id); }
  function saved(record: QualityRecord, done: boolean) {
    if (done) setEditor(null);
    setPeriod('today'); setDate(beijingInput(record.inspectedAt).slice(0, 10)); setQ(''); setSearch(''); setStatus('ALL'); setMine(false); setUploader(''); setTimeField('inspection'); setSort('upload'); setPage(1); setDeleted(false); setMobilePreview(true); changed(record);
    setMessage(done ? '已归档，已定位当前报表' : '内容已保留，可继续补充');
  }
  async function exportData(format: 'xlsx' | 'zip') { setExporting(true); try { await downloadQuality('paper-export?' + query + '&format=' + format, paperName(type) + (format === 'xlsx' ? '.xlsx' : '.zip')); } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); } finally { setExporting(false); } }
  const groups = new Map<string, PaperArchiveRecord[]>();
  list.items.forEach(item => { const day = sort === 'upload' ? (item.activity.lastUploadedAt ? beijingInput(item.activity.lastUploadedAt).slice(0, 10) : '尚未上传') : beijingInput(item.inspectedAt).slice(0, 10); groups.set(day, [...(groups.get(day) || []), item]); });
  return <main className={'hm-workbench-root qd-root qp-root qa-root ' + (mobilePreview ? 'qa-mobile-preview' : '')}>
    <AppWorkbenchHeader user={user} activeHref="/workspace/quality/data" subtitle="" menuItems={[]} hideHeader sidebarTriggerTargetId="qa-sidebar-trigger"/>
    <div className="qa-workbench">
      <header className="qa-head"><div><span id="qa-sidebar-trigger"/><ClipboardCheck size={22}/><h1>质量数据</h1><b>{paperName(type)}</b></div><nav><button onClick={onReferences}><BookOpen size={16}/><span>参考数据</span></button><button aria-label="刷新报表" disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={17}/></button><details className="qa-popover"><summary><Download size={16}/><span>导出</span></summary><div><button disabled={exporting || !list.total} onClick={() => void exportData('xlsx')}>导出当前筛选 Excel</button><button disabled={exporting || !list.total} onClick={() => void exportData('zip')}>按日期打包照片</button></div></details><button className="qd-primary" aria-label="上传报表" onClick={() => setEditor({})}><Plus size={18}/>上传报表</button></nav></header>
      <nav className="qa-types" aria-label="检验类型"><button onClick={() => changeType('')}>全部类型</button>{QUALITY_DATA_TYPES.map(t => <button key={t} aria-pressed={t === type} className={t === type ? 'active' : ''} onClick={() => changeType(t)}>{t === 'FIRST' ? '首检报表' : QUALITY_LABELS[t]}</button>)}</nav>
      <div className="qa-filters"><div className="qa-status">{[['ALL', '全部', list.counts.all], ['SUBMITTED', '已归档', list.counts.submitted], ['DRAFT', '草稿', list.counts.draft]].map(([value, label, count]) => <button key={value} className={status === value ? 'active' : ''} onClick={() => change(() => setStatus(String(value)))}>{label}<small>{count}</small></button>)}</div><label className="qa-search"><Search size={17}/><input aria-label="搜索报表" placeholder="报表名称、上传人、备注或文件名" value={q} onChange={e => change(() => setQ(e.target.value))}/></label><select aria-label="日期范围" value={period} onChange={e => change(() => setPeriod(e.target.value))}><option value="today">按日</option><option value="week">按周</option><option value="month">按月</option><option value="all">全部日期</option><option value="custom">自定义</option></select>{period === 'custom' ? <><input aria-label="开始日期" type="date" value={start} onInput={e => { const value=e.currentTarget.value; change(() => setStart(value)); }} onChange={e => change(() => setStart(e.target.value))}/><input aria-label="结束日期" type="date" value={end} onInput={e => { const value=e.currentTarget.value; change(() => setEnd(value)); }} onChange={e => change(() => setEnd(e.target.value))}/></> : period !== 'all' && <input aria-label="基准日期" type="date" value={date} onInput={e => { const value=e.currentTarget.value; change(() => setDate(value)); }} onChange={e => change(() => setDate(e.target.value))}/>}<div className="qa-more-wrap"><button className={advanced || uploader || timeField === 'upload' ? 'active' : ''} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={16}/>筛选</button>{advanced && <div className="qa-advanced"><header><b>更多筛选</b><button aria-label="关闭筛选" onClick={() => setAdvanced(false)}><X size={16}/></button></header><label>日期依据<select value={timeField} onChange={e => change(() => setTimeField(e.target.value))}><option value="inspection">报表日期</option><option value="upload">最近上传日期</option></select></label><label>上传人<select aria-label="上传人" value={uploader} onChange={e => change(() => setUploader(e.target.value))}><option value="">全部上传人</option>{list.uploaders.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button onClick={clear}>清除所有筛选</button></div>}</div></div>
      <div className="qa-view-bar"><button className={sort === 'date' ? 'active' : ''} onClick={() => change(() => setSort('date'))}>按日期</button><button className={sort === 'upload' ? 'active' : ''} onClick={() => change(() => { setSort('upload'); setPeriod('all'); })}>最近上传</button><label><input type="checkbox" checked={mine} onChange={e => change(() => setMine(e.target.checked))}/>我上传的</label><small>按{timeField === 'upload' ? '最近上传日期' : '报表日期'}筛选 · 共 {list.total} 份</small><button className={'qa-recycle ' + (deleted ? 'active' : '')} onClick={() => change(() => setDeleted(!deleted))}><Trash2 size={15}/>{deleted ? '返回报表' : '回收站'}</button></div>
      <div className={'qa-grid ' + (reading ? 'qa-reading' : '')}>
        <aside className="qa-list"><header><b>{deleted ? '回收站' : paperName(type)}</b><span>{list.total} 份</span></header><div className="qa-list-scroll" aria-busy={loading}>
          {Array.from(groups).map(([day, records]) => <section key={day}><button className="qa-day" aria-expanded={!collapsed.has(day)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(day)) next.delete(day); else next.add(day); return next; })}><ChevronDown size={14}/><b>{day === today ? '今天 · ' + day : day}</b><span>{records.length} 份{list.total > 20 ? ' · 本页' : ''}</span></button>{!collapsed.has(day) && records.map(record => <button key={record.id} className={'qa-record ' + (selected?.id === record.id ? 'selected' : '')} onClick={() => choose(record)}><div><b>{record.title}</b><em className={record.status === 'SUBMITTED' ? 'archived' : 'draft'}>{record.status === 'SUBMITTED' ? '已归档' : '草稿'}</em></div><span>{record.attachments.filter(f => !f.deletedAt).length} 份附件 · {record.activity.lastUploadedAt ? record.activity.uploadedBy : record.createdByName}</span>{record.data.paper?.dateEnd && <span>报表 {beijingInput(record.inspectedAt).slice(0, 10)} 至 {record.data.paper.dateEnd}</span>}<small>{record.activity.lastUploadedAt ? '上传 ' + firstTime(record.activity.lastUploadedAt) : '尚未上传照片'}</small></button>)}</section>)}
          {!list.items.length && !loading && <div className="qa-list-empty"><ClipboardCheck size={28}/><b>没有符合条件的报表</b><span>可调整日期或清除筛选</span><button onClick={clear}>清除筛选</button></div>}
        </div><footer><button disabled={page <= 1 || loading} onClick={() => change(() => setPage(v => v - 1), false)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(list.total / 20))}</span><button disabled={page * 20 >= list.total || loading} onClick={() => change(() => setPage(v => v + 1), false)}>下一页</button></footer></aside>
        <div className="qa-preview"><div className="qa-reading-bar"><button className="qa-mobile-back" onClick={() => setMobilePreview(false)}><ArrowLeft size={16}/>报表列表</button><button className="qa-focus" onClick={() => setReading(!reading)}>{reading ? <PanelLeftOpen size={16}/> : <PanelLeftClose size={16}/>}<span>{reading ? '展开列表' : '专注阅读'}</span></button><small>{selected?.code || (loading ? '正在加载报表…' : '')}</small></div>{selected ? <QualityPaperDetail record={selected} user={user} onChanged={changed} onEdit={() => setEditor({ record: selected })}/> : <div className="qa-empty"><ClipboardCheck size={44}/><h2>{loading ? '正在加载报表' : '选择报表查看照片'}</h2><p>首检与巡检按实际报表日期归档，一份报表可以包含多个产品。</p><button className="qd-primary" onClick={() => setEditor({})}><Plus size={17}/>上传{paperName(type)}</button></div>}</div>
      </div>
    </div>
    {editor && <div className="qd-modal qp-modal qa-modal" role="dialog" aria-modal="true" aria-label={'上传' + paperName(type)}><QualityPaperEditor user={user} type={type} record={editor.record} initialDate={period === 'today' ? date : today} onClose={() => setEditor(null)} onSaved={saved}/></div>}
    <GlassNotice message={error} error close={() => setError('')}/><GlassNotice message={message} close={() => setMessage('')}/>
  </main>;
}
