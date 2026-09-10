'use client';
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, HelpCircle, Info, ListFilter, Plus, QrCode, RefreshCw, Search, X } from 'lucide-react';
import QRCode from 'qrcode';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { useToast } from '@/components/ToastProvider';
import type { CurrentUserDTO } from '@/types';
import { OtherHoursDialog } from './OtherHoursDialog';
import { OtherHoursForm } from './OtherHoursForm';
import { OtherHoursDetail } from './OtherHoursDetail';
import { api, compressPhoto, duration, hours, initialForm, monthRange, queryFor, states, toForm, today, type Category, type Context, type Data, type Filters, type Form, type Photo, type Row } from './model';
import './workbench.css';

type Modal = 'help' | 'qr' | 'categories' | 'filters' | 'decision' | 'discard' | 'config' | null;
const emptyFilters = (field: boolean, approval: boolean): Filters => ({ scope: field ? 'mine' : 'manage', status: approval ? 'PENDING' : '', search: '', categoryId: '', ...monthRange(today()), corrections: false, employeeId: '' });

export default function OtherHoursWorkbench({ user, approval = false, field = false }: { user: CurrentUserDTO; approval?: boolean; field?: boolean }) {
  const { showToast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [filters, setFilters] = useState<Filters>(() => emptyFilters(field, approval));
  const [filterDraft, setFilterDraft] = useState<Filters>(filters);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [view, setView] = useState<'form' | 'records'>('form');
  const [composerActive, setComposerActive] = useState(field);
  const [form, setForm] = useState<Form>(initialForm);
  const [editorRow, setEditorRow] = useState<Row | null>(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialForm()));
  const [approvedMinutes, setApprovedMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [preview, setPreview] = useState<Photo | null>(null);
  const [qr, setQr] = useState('');
  const [reason, setReason] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const leavingPage = useRef(false);
  const selectedRef = useRef<Row | null>(null);
  const editorRef = useRef<Row | null>(null);
  const formState = useRef(form);
  const listGeneration = useRef(0);
  const selectionGeneration = useRef(0);
  const selectionId = useRef<string | null>(null);
  const pinnedSelection = useRef<string | null>(null);
  const idempotency = useRef('');
  const correctionOf = useRef<string | null>(null);
  const continuation = useRef<(() => void) | null>(null);
  const decision = useRef<{ action: string; row: Row; minutes: number } | null>(null);
  const listKey = useRef('');
  selectedRef.current = selected; editorRef.current = editorRow; formState.current = form;
  const dirty = JSON.stringify(form) !== baseline || failedFiles.length > 0;
  const nestedDialog = Boolean(modal || preview);
  const notify = (message: string) => showToast(message, { tone: 'success', duration: 2800 });
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : '操作失败，请重试');
  const changeFilters = (change: Partial<Filters>) => {
    pinnedSelection.current = null;
    setPage(1); setFilters(current => ({ ...current, ...change })); setRefresh(n => n + 1);
  };
  const closeModal = () => { if (!busyRef.current) setModal(null); };
  const leavePage = (url: string) => { leavingPage.current = true; window.location.assign(url); };
  const setEditor = (row: Row | null) => { editorRef.current = row; setEditorRow(row); };
  const resetEditor = (next: Form, row: Row | null = null) => {
    setEditor(row); setForm(next); formState.current = next; setBaseline(JSON.stringify(next));
    setFailedFiles([]); setError('');
  };
  const guard = (next: () => void) => {
    if (busyRef.current) return;
    if (dirty) { continuation.current = next; setModal('discard'); }
    else next();
  };
  const fresh = (copy?: Row) => guard(() => {
    const next = { ...initialForm(), categoryId: copy?.categoryId || data?.categories.find(c => c.isActive)?.id || '' };
    if (copy) Object.assign(next, toForm(copy), { employeeId: data?.permissions.admin && copy.employeeId !== user.employeeId ? copy.employeeId : '', backfillReason: copy.backfillReason || '更正原申报' });
    resetEditor(next); correctionOf.current = copy?.id || null; idempotency.current = crypto.randomUUID();
    setComposerActive(true); setView('form'); setDetailOpen(false);
  });
  const edit = (row: Row) => guard(() => {
    resetEditor(toForm(row), row); correctionOf.current = row.correctionOfId; idempotency.current = '';
    setComposerActive(true); setView('form'); setDetailOpen(false);
  });
  const selectRow = useCallback(async (id: string) => {
    const generation = ++selectionGeneration.current;
    selectionId.current = id; setDetailLoading(true);
    try {
      const result = await api<{ row: Row; context: Context }>('/api/other-work-times/' + id);
      if (generation !== selectionGeneration.current) return;
      setSelected(result.row); selectedRef.current = result.row; setContext(result.context); setApprovedMinutes(result.row.requestedMinutes);
    } catch (err) { if (generation === selectionGeneration.current) setError(err instanceof Error ? err.message : '详情加载失败'); }
    finally { if (generation === selectionGeneration.current) setDetailLoading(false); }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = emptyFilters(field, approval);
    for (const key of ['from', 'to', 'status', 'employeeId'] as const) if (params.has(key)) next[key] = params.get(key)!;
    if (params.get('id')) {
      pinnedSelection.current = params.get('id');
      if (!params.has('status')) next.status = '';
      if (!params.has('from')) next.from = ''; if (!params.has('to')) next.to = '';
      setComposerActive(false); setView('records'); setDetailOpen(field);
      void selectRow(params.get('id')!);
    }
    setFilters(next); setFilterDraft(next); setInitialized(true);
  }, [approval, field, selectRow]);
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setFilters(current => current.search === searchInput.trim() ? current : { ...current, search: searchInput.trim() }); }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    const generation = ++listGeneration.current;
    const key = JSON.stringify(filters);
    setLoading(true);
    const load = async () => {
      try {
        let result: Data;
        try { result = await api<Data>('/api/other-work-times?' + queryFor(filters, page)); }
        catch (err) {
          if (filters.scope !== 'manage') throw err;
          const mine = await api<Data>('/api/other-work-times?' + queryFor({ ...filters, scope: 'mine' }, page));
          if (mine.permissions.manage) throw err;
          if (!cancelled && generation === listGeneration.current) setFilters(current => ({ ...current, scope: 'mine' }));
          return;
        }
        if (cancelled || generation !== listGeneration.current) return;
        if (page > 1 && !result.rows.length && result.pagination.total <= (page - 1) * result.pagination.size) { setPage(Math.max(1, Math.ceil(result.pagination.total / result.pagination.size))); return; }
        const append = field && page > 1 && listKey.current === key;
        listKey.current = key;
        setData(previous => append && previous ? { ...result, rows: [...new Map([...previous.rows, ...result.rows].map(row => [row.id, row])).values()] } : result);
        if (!formState.current.categoryId) {
          const categoryId = result.categories.find(c => c.isActive)?.id || '';
          setBaseline(JSON.stringify({ ...initialForm(), categoryId }));
          setForm(current => ({ ...current, categoryId }));
        }
      } catch (err) { if (!cancelled && generation === listGeneration.current) setError(err instanceof Error ? err.message : '加载失败，请刷新重试'); }
      finally { if (!cancelled && generation === listGeneration.current) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [filters, page, refresh, field, initialized]);
  useEffect(() => {
    if (field || composerActive || loading || !data || pinnedSelection.current) return;
    const current = data.rows.find(row => row.id === selectionId.current);
    const next = current || data.rows[0];
    if (!next) { selectionGeneration.current++; selectionId.current = null; setSelected(null); setContext(null); return; }
    if (selectionId.current !== next.id || selectedRef.current?.version !== next.version) void selectRow(next.id);
  }, [data, field, composerActive, loading, selectRow]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!leavingPage.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!field || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const resize = () => { if (rootRef.current) rootRef.current.dataset.keyboard = String(window.innerHeight - viewport.height > 160); };
    viewport.addEventListener('resize', resize); resize();
    return () => viewport.removeEventListener('resize', resize);
  }, [field]);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 4500); return () => clearTimeout(timer);
  }, [highlight]);
  useEffect(() => {
    if (modal !== 'qr') return;
    let cancelled = false;
    void QRCode.toDataURL(window.location.origin + '/field-report/other-hours', { width: 600, margin: 3, errorCorrectionLevel: 'M' })
      .then(value => { if (!cancelled) setQr(value); }).catch(() => setError('二维码生成失败，请重试'));
    return () => { cancelled = true; };
  }, [modal]);

  async function perform(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await operation(); return true; } catch (err) { fail(err); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function saveBeforeLeaving() {
    const saved = await perform(async () => { await persistEditor(); notify('草稿已保存'); });
    if (saved) { const next = continuation.current; continuation.current = null; setModal(null); next?.(); }
  }
  async function persistEditor() {
    const values = formState.current, current = editorRef.current;
    idempotency.current ||= crypto.randomUUID();
    const body = { ...values, employeeId: values.employeeId || undefined,
      startedAt: values.startedAt ? values.workDate + 'T' + values.startedAt + ':00+08:00' : null,
      endedAt: values.endedAt ? values.workDate + 'T' + values.endedAt + ':00+08:00' : null };
    const result = await api<{ row: Row }>(current ? '/api/other-work-times/' + current.id : '/api/other-work-times', {
      method: current ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current ? { ...body, action: 'EDIT', version: current.version } : { ...body, idempotencyKey: idempotency.current, correctionOfId: correctionOf.current }),
    });
    setEditor(result.row); setBaseline(JSON.stringify(values));
    return result.row;
  }
  function showMine(row: Row) {
    setSearchInput(''); changeFilters({ ...monthRange(row.workDate), scope: 'mine', status: row.status, search: '', categoryId: '', corrections: false, employeeId: '' });
    setHighlight(row.id); setView('records'); setDetailOpen(false);
    if (!field) { setComposerActive(false); selectionId.current = row.id; setSelected(row); }
  }
  function saveEditor(submit: boolean) {
    if (submit && !formRef.current?.reportValidity()) return;
    if (submit && failedFiles.length) { setError('还有照片未上传，请重试或移除失败照片后提交。'); return; }
    void perform(async () => {
      let row = await persistEditor();
      if (submit) {
        row = (await api<{ row: Row }>('/api/other-work-times/' + row.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'SUBMIT', version: row.version }) })).row;
      }
      notify(submit ? '已提交，等待审批' : '草稿已保存');
      if (field || submit) {
        resetEditor({ ...initialForm(), categoryId: data?.categories.find(c => c.isActive)?.id || '' });
        idempotency.current = ''; correctionOf.current = null; showMine(row);
      } else setRefresh(n => n + 1);
    });
  }
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    void perform(async () => {
      if ((editorRef.current?.attachments.length || 0) + files.length > 6) throw new Error('最多添加 6 张照片，请减少选择后重试');
      setFailedFiles(files);
      let row = await persistEditor();
      for (let index = 0; index < files.length; index++) {
        try {
          const file = await compressPhoto(files[index]);
          const body = new FormData(); body.set('file', file); body.set('version', String(row.version));
          row = (await api<{ row: Row }>('/api/other-work-times/' + row.id + '/attachments', { method: 'POST', body })).row;
          setEditor(row); setFailedFiles(files.slice(index + 1));
        } catch (err) { throw new Error((err instanceof Error ? err.message : '照片上传失败') + '。已上传照片已保留，可重试剩余照片。'); }
      }
      notify('照片已保存'); setRefresh(n => n + 1);
    });
  }
  function removePhoto(photo: Photo) {
    void perform(async () => {
      const row = editorRef.current; if (!row) return;
      const result = await api<{ row: Row }>('/api/other-work-times/' + row.id + '/attachments/' + photo.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: row.version }) });
      setEditor(result.row); setRefresh(n => n + 1);
    });
  }
  function requestAction(action: string) {
    const row = selectedRef.current; if (!row || busyRef.current) return;
    if (action === 'APPROVE' && (!Number.isInteger(approvedMinutes) || approvedMinutes < 1 || approvedMinutes > row.requestedMinutes)) { setError('批准时长须为 1 至 ' + row.requestedMinutes + ' 分钟'); return; }
    if (action === 'WITHDRAW' && dirty) {
      guard(() => { decision.current = { action, row, minutes: approvedMinutes }; setReason(''); setModal('decision'); });
      return;
    }
    decision.current = { action, row, minutes: approvedMinutes }; setReason('');
    if (action === 'APPROVE' && approvedMinutes === row.requestedMinutes) void executeDecision('');
    else setModal('decision');
  }
  async function executeDecision(explanation: string) {
    const target = decision.current; if (!target) return;
    void perform(async () => {
      const result = await api<{ row: Row }>('/api/other-work-times/' + target.row.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: target.action, version: target.row.version, reason: explanation, approvedMinutes: target.minutes }) });
      setModal(null); setSelected(result.row); selectedRef.current = result.row; setRefresh(n => n + 1);
      const messages: Record<string, string> = { APPROVE: '审批通过', REJECT: '已退回，员工可修改后重新提交', VOID: '已作废，其他工时已扣回', CORRECTION_REQUEST: '更正申请已提交', WITHDRAW: '已撤回，可以继续修改' };
      notify(messages[target.action] || '处理完成');
      if (target.action === 'WITHDRAW') {
        resetEditor(toForm(result.row), result.row); setComposerActive(true); setView('form'); setDetailOpen(false);
      } else if (field) { setDetailOpen(false); setPage(1); }
    });
  }
  function exportLedger() {
    void perform(async () => {
      const response = await fetch('/api/other-work-times/export?' + queryFor(filters, page), { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || '导出失败');
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = '其他工时台账.xlsx'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('台账已导出');
    });
  }
  function updateCategory(category?: Category) {
    void perform(async () => {
      await api('/api/other-work-times/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(category ? { ...category, isActive: !category.isActive } : { name: categoryName }) });
      setCategoryName(''); setRefresh(n => n + 1); notify('事项分类已更新');
    });
  }
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  const detail = selected && <OtherHoursDetail row={selected} context={context} busy={busy} approvedMinutes={approvedMinutes} setApprovedMinutes={setApprovedMinutes}
    onAction={requestAction} onEdit={() => edit(selected)} onCopy={() => fresh(selected)} onPreview={setPreview} allowCopy={selected.employeeId === user.employeeId || Boolean(data?.permissions.admin)} />;
  const decisionTitle: Record<string, string> = { APPROVE: '确认核减时长', REJECT: '退回申报', WITHDRAW: '撤回并修改', VOID: '作废申报', CORRECTION_REQUEST: '申请更正' };
  const decisionAction = decision.current?.action || '';
  const decisionNeedsReason = decisionAction !== 'WITHDRAW';
  const scopeLabel = filters.scope === 'mine' ? '我的申报' : '管理台账';
  const visibleStatuses = field ? ['', 'PENDING', 'APPROVED', 'REJECTED', 'DRAFT'] : ['PENDING', 'PROCESSED', ''];
  const statusLabel = (value: string) => value === 'PROCESSED' ? '已处理' : value ? states[value] : '全部';
  const statusCount = (value: string) => value === 'PROCESSED' ? ['APPROVED', 'REJECTED', 'VOIDED'].reduce((sum, key) => sum + (data?.statusCounts?.[key] || 0), 0) : data?.statusCounts?.[value] || 0;
  const rangeLabel = !filters.from && !filters.to ? '全部日期' : filters.from === monthRange(data?.today || today()).from && filters.to === monthRange(data?.today || today()).to ? '本月' : '自定义';
  // JSX is kept below the operations so the same server-backed records power both layouts.
  return <main ref={rootRef} className={'other-hours-root ' + (field ? 'other-hours-field' : 'hm-workbench-root hm-workbench-navigation-overlay')}>
    {!field && <AppWorkbenchHeader user={user} activeHref={approval ? '/workspace/other-hours/approvals' : '/workspace/other-hours'} subtitle="公共安排与个人工时"
      menuItems={[{ label: '我的账号', href: '/account' }]} hideHeader sidebarTriggerTargetId="other-hours-navigation" />}
    <div className="oh-page">
      <header className="oh-header"><div className="oh-heading">
        {!field && <div id="other-hours-navigation" />}{field ? <span className="oh-brand">杭</span> : null}
        <div>{!field && <small>人事与工时 / 独立申报</small>}<div className="oh-title-line"><h1>{field ? '其他工时申报' : approval ? '其他工时审批' : '其他工时'}</h1>
          {!field && <button type="button" className="oh-quiet" onClick={() => setModal('help')}><Info size={15} />说明</button>}</div></div></div>
        <div className="oh-actions">{field ? <button type="button" className="oh-quiet" onClick={() => setModal('help')}><HelpCircle size={16} />填写说明</button> : <>
          <button type="button" disabled={busy} onClick={() => { setPage(1); setRefresh(n => n + 1); if (selected && !composerActive) void selectRow(selected.id); }}><RefreshCw size={16} />刷新</button>
          <button type="button" onClick={() => setModal('qr')}><QrCode size={16} />固定二维码</button>
          <button type="button" disabled={busy} className="primary" onClick={() => fresh()}><Plus size={16} />新建申报</button></>}</div>
      </header>
      <div className="oh-identity"><strong>{user.employee?.name || user.displayName}</strong><span>{user.employee?.employeeNo || '账号未绑定员工'} · {user.employee?.team || '班组未设置'}</span>
        <div className="oh-identity-actions">{field && data?.permissions.manage && <Link href="/workspace/other-hours/approvals" onClick={e => { e.preventDefault(); guard(() => leavePage('/workspace/other-hours/approvals')); }}>审批管理</Link>}
          {user.access.modules.includes('ACCOUNT_SELF') ? <Link href="/account" onClick={e => { e.preventDefault(); guard(() => leavePage('/account')); }}>我的账号</Link> :
            <button type="button" className="oh-quiet" disabled={busy} onClick={() => guard(() => { void perform(async () => { await api('/api/auth/logout', { method: 'POST' }); leavePage('/login?next=%2Ffield-report%2Fother-hours'); }); })}>切换账号</button>}</div>
      </div>
      {field && <nav className="oh-mobile-tabs" aria-label="申报视图"><button type="button" disabled={busy} aria-pressed={view === 'form'} onClick={() => setView('form')}>填写申报</button>
        <button type="button" disabled={busy} aria-pressed={view === 'records'} onClick={() => { setView('records'); setPage(1); setRefresh(n => n + 1); }}>我的申报</button></nav>}
      {error && !nestedDialog && <div className="oh-feedback error" role="alert"><span>{error}</span><button type="button" className="oh-icon-button" aria-label="关闭错误" onClick={() => setError('')}><X size={16} /></button></div>}
      <div className="oh-layout">
        <section className="oh-ledger" aria-label={scopeLabel} hidden={field && view !== 'records'}>
          <header className="oh-ledger-header"><div className="oh-ledger-heading">
            {field ? <h2>我的申报</h2> : <div className="oh-scope-tabs"><button type="button" disabled={busy} aria-pressed={filters.scope === 'mine'} onClick={() => changeFilters({ scope: 'mine' })}>我的申报</button>
              {data?.permissions.manage && <button type="button" disabled={busy} aria-pressed={filters.scope === 'manage'} onClick={() => changeFilters({ scope: 'manage' })}>管理台账</button>}</div>}
            <button type="button" className="oh-filter-trigger" disabled={busy} onClick={() => { setFilterDraft(filters); setModal('filters'); }}><span>{rangeLabel}</span><ListFilter size={15} />{field ? '筛选' : ''}</button></div>
            <div className="oh-status-tabs" aria-label="申报状态">{visibleStatuses.map(value => <button type="button" key={value} disabled={busy} aria-pressed={filters.status === value} onClick={() => changeFilters({ status: value })}>
              {statusLabel(value)}{!field && value && <small>{statusCount(value)}</small>}</button>)}</div>
            {(!field || filters.search) && <label className="oh-search"><Search size={16} /><input type="search" value={searchInput} aria-label="搜索申报" placeholder={filters.scope === 'mine' ? '搜索事项或工作说明' : '搜索员工、工号或事项'} onChange={e => setSearchInput(e.target.value)} /></label>}
            {(filters.categoryId || filters.corrections || filters.employeeId || !visibleStatuses.includes(filters.status)) && <div className="oh-applied-filters">
              <span>{filters.categoryId ? data?.categories.find(c => c.id === filters.categoryId)?.name : ''}{filters.corrections ? ' · 申请更正' : ''}{!visibleStatuses.includes(filters.status) ? statusLabel(filters.status) : ''}{filters.employeeId ? ' · 指定员工' : ''}</span>
              <button type="button" className="oh-quiet" onClick={() => changeFilters({ categoryId: '', corrections: false, employeeId: '', status: '' })}>清除</button></div>}
          </header>
          <div className="oh-ledger-summary"><span>当前范围 · 待审批 <b>{data?.summary.pending || 0} 笔</b></span><span>已通过 <b>{hours(data?.summary.approvedMinutes || 0)}</b></span></div>
          <div className="oh-list" aria-busy={loading}>{data?.rows.map((row, index) => <div key={row.id}>
            {field && (index === 0 || data.rows[index - 1].workDate !== row.workDate) && <div className="oh-date-group">{row.workDate === data.today ? '今天 · ' : ''}{row.workDate}</div>}
            <button type="button" disabled={busy} className={'oh-row' + ((!field && selected?.id === row.id && !composerActive) || highlight === row.id ? ' selected' : '')}
              onClick={() => {
                const navigate = () => {
                  pinnedSelection.current = null;
                  if (!field) { resetEditor({ ...initialForm(), categoryId: data.categories.find(c => c.isActive)?.id || '' }); setComposerActive(false); }
                  setError(''); void selectRow(row.id); if (field) setDetailOpen(true);
                };
                if (field) navigate(); else guard(navigate);
              }}>
              <div className="oh-row-top"><strong>{field ? row.categoryNameSnapshot : row.employeeNameSnapshot}</strong><span className={'oh-status status-' + row.status}>{states[row.status]}</span></div>
              <p>{!field && <span>{row.categoryNameSnapshot} · </span>}{row.description || '继续填写工作说明'}</p>
              <footer><span>{field ? row.attachments.length ? '照片 ' + row.attachments.length + ' 张' : row.workDate.slice(5) : row.workDate.slice(5) + ' · ' + (row.teamSnapshot || '未分组')}</span>
                <b>{duration(row.approvedMinutes ?? row.requestedMinutes)}</b>{field && <ChevronRight size={15} />}</footer>
              {row.status === 'REJECTED' && <small className="oh-row-rejection">{[...row.reviews].reverse().find(r => r.action === 'REJECT')?.reason || '请查看退回原因'}</small>}
              {row.correctionRequestedAt && row.status === 'APPROVED' && <small className="oh-row-correction">已申请更正</small>}
            </button></div>)}
            {!data?.rows.length && <div className="oh-empty"><Clock3 size={28} /><p>{loading ? '正在加载…' : '当前条件下暂无申报'}</p>{!loading && <button type="button" className="oh-quiet" onClick={() => { setSearchInput(''); changeFilters({ ...emptyFilters(field, false), scope: filters.scope, from: '', to: '' }); }}>查看全部记录</button>}</div>}
          </div>
          <footer className="oh-ledger-footer">{field ? <>{data && data.rows.length < data.pagination.total ? <button type="button" className="oh-load-more" disabled={loading || busy} onClick={() => setPage(n => n + 1)}>{loading ? '正在加载…' : '加载更多'}</button> : <span className="oh-list-end">{data?.rows.length ? '已显示全部记录' : ''}</span>}</> :
            <div className="oh-pagination"><button type="button" aria-label="上一页" disabled={page <= 1 || loading || busy} onClick={() => setPage(n => n - 1)}><ChevronLeft size={16} /></button><span>{page} / {Math.max(1, Math.ceil((data?.pagination.total || 0) / (data?.pagination.size || 30)))}</span>
              <button type="button" aria-label="下一页" disabled={page * (data?.pagination.size || 30) >= (data?.pagination.total || 0) || loading || busy} onClick={() => setPage(n => n + 1)}><ChevronRight size={16} /></button>
              <button type="button" disabled={busy} onClick={exportLedger}><Download size={15} />导出</button></div>}
            {!field && data?.permissions.admin && <button type="button" className="oh-quiet" disabled={busy} onClick={() => setModal('config')}>管理事项分类</button>}
          </footer>
        </section>
        <section className="oh-detail" aria-label={composerActive || field ? '填写申报' : '申报详情'} hidden={field && view !== 'form'}>
          {composerActive || field ? <>
            {!field && <header className="oh-composer-header"><h2>{editorRow ? '继续填写申报' : '登记其他安排工作'}</h2><button type="button" className="oh-quiet" disabled={busy} onClick={() => guard(() => { resetEditor({ ...initialForm(), categoryId: data?.categories.find(c => c.isActive)?.id || '' }); setComposerActive(false); })}>取消</button></header>}
            <OtherHoursForm form={form} row={editorRow} data={data} busy={busy} field={field} formRef={formRef} update={update} onSave={() => saveEditor(false)} onSubmit={() => saveEditor(true)}
              onUpload={files => { if (files) void uploadFiles(Array.from(files)); }} onRemove={removePhoto} onPreview={setPreview} onCategories={() => setModal('categories')}
              failedPhotos={failedFiles.map(file => file.name)} onRetry={() => void uploadFiles(failedFiles)} />
            {!!failedFiles.length && <button type="button" className="oh-quiet oh-discard-photos" disabled={busy} onClick={() => { setFailedFiles([]); setError(''); }}>移除失败照片</button>}
          </> : detailLoading ? <div className="oh-empty" role="status">正在加载详情…</div> : detail || <div className="oh-empty"><CheckCircle2 size={38} /><h2>{filters.status === 'PENDING' && !loading ? '当前待审批已处理完' : '选择一条申报'}</h2>
            <p>{filters.status === 'PENDING' ? '处理记录已保留，可随时回看。' : '查看工作内容、照片和处理记录。'}</p>{filters.status === 'PENDING' && <button type="button" onClick={() => changeFilters({ status: 'PROCESSED' })}>查看已处理</button>}</div>}
        </section>
      </div>
    </div>
    {field && detailOpen && <OtherHoursDialog title="申报详情" wide onClose={() => { setDetailOpen(false); selectionGeneration.current++; }} busy={busy} interactionEnabled={!nestedDialog}>
      {detailLoading ? <div className="oh-empty" role="status">正在加载详情…</div> : detail}{error && !nestedDialog && <p className="oh-dialog-error" role="alert">{error}</p>}
    </OtherHoursDialog>}
    {modal && <OtherHoursDialog title={modal === 'help' ? field ? '填写说明' : '其他工时说明' : modal === 'qr' ? '其他工时固定二维码' : modal === 'categories' ? '选择事项分类' : modal === 'filters' ? '筛选申报' : modal === 'decision' ? decisionTitle[decisionAction] : modal === 'discard' ? '填写内容尚未保存' : '管理事项分类'}
      onClose={closeModal} busy={busy} interactionEnabled={!preview}>
      {error && <p className="oh-dialog-error" role="alert">{error}</p>}
      {modal === 'help' && <div className="oh-help-content">{!field && <div className="oh-formula">个人达成率 =<br />（完成工时 + 已确认损耗 + 已通过其他工时）<br />÷（出勤工时 × 95%）× 100%</div>}
        <p>{field ? '按实际工作日期选择事项，填写实际耗时，并用一句话说明做了什么。照片可以按需补充。' : '出勤工时包含正常出勤和已确认实际加班，预留 5% 休息余量。'}</p>
        <p>提交后在“我的申报”查看进度，审批通过的时长归入实际工作日期。{!field && '日、周、月报表同步汇总。'}</p><button type="button" className="primary" onClick={closeModal}>知道了</button></div>}
      {modal === 'qr' && <div className="oh-qr"><p>协助样品 · 临时安排 · 公共辅助事务</p>{qr ? <img src={qr} alt="其他工时申报固定二维码" /> : <p>正在生成…</p>}
        <strong>扫码 → 登录本人账号 → 填写工作 → 提交审批</strong><div className="oh-actions">{qr && <a className="oh-button" href={qr} download="其他工时申报二维码.png"><Download size={16} />下载二维码</a>}<button type="button" onClick={() => window.print()}>打印张贴版</button></div></div>}
      {modal === 'categories' && <div className="oh-category-list">{data?.categories.filter(c => c.isActive).map(c => <button key={c.id} type="button" aria-pressed={c.id === form.categoryId} onClick={() => { update('categoryId', c.id); closeModal(); }}>{c.name}</button>)}
        {!data?.categories.some(c => c.isActive) && <p>暂无可用事项，请联系管理员维护分类。</p>}</div>}
      {modal === 'filters' && <form className="oh-filter-form" onSubmit={e => { e.preventDefault(); if (filterDraft.from && filterDraft.to && filterDraft.from > filterDraft.to) { setError('结束日期不能早于开始日期'); return; } changeFilters(filterDraft); setSearchInput(filterDraft.search); setModal(null); }}>
        <label>工作日期<div className="oh-range-presets"><button type="button" onClick={() => setFilterDraft(current => ({ ...current, ...monthRange(data?.today || today()) }))}>本月</button>
          <button type="button" onClick={() => { const date = new Date((data?.today || today()) + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); setFilterDraft(current => ({ ...current, from: date.toISOString().slice(0, 10), to: data?.today || today() })); }}>本周</button>
          <button type="button" onClick={() => setFilterDraft(current => ({ ...current, from: '', to: '' }))}>全部日期</button></div></label>
        <div className="oh-form-pair"><label>从<input type="date" value={filterDraft.from} onChange={e => setFilterDraft(current => ({ ...current, from: e.target.value }))} /></label><label>至<input type="date" value={filterDraft.to} onChange={e => setFilterDraft(current => ({ ...current, to: e.target.value }))} /></label></div>
        <label>事项分类<select value={filterDraft.categoryId} onChange={e => setFilterDraft(current => ({ ...current, categoryId: e.target.value }))}><option value="">全部事项</option>{data?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>申报状态<select value={filterDraft.status} onChange={e => setFilterDraft(current => ({ ...current, status: e.target.value }))}><option value="">全部状态</option><option value="PROCESSED">已处理</option>{Object.entries(states).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>{filters.scope === 'mine' ? '搜索事项或工作说明' : '搜索员工、工号或事项'}<input type="search" value={filterDraft.search} onChange={e => setFilterDraft(current => ({ ...current, search: e.target.value }))} /></label>
        {data?.permissions.admin && <label className="oh-check"><input type="checkbox" checked={filterDraft.corrections} onChange={e => setFilterDraft(current => ({ ...current, corrections: e.target.checked }))} />仅看申请更正</label>}
        <footer className="oh-dialog-actions"><button type="button" onClick={() => setFilterDraft({ ...emptyFilters(field, false), scope: filters.scope, from: '', to: '' })}>清空筛选</button><button type="submit" className="primary">应用筛选</button></footer>
        {field && <div className="oh-filter-tools"><button type="button" className="oh-quiet" disabled={busy} onClick={exportLedger}><Download size={15} />导出当前记录</button>
          <button type="button" className="oh-quiet" onClick={() => { setPage(1); setRefresh(n => n + 1); setModal(null); }}>刷新列表</button></div>}
      </form>}
      {modal === 'decision' && <form onSubmit={e => { e.preventDefault(); if (decisionNeedsReason && reason.trim().length < 2) { setError('请填写至少两个字的处理原因'); return; } void executeDecision(reason); }}>
        <p className="oh-secondary">{decisionAction === 'APPROVE' ? '批准 ' + duration(decision.current!.minutes) + '，请说明核减原因。' : decisionAction === 'REJECT' ? '员工会看到退回原因，可以修改后重新提交。' : decisionAction === 'VOID' ? '作废后将扣回这笔其他工时，原记录和处理轨迹会保留。' : decisionAction === 'WITHDRAW' ? '撤回后可以修改，重新提交后再进入审批。' : '请说明需要更正的内容，管理员处理后保留原申报和更正记录。'}</p>
        {decisionNeedsReason && <label>处理原因<textarea rows={3} required minLength={2} maxLength={1000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="请填写具体原因" /></label>}
        <footer className="oh-dialog-actions"><button type="button" disabled={busy} onClick={closeModal}>取消</button><button type="submit" className={decisionAction === 'VOID' ? 'danger' : 'primary'} disabled={busy}>{busy ? '正在处理…' : '确认'}</button></footer>
      </form>}
      {modal === 'discard' && <><p className="oh-secondary">可以先保存草稿，稍后从“我的申报”继续填写。{!!failedFiles.length && '还有未上传的照片，请先重试，或选择放弃修改。'}</p><footer className="oh-dialog-actions oh-discard-actions"><button type="button" disabled={busy} onClick={closeModal}>继续填写</button>
        <button type="button" disabled={busy} onClick={() => { const next = continuation.current; continuation.current = null; const saved = JSON.parse(baseline) as Form; setForm(saved); formState.current = saved; setFailedFiles([]); setModal(null); next?.(); }}>放弃修改</button>
        <button type="button" className="primary" disabled={busy || failedFiles.length > 0} onClick={() => void saveBeforeLeaving()}>保存后离开</button></footer></>}
      {modal === 'config' && <div className="oh-category-config">{data?.categories.map(c => <div key={c.id}><span>{c.name}</span><button type="button" disabled={busy} onClick={() => updateCategory(c)}>{c.isActive ? '停用' : '启用'}</button></div>)}
        <form onSubmit={e => { e.preventDefault(); updateCategory(); }}><label>新分类名称<input required minLength={2} maxLength={100} value={categoryName} onChange={e => setCategoryName(e.target.value)} /></label><button type="submit" className="primary" disabled={busy}>新增分类</button></form></div>}
    </OtherHoursDialog>}
    {preview && <OtherHoursDialog title="工作照片" wide onClose={() => setPreview(null)}><img className="oh-photo-preview" src={preview.url} alt={preview.originalName} /></OtherHoursDialog>}
  </main>;
}
