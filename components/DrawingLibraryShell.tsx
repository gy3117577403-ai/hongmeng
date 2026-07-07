'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { PortalMenu } from '@/components/PortalMenu';
import { safeDisplayFilename } from '@/lib/filenames';
import type { CurrentUserDTO, DrawingLibraryCustomerDTO, DrawingLibraryFileDTO, DrawingLibraryItemDTO, ResourceCategoryDTO } from '@/types';

type DrawingLibraryForm = {
  customerName: string;
  productName: string;
  specification: string;
  remark: string;
};

type DrawingFilter = 'all' | 'missing_drawing' | 'missing_sop' | 'missing_product' | 'complete' | 'recent';
type DrawingModal = { mode: 'create' | 'edit'; item?: DrawingLibraryItemDTO } | null;
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
  ['missing_drawing', '缺原图'],
  ['missing_sop', '缺 SOP'],
  ['missing_product', '缺成品图'],
  ['complete', '资料完整'],
  ['recent', '最近更新'],
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

function missingLabel(item: DrawingLibraryItemDTO, categories: ResourceCategoryDTO[]) {
  if (item.fileCount === 0) return '空资料';
  if (item.isComplete) return '完整';
  const names = item.missingRequiredCategories
    .map(code => categories.find(category => category.code === code)?.name || code)
    .join('、');
  return names ? `缺 ${names}` : '缺资料';
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
  const [libOpen, setLibOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryMenuButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  const accountName = user.displayName || user.username;
  const visibleItems = useMemo(() => (
    customer === '全部客户' ? items : items.filter(item => item.customerName === customer)
  ), [customer, items]);
  const selectedItem = visibleItems.find(item => item.id === selectedId) || visibleItems[0] || null;
  const activeCategory = categories.find(category => category.id === activeCategoryId) || categories[0] || null;
  const activeFiles = selectedItem?.files.filter(file => file.categoryId === activeCategory?.id) || [];
  const selectedFile = activeFiles.find(file => file.id === selectedFileId) || activeFiles[0] || null;

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) setSelectedId(selectedItem.id);
  }, [selectedItem, selectedId]);

  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('itemId') || '';
    if (target && items.some(item => item.id === target)) setSelectedId(target);
  }, [items]);

  useEffect(() => {
    if (selectedFile && selectedFile.id !== selectedFileId) setSelectedFileId(selectedFile.id);
    if (!selectedFile) setSelectedFileId('');
  }, [selectedFile, selectedFileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadData(), 260);
    return () => window.clearTimeout(timer);
  }, [keyword, filter]);

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      params.set('filter', filter);
      const res = await fetch(`/api/drawing-library?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || '图纸资料库加载失败');
        return;
      }
      const nextItems: DrawingLibraryItemDTO[] = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      if (customer !== '全部客户' && !nextItems.some(item => item.customerName === customer)) setCustomer('全部客户');
      if (!nextItems.some(item => item.id === selectedId)) setSelectedId(nextItems[0]?.id || '');
    } catch {
      setMsg('图纸资料库加载失败，请检查网络');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
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

  async function deleteItem() {
    if (!selectedItem) return;
    if (!window.confirm(`确认删除图纸资料：${selectedItem.specification}？`)) return;
    const deletingId = selectedItem.id;
    const res = await fetch(`/api/drawing-library/${selectedItem.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(data.error || '删除失败');
    setSelectedId('');
    setMsg('图纸资料已删除，可在回收站恢复');
    await loadData();
    setItems(current => current.filter(item => item.id !== deletingId));
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

  async function deleteFile(file: DrawingLibraryFileDTO) {
    if (!window.confirm(`确认软删除文件：${safeDisplayFilename(file)}？`)) return;
    const res = await fetch(`/api/drawing-library/files/${file.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(data.error || '删除文件失败');
    setMsg('图纸资料文件已软删除');
    await loadData();
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
    <main className="drawing-library-page">
      <header className="topbar drawing-topbar">
        <button className="home-button" type="button" aria-label="首页" onClick={() => { location.href = '/dashboard'; }}>⌂</button>
        <div className="brand-block">
          <strong>图纸资料库</strong>
          <span>客户 · 规格 · 长期资料文件</span>
        </div>
        <div className="drawing-search">
          <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户 / 规格 / 品名 / 备注" />
          {keyword && <button type="button" onClick={() => setKeyword('')}>清空</button>}
          <b>⌕</b>
        </div>
        <div className="top-actions">
          <button className="log-button" type="button" onClick={() => openModal('create')}>新增图纸资料</button>
          <button className="log-button" type="button" onClick={() => { setCleanupOpen(true); if (!cleanupPreview) previewCleanup(); }}>清理空资料</button>
          <button className="log-button" type="button" title="批量导入原图说明" onClick={() => setBulkHelpOpen(true)}>导入说明</button>
          <div className="library-wrap">
            <button ref={libraryMenuButtonRef} className="library-button" type="button" onClick={() => setLibOpen(value => !value)}>▱ 资料库</button>
            <PortalMenu open={libOpen} anchorRef={libraryMenuButtonRef} className="library-menu" width={220}>
                <button type="button" onClick={() => { location.href = '/dashboard'; }}>▤ 生产工单</button>
                <button className="active" type="button">图纸资料库 ✓</button>
                <button type="button" onClick={() => { location.href = '/connector-parameters'; }}>连接器参数资料</button>
            </PortalMenu>
          </div>
          <div className="user-wrap">
            <button ref={userMenuButtonRef} className="user-button" type="button" onClick={() => setUserMenu(value => !value)}>
              <span>♙</span><b title={accountName}>{accountName}</b><em>⌄</em>
            </button>
            <PortalMenu open={userMenu} anchorRef={userMenuButtonRef} className="user-menu app-user-menu" width={176}>
                <button type="button" onClick={() => { location.href = '/dashboard'; }}>返回生产工单</button>
                <button type="button" onClick={logout}>退出登录</button>
            </PortalMenu>
          </div>
        </div>
      </header>

      <section className="drawing-filterbar">
        {filterOptions.map(([key, label]) => (
          <button key={key} className={filter === key ? 'active' : ''} type="button" onClick={() => setFilter(key)}>{label}</button>
        ))}
        <span>{loading ? '加载中...' : `共 ${items.length} 条规格`}</span>
      </section>

      <section className="drawing-workspace">
        <aside className="drawing-customers">
          <div className="drawing-panel-head">
            <strong>客户</strong>
            <span>{customers.length ? `${customers.length - 1} 个客户` : '暂无客户'}</span>
          </div>
          <div className="drawing-list">
            {customers.map(item => (
              <button
                key={`${item.customerName}-${item.customerCode || ''}`}
                className={customer === item.customerName ? 'drawing-customer active' : 'drawing-customer'}
                type="button"
                onClick={() => setCustomer(item.customerName)}
              >
                <strong>{item.customerName}</strong>
                {item.customerCode && <em>{item.customerCode}</em>}
                <span>{item.itemCount} 个规格 · 缺资料 {item.missingCount}</span>
              </button>
            ))}
            {!customers.length && <div className="drawing-empty-mini">暂无图纸资料客户</div>}
          </div>
        </aside>

        <aside className="drawing-specs">
          <div className="drawing-panel-head">
            <strong>产品规格</strong>
            <button type="button" onClick={() => openModal('create')}>新增</button>
          </div>
          <div className="drawing-list">
            {visibleItems.map(item => (
              <button key={item.id} className={selectedItem?.id === item.id ? 'drawing-spec-card active' : 'drawing-spec-card'} type="button" onClick={() => chooseItem(item)}>
                <div>
                  <strong title={item.specification}>{item.specification}</strong>
                  <span>{item.customerName} · {item.productName || '未设置品名'}</span>
                </div>
                <footer>
                  <em className={item.isComplete ? 'complete' : 'missing'}>{missingLabel(item, categories)}</em>
                  <span>{item.completenessText} · {item.fileCount} 个文件</span>
                  <span>{dt(item.updatedAt)}</span>
                </footer>
              </button>
            ))}
            {!visibleItems.length && <div className="drawing-empty-mini">没有匹配的图纸资料</div>}
          </div>
        </aside>

        <section className="drawing-detail">
          {!selectedItem ? (
            <div className="drawing-empty-state">
              <strong>暂无图纸资料</strong>
              <p>请手动新增客户和产品规格，或在生产工单上传图纸资料后自动建立长期资料记录。</p>
              <button type="button" onClick={() => openModal('create')}>新增图纸资料</button>
            </div>
          ) : (
            <>
              <div className="drawing-detail-head">
                <div>
                  <span>规格</span>
                  <h1 title={selectedItem.specification}>{selectedItem.specification}</h1>
                  <p>
                    <b>{selectedItem.customerName}</b>
                    {hasText(selectedItem.productName) && <em>{selectedItem.productName}</em>}
                    <small>资料 {selectedItem.completenessText}</small>
                    <small>{missingLabel(selectedItem, categories)}</small>
                    <small>更新 {dt(selectedItem.updatedAt)}</small>
                  </p>
                </div>
                <div className="drawing-head-actions">
                  <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : '上传文件'}</button>
                  <button type="button" onClick={() => openModal('edit', selectedItem)}>编辑</button>
                  <button className="danger-button subtle" type="button" onClick={deleteItem}>删除</button>
                </div>
              </div>

              <div className={activeFiles.length ? 'drawing-library-main' : 'drawing-library-main no-file-panel'}>
                <nav className="drawing-category-rail">
                  {categories.map(category => {
                    const count = selectedItem.categoryFileCounts[category.id] || 0;
                    const required = ['drawing', 'sop', 'product'].includes(category.code);
                    return (
                      <button key={category.id} className={activeCategoryId === category.id ? 'active' : ''} type="button" onClick={() => { setActiveCategoryId(category.id); setSelectedFileId(''); }}>
                        <span className={count ? 'dot filled' : required ? 'dot missing' : 'dot'} />
                        <strong>{category.name}</strong>
                        <em>{count} 个</em>
                      </button>
                    );
                  })}
                </nav>

                <div className="drawing-preview">
                  <div className="drawing-preview-head">
                    <strong>{activeCategory?.name || '资料预览'}</strong>
                    <span>{selectedFile ? safeDisplayFilename(selectedFile) : '当前分类暂无文件'}</span>
                    <input ref={fileInputRef} hidden multiple type="file" accept="application/pdf,.pdf,image/*" onChange={event => uploadFiles(event.target.files)} />
                  </div>

                  {!selectedFile ? (
                    <div className="drawing-missing-card">
                      <span />
                      <strong>当前分类暂无图纸资料</strong>
                      <p>这里仅管理长期图纸资料。周计划字段仍保留在生产工单里，不进入图纸资料库。</p>
                      <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>上传 PDF / 图片</button>
                    </div>
                  ) : selectedFile.fileType === 'pdf' ? (
                    <PdfViewer fileId={selectedFile.id} title={safeDisplayFilename(selectedFile)} contentUrl={selectedFile.contentUrl} viewUrl={selectedFile.viewUrl} downloadUrl={selectedFile.downloadUrl} />
                  ) : selectedFile.fileType === 'image' ? (
                    <ImageViewer fileId={selectedFile.id} title={safeDisplayFilename(selectedFile)} contentUrl={selectedFile.contentUrl} downloadUrl={selectedFile.downloadUrl} />
                  ) : (
                    <div className="drawing-file-fallback">
                      <strong>{safeDisplayFilename(selectedFile)}</strong>
                      <p>此文件类型暂不支持内嵌预览，可直接下载查看。</p>
                      <a href={selectedFile.downloadUrl} target="_blank" rel="noreferrer">下载文件</a>
                    </div>
                  )}
                </div>

                {activeFiles.length > 0 && <aside className="drawing-file-panel">
                  <strong>分类文件</strong>
                  <div className="drawing-files">
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
                      <a href={selectedFile.downloadUrl} target="_blank" rel="noreferrer">下载</a>
                      <button type="button" onClick={() => deleteFile(selectedFile)}>删除</button>
                    </div>
                  )}
                </aside>}
              </div>
            </>
          )}
        </section>
      </section>

      {modal && (
        <div className="modal-backdrop" role="presentation">
          <form className="drawing-dialog" onSubmit={saveItem}>
            <div className="dialog-title">
              <div>
                <span>{modal.mode === 'edit' ? '编辑长期图纸资料' : '新增长期图纸资料'}</span>
                <h3>{modal.mode === 'edit' ? modal.item?.specification : '客户 · 规格 · 品名'}</h3>
              </div>
              <button type="button" onClick={() => setModal(null)}>×</button>
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
              <button type="button" onClick={() => setCleanupOpen(false)}>×</button>
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
              <button type="button" onClick={() => setBulkHelpOpen(false)}>×</button>
            </div>
            <p className="cleanup-note">浏览器页面不能直接扫描本地任意文件夹。请在服务器或开发电脑命令行运行 dry-run 脚本，确认匹配报告后再执行正式上传。</p>
            <div className="cleanup-summary">
              <span>默认目录 C:\Users\31175\Desktop\图纸</span>
              <span>只导入原图</span>
              <span>默认 dry-run</span>
              <span>不删除 S3 文件</span>
            </div>
            <div className="cleanup-samples">
              <span>建议结构：图纸\客户简称\规格-品名.pdf</span>
              <span>先运行：npm run drawings:bulk-originals:dry -- --source “C:\Users\31175\Desktop\图纸”</span>
              <span>查看 reports/bulk-original-drawings 下的 matched / unmatched / duplicates 报告。</span>
              <span>正式执行必须设置 CONFIRM_BULK_ORIGINAL_UPLOAD=YES，并使用登录账号，不要把密码写入脚本或文档。</span>
            </div>
            <div className="dialog-actions">
              <button className="primary-button" type="button" onClick={() => setBulkHelpOpen(false)}>知道了</button>
            </div>
          </div>
        </div>
      )}

      {msg && <div className="status-toast">{msg}</div>}
    </main>
  );
}
