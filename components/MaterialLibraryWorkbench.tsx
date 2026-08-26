'use client';

import QRCode from 'qrcode';
import {
  AlertTriangle,
  Archive,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Download,
  Expand,
  Eye,
  FolderCog,
  Image as ImageIcon,
  Loader2,
  PackageOpen,
  Plus,
  QrCode,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  Smartphone,
  Trash2,
  Undo2,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  MaterialLibraryCaptureSessionDTO,
  MaterialLibraryCategoryDTO,
  MaterialLibraryItemDTO,
  MaterialLibraryPhotoDTO,
  MaterialLibrarySummaryDTO,
  MaterialLibraryUploadLinkDTO,
  MaterialLibraryUploadModeDTO,
  MaterialLibraryWarningStateDTO,
} from '@/lib/material-library-contract';
import type { CurrentUserDTO } from '@/types';

type Permissions = { create: boolean; update: boolean; delete: boolean; execute: boolean };
type ItemForm = {
  categoryId: string;
  code: string;
  name: string;
  manufacturerModel: string;
  specification: string;
  materialComposition: string;
  supplierName: string;
  supplierPartNumber: string;
  batchNumber: string;
  warningState: MaterialLibraryWarningStateDTO;
  warningNote: string;
  notes: string;
};

const emptySummary: MaterialLibrarySummaryDTO = { active: 0, incomplete: 0, warnings: 0, recycled: 0 };
const emptyPermissions: Permissions = { create: false, update: false, delete: false, execute: false };
const emptyForm: ItemForm = {
  categoryId: '', code: '', name: '', manufacturerModel: '', specification: '', materialComposition: '', supplierName: '', supplierPartNumber: '', batchNumber: '', warningState: 'NONE', warningNote: '', notes: '',
};

function formFromItem(item: MaterialLibraryItemDTO): ItemForm {
  return {
    categoryId: item.categoryId,
    code: item.code,
    name: item.name,
    manufacturerModel: item.manufacturerModel || '',
    specification: item.specification || '',
    materialComposition: item.materialComposition || '',
    supplierName: item.supplierName || '',
    supplierPartNumber: item.supplierPartNumber || '',
    batchNumber: item.batchNumber || '',
    warningState: item.warningState,
    warningNote: item.warningNote || '',
    notes: item.notes || '',
  };
}

function formFromSession(session: MaterialLibraryCaptureSessionDTO): ItemForm {
  return {
    categoryId: session.categoryId,
    code: session.item.code,
    name: session.item.name,
    manufacturerModel: session.draftManufacturerModel || '',
    specification: session.draftSpecification || '',
    materialComposition: session.draftMaterialComposition || '',
    supplierName: session.draftSupplierName || '',
    supplierPartNumber: session.draftSupplierPartNumber || '',
    batchNumber: session.draftBatchNumber || '',
    warningState: session.draftWarningState,
    warningNote: session.draftWarningNote || '',
    notes: session.draftNotes || '',
  };
}

function formatTime(value: string | null, includeDate = false) {
  if (!value) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', includeDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}

function warningLabel(value: MaterialLibraryWarningStateDTO) {
  if (value === 'DEFECT') return '不良品警示';
  if (value === 'ATTENTION') return '重点关注';
  return '状态正常';
}

async function jsonBody(response: Response): Promise<Record<string, any>> {
  return response.json().catch(() => ({})) as Promise<Record<string, any>>;
}

function MaterialImage({ photo, className = '', priority = false }: { photo: MaterialLibraryPhotoDTO; className?: string; priority?: boolean }) {
  return <Image
    unoptimized
    priority={priority}
    className={className}
    width={photo.width || 960}
    height={photo.height || 720}
    src={photo.contentUrl}
    alt={photo.caption || photo.originalName}
    style={{ transform: `rotate(${photo.rotation}deg)` }}
  />;
}

export default function MaterialLibraryWorkbench({ user, initialSessionId }: { user: CurrentUserDTO; initialSessionId: string }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [categories, setCategories] = useState<MaterialLibraryCategoryDTO[]>([]);
  const [items, setItems] = useState<MaterialLibraryItemDTO[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [permissions, setPermissions] = useState(emptyPermissions);
  const [categoryId, setCategoryId] = useState('');
  const [stateFilter, setStateFilter] = useState<'active' | 'deleted'>('active');
  const [warningFilter, setWarningFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [itemForm, setItemForm] = useState<ItemForm>(emptyForm);
  const [savingItem, setSavingItem] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMode, setQrMode] = useState<MaterialLibraryUploadModeDTO>('TEMPORARY');
  const [qrMinutes, setQrMinutes] = useState(30);
  const [qrLink, setQrLink] = useState<MaterialLibraryUploadLinkDTO | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [generatingQr, setGeneratingQr] = useState(false);
  const [session, setSession] = useState<MaterialLibraryCaptureSessionDTO | null>(null);
  const [sessionForm, setSessionForm] = useState<ItemForm>(emptyForm);
  const [sessionDirty, setSessionDirty] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [activePhotoId, setActivePhotoId] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedItem = useMemo(() => items.find(item => item.id === selectedId) || items[0] || null, [items, selectedId]);
  const activePhoto = useMemo(() => {
    if (!session) return null;
    return session.photos.find(photo => photo.id === activePhotoId) || session.photos[0] || null;
  }, [activePhotoId, session]);

  const loadCategories = useCallback(async () => {
    const response = await fetch('/api/material-library/categories', { cache: 'no-store' });
    const body = await jsonBody(response);
    if (!response.ok) throw new Error(body.error || '物料分类加载失败');
    setCategories(Array.isArray(body.categories) ? body.categories : []);
  }, []);

  const loadItems = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ state: stateFilter });
      if (keyword) query.set('keyword', keyword);
      if (categoryId) query.set('categoryId', categoryId);
      if (warningFilter) query.set('warning', warningFilter);
      const response = await fetch(`/api/material-library/items?${query}`, { cache: 'no-store' });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '物料库加载失败');
      const nextItems = Array.isArray(body.items) ? body.items as MaterialLibraryItemDTO[] : [];
      setItems(nextItems);
      setSummary(body.summary || emptySummary);
      setPermissions(body.permissions || emptyPermissions);
      setSelectedId(current => nextItems.some(item => item.id === current) ? current : nextItems[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '物料库加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [categoryId, keyword, stateFilter, warningFilter]);

  const loadSession = useCallback(async (id: string, quiet = false) => {
    try {
      const response = await fetch(`/api/material-library/sessions/${id}`, { cache: 'no-store' });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '实时录入会话加载失败');
      const next = body.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      setSelectedId(next.materialItemId);
      setActivePhotoId(current => next.photos.some(photo => photo.id === current) ? current : next.photos[0]?.id || '');
      setSessionForm(current => sessionDirty ? current : formFromSession(next));
      if (!quiet) setMessage(next.status === 'ACTIVE' ? '已进入手机拍照实时接收会话' : '已打开历史录入会话');
      return next;
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : '实时录入会话加载失败');
      return null;
    }
  }, [sessionDirty]);

  useEffect(() => {
    void Promise.all([loadCategories(), loadItems()]);
  }, [loadCategories, loadItems]);

  useEffect(() => {
    if (initialSessionId) void loadSession(initialSessionId);
  }, [initialSessionId, loadSession]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 3600);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') return undefined;
    const timer = window.setInterval(() => { void loadSession(session.id, true); }, 1600);
    return () => window.clearInterval(timer);
  }, [loadSession, session]);

  useEffect(() => {
    if (!qrOpen || !qrLink) return undefined;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/material-library/upload-links/${qrLink.id}`, { cache: 'no-store' });
      const body = await jsonBody(response);
      if (!response.ok) return;
      const next = body.link as MaterialLibraryUploadLinkDTO;
      setQrLink(next);
      if (next.latestSession?.status === 'ACTIVE') {
        setQrOpen(false);
        setSessionDirty(false);
        setSession(next.latestSession);
        setSessionForm(formFromSession(next.latestSession));
        setActivePhotoId(next.latestSession.photos[0]?.id || '');
        window.history.replaceState(null, '', `/workspace/material-library?sessionId=${encodeURIComponent(next.latestSession.id)}`);
        setMessage('手机已连接，照片将逐张实时出现在工作台');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [qrLink, qrOpen]);

  function openCreate() {
    setFormMode('create');
    setItemForm({ ...emptyForm, categoryId: categoryId || categories[0]?.id || '' });
    setFormOpen(true);
  }

  function openEdit() {
    if (!selectedItem) return;
    setFormMode('edit');
    setItemForm(formFromItem(selectedItem));
    setFormOpen(true);
  }

  async function saveItem() {
    setSavingItem(true);
    try {
      const editing = formMode === 'edit' && selectedItem;
      const response = await fetch(editing ? `/api/material-library/items/${editing.id}` : '/api/material-library/items', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...itemForm, ...(editing ? { expectedVersion: editing.version } : {}) }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '物料档案保存失败');
      setFormOpen(false);
      setSelectedId(body.item.id);
      await Promise.all([loadItems(true), loadCategories()]);
      setMessage(editing ? '物料档案已更新' : '物料档案已建立，可以生成二维码拍照录入');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '物料档案保存失败');
    } finally {
      setSavingItem(false);
    }
  }

  async function deleteItem() {
    if (!selectedItem || !window.confirm(`将“${selectedItem.code} · ${selectedItem.name}”移入回收站？照片原文件保留在对象存储中，可恢复。`)) return;
    const reason = window.prompt('请填写移入回收站原因（必填）', '重复档案');
    if (!reason?.trim()) return setMessage('移入回收站前必须填写原因');
    const response = await fetch(`/api/material-library/items/${selectedItem.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: selectedItem.version, reason: reason.trim() }),
    });
    const body = await jsonBody(response);
    if (!response.ok) return setMessage(body.error || '移入回收站失败');
    await Promise.all([loadItems(true), loadCategories()]);
    setMessage('物料档案已移入回收站，照片对象仍保留');
  }

  async function restoreItem() {
    if (!selectedItem) return;
    const response = await fetch(`/api/material-library/items/${selectedItem.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: selectedItem.version }),
    });
    const body = await jsonBody(response);
    if (!response.ok) return setMessage(body.error || '恢复失败');
    await Promise.all([loadItems(true), loadCategories()]);
    setMessage('物料档案已恢复');
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const response = await fetch('/api/material-library/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCategoryName }),
    });
    const body = await jsonBody(response);
    if (!response.ok) return setMessage(body.error || '分类创建失败');
    setNewCategoryName('');
    await loadCategories();
    setMessage('自定义分类已创建');
  }

  async function removeCategory(category: MaterialLibraryCategoryDTO) {
    if (!window.confirm(`删除分类“${category.name}”？仅空的自定义分类可删除。`)) return;
    const response = await fetch(`/api/material-library/categories/${category.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: category.version }),
    });
    const body = await jsonBody(response);
    if (!response.ok) return setMessage(body.error || '分类删除失败');
    await loadCategories();
    setMessage('分类已移入回收状态');
  }

  async function createQr() {
    if (!selectedItem) return;
    setGeneratingQr(true);
    try {
      const response = await fetch('/api/material-library/upload-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ materialItemId: selectedItem.id, mode: qrMode, expiresInMinutes: qrMinutes }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '二维码生成失败');
      const link = body.link as MaterialLibraryUploadLinkDTO;
      const absolute = `${window.location.origin}${link.capturePath}`;
      setQrLink(link);
      setQrUrl(absolute);
      setQrDataUrl(await QRCode.toDataURL(absolute, { margin: 1, width: 320, color: { dark: '#14283f', light: '#ffffff' } }));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '二维码生成失败');
    } finally {
      setGeneratingQr(false);
    }
  }

  function openQr() {
    if (!selectedItem) return;
    setQrLink(null);
    setQrDataUrl('');
    setQrUrl('');
    setQrOpen(true);
  }

  async function revokeQr() {
    if (!qrLink || !window.confirm('撤销当前二维码？正在进行的录入会话也会取消。')) return;
    const response = await fetch(`/api/material-library/upload-links/${qrLink.id}`, { method: 'DELETE' });
    const body = await jsonBody(response);
    if (!response.ok) return setMessage(body.error || '二维码撤销失败');
    setQrLink(null);
    setQrDataUrl('');
    setQrUrl('');
    setMessage('二维码已撤销');
  }

  function updateSessionForm<K extends keyof ItemForm>(key: K, value: ItemForm[K]) {
    setSessionForm(current => ({ ...current, [key]: value }));
    setSessionDirty(true);
  }

  async function saveSessionDraft(showMessage = true): Promise<MaterialLibraryCaptureSessionDTO | null> {
    if (!session || session.status !== 'ACTIVE') return session;
    if (!sessionDirty) return session;
    setSavingSession(true);
    try {
      const response = await fetch(`/api/material-library/sessions/${session.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sessionForm, expectedVersion: session.version }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '录入数据保存失败');
      const next = body.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      setSessionForm(formFromSession(next));
      setSessionDirty(false);
      if (showMessage) setMessage('录入数据已保存');
      return next;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '录入数据保存失败');
      return null;
    } finally {
      setSavingSession(false);
    }
  }

  async function completeSession() {
    if (!session || !permissions.execute) return;
    const saved = await saveSessionDraft(false);
    if (!saved) return;
    if (!window.confirm(`确认归档 ${saved.photos.length} 张照片和本次录入数据？归档后品质人员不可删除照片。`)) return;
    setSavingSession(true);
    try {
      const response = await fetch(`/api/material-library/sessions/${saved.id}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: saved.version }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '归档失败');
      setSession(body.session as MaterialLibraryCaptureSessionDTO);
      setMessage('本次来料拍照记录已确认归档并同步到物料档案');
      await Promise.all([loadItems(true), loadCategories()]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '归档失败');
    } finally {
      setSavingSession(false);
    }
  }

  async function closeSession() {
    if (!session) return;
    if (session.status === 'ACTIVE' && !window.confirm('退出实时会话？手机仍可继续上传，稍后可从二维码状态重新进入。')) return;
    setSession(null);
    setSessionDirty(false);
    window.history.replaceState(null, '', '/workspace/material-library');
      await Promise.all([loadItems(true), loadCategories()]);
  }

  async function uploadDesktopPhoto(file: File) {
    if (!session) return;
    setPhotoBusy(true);
    try {
      const data = new FormData();
      data.set('file', file);
      data.set('captureSource', 'DESKTOP_UPLOAD');
      const response = await fetch(`/api/material-library/sessions/${session.id}/photos`, { method: 'POST', body: data });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '照片上传失败');
      setSession(body.session as MaterialLibraryCaptureSessionDTO);
      setActivePhotoId(body.session.photos.at(-1)?.id || '');
      setMessage('照片已上传到对象存储');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片上传失败');
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function updatePhoto(photo: MaterialLibraryPhotoDTO, patch: Record<string, unknown>) {
    setPhotoBusy(true);
    try {
      const response = await fetch(`/api/material-library/photos/${photo.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '照片更新失败');
      if (body.session) setSession(body.session as MaterialLibraryCaptureSessionDTO);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片更新失败');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function deletePhoto(photo: MaterialLibraryPhotoDTO) {
    if (!window.confirm('移除这张照片？原文件会按软删除规则保留在对象存储中。')) return;
    setPhotoBusy(true);
    try {
      const response = await fetch(`/api/material-library/photos/${photo.id}`, { method: 'DELETE' });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(body.error || '照片移除失败');
      if (body.session) setSession(body.session as MaterialLibraryCaptureSessionDTO);
      setActivePhotoId('');
      setMessage('照片已移除，原文件仍在对象存储中');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片移除失败');
    } finally {
      setPhotoBusy(false);
    }
  }

  return <main className="hm-workbench-root hm-cockpit-root material-library-shell">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/material-library"
      subtitle="来料照片、型号规格与不良警示档案"
      menuItems={[]}
      hideHeader
      sidebarTriggerTargetId="material-library-navigation-trigger"
      sidebarExpanded={sidebarExpanded}
      onSidebarExpandedChange={setSidebarExpanded}
    />

    <div className="material-library-frame">
      <header className={`material-library-command${session ? ' session-command' : ''}`}>
        <div id="material-library-navigation-trigger" />
        <span className="material-command-icon"><PackageOpen size={21} /></span>
        <div className="material-command-title"><strong>{session ? '手机拍照录入' : '物料库'}</strong><small>{session ? `${session.item.code} · ${session.item.name}` : '来料实拍、规格留库与不良状态预警'}</small></div>
        {session ? <div className="material-session-steps" aria-label="录入进度">
          <span className="done"><b><Check size={12} /></b>选择物料</span><i />
          <span className="done"><b><Check size={12} /></b>手机连接</span><i />
          <span className={session.photos.length ? 'done' : 'active'}><b>{session.photos.length ? <Check size={12} /> : 3}</b>拍照上传</span><i />
          <span className={session.status === 'COMPLETED' ? 'done' : 'active'}><b>{session.status === 'COMPLETED' ? <Check size={12} /> : 4}</b>确认归档</span>
        </div> : <form className="material-command-search" onSubmit={event => { event.preventDefault(); setKeyword(searchValue.trim()); }}>
          <Search size={17} /><input aria-label="搜索物料" value={searchValue} onChange={event => setSearchValue(event.target.value)} placeholder="搜索物料编码、名称、型号、规格、供应商或批次" /><kbd>Enter</kbd>
        </form>}
        <div className="material-command-actions">
          {session ? <button type="button" className="ghost" onClick={() => void closeSession()}><ChevronLeft size={16} />返回物料库</button> : <>
            <button type="button" className="icon-only" aria-label="刷新物料库" title="刷新" onClick={() => { void Promise.all([loadCategories(), loadItems()]); }}><RefreshCw className={loading ? 'spin' : ''} size={17} /></button>
            {permissions.create && <button type="button" className="primary" onClick={openCreate}><Plus size={17} />新建物料</button>}
          </>}
        </div>
      </header>

      {session ? <section className="material-capture-workspace">
        <aside className="material-capture-status">
          <header><span><Smartphone size={17} /></span><div><strong>拍照会话</strong><small>{session.uploadMode === 'PERMANENT' ? '永久二维码' : '临时二维码'}</small></div><em className={session.status.toLowerCase()}>{session.status === 'ACTIVE' ? '进行中' : session.status === 'COMPLETED' ? '已归档' : '已取消'}</em></header>
          <div className="capture-connected"><span><Wifi size={18} /></span><div><strong>{session.connectedByName || '等待手机连接'}</strong><small>{session.lastSeenAt ? `最近连接 ${formatTime(session.lastSeenAt)}` : '扫码后显示连接状态'}</small></div></div>
          <dl className="capture-meta">
            <div><dt>会话编号</dt><dd>{session.sessionNo}</dd></div>
            <div><dt>物料编码</dt><dd>{session.item.code}</dd></div>
            <div><dt>物料名称</dt><dd>{session.item.name}</dd></div>
            <div><dt>已接收照片</dt><dd><b>{session.photos.length}</b> 张</dd></div>
          </dl>
          <div className="capture-activity">
            <h3>实时动态 <span>Live</span></h3>
            {session.photos.slice().reverse().slice(0, 4).map(photo => <div key={photo.id}><CircleDot size={13} /><span><b>收到照片</b><small>{photo.originalName} · {formatTime(photo.createdAt)}</small></span></div>)}
            {!session.photos.length && <p>手机拍照后，照片会逐张出现在这里。</p>}
          </div>
          <div className="capture-storage-note"><ShieldAlert size={16} /><span><strong>原图安全存储</strong><small>照片直接写入 S3 兼容对象存储，应用容器不永久保存文件。</small></span></div>
        </aside>

        <section className="material-capture-media">
          <header><div><span>实时照片</span><strong>{session.photos.length} 张</strong></div><div><input ref={fileInputRef} type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadDesktopPhoto(file); }} />{session.status === 'ACTIVE' && <button type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} />电脑补传</button>}</div></header>
          <div className="capture-photo-grid">
            {session.photos.slice(0, 4).map((photo, index) => <button type="button" className={activePhoto?.id === photo.id ? 'active' : ''} key={photo.id} onClick={() => setActivePhotoId(photo.id)}><MaterialImage photo={photo} priority={index === 0} /><span>{photo.isCover ? '封面' : `照片 ${index + 1}`}</span><small>{formatTime(photo.createdAt)}</small></button>)}
            {Array.from({ length: Math.max(0, 4 - session.photos.length) }, (_, index) => <div className="capture-photo-placeholder" key={`placeholder-${index}`}><Camera size={20} /><span>等待照片</span></div>)}
          </div>
          <div className="capture-preview" ref={previewRef}>
            {activePhoto ? <>
              <MaterialImage photo={activePhoto} />
              <div className="capture-preview-toolbar">
                <button type="button" disabled={photoBusy} title="顺时针旋转" onClick={() => void updatePhoto(activePhoto, { rotation: (activePhoto.rotation + 90) % 360 })}><RotateCw size={16} /></button>
                <button type="button" title="全屏预览" onClick={() => void previewRef.current?.requestFullscreen()}><Expand size={16} /></button>
                <a href={activePhoto.contentUrl} download={activePhoto.originalName} title="下载原图"><Download size={16} /></a>
                {!activePhoto.isCover && <button type="button" disabled={photoBusy} title="设为封面" onClick={() => void updatePhoto(activePhoto, { isCover: true })}><ImageIcon size={16} /></button>}
                <button className="danger" type="button" disabled={photoBusy || (session.status !== 'ACTIVE' && !permissions.delete)} title="移除照片" onClick={() => void deletePhoto(activePhoto)}><Trash2 size={16} /></button>
              </div>
            </> : <div className="capture-preview-empty"><Camera size={32} /><strong>等待手机拍照</strong><span>扫码后选择“拍照”，照片会自动上传并在此处预览。</span></div>}
          </div>
          <footer><span><Wifi size={15} />{session.status === 'ACTIVE' ? '每 1.6 秒同步一次手机端照片' : '该会话已结束'}</span><small>上传失败不会生成档案记录，可在手机端重试</small></footer>
        </section>

        <aside className="material-capture-form">
          <header><div><span>录入物料数据</span><strong>来料检验记录</strong></div><em>{sessionDirty ? '有未保存修改' : '已同步'}</em></header>
          <div className="capture-form-scroll">
            <label><span>物料分类</span><select disabled={session.status !== 'ACTIVE'} value={sessionForm.categoryId} onChange={event => updateSessionForm('categoryId', event.target.value)}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <div className="capture-form-two"><label><span>物料编码</span><input value={sessionForm.code} disabled /></label><label><span>物料名称</span><input value={sessionForm.name} disabled /></label></div>
            <label><span>厂家型号</span><input disabled={session.status !== 'ACTIVE'} value={sessionForm.manufacturerModel} onChange={event => updateSessionForm('manufacturerModel', event.target.value)} placeholder="例如：JST-SXH-001T-P0.6" /></label>
            <label><span>规格 / 关键尺寸</span><input disabled={session.status !== 'ACTIVE'} value={sessionForm.specification} onChange={event => updateSessionForm('specification', event.target.value)} placeholder="型号、线径、颜色、尺寸等" /></label>
            <label><span>材料 / 表面状态</span><input disabled={session.status !== 'ACTIVE'} value={sessionForm.materialComposition} onChange={event => updateSessionForm('materialComposition', event.target.value)} placeholder="材质、镀层、颜色或外观状态" /></label>
            <div className="capture-form-two"><label><span>供应商</span><input disabled={session.status !== 'ACTIVE'} value={sessionForm.supplierName} onChange={event => updateSessionForm('supplierName', event.target.value)} /></label><label><span>供应商料号</span><input disabled={session.status !== 'ACTIVE'} value={sessionForm.supplierPartNumber} onChange={event => updateSessionForm('supplierPartNumber', event.target.value)} /></label></div>
            <label><span>来料批次</span><input disabled={session.status !== 'ACTIVE'} value={sessionForm.batchNumber} onChange={event => updateSessionForm('batchNumber', event.target.value)} placeholder="选填，用于追溯本次来料" /></label>
            <fieldset><legend>质量状态</legend><div className="capture-warning-options">{(['NONE', 'ATTENTION', 'DEFECT'] as MaterialLibraryWarningStateDTO[]).map(value => <button className={`${value.toLowerCase()} ${sessionForm.warningState === value ? 'active' : ''}`} type="button" disabled={session.status !== 'ACTIVE'} key={value} onClick={() => updateSessionForm('warningState', value)}><i />{warningLabel(value)}</button>)}</div></fieldset>
            {sessionForm.warningState !== 'NONE' && <label className="warning-note"><span>警示说明 <b>必填</b></span><textarea disabled={session.status !== 'ACTIVE'} value={sessionForm.warningNote} onChange={event => updateSessionForm('warningNote', event.target.value)} placeholder="说明不良表现、差异和使用风险" /></label>}
            <label><span>检验备注</span><textarea disabled={session.status !== 'ACTIVE'} value={sessionForm.notes} onChange={event => updateSessionForm('notes', event.target.value)} placeholder="补充测量数据、包装状态或核对结论" /></label>
          </div>
          <footer>
            {session.status === 'ACTIVE' ? <><button type="button" className="secondary" disabled={savingSession || !sessionDirty} onClick={() => void saveSessionDraft()}>{savingSession ? <Loader2 className="spin" size={16} /> : <Save size={16} />}保存数据</button><button type="button" className="primary" disabled={savingSession || !permissions.execute} onClick={() => void completeSession()}><Archive size={16} />确认归档</button></> : <button type="button" className="primary wide" onClick={() => void closeSession()}><CheckCircle2 size={16} />返回物料档案</button>}
          </footer>
        </aside>
      </section> : <section className="material-library-workspace">
        <aside className="material-library-filters">
          <header><span><FolderCog size={16} />物料分类</span>{permissions.create && <button type="button" title="管理分类" onClick={() => setCategoryManagerOpen(true)}><FolderCog size={15} /></button>}</header>
          <button className={!categoryId ? 'active' : ''} type="button" onClick={() => setCategoryId('')}><span><PackageOpen size={16} />全部物料</span><b>{summary.active}</b></button>
          {categories.map(category => <button className={categoryId === category.id ? 'active' : ''} type="button" key={category.id} onClick={() => setCategoryId(category.id)}><span><span className="category-orb" />{category.name}</span><b>{category.itemCount}</b></button>)}
          <h3>快速筛选</h3>
          <button className={warningFilter === 'ANY' ? 'active warning' : ''} type="button" onClick={() => setWarningFilter(current => current === 'ANY' ? '' : 'ANY')}><span><AlertTriangle size={16} />有质量警示</span><b>{summary.warnings}</b></button>
          <button className={stateFilter === 'deleted' ? 'active' : ''} type="button" onClick={() => setStateFilter(current => current === 'deleted' ? 'active' : 'deleted')}><span><Trash2 size={16} />回收站</span><b>{summary.recycled}</b></button>
          <div className="material-filter-rule"><ShieldAlert size={16} /><span><strong>留库原则</strong><small>相同名称不代表相同型号；以照片、规格和批次共同核对。</small></span></div>
        </aside>

        <section className="material-library-list">
          <header><div><span>{stateFilter === 'deleted' ? '回收站' : categoryId ? categories.find(category => category.id === categoryId)?.name : '全部物料'}</span><strong>{items.length} 条</strong></div><small>{keyword ? `搜索“${keyword}”` : '最近更新优先'}</small></header>
          <div className="material-list-scroll">
            {items.map((item, index) => <button type="button" className={`${selectedItem?.id === item.id ? 'active' : ''} warning-${item.warningState.toLowerCase()}`} key={item.id} onClick={() => setSelectedId(item.id)}>
              <span className="material-card-photo">{item.coverPhoto ? <MaterialImage photo={item.coverPhoto} priority={index < 2} /> : <ImageIcon size={22} />}</span>
              <span className="material-card-copy"><strong>{item.code}</strong><b>{item.name}</b><small>{item.manufacturerModel || item.specification || '尚未录入型号规格'}</small><em>{item.category.name} · {item.photoCount} 张照片</em></span>
              {item.warningState !== 'NONE' && <span className="material-card-warning"><AlertTriangle size={12} />{warningLabel(item.warningState)}</span>}
              <ChevronRight size={15} />
            </button>)}
            {!loading && !items.length && <div className="material-list-empty"><PackageOpen size={30} /><strong>{stateFilter === 'deleted' ? '回收站为空' : '当前条件下没有物料'}</strong><span>新建物料后即可生成二维码，让品质人员用手机拍照留库。</span>{permissions.create && stateFilter !== 'deleted' && <button type="button" onClick={openCreate}><Plus size={15} />新建物料</button>}</div>}
            {loading && <div className="material-list-loading"><Loader2 className="spin" /><span>正在加载物料档案…</span></div>}
          </div>
        </section>

        <section className="material-library-preview">
          {selectedItem ? <>
            <header><div><span>{selectedItem.category.name}</span><strong>{selectedItem.code}</strong><small>{selectedItem.name}</small></div><div className="material-preview-actions">{stateFilter === 'active' ? <><button type="button" className="qr" onClick={openQr}><QrCode size={16} />手机拍照</button>{permissions.update && <button type="button" onClick={openEdit}><Save size={15} />编辑</button>}{permissions.delete && <button type="button" className="danger" onClick={() => void deleteItem()}><Trash2 size={15} /></button>}</> : permissions.update && <button type="button" className="restore" onClick={() => void restoreItem()}><Undo2 size={15} />恢复</button>}</div></header>
            {selectedItem.warningState !== 'NONE' && <div className={`material-preview-warning ${selectedItem.warningState.toLowerCase()}`}><AlertTriangle size={19} /><span><strong>{warningLabel(selectedItem.warningState)}</strong><small>{selectedItem.warningNote}</small></span></div>}
            <div className="material-preview-body">
              <div className="material-preview-gallery">
                <div className="material-preview-main-photo">{selectedItem.coverPhoto ? <MaterialImage photo={selectedItem.coverPhoto} priority /> : <div><ImageIcon size={34} /><strong>尚无来料实拍</strong><span>生成二维码后可用手机实时拍照上传</span></div>}</div>
                <div className="material-preview-thumbs">{selectedItem.photos.slice(0, 5).map(photo => <a href={photo.contentUrl} target="_blank" rel="noreferrer" key={photo.id}><MaterialImage photo={photo} /></a>)}{!selectedItem.photos.length && <span>照片将在归档后形成可追溯图库</span>}</div>
              </div>
              <div className="material-preview-data">
                <h3>物料数据 <span>{selectedItem.dataComplete ? '照片已留库' : '待拍照'}</span></h3>
                <dl>
                  <div><dt>厂家型号</dt><dd>{selectedItem.manufacturerModel || '—'}</dd></div>
                  <div><dt>规格 / 关键尺寸</dt><dd>{selectedItem.specification || '—'}</dd></div>
                  <div><dt>材料 / 表面状态</dt><dd>{selectedItem.materialComposition || '—'}</dd></div>
                  <div><dt>供应商</dt><dd>{selectedItem.supplierName || '—'}</dd></div>
                  <div><dt>供应商料号</dt><dd>{selectedItem.supplierPartNumber || '—'}</dd></div>
                  <div><dt>最近批次</dt><dd>{selectedItem.batchNumber || '—'}</dd></div>
                </dl>
                <div className="material-preview-notes"><span>检验备注</span><p>{selectedItem.notes || '暂无补充说明'}</p></div>
                <footer><span><Clock3 size={14} />最近拍照 {formatTime(selectedItem.lastCapturedAt, true)}</span><span><Eye size={14} />{selectedItem.photoCount} 张实拍证据</span></footer>
              </div>
            </div>
          </> : <div className="material-preview-empty"><PackageOpen size={38} /><strong>选择一条物料档案</strong><span>右侧将显示来料照片、型号规格、供应商与不良品警示。</span></div>}
        </section>
      </section>}
    </div>

    {formOpen && <div className="material-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFormOpen(false); }}><section className="material-modal material-item-modal" role="dialog" aria-modal="true" aria-label={formMode === 'create' ? '新建物料档案' : '编辑物料档案'}>
      <header><div><span><PackageOpen size={18} /></span><div><strong>{formMode === 'create' ? '新建物料档案' : '编辑物料档案'}</strong><small>先建立识别主档，再用手机扫码拍照补全来料证据</small></div></div><button type="button" onClick={() => setFormOpen(false)}><X size={18} /></button></header>
      <div className="material-modal-form">
        <div className="two"><label><span>物料分类 *</span><select value={itemForm.categoryId} onChange={event => setItemForm(current => ({ ...current, categoryId: event.target.value }))}><option value="">请选择分类</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>物料编码 *</span><input value={itemForm.code} onChange={event => setItemForm(current => ({ ...current, code: event.target.value }))} placeholder="例如 T-000483" /></label></div>
        <label><span>物料名称 *</span><input value={itemForm.name} onChange={event => setItemForm(current => ({ ...current, name: event.target.value }))} placeholder="用于检索，不作为唯一识别依据" /></label>
        <div className="two"><label><span>厂家型号</span><input value={itemForm.manufacturerModel} onChange={event => setItemForm(current => ({ ...current, manufacturerModel: event.target.value }))} /></label><label><span>规格 / 关键尺寸</span><input value={itemForm.specification} onChange={event => setItemForm(current => ({ ...current, specification: event.target.value }))} /></label></div>
        <label><span>材料 / 表面状态</span><input value={itemForm.materialComposition} onChange={event => setItemForm(current => ({ ...current, materialComposition: event.target.value }))} /></label>
        <div className="two"><label><span>供应商</span><input value={itemForm.supplierName} onChange={event => setItemForm(current => ({ ...current, supplierName: event.target.value }))} /></label><label><span>供应商料号</span><input value={itemForm.supplierPartNumber} onChange={event => setItemForm(current => ({ ...current, supplierPartNumber: event.target.value }))} /></label></div>
        <label><span>来料批次</span><input value={itemForm.batchNumber} onChange={event => setItemForm(current => ({ ...current, batchNumber: event.target.value }))} /></label>
        <label><span>检验备注</span><textarea value={itemForm.notes} onChange={event => setItemForm(current => ({ ...current, notes: event.target.value }))} /></label>
      </div>
      <footer><button type="button" onClick={() => setFormOpen(false)}>取消</button><button className="primary" type="button" disabled={savingItem || !itemForm.categoryId || !itemForm.code.trim() || !itemForm.name.trim()} onClick={() => void saveItem()}>{savingItem ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{formMode === 'create' ? '建立档案' : '保存修改'}</button></footer>
    </section></div>}

    {categoryManagerOpen && <div className="material-modal-backdrop"><section className="material-modal category-modal" role="dialog" aria-modal="true" aria-label="物料分类管理">
      <header><div><span><FolderCog size={18} /></span><div><strong>物料分类管理</strong><small>系统分类保留，可新增或删除空的自定义分类</small></div></div><button type="button" onClick={() => setCategoryManagerOpen(false)}><X size={18} /></button></header>
      <div className="category-create"><input value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} placeholder="输入新分类名称" /><button type="button" disabled={!newCategoryName.trim()} onClick={() => void addCategory()}><Plus size={15} />新增</button></div>
      <div className="category-list">{categories.map(category => <div key={category.id}><span className="category-orb" /><strong>{category.name}</strong><small>{category.itemCount} 个物料</small>{category.isSystem ? <em>系统</em> : <button type="button" disabled={category.itemCount > 0 || !permissions.delete} onClick={() => void removeCategory(category)}><Trash2 size={14} /></button>}</div>)}</div>
    </section></div>}

    {qrOpen && selectedItem && <div className="material-modal-backdrop"><section className="material-modal qr-modal" role="dialog" aria-modal="true" aria-label="手机拍照二维码">
      <header><div><span><QrCode size={18} /></span><div><strong>手机扫码拍照</strong><small>{selectedItem.code} · {selectedItem.name}</small></div></div><button type="button" aria-label="关闭二维码弹窗" onClick={() => setQrOpen(false)}><X size={18} /></button></header>
      <div className="qr-mode-switch"><button className={qrMode === 'TEMPORARY' ? 'active' : ''} type="button" onClick={() => { setQrMode('TEMPORARY'); setQrLink(null); setQrDataUrl(''); setQrUrl(''); }}><Clock3 size={16} /><span><strong>临时二维码</strong><small>一次录入，过期失效</small></span></button><button className={qrMode === 'PERMANENT' ? 'active' : ''} type="button" onClick={() => { setQrMode('PERMANENT'); setQrLink(null); setQrDataUrl(''); setQrUrl(''); }}><QrCode size={16} /><span><strong>永久二维码</strong><small>贴在料盒，重复使用</small></span></button></div>
      {!qrLink ? <div className="qr-generate"><span><Smartphone size={30} /></span><strong>{qrMode === 'TEMPORARY' ? '生成本次来料检验二维码' : '生成物料永久拍照入口'}</strong><p>{qrMode === 'TEMPORARY' ? '适合一次来料检验；完成、撤销或过期后不能再次使用。' : '适合打印后贴在物料盒；每次归档后，下次扫码会新建录入会话。'}</p>{qrMode === 'TEMPORARY' && <label>有效期<select value={qrMinutes} onChange={event => setQrMinutes(Number(event.target.value))}><option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={240}>4 小时</option><option value={1440}>24 小时</option></select></label>}<button className="primary" type="button" disabled={generatingQr} onClick={() => void createQr()}>{generatingQr ? <Loader2 className="spin" size={16} /> : <QrCode size={16} />}生成二维码</button></div> : <div className="qr-ready">
        <div className="qr-image">{qrDataUrl && <Image unoptimized src={qrDataUrl} width={260} height={260} alt={`${selectedItem.code} 手机拍照二维码`} />}</div>
        <div className="qr-ready-copy"><span className="live"><Wifi size={14} />等待手机扫码</span><strong>打开手机相机或企业微信扫码</strong><p>扫码后仍需登录品质账号。二维码不包含账号、密码或长期登录凭证。</p><dl><div><dt>模式</dt><dd>{qrLink.mode === 'PERMANENT' ? '永久可复用' : '临时单次'}</dd></div><div><dt>有效期</dt><dd>{qrLink.expiresAt ? formatTime(qrLink.expiresAt, true) : '长期有效，支持撤销'}</dd></div></dl><label className="qr-link-field"><span>扫码入口</span><input readOnly value={qrUrl} aria-label="扫码入口" /><button type="button" onClick={() => { void navigator.clipboard.writeText(qrUrl); setMessage('扫码入口已复制'); }}>复制</button></label><button type="button" className="danger-link" onClick={() => void revokeQr()}><Trash2 size={14} />撤销二维码</button></div>
      </div>}
      <footer><ShieldAlert size={15} /><span>永久码只保存不可猜测的物料入口；扫码后仍由登录与品质权限校验。</span></footer>
    </section></div>}

    {(message || error) && <div className={`material-toast ${error ? 'error' : ''}`} role="status">{error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{error || message}<button type="button" onClick={() => { setMessage(''); setError(''); }}><X size={14} /></button></div>}
  </main>;
}
