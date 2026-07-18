'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Copy,
  FileDown,
  FileSpreadsheet,
  Library,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  CurrentUserDTO,
  ProductProcessTimeEntryDTO,
  ProductTimeListItemDTO,
  ProductTimeProfileDTO,
  ProcessStageGroup,
} from '@/types';

type ProcessDefinition = {
  id: string;
  code: string;
  name: string;
  stageGroup: ProcessStageGroup;
  sortOrder: number;
};

type ProductTimeSummary = { total: number; published: number; draft: number; missing: number };
type CustomerOption = { customerName: string; count: number };
type ProductTimePayload = {
  ok: boolean;
  error?: string;
  items?: ProductTimeListItemDTO[];
  definitions?: ProcessDefinition[];
  customers?: CustomerOption[];
  summary?: ProductTimeSummary;
};

type EntryDraft = {
  processDefinitionId: string;
  unitSeconds: string;
  actionSeconds: string;
  occurrences: string;
  setupSeconds: string;
  countsForEfficiency: boolean;
  remark: string;
};

type ProductTimeImportEntry = {
  processDefinitionId: string;
  processName: string;
  unitSeconds: number;
  occurrences: number;
};

type ProductTimeImportRow = {
  rowNo: number;
  itemId: string | null;
  specification: string;
  customerName: string;
  productName: string;
  entries: ProductTimeImportEntry[];
  totalSeconds: number;
  status: 'ready' | 'invalid';
  warnings: string[];
};

type ProductTimeImportPreview = {
  fileName: string;
  sheetName: string;
  processColumns: string[];
  rows: ProductTimeImportRow[];
  summary: {
    total: number;
    ready: number;
    invalid: number;
    matchedProcessColumns: number;
  };
};

const emptySummary: ProductTimeSummary = { total: 0, published: 0, draft: 0, missing: 0 };
const stageText: Record<ProcessStageGroup, string> = { frontend: '前端', backend: '后端', finish: '完工' };

function seconds(value: number | null | undefined): string {
  if (!value) return '';
  return String(Math.round((value / 1000) * 1000) / 1000);
}

function duration(milliseconds: number): string {
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) return `${Math.round(totalSeconds * 10) / 10} 秒`;
  const minutes = totalSeconds / 60;
  return `${Math.round(minutes * 10) / 10} 分钟`;
}

function entryDraft(entry: ProductProcessTimeEntryDTO): EntryDraft {
  return {
    processDefinitionId: entry.processDefinitionId,
    unitSeconds: seconds(entry.unitMilliseconds),
    actionSeconds: seconds(entry.actionMilliseconds),
    occurrences: String(entry.occurrences || 1),
    setupSeconds: seconds(entry.setupMilliseconds) || '0',
    countsForEfficiency: entry.countsForEfficiency,
    remark: entry.remark || '',
  };
}

function draftTotal(entries: EntryDraft[]): number {
  return entries.reduce((total, entry) => {
    const direct = Number(entry.unitSeconds);
    const action = Number(entry.actionSeconds);
    const occurrences = Number(entry.occurrences || 1);
    const value = Number.isFinite(direct) && direct > 0
      ? direct
      : Number.isFinite(action) && action > 0 && Number.isFinite(occurrences) && occurrences > 0
        ? action * occurrences
        : 0;
    return total + Math.round(value * 1000);
  }, 0);
}

function statusText(item: ProductTimeListItemDTO): string {
  if (item.draft) return item.published ? '新版草稿' : '草稿';
  if (item.published) return `已发布 V${item.published.version}`;
  return '工时待维护';
}

export default function ProductTimeShell({ user }: { user: CurrentUserDTO }) {
  const [items, setItems] = useState<ProductTimeListItemDTO[]>([]);
  const [definitions, setDefinitions] = useState<ProcessDefinition[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [summary, setSummary] = useState<ProductTimeSummary>(emptySummary);
  const [keyword, setKeyword] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [remark, setRemark] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryStage, setLibraryStage] = useState<'all' | ProcessStageGroup>('all');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [newProcessName, setNewProcessName] = useState('');
  const [newProcessStage, setNewProcessStage] = useState<ProcessStageGroup>('backend');
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductTimeImportPreview | null>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryCloseRef = useRef<HTMLButtonElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importCloseRef = useRef<HTMLButtonElement>(null);
  const initialSelectionRef = useRef(false);

  const selectedItem = items.find(item => item.id === selectedId) || items[0] || null;
  const activeDraft = selectedItem?.draft || null;
  const activePublished = selectedItem?.published || null;
  const activeProfile = activeDraft || activePublished;

  const load = useCallback(async (preferredItemId?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (customer) params.set('customer', customer);
      if (status !== 'all') params.set('status', status);
      const response = await fetch(`/api/product-time-profiles?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as ProductTimePayload;
      if (!response.ok) throw new Error(data.error || '产品工时加载失败');
      const nextItems = data.items || [];
      setItems(nextItems);
      setDefinitions(data.definitions || []);
      setCustomers(data.customers || []);
      setSummary(data.summary || emptySummary);
      const urlItemId = new URLSearchParams(window.location.search).get('itemId') || '';
      const requested = preferredItemId || urlItemId || selectedId;
      setSelectedId(nextItems.some(item => item.id === requested) ? requested : nextItems[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时加载失败');
    } finally {
      setLoading(false);
    }
  }, [customer, keyword, selectedId, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 220);
    return () => window.clearTimeout(timer);
  }, [keyword, customer, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialSelectionRef.current) return;
    initialSelectionRef.current = true;
    const itemId = new URLSearchParams(window.location.search).get('itemId') || '';
    if (itemId) setSelectedId(itemId);
  }, []);

  useEffect(() => {
    setEntries(activeProfile?.entries.map(entryDraft) || []);
    setRemark(activeProfile?.remark || '');
    setCopySourceId('');
    setDirty(false);
    setError('');
  }, [activeProfile, selectedItem?.id]);

  useEffect(() => {
    if (!libraryOpen && !importOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      if (importOpen) importCloseRef.current?.focus();
      else if (libraryOpen && window.matchMedia('(max-width: 1500px)').matches) libraryCloseRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [importOpen, libraryOpen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (importOpen) {
        setImportOpen(false);
        window.requestAnimationFrame(() => importTriggerRef.current?.focus());
        return;
      }
      if (libraryOpen) {
        setLibraryOpen(false);
        window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
      }
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [importOpen, libraryOpen]);

  const filteredDefinitions = useMemo(() => definitions.filter(definition => {
    if (entries.some(entry => entry.processDefinitionId === definition.id)) return false;
    if (libraryStage !== 'all' && definition.stageGroup !== libraryStage) return false;
    const normalized = libraryKeyword.trim().toLocaleLowerCase('zh-CN');
    return !normalized || `${definition.name} ${definition.code}`.toLocaleLowerCase('zh-CN').includes(normalized);
  }), [definitions, entries, libraryKeyword, libraryStage]);

  function chooseItem(id: string): void {
    if (dirty && !window.confirm('当前产品工时尚未保存，确定切换产品吗？')) return;
    setSelectedId(id);
  }

  function addDefinition(definition: ProcessDefinition): void {
    setEntries(current => [...current, {
      processDefinitionId: definition.id,
      unitSeconds: '',
      actionSeconds: '',
      occurrences: '1',
      setupSeconds: '0',
      countsForEfficiency: true,
      remark: '',
    }]);
    setDirty(true);
    setMessage(`${definition.name} 已加入产品工时表`);
  }

  function updateEntry(index: number, patch: Partial<EntryDraft>): void {
    setEntries(current => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
    setDirty(true);
  }

  function moveEntry(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    setEntries(current => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setDirty(true);
  }

  function removeEntry(index: number): void {
    setEntries(current => current.filter((_entry, entryIndex) => entryIndex !== index));
    setDirty(true);
  }

  function copyProfile(): void {
    const source = items.find(item => item.id === copySourceId)?.published || null;
    if (!source) {
      setError('请选择一个已发布产品作为复制来源');
      return;
    }
    setEntries(source.entries.map(entryDraft));
    setRemark(`参考产品工时 V${source.version}`);
    setDirty(true);
    setMessage(`已复制 ${source.processCount} 道工序，请检查后保存`);
  }

  async function createProcess(): Promise<void> {
    if (!newProcessName.trim()) {
      setError('请填写新工序名称');
      return;
    }
    setCreatingProcess(true);
    setError('');
    try {
      const response = await fetch('/api/process-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProcessName.trim(), stageGroup: newProcessStage }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; definition?: ProcessDefinition };
      if (!response.ok || !data.definition) throw new Error(data.error || '新增工序失败');
      setDefinitions(current => [...current, data.definition!]);
      addDefinition(data.definition);
      setNewProcessName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新增工序失败');
    } finally {
      setCreatingProcess(false);
    }
  }

  async function saveDraft(): Promise<ProductTimeProfileDTO | null> {
    if (!selectedItem) return null;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: activeDraft?.revision ?? null,
          remark,
          sourceType: copySourceId ? 'copied' : 'manual',
          entries: entries.map(entry => ({
            processDefinitionId: entry.processDefinitionId,
            unitSeconds: entry.unitSeconds,
            actionSeconds: entry.actionSeconds,
            occurrences: entry.occurrences,
            setupSeconds: entry.setupSeconds,
            countsForEfficiency: entry.countsForEfficiency,
            remark: entry.remark,
          })),
        }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; profile?: ProductTimeProfileDTO };
      if (!response.ok || !data.profile) throw new Error(data.error || '产品工时保存失败');
      setDirty(false);
      setMessage(`产品工时 V${data.profile.version} 草稿已保存`);
      await load(selectedItem.id);
      return data.profile;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时保存失败');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish(): Promise<void> {
    if (!selectedItem || !activeDraft) {
      setError('请先保存产品工时草稿');
      return;
    }
    if (dirty) {
      setError('当前内容尚未保存，请先保存草稿再发布');
      return;
    }
    if (!window.confirm(`确认发布 ${selectedItem.specification} 产品工时 V${activeDraft.version}？已确认工单不会被反向修改。`)) return;
    setPublishing(true);
    setError('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: activeDraft.revision }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        profile?: ProductTimeProfileDTO;
        routeSync?: { updated: number; started: number; skipped: number };
      };
      if (!response.ok || !data.profile) throw new Error(data.error || '产品工时发布失败');
      const synced = data.routeSync?.updated || 0;
      setMessage(`产品工序与工时 V${data.profile.version} 已发布${synced ? `，已自动同步 ${synced} 张待执行工单` : ''}`);
      await load(selectedItem.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时发布失败');
    } finally {
      setPublishing(false);
    }
  }

  function closeImport(): void {
    if (importLoading || importCommitting) return;
    setImportOpen(false);
    window.requestAnimationFrame(() => importTriggerRef.current?.focus());
  }

  async function previewImport(file: File): Promise<void> {
    setImportLoading(true);
    setImportPreview(null);
    setError('');
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/product-time-profiles/import/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        fileName?: string;
        sheetName?: string;
        processColumns?: string[];
        rows?: ProductTimeImportRow[];
        summary?: ProductTimeImportPreview['summary'];
      };
      if (!response.ok || !data.fileName || !data.summary || !data.rows) {
        throw new Error(data.error || '产品工时表预览失败');
      }
      setImportPreview({
        fileName: data.fileName,
        sheetName: data.sheetName || '首个工作表',
        processColumns: data.processColumns || [],
        rows: data.rows,
        summary: data.summary,
      });
      setImportOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时表预览失败');
    } finally {
      setImportLoading(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function commitImport(): Promise<void> {
    const readyRows = importPreview?.rows.filter(row => row.status === 'ready' && row.itemId) || [];
    if (!readyRows.length) {
      setError('当前预览没有可导入的产品');
      return;
    }
    setImportCommitting(true);
    setError('');
    try {
      const response = await fetch('/api/product-time-profiles/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: readyRows.map(row => ({
            rowNo: row.rowNo,
            itemId: row.itemId,
            entries: row.entries,
          })),
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        result?: { imported: number; createdDrafts: number; updatedDrafts: number };
      };
      if (!response.ok || !data.result) throw new Error(data.error || '产品工时导入失败');
      setImportOpen(false);
      setImportPreview(null);
      setMessage(`已导入 ${data.result.imported} 款产品工时草稿，请逐项检查后再发布`);
      await load(selectedItem?.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时导入失败');
    } finally {
      setImportCommitting(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const totalMilliseconds = draftTotal(entries);
  const selectedStatus = selectedItem ? statusText(selectedItem) : '未选择产品';

  return (
    <main className="product-time-page hm-product-time-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/product-times"
        subtitle="按产品维护执行工序、顺序与单位标准时间"
        menuItems={[{ label: '返回图纸资料库', href: '/drawing-library' }, { label: '退出登录', onSelect: logout }]}
      />

      <div className="product-time-main">
        <section className="product-time-summary" aria-label="产品工时概览">
          <article><Clock3 aria-hidden="true" /><span>图纸产品<strong>{summary.total}</strong><small>当前筛选范围</small></span></article>
          <article><CheckCircle2 aria-hidden="true" /><span>已发布<strong>{summary.published}</strong><small>可用于新工单</small></span></article>
          <article><Save aria-hidden="true" /><span>草稿待发布<strong>{summary.draft}</strong><small>继续维护</small></span></article>
          <article className="warning"><Library aria-hidden="true" /><span>工时待维护<strong>{summary.missing}</strong><small>暂不计算正式达成率</small></span></article>
        </section>

        <section className="product-time-toolbar" aria-label="产品工时搜索和筛选">
          <label><Search aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格或品名" /></label>
          <select value={customer} onChange={event => setCustomer(event.target.value)} aria-label="筛选客户"><option value="">全部客户</option>{customers.map(option => <option key={option.customerName} value={option.customerName}>{option.customerName}（{option.count}）</option>)}</select>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="筛选工时状态"><option value="all">全部状态</option><option value="missing">工时待维护</option><option value="draft">草稿待发布</option><option value="published">已发布</option></select>
          <div className="product-time-toolbar-actions">
            <input
              ref={importInputRef}
              className="product-time-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              aria-label="选择产品工时 Excel 或 CSV"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void previewImport(file);
              }}
            />
            <button ref={importTriggerRef} className="hm-workbench-button" type="button" disabled={importLoading} onClick={() => importInputRef.current?.click()} title="导入产品工时 Excel"><Upload size={15} aria-hidden="true" />{importLoading ? '解析中' : '导入'}</button>
            <a className="hm-workbench-button" href="/api/product-time-profiles/export.xlsx" title="导出产品工时 Excel"><FileDown size={15} aria-hidden="true" />导出</a>
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => load(selectedItem?.id)} title="刷新产品工时"><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />刷新</button>
          </div>
        </section>

        {message && <div className="product-time-message" role="status">{message}</div>}
        {error && <div className="product-time-error" role="alert">{error}</div>}

        <section className="product-time-workspace">
          <aside className="product-time-browser" aria-label="图纸产品列表">
            <div className="product-time-panel-head"><span><strong>产品规格</strong><small>{items.length} 项</small></span></div>
            <div className="product-time-product-list hm-scroll-region" tabIndex={0}>
              {items.map(item => {
                const profile = item.draft || item.published;
                return <button key={item.id} className={selectedItem?.id === item.id ? 'active' : ''} type="button" onClick={() => chooseItem(item.id)}>
                  <strong title={item.specification}>{item.specification}</strong>
                  <span title={`${item.customerName} · ${item.productName || '品名未设置'}`}>{item.customerName} · {item.productName || '品名未设置'}</span>
                  <footer><em className={item.published ? 'published' : item.draft ? 'draft' : 'missing'}>{statusText(item)}</em><small>{profile ? `${profile.processCount} 工序 · ${duration(profile.totalMillisecondsPerUnit)}` : '未配置'}</small></footer>
                </button>;
              })}
              {!loading && !items.length && <div className="product-time-empty"><Search aria-hidden="true" /><strong>没有符合条件的产品</strong><span>请调整搜索或先在图纸资料库建立产品资料。</span></div>}
            </div>
          </aside>

          <section className="product-time-editor" aria-label="产品单位工时编辑">
            {!selectedItem ? <div className="product-time-empty large"><Clock3 aria-hidden="true" /><strong>选择产品开始维护工时</strong><span>产品工时会绑定图纸资料，不会依赖容易重复的文本规格。</span></div> : <>
              <header className="product-time-editor-head">
                <div><span>{selectedStatus}</span><h1 title={selectedItem.specification}>{selectedItem.specification}</h1><p title={`${selectedItem.customerName} · ${selectedItem.productName || '品名未设置'}`}>{selectedItem.customerName} · {selectedItem.productName || '品名未设置'}</p></div>
                <div className="product-time-editor-actions">
                  <a className="hm-workbench-button" href={`/drawing-library?itemId=${encodeURIComponent(selectedItem.id)}`}><BookOpenText size={15} aria-hidden="true" />查看图纸</a>
                  <button ref={libraryTriggerRef} className="hm-workbench-button" type="button" aria-expanded={libraryOpen} aria-controls="product-process-library" onClick={() => setLibraryOpen(true)}><Library size={15} aria-hidden="true" />工序库</button>
                  <button className="hm-workbench-button" type="button" disabled={saving} onClick={saveDraft}><Save size={15} aria-hidden="true" />{saving ? '保存中' : '保存草稿'}</button>
                  <button className="hm-workbench-button primary" type="button" disabled={publishing || dirty || !activeDraft} onClick={publish}><CheckCircle2 size={15} aria-hidden="true" />{publishing ? '发布中' : '发布版本'}</button>
                </div>
              </header>

              <div className="product-time-metrics">
                <span><small>工序数量</small><strong>{entries.length}</strong></span>
                <span><small>单件总工时</small><strong>{duration(totalMilliseconds)}</strong></span>
                <span><small>当前版本</small><strong>{activeProfile ? `V${activeProfile.version}` : '待创建'}</strong></span>
                <span><small>工时来源</small><strong>{copySourceId ? '复制后调整' : '人工维护'}</strong></span>
              </div>

              <div className="product-time-copy-row">
                <label><span>复制相似产品</span><select value={copySourceId} onChange={event => setCopySourceId(event.target.value)}><option value="">选择已发布产品</option>{items.filter(item => item.id !== selectedItem.id && item.published).map(item => <option key={item.id} value={item.id}>{item.customerName} · {item.specification}</option>)}</select></label>
                <button className="hm-workbench-button" type="button" disabled={!copySourceId} onClick={copyProfile}><Copy size={15} aria-hidden="true" />复制工时</button>
              </div>

              <div className="product-time-table-head" aria-hidden="true"><span>顺序/工序</span><span>单件工时(秒)</span><span>单次(秒)</span><span>次数</span><span>准备(秒)</span><span>计入达成率</span><span>操作</span></div>
              <div className="product-time-entry-list hm-scroll-region" tabIndex={0} aria-label={`产品工时明细，共 ${entries.length} 道工序`}>
                {entries.map((entry, index) => {
                  const definition = definitions.find(item => item.id === entry.processDefinitionId);
                  return <article key={entry.processDefinitionId}>
                    <div className="product-time-process-name"><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{definition?.name || '工序已停用'}</strong><small>{definition ? stageText[definition.stageGroup] : '待处理'}</small></span></div>
                    <label><span>单件工时</span><input inputMode="decimal" value={entry.unitSeconds} onChange={event => updateEntry(index, { unitSeconds: event.target.value })} placeholder="必填" /></label>
                    <label><span>单次时间</span><input inputMode="decimal" value={entry.actionSeconds} onChange={event => updateEntry(index, { actionSeconds: event.target.value })} placeholder="可选" /></label>
                    <label><span>次数</span><input inputMode="numeric" value={entry.occurrences} onChange={event => updateEntry(index, { occurrences: event.target.value })} /></label>
                    <label><span>准备时间</span><input inputMode="decimal" value={entry.setupSeconds} onChange={event => updateEntry(index, { setupSeconds: event.target.value })} /></label>
                    <label className="product-time-efficiency"><input type="checkbox" checked={entry.countsForEfficiency} onChange={event => updateEntry(index, { countsForEfficiency: event.target.checked })} /><span>计入</span></label>
                    <div className="product-time-row-actions"><button type="button" title="上移" aria-label={`上移${definition?.name || '工序'}`} disabled={index === 0} onClick={() => moveEntry(index, -1)}><ArrowUp size={15} /></button><button type="button" title="下移" aria-label={`下移${definition?.name || '工序'}`} disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown size={15} /></button><button className="danger" type="button" title="移除" aria-label={`移除${definition?.name || '工序'}`} onClick={() => removeEntry(index)}><Trash2 size={15} /></button></div>
                    <input className="product-time-row-remark" value={entry.remark} onChange={event => updateEntry(index, { remark: event.target.value })} placeholder="工序备注，可选" />
                  </article>;
                })}
                {!entries.length && <div className="product-time-empty"><Library aria-hidden="true" /><strong>当前产品还没有工时明细</strong><span>从工序库添加参与该产品的工序；未添加的工序即表示不参与。</span><button className="hm-workbench-button primary" type="button" onClick={() => setLibraryOpen(true)}>打开工序库</button></div>}
              </div>
              <label className="product-time-remark"><span>版本说明</span><textarea value={remark} onChange={event => { setRemark(event.target.value); setDirty(true); }} placeholder="记录工时测定依据、特殊设备或本次调整原因" /></label>
            </>}
          </section>

          {libraryOpen && <button className="product-time-library-scrim" type="button" aria-label="关闭工序库" onClick={() => {
            setLibraryOpen(false);
            window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
          }} />}
          <aside id="product-process-library" className={`product-time-library ${libraryOpen ? 'open' : ''}`} aria-label="共享工序库">
            <header><span><strong>共享工序库</strong><small>加入当前产品后填写单件工时</small></span><button ref={libraryCloseRef} type="button" title="关闭工序库" aria-label="关闭工序库" onClick={() => {
              setLibraryOpen(false);
              window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
            }}><X size={17} /></button></header>
            <label className="product-time-library-search"><Search size={15} aria-hidden="true" /><input value={libraryKeyword} onChange={event => setLibraryKeyword(event.target.value)} placeholder="搜索工序" /></label>
            <div className="product-time-stage-tabs">{(['all', 'frontend', 'backend', 'finish'] as const).map(value => <button key={value} className={libraryStage === value ? 'active' : ''} type="button" onClick={() => setLibraryStage(value)}>{value === 'all' ? '全部' : stageText[value]}</button>)}</div>
            <div className="product-time-definition-list hm-scroll-region" tabIndex={0}>{filteredDefinitions.map(definition => <button key={definition.id} type="button" onClick={() => addDefinition(definition)}><span><strong>{definition.name}</strong><small>{stageText[definition.stageGroup]}</small></span><Plus size={15} aria-hidden="true" /></button>)}{!filteredDefinitions.length && <p>没有可添加的工序</p>}</div>
            <section className="product-time-new-process"><strong>新增共享工序</strong><input value={newProcessName} onChange={event => setNewProcessName(event.target.value)} placeholder="工序名称" maxLength={60} /><select value={newProcessStage} onChange={event => setNewProcessStage(event.target.value as ProcessStageGroup)}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select><button className="hm-workbench-button" type="button" disabled={creatingProcess} onClick={createProcess}><Plus size={15} />{creatingProcess ? '创建中' : '创建并加入'}</button></section>
          </aside>
        </section>
      </div>

      {importOpen && importPreview && <div className="product-time-import-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeImport();
      }}>
        <section className="product-time-import-dialog" role="dialog" aria-modal="true" aria-labelledby="product-time-import-title">
          <header>
            <div><FileSpreadsheet aria-hidden="true" /><span><strong id="product-time-import-title">产品工时导入预览</strong><small title={importPreview.fileName}>{importPreview.fileName} · {importPreview.sheetName}</small></span></div>
            <button ref={importCloseRef} type="button" title="关闭导入预览" aria-label="关闭导入预览" disabled={importCommitting} onClick={closeImport}><X size={18} /></button>
          </header>
          <div className="product-time-import-notice"><AlertTriangle size={17} aria-hidden="true" /><span><strong>导入只保存草稿，不会自动发布</strong><small>空白工序表示该产品不参与；无效行不会写入数据库。</small></span></div>
          <div className="product-time-import-summary">
            <span><small>数据行</small><strong>{importPreview.summary.total}</strong></span>
            <span className="ready"><small>可导入</small><strong>{importPreview.summary.ready}</strong></span>
            <span className="invalid"><small>需处理</small><strong>{importPreview.summary.invalid}</strong></span>
            <span><small>匹配工序列</small><strong>{importPreview.summary.matchedProcessColumns}</strong></span>
          </div>
          <div className="product-time-import-columns" title={importPreview.processColumns.join('、')}>
            已识别工序：{importPreview.processColumns.join('、') || '无'}
          </div>
          <div className="product-time-import-list hm-scroll-region" tabIndex={0}>
            <div className="product-time-import-list-head"><span>行</span><span>产品 / 客户</span><span>工序</span><span>单件合计</span><span>状态</span></div>
            {importPreview.rows.map(row => <article key={`${row.rowNo}-${row.specification}`} className={row.status}>
              <span>{row.rowNo}</span>
              <span><strong title={row.specification}>{row.specification}</strong><small title={`${row.customerName} · ${row.productName || '品名未设置'}`}>{row.customerName || '客户未匹配'} · {row.productName || '品名未设置'}</small></span>
              <span>{row.entries.length}</span>
              <span>{Math.round(row.totalSeconds * 1000) / 1000} 秒</span>
              <span>{row.status === 'ready' ? <em>可导入</em> : <em title={row.warnings.join('；')}>{row.warnings.join('；') || '数据无效'}</em>}</span>
            </article>)}
          </div>
          <footer>
            <span>将写入 {importPreview.summary.ready} 款产品的草稿；发布前仍可逐项修改。</span>
            <div><button className="hm-workbench-button" type="button" disabled={importCommitting} onClick={closeImport}>取消</button><button className="hm-workbench-button primary" type="button" disabled={importCommitting || importPreview.summary.ready === 0} onClick={commitImport}><Upload size={15} aria-hidden="true" />{importCommitting ? '导入中' : `导入 ${importPreview.summary.ready} 条草稿`}</button></div>
          </footer>
        </section>
      </div>}
    </main>
  );
}
