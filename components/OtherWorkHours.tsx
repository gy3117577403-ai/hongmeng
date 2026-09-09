'use client';
/* Authenticated evidence photos must use the same-origin session; QR images are local data URLs. */
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Plus, QrCode, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type { CurrentUserDTO } from '@/types';
import './other-work-hours.css';

type Category = { id: string; name: string; isActive: boolean; version: number };
type Photo = { id: string; originalName: string; url: string };
type Row = {
  id: string; employeeId: string; version: number; workDate: string; employeeNameSnapshot: string; employeeNoSnapshot: string; teamSnapshot: string | null;
  categoryId: string; categoryNameSnapshot: string; requestedMinutes: number; approvedMinutes: number | null; status: string;
  description: string; arranger: string | null; sampleReference: string | null; backfillReason: string | null;
  startedAt: string | null; endedAt: string | null; reviewedByName: string | null; reviewedAt: string | null;
  correctionRequestedAt: string | null; correctionReason: string | null; correctionOfId: string | null;
  attachments: Photo[]; reviews: { id: string; action: string; reason: string | null; createdAt: string; actor: { displayName: string; username: string } }[];
  permissions: { edit: boolean; submit: boolean; withdraw: boolean; review: boolean; void: boolean; requestCorrection: boolean };
};
type Data = { rows: Row[]; categories: Category[]; summary: { approvedMinutes: number; pending: number };
  byCategory: { categoryNameSnapshot: string; _sum: { approvedMinutes: number | null }; _count: number }[];
  pagination: { page: number; size: number; total: number }; permissions: { manage: boolean; admin: boolean }; today: string;
  employees?: { id: string; name: string; employeeNo: string }[] };
type Context = { attendanceStatus: string; attendanceMilliseconds: number; confirmedLossMilliseconds: number;
  reviewerAvailable: boolean; completions: { id: string; workStartedAt: string; workEndedAt: string }[];
  other: { id: string; status: string; categoryNameSnapshot: string; requestedMinutes: number; approvedMinutes: number | null }[];
  executions: { startedAt: string; endedAt: string; actualLaborMilliseconds: number }[]; reviewHint: string };
type Form = { workDate: string; categoryId: string; requestedMinutes: number; description: string; arranger: string; sampleReference: string; backfillReason: string; startedAt: string; endedAt: string; employeeId: string };
const states: Record<string, string> = { DRAFT: '草稿', PENDING: '待审批', APPROVED: '已通过', REJECTED: '已退回', WITHDRAWN: '已撤回', VOIDED: '已作废' };
const actions: Record<string, string> = { CREATE: '保存草稿', EDIT: '修改草稿', SUBMIT: '提交审批', APPROVE: '审批通过', REJECT: '退回修改', WITHDRAW: '撤回申请', VOID: '作废记录', CORRECTION_REQUEST: '申请更正', UPLOAD_PHOTO: '上传照片', DELETE_PHOTO: '移除照片' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const hours = (minutes: number) => (minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 小时';
const dateTime = (date: string) => new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const initialForm = (): Form => ({ workDate: today(), categoryId: '', requestedMinutes: 60, description: '', arranger: '', sampleReference: '', backfillReason: '', startedAt: '', endedAt: '', employeeId: '' });
function timeOf(date: string | null) { return date ? new Date(date).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 5) : ''; }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok || value.ok === false) throw new Error(value.error || '操作失败');
  return value;
}
async function compressPhoto(file: File) {
  if (file.size < 1500000 || !file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } finally { bitmap.close(); }
}

export default function OtherWorkHours({ user, approval = false, field = false }: { user: CurrentUserDTO; approval?: boolean; field?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [form, setForm] = useState<Form>(initialForm);
  const [isNew, setIsNew] = useState(field);
  const [status, setStatus] = useState(approval ? 'PENDING' : '');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [scope, setScope] = useState(field ? 'mine' : 'manage');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [reason, setReason] = useState(''); const [approvedMinutes, setApprovedMinutes] = useState(60);
  const [qr, setQr] = useState(''); const [qrOpen, setQrOpen] = useState(false);
  const [preview, setPreview] = useState<Photo | null>(null);
  const [categoryName, setCategoryName] = useState(''); const [configOpen, setConfigOpen] = useState(false);
  const [corrections, setCorrections] = useState(false);
  const idempotency = useRef('');
  const correctionOf = useRef<string | null>(null);
  const selectedId = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const params = useCallback(() => {
    const p = new URLSearchParams({ scope, status, search, page: String(page) });
    if (from) p.set('from', from); if (to) p.set('to', to);
    if (categoryFilter) p.set('categoryId', categoryFilter);
    if (corrections) p.set('corrections', '1');
    const employeeId = new URLSearchParams(window.location.search).get('employeeId');
    if (employeeId) p.set('employeeId', employeeId);
    return p;
  }, [scope, status, search, page, from, to, corrections, categoryFilter]);
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    try {
      let result: Data;
      try { result = await api<Data>('/api/other-work-times?' + params()); }
      catch (err) {
        if (scope !== 'manage') throw err;
        const mine = new URLSearchParams(params()); mine.set('scope', 'mine');
        result = await api<Data>('/api/other-work-times?' + mine);
        if (!result.permissions.manage) setScope('mine'); else throw err;
      }
      if (generation === requestGeneration.current) {
        setData(result);
        setForm(current => current.categoryId ? current : { ...current, categoryId: result.categories.find(c => c.isActive)?.id || '' });
      }
    } catch (err) { if (generation === requestGeneration.current) setError(err instanceof Error ? err.message : '加载失败'); }
    finally { if (generation === requestGeneration.current) setLoading(false); }
  }, [params, scope]);
  useEffect(() => { void load(); }, [load]);
  const select = useCallback(async (id: string) => {
    selectedId.current = id; setError('');
    try {
      const result = await api<{ row: Row; context: Context }>('/api/other-work-times/' + id);
      if (selectedId.current !== id) return;
      setSelected(result.row); setContext(result.context); setIsNew(false);
      setApprovedMinutes(result.row.requestedMinutes); setReason('');
      setForm({ ...initialForm(), ...result.row, arranger: result.row.arranger || '', sampleReference: result.row.sampleReference || '',
        backfillReason: result.row.backfillReason || '', startedAt: timeOf(result.row.startedAt), endedAt: timeOf(result.row.endedAt) });
    } catch (err) { setError(err instanceof Error ? err.message : '详情加载失败'); }
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('from')) setFrom(p.get('from')!); if (p.get('to')) setTo(p.get('to')!);
    if (p.get('status')) setStatus(p.get('status')!);
    if (p.get('id')) void select(p.get('id')!);
  }, [select]);
  useEffect(() => {
    // Refresh totals on return without overwriting an in-progress form or photo upload.
    const reload = () => { void load(); };
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [load]);
  useEffect(() => {
    if (qrOpen) void QRCode.toDataURL(window.location.origin + '/field-report/other-hours', { width: 600, margin: 3, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setError('二维码生成失败，请重试'));
  }, [qrOpen]);
  const fresh = (copy?: Row) => {
    selectedId.current = null; setSelected(null); setContext(null); setIsNew(true); setError(''); setNotice('');
    correctionOf.current = copy?.id || null; idempotency.current = crypto.randomUUID();
    setForm({ ...initialForm(), categoryId: copy?.categoryId || data?.categories.find(c => c.isActive)?.id || '',
      ...(copy ? { employeeId: data?.permissions.admin ? copy.employeeId : '', workDate: copy.workDate, requestedMinutes: copy.requestedMinutes, description: copy.description, arranger: copy.arranger || '', sampleReference: copy.sampleReference || '', backfillReason: '更正原申报：' + (copy.correctionReason || ''), startedAt: timeOf(copy.startedAt), endedAt: timeOf(copy.endedAt) } : {}) });
  };
  const body = () => ({ ...form, employeeId: form.employeeId || undefined,
    startedAt: form.startedAt ? form.workDate + 'T' + form.startedAt + ':00+08:00' : null,
    endedAt: form.endedAt ? form.workDate + 'T' + form.endedAt + ':00+08:00' : null });
  async function save() {
    idempotency.current ||= crypto.randomUUID();
    const result = await api<{ row: Row }>(selected ? '/api/other-work-times/' + selected.id : '/api/other-work-times', {
      method: selected ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selected ? { ...body(), action: 'EDIT', version: selected.version } : { ...body(), idempotencyKey: idempotency.current, correctionOfId: correctionOf.current }),
    });
    selectedId.current = result.row.id; setSelected(result.row); setIsNew(false);
    return result.row;
  }
  async function run(action: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let row = selected;
      if (action === 'SAVE' || action === 'SUBMIT') row = await save();
      if (!row) return;
      if (action !== 'SAVE') {
        const result = await api<{ row: Row }>('/api/other-work-times/' + row.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, version: row.version, reason, approvedMinutes }) });
        setSelected(result.row); row = result.row;
      }
      setNotice(action === 'APPROVE' ? '已通过，批准工时已计入原工作日的个人达成。' : action === 'VOID' ? '已作废，原工作日及对应周期已扣除这笔其他工时。' : action === 'SUBMIT' ? '提交成功，等待一位有权限的组长、主管或管理员审批。' : '已保存');
      await load(); await select(row.id);
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    // The input is reset immediately so the same photo can be selected again.
    // Capture its live FileList before saving the draft asynchronously.
    const selectedFiles = Array.from(files);
    setBusy(true); setError('');
    try {
      let row = await save();
      if (row.attachments.length + selectedFiles.length > 6) throw new Error('最多 6 张照片，请减少选择后重试');
      for (const original of selectedFiles) {
        const file = await compressPhoto(original);
        const formData = new FormData(); formData.set('file', file); formData.set('version', String(row.version));
        const result = await api<{ row: Row }>('/api/other-work-times/' + row.id + '/attachments', { method: 'POST', body: formData });
        row = result.row; setSelected(row);
      }
      setNotice('照片已保存，确认内容后提交审批。'); await load();
    } catch (err) { setError((err instanceof Error ? err.message : '照片上传失败') + '；已上传照片会保留，可重新选择失败照片。'); }
    finally { setBusy(false); }
  }
  async function removePhoto(photo: Photo) {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try { const result = await api<{ row: Row }>('/api/other-work-times/' + selected.id + '/attachments/' + photo.id, { method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: selected.version }) }); setSelected(result.row); }
    catch (err) { setError(err instanceof Error ? err.message : '移除失败'); } finally { setBusy(false); }
  }
  async function category(c?: Category) {
    setBusy(true); setError('');
    try { await api('/api/other-work-times/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c ? { ...c, isActive: !c.isActive } : { name: categoryName }) }); setCategoryName(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '分类保存失败'); } finally { setBusy(false); }
  }
  async function exportLedger() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/other-work-times/export?' + params(), { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || '导出失败');
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
      a.href = url; a.download = '其他工时台账.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : '导出失败'); } finally { setBusy(false); }
  }
  const editing = isNew || selected?.permissions.edit;
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  return <main className={'other-hours-root ' + (field ? 'other-hours-field' : 'hm-workbench-root hm-workbench-navigation-overlay')}>
    {!field && <AppWorkbenchHeader user={user} activeHref={approval ? '/workspace/other-hours/approvals' : '/workspace/other-hours'} subtitle="公共安排与个人工时" menuItems={[{ label: '我的账号', href: '/account' }]} hideHeader sidebarTriggerTargetId="other-hours-navigation" />}
    <header className="oh-header"><div className="oh-heading">
      {!field && <div id="other-hours-navigation" />}
      <span className="oh-icon"><Clock3 /></span><div><small>人事与工时 · 独立申报</small><h1>{approval ? '其他工时审批' : field ? '其他工时申报' : '其他工时'}</h1></div></div>
      <div className="oh-actions"><button type="button" disabled={busy} onClick={() => { void load(); if (selected) void select(selected.id); }}><RefreshCw size={16} />刷新</button>
        {!field && <button type="button" onClick={() => setQrOpen(true)}><QrCode size={16} />固定二维码</button>}
        <button type="button" disabled={busy} onClick={() => fresh()} className="primary"><Plus size={16} />新建申报</button></div></header>
    <div className="oh-identity"><strong>{user.employee?.name || user.displayName}</strong><span>{user.employee?.employeeNo || '账号未绑定员工'} · {user.employee?.team || '班组未设置'}</span>{user.access.modules.includes('ACCOUNT_SELF') ? <Link href="/account">我的账号</Link> : <button type="button" disabled={busy} onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/login?next=%2Ffield-report%2Fother-hours'); }}>退出并切换账号</button>}</div>
    <div className="oh-rule"><CheckCircle2 size={18} /><span>个人达成率 =（完成工时 + 已确认损耗 + 已通过其他工时）÷（出勤工时 × 95%）<small>预留 5% 休息余量。协助样品和公共安排不需要工单，审批通过后归入实际工作日期。</small></span></div>
    {error && <div className="oh-feedback error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}
    {notice && <div className="oh-feedback success" role="status">{notice}</div>}
    <div className="oh-layout"><section className="oh-ledger">
      <div className="oh-tabs"><button type="button" className={scope === 'mine' ? 'active' : ''} onClick={() => { setScope('mine'); setPage(1); }}>我的申报</button>
        {data?.permissions.manage && <button type="button" className={scope === 'manage' ? 'active' : ''} onClick={() => { setScope('manage'); setPage(1); }}>管理台账</button>}</div>
      <div className="oh-filters"><input aria-label="搜索申报" placeholder="员工、工号、事项" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="申报状态" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部状态</option>{Object.entries(states).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
        <select aria-label="筛选事项分类" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}><option value="">全部事项分类</option>{data?.categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
        <div className="oh-date-range"><label>从<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>至<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div>
        {data?.permissions.admin && <label className="oh-check"><input type="checkbox" checked={corrections} onChange={e => { setCorrections(e.target.checked); setPage(1); }} />仅看申请更正</label>}</div>
      <div className="oh-ledger-summary"><span><b>{data?.summary.pending || 0}</b> 条待审批</span><span>已通过 <b>{hours(data?.summary.approvedMinutes || 0)}</b></span></div>
      {!!data?.byCategory.length && <details className="oh-categories"><summary>已通过工时按事项汇总</summary>{data.byCategory.map(c => <div key={c.categoryNameSnapshot}><span>{c.categoryNameSnapshot} · {c._count} 笔</span><b>{hours(c._sum.approvedMinutes || 0)}</b></div>)}</details>}
      <div className="oh-list" aria-busy={loading}>{data?.rows.map(row => <button type="button" key={row.id} className={'oh-row ' + (selected?.id === row.id ? 'selected' : '')} onClick={() => void select(row.id)}>
        <div><strong>{row.employeeNameSnapshot} · {row.categoryNameSnapshot}</strong><em className={'status-' + row.status}>{states[row.status]}</em></div>
        <p>{row.description}</p><footer><span>{row.workDate} · {row.teamSnapshot || '未分组'}</span><b>{hours(row.approvedMinutes ?? row.requestedMinutes)}</b></footer>
        {row.correctionRequestedAt && row.status === 'APPROVED' && <small>申请更正：{row.correctionReason}</small>}
      </button>)}{!data?.rows.length && <div className="oh-empty">{loading ? '正在加载…' : '当前条件下暂无申报'}</div>}</div>
      <div className="oh-pagination"><button type="button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft /></button><span>{page} / {Math.max(1, Math.ceil((data?.pagination.total || 0) / 30))}</span><button type="button" aria-label="下一页" disabled={page * 30 >= (data?.pagination.total || 0) || loading} onClick={() => setPage(p => p + 1)}><ChevronRight /></button>
        <button type="button" disabled={busy} onClick={() => void exportLedger()}><Download size={16} />导出</button></div>
      {data?.permissions.admin && <button type="button" className="oh-config-toggle" onClick={() => setConfigOpen(!configOpen)}>管理事项分类</button>}
      {configOpen && <div className="oh-categories">{data?.categories.map(c => <div key={c.id}><span>{c.name}</span><button type="button" disabled={busy} onClick={() => void category(c)}>{c.isActive ? '停用' : '启用'}</button></div>)}<input aria-label="新分类名称" placeholder="新分类名称" value={categoryName} onChange={e => setCategoryName(e.target.value)} /><button type="button" disabled={busy || !categoryName.trim()} onClick={() => void category()}>新增分类</button></div>}
    </section>
    <section className="oh-detail">{!selected && !isNew ? <div className="oh-empty"><Clock3 size={42} /><h2>选择一条申报</h2><p>查看工作说明、照片和处理轨迹</p></div> : <>
      <header><div><small>{selected ? selected.workDate + ' · ' + states[selected.status] : '本人申报'}</small><h2>{selected ? selected.employeeNameSnapshot + ' · ' + selected.categoryNameSnapshot : '登记其他安排工作'}</h2></div>{selected && <b>{hours(selected.approvedMinutes ?? selected.requestedMinutes)}</b>}</header>
      {selected?.status === 'PENDING' && context?.reviewerAvailable === false && <p className="oh-feedback error" role="status">当前没有可审批此申报的有效账号，请联系管理员配置对应班组的组长或主管。</p>}
      {editing ? <form onSubmit={e => { e.preventDefault(); void run('SUBMIT'); }} className="oh-form">
        <fieldset disabled={busy}>
          {data?.permissions.admin && isNew && <label>管理员补录（可选）<select value={form.employeeId} onChange={e => update('employeeId', e.target.value)}><option value="">为本人申报</option>{data.employees?.map(e => <option key={e.id} value={e.id}>{e.employeeNo} · {e.name}</option>)}</select></label>}
          <div className="oh-form-pair"><label>工作日期<input type="date" required value={form.workDate} max={data?.today || today()} disabled={Boolean(selected)} onChange={e => update('workDate', e.target.value)} /></label>
            <label>事项分类<select required value={form.categoryId} onChange={e => update('categoryId', e.target.value)}><option value="">请选择</option>{data?.categories.filter(c => c.isActive || c.id === form.categoryId).map(c => <option key={c.id} value={c.id} disabled={!c.isActive}>{c.name}{!c.isActive ? '（已停用）' : ''}</option>)}</select></label></div>
          <label>实际耗时（分钟）<input type="number" min="1" max="1440" step="1" required value={form.requestedMinutes || ''} onChange={e => update('requestedMinutes', Number(e.target.value))} /><small>当前：{hours(form.requestedMinutes)}。填写实际工作时间，照片不能替代时长。</small></label>
          <label>工作说明<textarea required minLength={2} maxLength={1000} rows={3} value={form.description} placeholder="例如：按组长安排，协助样品组给连接线打端子。" onChange={e => update('description', e.target.value)} /></label>
          <div className="oh-form-pair"><label>安排人（选填）<input maxLength={300} value={form.arranger} onChange={e => update('arranger', e.target.value)} /></label><label>样品任务 / 追溯说明（选填）<input maxLength={300} value={form.sampleReference} onChange={e => update('sampleReference', e.target.value)} /></label></div>
          <details className="oh-time-options"><summary>补充起止时段（选填，用于核对重叠）</summary><div className="oh-form-pair"><label>开始时间<input type="time" value={form.startedAt} onChange={e => update('startedAt', e.target.value)} /></label><label>结束时间<input type="time" value={form.endedAt} onChange={e => update('endedAt', e.target.value)} /></label></div><small>一天一笔；跨工作日请拆分，明确未工作的休息间隔不计申报时长。</small></details>
          {(form.workDate < (data?.today || today()) || form.employeeId) && <label>补报 / 管理员补录原因<textarea required minLength={2} value={form.backfillReason} onChange={e => update('backfillReason', e.target.value)} rows={2} /></label>}
          <div className="oh-upload"><label><Camera size={18} />拍照<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => { void upload(e.target.files); e.target.value = ''; }} /></label><label>从相册选择<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void upload(e.target.files); e.target.value = ''; }} /></label><small>选填，最多 6 张。先填写日期、分类、时长和说明。</small></div>
        </fieldset>
        <div className="oh-photos">{selected?.attachments.map(photo => <div key={photo.id}><button type="button" onClick={() => setPreview(photo)}><img src={photo.url} alt={photo.originalName} /></button><button type="button" disabled={busy} onClick={() => void removePhoto(photo)} aria-label={'移除照片 ' + photo.originalName}><X size={16} /></button></div>)}</div>
        <div className="oh-form-footer"><button type="button" disabled={busy} onClick={() => void run('SAVE')}>保存草稿</button><button type="submit" disabled={busy || (!user.employeeId && !form.employeeId)} className="primary">{busy ? '正在处理…' : '提交审批'}</button></div>
      </form> : selected && <div className="oh-readonly"><dl><div><dt>申报时长</dt><dd>{hours(selected.requestedMinutes)}</dd></div><div><dt>批准时长</dt><dd>{selected.approvedMinutes === null ? '待审批' : hours(selected.approvedMinutes)}</dd></div><div><dt>安排人</dt><dd>{selected.arranger || '未填写'}</dd></div><div><dt>样品追溯</dt><dd>{selected.sampleReference || '未填写'}</dd></div></dl><h3>工作说明</h3><p>{selected.description}</p>
        {selected.startedAt && <p>时段：{dateTime(selected.startedAt)} 至 {dateTime(selected.endedAt!)}</p>}
        {selected.backfillReason && <p>补报原因：{selected.backfillReason}</p>}
        {selected.reviewedAt && <p>审批人：{selected.reviewedByName} · {dateTime(selected.reviewedAt)}</p>}
        <div className="oh-photos">{selected.attachments.map(photo => <button type="button" key={photo.id} onClick={() => setPreview(photo)}><img src={photo.url} alt={photo.originalName} /></button>)}</div>
        {selected.permissions.withdraw && <button type="button" disabled={busy} onClick={() => void run('WITHDRAW')}>撤回并修改</button>}
        {['VOIDED', 'REJECTED', 'WITHDRAWN'].includes(selected.status) && (selected.employeeNoSnapshot === user.employee?.employeeNo || data?.permissions.admin) && <button type="button" disabled={busy} onClick={() => fresh(selected)}>复制为更正申请</button>}
      </div>}
      {context && selected?.permissions.review && <section className="oh-review-context"><h3>审批核对</h3><div className="oh-form-pair"><span>当日出勤：<b>{hours(context.attendanceMilliseconds / 60000)}</b>（{context.attendanceStatus === 'confirmed' ? '已确认' : '考勤待完善'}）</span><span>确认损耗：{hours(context.confirmedLossMilliseconds / 60000)}</span></div><p>{context.reviewHint}</p>{context.other.map(o => <p key={o.id}>同日：{o.categoryNameSnapshot} · {states[o.status]} · {hours(o.approvedMinutes ?? o.requestedMinutes)}</p>)}{context.executions.map((e, i) => <p key={i}>生产实耗：{dateTime(e.startedAt)} 至 {dateTime(e.endedAt)} · {hours(e.actualLaborMilliseconds / 60000)}</p>)}{context.completions?.map(c => <p key={c.id}>扫码工作时段：{dateTime(c.workStartedAt)} 至 {dateTime(c.workEndedAt)}</p>)}</section>}
      {selected && (selected.permissions.review || selected.permissions.void || selected.permissions.requestCorrection) && <section className="oh-decision">
        {selected.permissions.review && <label>批准时长（分钟）<input type="number" min="1" max={selected.requestedMinutes} value={approvedMinutes} onChange={e => setApprovedMinutes(Number(e.target.value))} /></label>}
        <label>处理说明<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="核减、退回、更正和作废必须填写原因；正常通过可不填。" /></label>
        <div className="oh-actions">{selected.permissions.review && <><button type="button" disabled={busy || reason.trim().length < 2} onClick={() => void run('REJECT')}>退回修改</button><button type="button" disabled={busy} className="primary" onClick={() => void run('APPROVE')}>通过并计入工时</button></>}
          {selected.permissions.requestCorrection && <button type="button" disabled={busy || reason.trim().length < 2} onClick={() => void run('CORRECTION_REQUEST')}>提交更正申请</button>}
          {selected.permissions.void && <button type="button" className="danger" disabled={busy || reason.trim().length < 2} onClick={() => void run('VOID')}>作废并扣除本笔工时</button>}</div>
        {selected.correctionRequestedAt && <p>更正申请：{selected.correctionReason}</p>}
      </section>}
      {selected && <details className="oh-audit"><summary>处理轨迹 · {selected.reviews.length} 条</summary>{selected.reviews.map(r => <article key={r.id}><b>{actions[r.action] || r.action}</b><span>{r.actor.displayName || r.actor.username} · {dateTime(r.createdAt)}</span>{r.reason && <p>{r.reason}</p>}</article>)}</details>}
    </>}</section></div>
    {qrOpen && <div className="oh-modal" role="presentation"><section role="dialog" aria-modal="true" aria-label="其他工时固定二维码" className="oh-qr"><button type="button" className="oh-close" aria-label="关闭二维码" onClick={() => setQrOpen(false)}><X /></button><h2>其他工时申报</h2><p>协助样品 · 临时安排 · 公共辅助事务</p>{qr ? <img src={qr} alt="其他工时申报固定二维码" /> : <p>正在生成…</p>}<strong>扫码 → 登录本人账号 → 填写工作 → 提交审批</strong><p>实际工作日期和时长必填，照片选填。</p><div className="oh-actions"><a href={qr} download="其他工时申报二维码.png"><Download size={16} />下载二维码</a><button type="button" onClick={() => window.print()}>打印张贴版</button></div></section></div>}
    {preview && <div className="oh-modal" role="presentation" onClick={() => setPreview(null)}><section className="oh-photo-preview" role="dialog" aria-modal="true" aria-label="工作照片" onClick={e => e.stopPropagation()}><button type="button" aria-label="关闭照片" onClick={() => setPreview(null)}><X /></button><img src={preview.url} alt={preview.originalName} /></section></div>}
  </main>;
}
