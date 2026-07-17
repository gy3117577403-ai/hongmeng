'use client';

import { BookOpenText, FileImage, MoreHorizontal, Plus, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BulkOriginalDrawingImportModal } from '@/components/BulkOriginalDrawingImportModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { safeDisplayFilename } from '@/lib/filenames';
import type { CurrentUserDTO, DrawingLibraryCustomerDTO, DrawingLibraryFileDTO, DrawingLibraryItemDTO, ResourceCategoryDTO } from '@/types';

type DrawingLibraryForm = {
  customerName: string;
  productName: string;
  specification: string;
  remark: string;
};

type DrawingFilter = 'all' | 'complete' | 'recent' | 'anomaly';
type DrawingModal = { mode: 'create' | 'edit'; item?: DrawingLibraryItemDTO } | null;
type DrawingDeleteTarget =
  | { kind: 'item'; item: DrawingLibraryItemDTO }
  | { kind: 'file'; file: DrawingLibraryFileDTO };
type CleanupSummary = {
  totalActive: number;
  candidateCount: number;
  customerCount: number;
  specificationCount: number;
  retainedCount: number;
  withFileCount: number;
  withRemarkCount: number;
  connectorParameterCount: number;
  connectorParameterFileCount: number;
  workOrderCount: number;
  cleanedCount?: number;
  samples: Array<{ id: string; customerName: string; specification: string; productName?: string | null }>;
};

const emptyForm: DrawingLibraryForm = { customerName: '', productName: '', specification: '', remark: '' };
const filterOptions: Array<[DrawingFilter, string]> = [
  ['all', '全部'],
  ['recent', '最近更新'],
  ['complete', '资料完整'],
  ['anomaly', '异常数据'],
];

function dt(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date).replace(/\//g, '-');
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formFrom(item?: DrawingLibraryItemDTO): DrawingLibraryForm {
  if (!item) return emptyForm;
  return {
    customerName: item.customerName === '未设置' ? '' : item.customerName,
    productName: item.productName || '',
    specification: item.specification || '',
    remark: item.remark || '',
  };
}

function hasText(value?: string | null) {
  const text = value?.trim() || '';
  return !!text && text !== '-';
}

function categoryShortName(value?: string | null) {
  if (value === 'SOP指导书') return 'SOP';
  if (value === '成品图') return '成品';
  if (value === '注意事项') return '注意';
  return value || '分类';
}

export function DrawingLibraryShell({
  user,
  initialItems,
  initialCustomers,
  categories,
}: {
  user: CurrentUserDTO;
  initialItems: DrawingLibraryItemDTO[];
  initialCustomers: DrawingLibraryCustomerDTO[];
  categories: ResourceCategoryDTO[];
}) {
  const [items, setItems] = useState(initialItems);
  const [customers, setCustomers] = useState(initialCustomers);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<DrawingFilter>('all');
  const [customer, setCustomer] = useState('全部客户');
  const [selectedId, setSelectedId] = useState(initialItems[0]?.id || '');
  const [selectedFileId, setSelectedFileId] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<DrawingModal>(null);
  const [form, setForm] = useState<DrawingLibraryForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupSummary | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState('');
  const [cleanupError, setCleanupError] = useState('');
  const [bulkHelpOpen, setBulkHelpOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DrawingDeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePanelTriggerRef = useRef<HTMLButtonElement>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const filePanelRef = useRef<HTMLElement>(null);
  const filePanelCloseRef = useRef<HTMLButtonElement>(null);
  const initialUrlAppliedRef = useRef(false);
  const urlMissingWarnedRef = useRef(false);

  const visibleItems = useMemo(() => (
    customer === '全部客户' ? items : items.filter(item => item.customerName === customer)
  ), [customer, items]);
  const selectedItem = visibleItems.find(item => item.id === selectedId) || visibleItems[0] || null;
  const activeCategory = categories.find(category => category.id === activeCategoryId) || categories[0] || null;
  const activeFiles = selectedItem?.files.filter(file => file.categoryId === activeCategory?.id) || [];
  const selectedFile = activeFiles.find(file => file.id === selectedFileId) || activeFiles[0] || null;
  const hasActiveFilters = !!keyword.trim() || filter !== 'all' || customer !== '全部客户';
  const activeFilterLabel = filterOptions.find(([key]) => key === filter)?.[1] || '全部';
  const visibleFileCount = useMemo(() => visibleItems.reduce((total, item) => total + item.fileCount, 0), [visibleItems]);

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) setSelectedId(selectedItem.id);
  }, [selectedItem, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetItemId = params.get('itemId') || '';
    const targetFileId = params.get('fileId') || '';
    const targetKeyword = params.get('keyword') || '';
    const shouldCreate = params.get('create') === '1';
    const createCustomerName = params.get('customerName') || '';
    const createSpecification = params.get('specification') || '';
    const createProductName = params.get('productName') || '';

    if (!initialUrlAppliedRef.current) {
      initialUrlAppliedRef.current = true;
      if (targetKeyword && keyword !== targetKeyword) {
        setKeyword(targetKeyword);
        return;
      }
      if (shouldCreate) {
        setModal({ mode: 'create' });
        setForm({
          customerName: createCustomerName,
          specification: createSpecification,
          productName: createProductName,
          remark: '',
        });
        setFormError('');
      }
    }

    if (!targetItemId) return;
    const targetItem = items.find(item => item.id === targetItemId) || null;
    if (!targetItem) {
      if (!urlMissingWarnedRef.current && items.length) {
        urlMissingWarnedRef.current = true;
        setMsg('图纸资料不存在或已删除。');
      }
      return;
    }

    setCustomer('全部客户');
    setSelectedId(targetItem.id);
    if (targetFileId) {
      const targetFile = targetItem.files.find(file => file.id === targetFileId) || null;
      if (targetFile) {
        setActiveCategoryId(targetFile.categoryId);
        setSelectedFileId(targetFile.id);
      } else if (!urlMissingWarnedRef.current) {
        urlMissingWarnedRef.current = true;
        setMsg('图纸文件不存在或已删除。');
      }
    }
  }, [items, keyword]);

  useEffect(() => {
    if (selectedFile && selectedFile.id !== selectedFileId) setSelectedFileId(selectedFile.id);
    if (!selectedFile) setSelectedFileId('');
  }, [selectedFile, selectedFileId]);

  useEffect(() => {
    function closeTransientLayer(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (bulkImportOpen) setBulkImportOpen(false);
      else if (cleanupOpen) setCleanupOpen(false);
      else if (bulkHelpOpen) setBulkHelpOpen(false);
      else if (modal) setModal(null);
    }
    window.addEventListener('keydown', closeTransientLayer);
    return () => window.removeEventListener('keydown', closeTransientLayer);
  }, [bulkHelpOpen, bulkImportOpen, cleanupOpen, modal]);

  useEffect(() => {
    if (!filePanelOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => filePanelCloseRef.current?.focus());

    function keepFilePanelActive(event: KeyboardEvent) {
      const panel = filePanelRef.current;
      if (!panel) return;
      const blockingLayerOpen = !!(bulkImportOpen || cleanupOpen || bulkHelpOpen || modal);
      if (blockingLayerOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFilePanel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !panel.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', keepFilePanelActive);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keepFilePanelActive);
    };
  }, [bulkHelpOpen, bulkImportOpen, cleanupOpen, filePanelOpen, modal]);

  const loadData = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      params.set('filter', filter);
      const res = await fetch(`/api/drawing-library?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setMsg(data.error || '图纸资料库加载失败');
        return;
      }
      const nextItems: DrawingLibraryItemDTO[] = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setCustomer(current => current !== '全部客户' && !nextItems.some(item => item.customerName === current) ? '全部客户' : current);
      setSelectedId(current => nextItems.some(item => item.id === current) ? current : nextItems[0]?.id || '');
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) setMsg('图纸资料库加载失败，请检查网络');
    } finally {
      if (loadControllerRef.current === controller) setLoading(false);
    }
  }, [filter, keyword]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 260);
    return () => {
      window.clearTimeout(timer);
      loadControllerRef.current?.abort();
    };
  }, [loadData]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function clearFilters() {
    setKeyword('');
    setFilter('all');
    setCustomer('全部客户');
  }

  function closeFilePanel() {
    setFilePanelOpen(false);
    window.requestAnimationFrame(() => filePanelTriggerRef.current?.focus());
  }

  function openModal(mode: 'create' | 'edit', item?: DrawingLibraryItemDTO) {
    setModal({ mode, item });
    setForm(formFrom(item));
    setFormError('');
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.customerName.trim()) return setFormError('客户不能为空');
    if (!form.specification.trim()) return setFormError('产品规格不能为空');
    setSaving(true);
    try {
      const target = modal?.mode === 'edit' && modal.item ? `/api/drawing-library/${modal.item.id}` : '/api/drawing-library';
      const method = modal?.mode === 'edit' ? 'PATCH' : 'POST';
      const res = await fetch(target, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || '保存失败');
        return;
      }
      setModal(null);
      setMsg(modal?.mode === 'edit' ? '图纸资料已保存' : '图纸资料已新增');
      await loadData();
      if (data.item?.id) setSelectedId(data.item.id);
    } catch {
      setFormError('保存失败，请检查网络');
    } finally {
      setSaving(false);
    }
  }

  function deleteItem() {
    if (!selectedItem) return;
    setDeleteTarget({ kind: 'item', item: selectedItem });
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!selectedItem || !activeCategory || !fileList?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const body = new FormData();
        body.set('categoryId', activeCategory.id);
        body.set('file', file);
        const res = await fetch(`/api/drawing-library/${selectedItem.id}/files/upload`, { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(data.error || `${file.name} 上传失败`);
          return;
        }
      }
      setMsg('图纸资料文件已上传');
      await loadData();
    } catch {
      setMsg('上传失败，请检查对象存储配置');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function deleteFile(file: DrawingLibraryFileDTO) {
    setDeleteTarget({ kind: 'file', file });
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'item') {
        const deletingId = deleteTarget.item.id;
        const res = await fetch(`/api/drawing-library/${deletingId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(data.error || '删除失败');
          return;
        }
        setSelectedId('');
        setMsg('图纸资料已删除，可在回收站恢复');
        setItems(current => current.filter(item => item.id !== deletingId));
      } else {
        const res = await fetch(`/api/drawing-library/files/${deleteTarget.file.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(data.error || '删除文件失败');
          return;
        }
        setMsg('图纸资料文件已软删除');
      }
      setDeleteTarget(null);
      await loadData();
    } catch {
      setMsg(deleteTarget.kind === 'item' ? '删除图纸资料失败，请检查网络' : '删除文件失败，请检查网络');
    } finally {
      setDeleting(false);
    }
  }

  function chooseItem(item: DrawingLibraryItemDTO) {
    setSelectedId(item.id);
    setSelectedFileId('');
  }

  async function previewCleanup() {
    setCleanupLoading(true);
    setCleanupError('');
    try {
      const res = await fetch('/api/drawing-library/cleanup-empty/preview', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCleanupError(data.error || '预览清理失败');
        return;
      }
      setCleanupPreview(data.summary || null);
    } catch {
      setCleanupError('预览清理失败，请检查网络');
    } finally {
      setCleanupLoading(false);
    }
  }

  async function commitCleanup() {
    if (cleanupConfirm.trim() !== 'CLEAN_EMPTY') return setCleanupError('请输入 CLEAN_EMPTY 确认清理');
    setCleanupLoading(true);
    setCleanupError('');
    try {
      const res = await fetch('/api/drawing-library/cleanup-empty/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText: cleanupConfirm.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCleanupError(data.error || '清理失败');
        return;
      }
      setCleanupPreview(data.summary || null);
      setCleanupConfirm('');
      setMsg(`已清理 ${data.summary?.cleanedCount ?? 0} 条空图纸资料记录`);
      await loadData();
    } catch {
      setCleanupError('清理失败，请检查网络');
    } finally {
      setCleanupLoading(false);
    }
  }

  return (
    <main className="drawing-library-page hm-drawing-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/drawing-library"
        subtitle="客户、规格与图纸预览"
        menuItems={[
          { label: '返回生产工单', href: '/dashboard' },
          { label: '退出登录', onSelect: logout },
        ]}
      />

      <div className="hm-drawing-main">
        <section className="hm-drawing-query" aria-label="图纸资料搜索和筛选">
          <label className="hm-drawing-search-field" htmlFor="drawing-library-search">
            <span>搜索资料</span>
            <span className="hm-drawing-search-control">
              <Search size={16} aria-hidden="true" />
              <input id="drawing-library-search" className="hm-workbench-input" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="客户、规格、品名或备注" />
              {keyword && <button type="button" aria-label="清空搜索关键词" onClick={() => setKeyword('')}>清空</button>}
            </span>
          </label>

          <label className="hm-drawing-customer-filter">
            <span>客户</span>
            <select className="hm-workbench-input" value={customer} onChange={event => setCustomer(event.target.value)}>
              {customers.map(item => <option key={`${item.customerName}-${item.customerCode || ''}`} value={item.customerName}>{item.customerName}（{item.itemCount}）</option>)}
              {!customers.length && <option value="全部客户">全部客户（0）</option>}
            </select>
          </label>

          <label className="hm-drawing-status-filter">
            <span>状态</span>
            <select className="hm-workbench-input" value={filter} onChange={event => setFilter(event.target.value as DrawingFilter)}>
              {filterOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>

          <div className="hm-drawing-result-count" aria-live="polite">
            <span>{loading ? '正在检索' : '当前结果'}</span><strong>{loading ? '…' : visibleItems.length}</strong><small>规格 · {visibleFileCount} 文件</small>
          </div>
          <span className="hm-drawing-filter-summary" title={[keyword.trim() ? `关键词：${keyword.trim()}` : '', customer !== '全部客户' ? `客户：${customer}` : '', filter !== 'all' ? `状态：${activeFilterLabel}` : ''].filter(Boolean).join(' · ') || '全部资料'}>{hasActiveFilters ? '已启用筛选' : '全部资料'}</span>
          <details className="hm-drawing-more-filters">
            <summary className="hm-workbench-button">更多筛选</summary>
            <div role="group" aria-label="快捷资料状态筛选">
              <span>资料状态</span>
              {filterOptions.map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
            </div>
          </details>
          <button className="hm-drawing-clear-filters" type="button" disabled={!hasActiveFilters} onClick={clearFilters}>清除筛选</button>
          <div className="hm-drawing-command-actions" aria-label="图纸资料操作">
            <button className="hm-workbench-button" type="button" onClick={() => openModal('create')} title="新增图纸资料"><Plus size={15} aria-hidden="true" /><span>新增</span></button>
            <button className="hm-workbench-button primary" type="button" onClick={() => setBulkImportOpen(true)} title="批量导入原图"><Upload size={15} aria-hidden="true" /><span>批量导入</span></button>
            <button className="hm-workbench-button" type="button" title="查看批量导入原图说明" onClick={() => setBulkHelpOpen(true)}><BookOpenText size={15} aria-hidden="true" /><span>说明</span></button>
            <details className="hm-drawing-more-actions">
              <summary className="hm-workbench-button" title="更多图纸资料操作"><MoreHorizontal size={15} aria-hidden="true" /><span>更多</span></summary>
              <div><button className="danger" type="button" onClick={() => { setCleanupOpen(true); if (!cleanupPreview) previewCleanup(); }}>资料治理</button></div>
            </details>
          </div>
        </section>

        {msg && <div className="hm-drawing-message" role="status"><span>{msg}</span><button type="button" onClick={loadData}>重新加载</button></div>}

        <section className="drawing-workspace">
          <aside className="drawing-browser" aria-label="图纸规格结果">
            <div className="drawing-panel-head">
              <div><strong>规格结果</strong><span>{customer === '全部客户' ? '全部客户' : customer}</span></div>
              <b>{visibleItems.length}</b>
            </div>
            <div className="drawing-list hm-scroll-region" tabIndex={0} aria-label={`图纸规格结果，共 ${visibleItems.length} 项`}>
              {visibleItems.map(item => (
                <button key={item.id} className={selectedItem?.id === item.id ? 'drawing-spec-card active' : 'drawing-spec-card'} type="button" aria-pressed={selectedItem?.id === item.id} onClick={() => chooseItem(item)}>
                  <div className="drawing-spec-title-line">
                    <strong title={item.specification}>{item.specification}</strong>
                    {item.isAnomaly && <span title={item.anomalyReason || '异常数据'}>异常</span>}
                  </div>
                  <p title={`${item.customerName} · ${item.productName || '未设置品名'}`}>{item.customerName} · {item.productName || '未设置品名'}</p>
                  <footer>
                    <em>{item.completenessText}</em>
                    <span>{item.fileCount} 个文件</span>
                    <time dateTime={item.updatedAt || undefined}>{dt(item.updatedAt)}</time>
                  </footer>
                </button>
              ))}
              {!visibleItems.length && (
                <div className="drawing-result-empty">
                  <Search aria-hidden="true" />
                  <strong>{hasActiveFilters ? '没有符合条件的资料' : '资料库中还没有图纸资料'}</strong>
                  <p>{hasActiveFilters ? '尝试清除关键词、客户或状态筛选。' : '新增资料或使用批量导入建立长期图纸档案。'}</p>
                  <button className="hm-workbench-button" type="button" onClick={hasActiveFilters ? clearFilters : () => openModal('create')}>{hasActiveFilters ? '清除筛选' : '新增资料'}</button>
                </div>
              )}
            </div>
          </aside>

          <section className="drawing-detail" aria-label="资料预览工作区">
          {!selectedItem ? (
            <div className="drawing-empty-state">
              <FileImage aria-hidden="true" />
              <strong>{hasActiveFilters ? '当前筛选下没有可预览资料' : '选择一个规格开始查看'}</strong>
              <p>{hasActiveFilters ? '左侧结果会随搜索条件更新，清除筛选可返回全部资料。' : '预览区会保持图纸原始比例，并提供版本、下载和资料维护入口。'}</p>
              <button className="hm-workbench-button" type="button" onClick={hasActiveFilters ? clearFilters : () => openModal('create')}>{hasActiveFilters ? '清除筛选' : '新增图纸资料'}</button>
            </div>
          ) : (
            <>
              <div className="drawing-detail-head">
                <div>
                  <span>当前资料</span>
                  <h1 title={selectedItem.specification}>{selectedItem.specification}</h1>
                  <p>
                    <b title={selectedItem.customerName}>{selectedItem.customerName}</b>
                    {hasText(selectedItem.productName) && <em title={selectedItem.productName || ''}>{selectedItem.productName}</em>}
                    <small>{selectedItem.completenessText}</small>
                    <small>{selectedItem.fileCount} 个文件</small>
                    <small>更新于 {dt(selectedItem.updatedAt)}</small>
                    {selectedItem.isAnomaly && <small className="anomaly">{selectedItem.anomalyReason}</small>}
                  </p>
                </div>
                <div className="drawing-head-actions">
                  <button ref={filePanelTriggerRef} className="hm-workbench-button hm-drawing-file-toggle" type="button" aria-controls="drawing-library-file-panel" aria-expanded={filePanelOpen} onClick={() => filePanelOpen ? closeFilePanel() : setFilePanelOpen(true)}>文件 {activeFiles.length}</button>
                  <button className="hm-workbench-button" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : '上传资料'}</button>
                  <button className="hm-workbench-button" type="button" onClick={() => openModal('edit', selectedItem)}>编辑</button>
                  <button className="hm-workbench-button danger" type="button" onClick={deleteItem}>删除</button>
                </div>
              </div>

              <div className="drawing-library-main">
                <nav className="drawing-category-rail">
                  {categories.map(category => {
                    const count = selectedItem.categoryFileCounts[category.id] || 0;
                    return (
                      <button key={category.id} className={activeCategoryId === category.id ? 'active' : ''} type="button" onClick={() => { setActiveCategoryId(category.id); setSelectedFileId(''); }}>
                        <span className={count ? 'dot filled' : 'dot'} />
                        <strong title={category.name}>{categoryShortName(category.name)}</strong>
                        <em>{count}</em>
                      </button>
                    );
                  })}
                </nav>

                <div className="drawing-preview">
                  <div className="drawing-preview-head">
                    <span><b>{activeCategory?.name || '资料预览'}</b><small>{selectedFile ? `${selectedFile.version || 'V1.0'} · ${bytes(selectedFile.fileSize)}` : '当前分类'}</small></span>
                    <strong title={selectedFile ? safeDisplayFilename(selectedFile) : ''}>{selectedFile ? safeDisplayFilename(selectedFile) : '暂无文件'}</strong>
                    <input ref={fileInputRef} hidden multiple type="file" accept="application/pdf,.pdf,image/*" onChange={event => uploadFiles(event.target.files)} />
                  </div>

                  {!selectedFile ? (
                    <div className="drawing-preview-placeholder" aria-label="当前分类暂无可预览文件">
                      <span aria-hidden="true">＋</span>
                      <strong>{activeCategory?.name || '当前分类'}暂无文件</strong>
                      <p>支持 PDF、JPG、PNG 等现有资料类型，上传后可在这里直接预览。</p>
                      <button className="hm-workbench-button primary" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : `上传到${activeCategory?.name || '当前分类'}`}</button>
                    </div>
                  ) : selectedFile.fileType === 'pdf' ? (
                    <PdfViewer dashboardMode fileId={selectedFile.id} title={safeDisplayFilename(selectedFile)} contentUrl={selectedFile.contentUrl} viewUrl={selectedFile.viewUrl} downloadUrl={selectedFile.downloadUrl} />
                  ) : selectedFile.fileType === 'image' ? (
                    <ImageViewer dashboardMode fileId={selectedFile.id} title={safeDisplayFilename(selectedFile)} contentUrl={selectedFile.contentUrl} downloadUrl={selectedFile.downloadUrl} />
                  ) : (
                    <div className="drawing-file-fallback">
                      <strong title={safeDisplayFilename(selectedFile)}>{safeDisplayFilename(selectedFile)}</strong>
                      <p>此文件类型暂不支持内嵌预览，可直接下载查看。</p>
                      <a href={selectedFile.downloadUrl} target="_blank" rel="noreferrer">下载文件</a>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          </section>

          {filePanelOpen && <button className="drawing-file-panel-scrim" type="button" aria-label="关闭文件工具窗" onClick={closeFilePanel} />}
          {filePanelOpen && <aside ref={filePanelRef} id="drawing-library-file-panel" className="drawing-file-panel open" aria-label="分类文件工具窗" role="dialog" aria-modal="true" tabIndex={-1}>
          <div className="drawing-file-panel-head">
            <div><strong>{activeCategory?.name || '分类文件'}</strong><span>{activeFiles.length} 个文件</span></div>
            <button ref={filePanelCloseRef} className="drawing-file-panel-close" type="button" aria-label="关闭文件工具窗" title="关闭" onClick={closeFilePanel}>×</button>
          </div>
          {selectedItem && activeFiles.length > 0 ? (
            <>
              <div className="drawing-files hm-scroll-region" tabIndex={0} aria-label={`当前分类文件，共 ${activeFiles.length} 个`}>
                {activeFiles.map(file => (
                  <button key={file.id} className={selectedFile?.id === file.id ? 'active' : ''} type="button" onClick={() => setSelectedFileId(file.id)}>
                    <b>{file.fileType === 'pdf' ? 'PDF' : file.fileType === 'image' ? 'IMG' : 'FILE'}</b>
                    <span title={safeDisplayFilename(file)}>{safeDisplayFilename(file)}</span>
                    <em>{file.version || 'V1.0'} · {bytes(file.fileSize)}</em>
                  </button>
                ))}
              </div>
              {selectedFile && (
                <div className="drawing-file-actions">
                  <a className="hm-workbench-button" href={selectedFile.downloadUrl} target="_blank" rel="noreferrer">下载文件</a>
                  <button className="hm-workbench-button danger" type="button" onClick={() => deleteFile(selectedFile)}>删除文件</button>
                </div>
              )}
            </>
          ) : (
            <div className="drawing-file-empty">
              <strong>{selectedItem ? '当前分类暂无文件' : '请选择规格'}</strong>
              <p>{selectedItem ? '上传 PDF 或图片后会在中间预览区查看。' : '选择左侧规格后查看当前分类文件。'}</p>
              {selectedItem && <button className="hm-workbench-button primary" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : '上传 PDF / 图片'}</button>}
            </div>
          )}
          </aside>}
        </section>
      </div>

      {modal && (
        <div className="modal-backdrop" role="presentation">
          <form className="drawing-dialog" onSubmit={saveItem}>
            <div className="dialog-title">
              <div>
                <span>{modal.mode === 'edit' ? '编辑长期图纸资料' : '新增长期图纸资料'}</span>
                <h3>{modal.mode === 'edit' ? modal.item?.specification : '客户 · 规格 · 品名'}</h3>
              </div>
              <button type="button" aria-label="关闭资料编辑窗口" title="关闭" onClick={() => setModal(null)}>×</button>
            </div>
            <label>
              <span>客户 *</span>
              <input value={form.customerName} onChange={event => setForm(value => ({ ...value, customerName: event.target.value }))} placeholder="例如：杭州昆泰(10033)" />
            </label>
            <label>
              <span>产品规格 *</span>
              <input value={form.specification} onChange={event => setForm(value => ({ ...value, specification: event.target.value }))} placeholder="例如：D019999-9087-V03" />
            </label>
            <label>
              <span>品名 / 产品名称</span>
              <input value={form.productName} onChange={event => setForm(value => ({ ...value, productName: event.target.value }))} placeholder="可选" />
            </label>
            <label>
              <span>备注</span>
              <textarea value={form.remark} onChange={event => setForm(value => ({ ...value, remark: event.target.value }))} placeholder="可选，仅记录长期资料备注" />
            </label>
            {formError && <div className="form-error">{formError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setModal(null)}>取消</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}

      {cleanupOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="drawing-dialog cleanup-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              <div>
                <span>空资料记录清理</span>
                <h3>清理周计划导入产生的空图纸资料</h3>
              </div>
              <button type="button" aria-label="关闭资料治理窗口" title="关闭" onClick={() => setCleanupOpen(false)}>×</button>
            </div>
            <p className="cleanup-note">只清理无文件、无备注、由历史导入自动生成的空图纸资料记录。不会删除生产工单、连接器参数、资料文件或 S3 对象。</p>
            <div className="cleanup-summary">
              <span>候选 {cleanupPreview?.candidateCount ?? 0}</span>
              <span>涉及客户 {cleanupPreview?.customerCount ?? 0}</span>
              <span>涉及规格 {cleanupPreview?.specificationCount ?? 0}</span>
              <span>保留记录 {cleanupPreview?.retainedCount ?? 0}</span>
              <span>有文件记录 {cleanupPreview?.withFileCount ?? 0}</span>
              <span>有备注记录 {cleanupPreview?.withRemarkCount ?? 0}</span>
              <span>生产工单保留 {cleanupPreview?.workOrderCount ?? 0}</span>
              <span>连接器参数保留 {cleanupPreview?.connectorParameterCount ?? 0}</span>
            </div>
            {!!cleanupPreview?.samples?.length && (
              <div className="cleanup-samples">
                {cleanupPreview.samples.slice(0, 8).map(sample => (
                  <span key={sample.id}>{sample.customerName} · {sample.specification}</span>
                ))}
              </div>
            )}
            {cleanupError && <div className="form-error">{cleanupError}</div>}
            <label>
              <span>正式清理请输入 CLEAN_EMPTY</span>
              <input value={cleanupConfirm} onChange={event => setCleanupConfirm(event.target.value)} placeholder="CLEAN_EMPTY" />
            </label>
            <div className="dialog-actions">
              <button type="button" disabled={cleanupLoading} onClick={previewCleanup}>{cleanupLoading ? '检查中...' : '重新预览'}</button>
              <button className="danger-button" type="button" disabled={cleanupLoading || cleanupConfirm.trim() !== 'CLEAN_EMPTY'} onClick={commitCleanup}>
                {cleanupLoading ? '清理中...' : '确认清理'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkHelpOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="drawing-dialog cleanup-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              <div>
                <span>批量导入原图说明</span>
                <h3>从本地图纸文件夹导入到图纸资料库“原图”分类</h3>
              </div>
              <button type="button" aria-label="关闭批量导入说明" title="关闭" onClick={() => setBulkHelpOpen(false)}>×</button>
            </div>
            <p className="cleanup-note">推荐使用页面上的“批量导入原图”：选择本地图纸文件夹后先预览匹配、重复和未确认客户，输入确认码才会上传。命令行脚本仍保留为高级兜底工具。</p>
            <div className="cleanup-summary">
              <span>网页端先预览</span>
              <span>只导入原图</span>
              <span>确认码 IMPORT_ORIGINALS</span>
              <span>不删除 S3 文件</span>
            </div>
            <div className="cleanup-samples">
              <span>建议结构：图纸\客户简称\规格-品名.pdf</span>
              <span>未确认客户会停留在“请选择客户”，不会上传。</span>
              <span>重复文件按同一资料记录、原图分类、原文件名和大小识别。</span>
              <span>命令行兜底：npm run drawings:bulk-originals:dry -- --source “C:\Users\31175\Desktop\图纸”。</span>
            </div>
            <div className="dialog-actions">
              <button className="primary-button" type="button" onClick={() => setBulkHelpOpen(false)}>知道了</button>
            </div>
          </div>
        </div>
      )}

      <BulkOriginalDrawingImportModal
        open={bulkImportOpen}
        customers={customers}
        onClose={() => setBulkImportOpen(false)}
        onCompleted={loadData}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'item' ? '删除图纸资料？' : '删除资料文件？'}
        description={deleteTarget?.kind === 'item'
          ? `“${deleteTarget.item.specification}”将移入回收站，现有文件不会从对象存储物理删除。`
          : deleteTarget
            ? `“${safeDisplayFilename(deleteTarget.file)}”将被软删除，可通过数据恢复流程找回。`
            : ''}
        confirmLabel="确认删除"
        danger
        busy={deleting}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={() => { void confirmDelete(); }}
      />

      {msg && <div className="status-toast">{msg}</div>}
    </main>
  );
}
