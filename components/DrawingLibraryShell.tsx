'use client';

import { ArchiveRestore, ArrowLeft, BookOpenText, Clock3, FileImage, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BulkOriginalDrawingImportModal } from '@/components/BulkOriginalDrawingImportModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import {
  PdfOverlayEditorModal,
  type PdfOverlayDocument,
  type PdfOverlayPersistenceResult,
  type PdfOverlayPublishPayload,
  type PdfOverlayUploadedImage,
} from '@/components/sop';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { safeDisplayFilename } from '@/lib/filenames';
import { planningReturnContextFromSearch, type PlanningReturnContext } from '@/lib/planning-navigation';
import { productTimeConfigurationRoute } from '@/lib/workflow-routes';
import type { CurrentUserDTO, DrawingLibraryCustomerDTO, DrawingLibraryFileDTO, DrawingLibraryItemDTO, ResourceCategoryDTO } from '@/types';

type DrawingLibraryForm = {
  customerName: string;
  productName: string;
  specification: string;
  remark: string;
};

type DrawingFilter = 'all' | 'complete' | 'recent' | 'anomaly';
type DrawingModal = { mode: 'create' | 'edit'; item?: DrawingLibraryItemDTO } | null;
type PdfOverlayEditorSession = {
  itemId: string;
  versionId: string;
  sourceFile: DrawingLibraryFileDTO;
  initialDocument: PdfOverlayDocument;
};
type DrawingTrashItem = {
  id: string;
  customerName: string;
  customerCode?: string | null;
  productName?: string | null;
  specification: string;
  libraryKey: string;
  deletedAt: string | null;
  updatedAt: string;
  _count: {
    files: number;
    productionPlanOrders: number;
    workOrders: number;
    productTimeProfiles: number;
  };
};
type DrawingTrashFile = {
  id: string;
  libraryItemId: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  fileSize: number;
  version: string;
  deletedAt: string | null;
  category: { id: string; name: string; code: string };
  libraryItem: {
    id: string;
    customerName: string;
    productName?: string | null;
    specification: string;
  };
};
type MissingDrawingReference =
  | { kind: 'deleted'; item: DrawingTrashItem }
  | { kind: 'missing'; itemId: string };

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
  if (value === '样品过程图') return '过程';
  if (value === '测量证据') return '测量';
  if (value === '剥皮参数') return '剥皮';
  return value || '分类';
}

const structuredFieldLabels: Record<string, string> = {
  name: '名称',
  specification: '规格',
  model: '型号',
  length: '长度',
  quantity: '数量',
  unit: '单位',
  tolerance: '公差',
  position: '使用位置',
  positionLabel: '部位',
  category: '分类',
  severity: '等级',
  content: '内容',
  processName: '适用工序',
  value: '记录值',
  remark: '备注',
};

function structuredValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function DrawingLibraryShell({
  user,
  initialItems,
  initialCustomers,
  categories,
  requestedItemId,
}: {
  user: CurrentUserDTO;
  initialItems: DrawingLibraryItemDTO[];
  initialCustomers: DrawingLibraryCustomerDTO[];
  categories: ResourceCategoryDTO[];
  requestedItemId: string;
}) {
  const canManageDrawing = user.access.capabilities.includes('ENGINEERING:CREATE')
    || user.access.capabilities.includes('ENGINEERING:UPDATE')
    || user.access.capabilities.includes('DRAWING_LIBRARY:CREATE')
    || user.access.capabilities.includes('DRAWING_LIBRARY:UPDATE');
  const canDeleteDrawing = user.access.capabilities.includes('ENGINEERING:DELETE');
  const [items, setItems] = useState(initialItems);
  const [customers, setCustomers] = useState(initialCustomers);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<DrawingFilter>('all');
  const [customer, setCustomer] = useState('全部客户');
  const requestedActiveItem = initialItems.find(item => item.id === requestedItemId) || null;
  const [selectedId, setSelectedId] = useState(requestedItemId ? (requestedActiveItem?.id || '') : (initialItems[0]?.id || ''));
  const [selectedFileId, setSelectedFileId] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [planningReturnContext, setPlanningReturnContext] = useState<PlanningReturnContext | null>(null);
  useToastBridge(msg, setMsg);
  const [modal, setModal] = useState<DrawingModal>(null);
  const [form, setForm] = useState<DrawingLibraryForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bulkHelpOpen, setBulkHelpOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [pdfOverlaySession, setPdfOverlaySession] = useState<PdfOverlayEditorSession | null>(null);
  const [pdfOverlayOpening, setPdfOverlayOpening] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DrawingLibraryFileDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [missingReference, setMissingReference] = useState<MissingDrawingReference | null>(null);
  const [referenceResolving, setReferenceResolving] = useState(!!requestedItemId && !requestedActiveItem);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<DrawingTrashItem[]>([]);
  const [trashFiles, setTrashFiles] = useState<DrawingTrashFile[]>([]);
  const [trashKeyword, setTrashKeyword] = useState('');
  const [trashLoading, setTrashLoading] = useState(false);
  const [restoringId, setRestoringId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef(selectedId);
  const filePanelTriggerRef = useRef<HTMLButtonElement>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const filePanelRef = useRef<HTMLElement>(null);
  const filePanelCloseRef = useRef<HTMLButtonElement>(null);
  const initialUrlAppliedRef = useRef(false);
  const urlMissingWarnedRef = useRef(false);
  const requestedItemLoadingRef = useRef('');

  const visibleItems = useMemo(() => (
    customer === '全部客户' ? items : items.filter(item => item.customerName === customer)
  ), [customer, items]);
  const referenceResolutionPending = !selectedId && (referenceResolving || !!missingReference);
  const selectedItem = visibleItems.find(item => item.id === selectedId)
    || (!referenceResolutionPending ? visibleItems[0] : null);
  const activeCategory = categories.find(category => category.id === activeCategoryId) || categories[0] || null;
  const activeFiles = selectedItem?.files.filter(file => file.categoryId === activeCategory?.id) || [];
  const selectedFile = activeFiles.find(file => file.id === selectedFileId) || activeFiles[0] || null;
  const activeStructuredRecords = (selectedItem?.structuredRecords || []).filter(record => (
    activeCategory?.code === 'material'
      ? record.kind === 'MATERIAL'
      : activeCategory?.code === 'notice'
        ? record.kind === 'NOTICE' || record.kind === 'CUSTOM'
        : false
  ));
  const activeConnectorParameters = activeCategory?.code === 'sample_parameters'
    ? selectedItem?.connectorParameters || []
    : [];
  const activeStructuredCount = activeStructuredRecords.length + activeConnectorParameters.length;
  const isSopCategory = activeCategory?.code === 'sop';
  const hasActiveFilters = !!keyword.trim() || filter !== 'all' || customer !== '全部客户';
  const activeFilterLabel = filterOptions.find(([key]) => key === filter)?.[1] || '全部';
  const visibleFileCount = useMemo(() => visibleItems.reduce((total, item) => total + item.fileCount, 0), [visibleItems]);

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) setSelectedId(selectedItem.id);
  }, [selectedItem, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
      setPlanningReturnContext(planningReturnContextFromSearch(window.location.search));
      if (targetKeyword && keyword !== targetKeyword) {
        setKeyword(targetKeyword);
        return;
      }
      if (shouldCreate && canManageDrawing) {
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

    if (!targetItemId) {
      setReferenceResolving(false);
      return;
    }
    const targetItem = items.find(item => item.id === targetItemId) || null;
    if (!targetItem) {
      if (urlMissingWarnedRef.current || requestedItemLoadingRef.current === targetItemId) return;
      setReferenceResolving(true);
      requestedItemLoadingRef.current = targetItemId;
      const controller = new AbortController();
      void (async () => {
        try {
          const response = await fetch(`/api/drawing-library/${encodeURIComponent(targetItemId)}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.item) {
            if (response.status === 404) {
              const trashResponse = await fetch(`/api/drawing-library/trash?itemId=${encodeURIComponent(targetItemId)}`, {
                cache: 'no-store',
                signal: controller.signal,
              });
              const trashData = await trashResponse.json().catch(() => ({}));
              const deletedItem = Array.isArray(trashData.items) ? trashData.items[0] as DrawingTrashItem | undefined : undefined;
              setSelectedId('');
              if (trashResponse.ok && deletedItem) {
                setMissingReference({ kind: 'deleted', item: deletedItem });
                setMsg('该图纸资料已移入回收站，可在当前页面恢复并修复业务引用。');
              } else {
                setMissingReference({ kind: 'missing', itemId: targetItemId });
                setMsg('图纸资料记录不存在，可能已被永久清理或引用已失效。');
              }
              setReferenceResolving(false);
              urlMissingWarnedRef.current = true;
              return;
            }
            urlMissingWarnedRef.current = true;
            setMsg(data.error || '图纸资料加载失败');
            return;
          }
          const directItem = data.item as DrawingLibraryItemDTO;
          setMissingReference(null);
          setItems(current => current.some(item => item.id === directItem.id) ? current : [directItem, ...current]);
          setCustomer('全部客户');
          setSelectedId(directItem.id);
          setReferenceResolving(false);
          setMsg('');
        } catch (reason) {
          if (!(reason instanceof Error && reason.name === 'AbortError')) {
            urlMissingWarnedRef.current = true;
            setMsg('图纸资料加载失败，请检查网络');
          }
        } finally {
          if (requestedItemLoadingRef.current === targetItemId) requestedItemLoadingRef.current = '';
        }
      })();
      return () => controller.abort();
    }

    setMissingReference(null);
    setReferenceResolving(false);
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
  }, [canManageDrawing, items, keyword]);

  useEffect(() => {
    if (selectedFile && selectedFile.id !== selectedFileId) setSelectedFileId(selectedFile.id);
    if (!selectedFile) setSelectedFileId('');
  }, [selectedFile, selectedFileId]);

  useEffect(() => {
    function closeTransientLayer(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (bulkImportOpen) setBulkImportOpen(false);
      else if (trashOpen) setTrashOpen(false);
      else if (bulkHelpOpen) setBulkHelpOpen(false);
      else if (modal) setModal(null);
    }
    window.addEventListener('keydown', closeTransientLayer);
    return () => window.removeEventListener('keydown', closeTransientLayer);
  }, [bulkHelpOpen, bulkImportOpen, modal, trashOpen]);

  useEffect(() => {
    if (!filePanelOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => filePanelCloseRef.current?.focus());

    function keepFilePanelActive(event: KeyboardEvent) {
      const panel = filePanelRef.current;
      if (!panel) return;
      const blockingLayerOpen = !!(bulkImportOpen || bulkHelpOpen || modal || trashOpen);
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
  }, [bulkHelpOpen, bulkImportOpen, filePanelOpen, modal, trashOpen]);

  const loadData = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      params.set('filter', filter);
      const requestedItemId = new URLSearchParams(window.location.search).get('itemId') || '';
      if (requestedItemId) params.set('itemId', requestedItemId);
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
      setSelectedId(current => {
        if (nextItems.some(item => item.id === current)) return current;
        if (requestedItemId && !nextItems.some(item => item.id === requestedItemId)) return '';
        return nextItems[0]?.id || '';
      });
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) setMsg('图纸资料库加载失败，请检查网络');
    } finally {
      if (loadControllerRef.current === controller) setLoading(false);
    }
  }, [filter, keyword]);

  const openPdfOverlayEditor = useCallback(async () => {
    if (!selectedItem || !selectedFile || activeCategory?.code !== 'sop') {
      setMsg('请先在 SOP 分类中选择一份 PDF 文件');
      return;
    }
    if (selectedFile.fileType !== 'pdf') {
      setMsg('在线编辑当前仅支持 PDF 文件');
      return;
    }
    setFilePanelOpen(false);
    setPdfOverlayOpening(true);
    try {
      const res = await fetch(`/api/drawing-library/${selectedItem.id}/sop/pdf-overlay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseFileId: selectedFile.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '无法打开在线编辑器');
      if (!data.versionId) throw new Error('编辑版本创建失败，请刷新后重试');
      const sourceFile = (data.sourceFile || selectedFile) as DrawingLibraryFileDTO;
      const initialDocument = {
        ...(data.content || {}),
        sourceId: selectedItem.id,
        baseFileId: sourceFile.id,
        sourceFileName: safeDisplayFilename(sourceFile),
        revision: Number(data.revision || 0),
      } as PdfOverlayDocument;
      setPdfOverlaySession({
        itemId: selectedItem.id,
        versionId: String(data.versionId || ''),
        sourceFile,
        initialDocument,
      });
    } catch (error) {
      setMsg(error instanceof Error ? error.message : '无法打开在线编辑器');
    } finally {
      setPdfOverlayOpening(false);
    }
  }, [activeCategory?.code, selectedFile, selectedItem]);

  const savePdfOverlay = useCallback(async (document: PdfOverlayDocument): Promise<PdfOverlayPersistenceResult> => {
    const session = pdfOverlaySession;
    if (!session) throw new Error('编辑会话已关闭，请重新打开');
    const res = await fetch(`/api/drawing-library/${session.itemId}/sop/pdf-overlay/versions/${session.versionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: document.revision ?? session.initialDocument.revision ?? 0,
        document,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '保存编辑草稿失败');
    return { revision: Number(data.revision), updatedAt: data.updatedAt };
  }, [pdfOverlaySession]);

  const uploadPdfOverlayImage = useCallback(async (file: File): Promise<PdfOverlayUploadedImage> => {
    const session = pdfOverlaySession;
    if (!session) throw new Error('编辑会话已关闭，请重新打开');
    const form = new FormData();
    form.set('versionId', session.versionId);
    form.set('file', file);
    const res = await fetch(`/api/drawing-library/${session.itemId}/sop/pdf-overlay/assets/upload`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '插入图片失败');
    return { url: String(data.url || ''), assetId: data.assetId ? String(data.assetId) : undefined };
  }, [pdfOverlaySession]);

  const publishPdfOverlay = useCallback(async (payload: PdfOverlayPublishPayload): Promise<PdfOverlayPersistenceResult> => {
    const session = pdfOverlaySession;
    if (!session) throw new Error('编辑会话已关闭，请重新打开');
    const form = new FormData();
    form.set('expectedRevision', String(payload.document.revision ?? session.initialDocument.revision ?? 0));
    form.set('document', JSON.stringify(payload.document));
    const manifest = payload.overlays.map(overlay => ({
      page: overlay.page,
      width: overlay.width,
      height: overlay.height,
      field: `overlay_${overlay.page}`,
    }));
    form.set('manifest', JSON.stringify(manifest));
    for (const overlay of payload.overlays) {
      const blob = await (await fetch(overlay.pngDataUrl)).blob();
      form.set(`overlay_${overlay.page}`, blob, `overlay-${overlay.page}.png`);
    }
    const res = await fetch(`/api/drawing-library/${session.itemId}/sop/pdf-overlay/versions/${session.versionId}/publish`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '发布 PDF 新版本失败');
    setPdfOverlaySession(null);
    await loadData();
    if (selectedIdRef.current === session.itemId && data.file?.id) setSelectedFileId(String(data.file.id));
    setMsg('SOP 修订版已发布，原始文件已保留，当前预览已切换到新版本');
    return { revision: Number(data.revision), updatedAt: data.updatedAt };
  }, [loadData, pdfOverlaySession]);

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

  async function loadTrash(search = trashKeyword) {
    setTrashLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('keyword', search.trim());
      const response = await fetch(`/api/drawing-library/trash?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMsg(data.error || '回收站加载失败');
        return;
      }
      setTrashItems(Array.isArray(data.items) ? data.items : []);
      setTrashFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setMsg('回收站加载失败，请检查网络');
    } finally {
      setTrashLoading(false);
    }
  }

  function openTrash() {
    setTrashOpen(true);
    void loadTrash();
  }

  async function restoreItem(item: DrawingTrashItem) {
    setRestoringId(item.id);
    try {
      const response = await fetch(`/api/drawing-library/${encodeURIComponent(item.id)}/restore`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMsg(data.error || '图纸资料恢复失败');
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('itemId', item.id);
      url.searchParams.delete('fileId');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      urlMissingWarnedRef.current = false;
      requestedItemLoadingRef.current = '';
      setMissingReference(null);
      setReferenceResolving(false);
      setSelectedId(item.id);
      setSelectedFileId('');
      const linkedOrders = Number(data.repair?.linkedOrders || 0);
      const refreshedWorkOrders = Number(data.repair?.refreshedWorkOrders || 0);
      setMsg(linkedOrders > 0 || refreshedWorkOrders > 0
        ? `图纸资料已恢复；重连计划 ${linkedOrders} 条，刷新生产工单 ${refreshedWorkOrders} 张。`
        : '图纸资料已恢复，关联状态已重新校验。');
      await loadData();
      setTrashItems(current => current.filter(candidate => candidate.id !== item.id));
      if (trashOpen) await loadTrash(trashKeyword);
    } catch {
      setMsg('图纸资料恢复失败，请检查网络');
    } finally {
      setRestoringId('');
    }
  }

  async function restoreFile(file: DrawingTrashFile) {
    setRestoringId(file.id);
    try {
      const response = await fetch(`/api/drawing-library/files/${encodeURIComponent(file.id)}/restore`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMsg(data.error || '资料文件恢复失败');
        return;
      }
      setTrashFiles(current => current.filter(candidate => candidate.id !== file.id));
      const refreshedWorkOrders = Number(data.sync?.refreshedWorkOrders || 0);
      setMsg(refreshedWorkOrders > 0
        ? `资料文件已恢复，并同步刷新 ${refreshedWorkOrders} 张生产工单。`
        : '资料文件已恢复，产品主档和业务历史保持不变。');
      await loadData();
    } catch {
      setMsg('资料文件恢复失败，请检查网络');
    } finally {
      setRestoringId('');
    }
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
        if (res.status === 409 && typeof data.itemId === 'string' && data.itemId) {
          setModal(null);
          setKeyword('');
          setFilter('all');
          setCustomer('全部客户');
          setSelectedId(data.itemId);
          const url = new URL(window.location.href);
          url.searchParams.set('itemId', data.itemId);
          url.searchParams.delete('create');
          url.searchParams.delete('customerName');
          url.searchParams.delete('specification');
          url.searchParams.delete('productName');
          window.history.replaceState(null, '', `${url.pathname}${url.search}`);
          setMsg('已定位现有图纸资料，计划状态会自动同步。');
          return;
        }
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
    setDeleteTarget(file);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/drawing-library/files/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || '删除文件失败');
        return;
      }
      setMsg(Number(data.sync?.activeOriginalFiles || 0) === 0 && deleteTarget.categoryCode === 'drawing'
        ? '原图已移入回收站；计划、生产执行和流程状态已同步为待补，产品主档仍永久保留。'
        : '资料文件已移入回收站；产品主档、工序工时和业务历史均已保留。');
      setDeleteTarget(null);
      await loadData();
    } catch {
      setMsg('删除文件失败，请检查网络');
    } finally {
      setDeleting(false);
    }
  }

  async function chooseItem(item: DrawingLibraryItemDTO) {
    if (item.id === selectedItem?.id) return;
    setFilePanelOpen(false);
    setMissingReference(null);
    setReferenceResolving(false);
    setSelectedId(item.id);
    setSelectedFileId('');
    urlMissingWarnedRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.set('itemId', item.id);
    url.searchParams.delete('fileId');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function chooseCategory(category: ResourceCategoryDTO) {
    if (category.id === activeCategoryId) return;
    setFilePanelOpen(false);
    setActiveCategoryId(category.id);
    setSelectedFileId('');
  }

  async function openProductTime(itemId: string) {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('itemId', itemId);
    if (selectedFile?.id) returnUrl.searchParams.set('fileId', selectedFile.id);
    else returnUrl.searchParams.delete('fileId');

    window.location.href = productTimeConfigurationRoute(itemId, {
      from: 'drawing',
      returnTo: `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`,
    });
  }

  async function returnToPlanning() {
    if (!planningReturnContext) return;
    window.location.replace(planningReturnContext.returnTo);
  }

  async function returnToProduction() {
    window.location.href = '/production';
  }

  return (
    <main className="drawing-library-page hm-drawing-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/drawing-library"
        subtitle="客户、规格与图纸预览"
        utilityActions={planningReturnContext ? (
          <a
            className="hm-drawing-planning-return"
            href={planningReturnContext.returnTo}
            title={`返回计划中心原排单位置${selectedItem?.specification ? `：${selectedItem.specification}` : ''}`}
            onClick={event => {
              event.preventDefault();
              void returnToPlanning();
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>
              <strong>返回计划中心</strong>
              <small>
                {planningReturnContext.weekStartDate && planningReturnContext.weekEndDate
                  ? `${planningReturnContext.weekStartDate.slice(5)} - ${planningReturnContext.weekEndDate.slice(5)}`
                  : '恢复原排单位置'}
              </small>
            </span>
          </a>
        ) : undefined}
        menuItems={[
          planningReturnContext
            ? { label: '返回计划中心', onSelect: () => { void returnToPlanning(); } }
            : { label: '返回生产执行', onSelect: () => { void returnToProduction(); } },
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
            {canManageDrawing && <>
              <button className="hm-workbench-button" type="button" onClick={() => openModal('create')} title="新增图纸资料"><Plus size={15} aria-hidden="true" /><span>新增</span></button>
              <button className="hm-workbench-button primary" type="button" onClick={() => setBulkImportOpen(true)} title="批量导入原图"><Upload size={15} aria-hidden="true" /><span>批量导入</span></button>
              <button className="hm-workbench-button" type="button" title="查看批量导入原图说明" onClick={() => setBulkHelpOpen(true)}><BookOpenText size={15} aria-hidden="true" /><span>说明</span></button>
              <button className="hm-workbench-button" type="button" title="查看和恢复已删除资料文件" onClick={openTrash}><Trash2 size={15} aria-hidden="true" /><span>文件回收站</span></button>
            </>}
          </div>
        </section>

        <section className="drawing-workspace">
          <aside className="drawing-browser" aria-label="图纸规格结果">
            <div className="drawing-panel-head">
              <div><strong>规格结果</strong><span>{customer === '全部客户' ? '全部客户' : customer}</span></div>
              <b>{visibleItems.length}</b>
            </div>
            <div className="drawing-list hm-scroll-region" tabIndex={0} aria-label={`图纸规格结果，共 ${visibleItems.length} 项`}>
              {visibleItems.map(item => (
                <button key={item.id} className={selectedItem?.id === item.id ? 'drawing-spec-card active' : 'drawing-spec-card'} type="button" aria-pressed={selectedItem?.id === item.id} onClick={() => { void chooseItem(item); }}>
                  <div className="drawing-spec-title-line">
                    <strong title={item.specification}>{item.specification}</strong>
                    {item.isAnomaly && <span title={item.anomalyReason || '异常数据'}>异常</span>}
                  </div>
                  <p title={`${item.customerName} · ${item.productName || '未设置品名'}`}>{item.customerName} · {item.productName || '未设置品名'}</p>
                  <footer>
                    <em>{item.fileCount ? item.completenessText : '待上传'}</em>
                    <span>{item.fileCount ? `${item.fileCount} 个文件` : '档案已建立'}</span>
                    <time dateTime={item.updatedAt || undefined}>{dt(item.updatedAt)}</time>
                  </footer>
                </button>
              ))}
              {!visibleItems.length && (
                <div className="drawing-result-empty">
                  <Search aria-hidden="true" />
                  <strong>{hasActiveFilters ? '没有符合条件的资料' : '资料库中还没有图纸资料'}</strong>
                  <p>{hasActiveFilters ? '尝试清除关键词、客户或状态筛选。' : canManageDrawing ? '新增资料或使用批量导入建立长期图纸档案。' : '当前资料库中还没有可查看的资料。'}</p>
                  {(hasActiveFilters || canManageDrawing) && <button className="hm-workbench-button" type="button" onClick={hasActiveFilters ? clearFilters : () => openModal('create')}>{hasActiveFilters ? '清除筛选' : '新增资料'}</button>}
                </div>
              )}
            </div>
          </aside>

          <section className="drawing-detail" aria-label="资料预览工作区">
          {!selectedItem ? (
            missingReference?.kind === 'deleted' ? (
              <div className="drawing-reference-recovery" role="status">
                <span className="drawing-reference-recovery-icon"><ArchiveRestore aria-hidden="true" /></span>
                <div>
                  <em>已定位断开的业务引用</em>
                  <h2>{missingReference.item.specification}</h2>
                  <p>{missingReference.item.customerName} · {missingReference.item.productName || '未设置品名'}</p>
                </div>
                <section aria-label="恢复影响摘要">
                  <span><b>{missingReference.item._count.files}</b> 个文件</span>
                  <span><b>{missingReference.item._count.productionPlanOrders}</b> 条计划</span>
                  <span><b>{missingReference.item._count.workOrders}</b> 张工单</span>
                  <span><b>{missingReference.item._count.productTimeProfiles}</b> 套工序工时</span>
                </section>
                <p className="drawing-reference-recovery-note">恢复会保留原图纸和工序工时，并重新核对计划、生产工单及流程中的图纸引用；不会复制或覆盖文件。</p>
                <div className="drawing-reference-recovery-actions">
                  {canManageDrawing && <><button className="hm-workbench-button" type="button" onClick={openTrash}>查看回收站</button>
                  <button className="hm-workbench-button primary" type="button" disabled={restoringId === missingReference.item.id} onClick={() => void restoreItem(missingReference.item)}>
                    <ArchiveRestore size={15} aria-hidden="true" />
                    {restoringId === missingReference.item.id ? '恢复并修复中...' : '恢复资料并修复链路'}
                  </button></>}
                </div>
              </div>
            ) : missingReference?.kind === 'missing' ? (
              <div className="drawing-reference-recovery missing" role="status">
                <span className="drawing-reference-recovery-icon"><FileImage aria-hidden="true" /></span>
                <div>
                  <em>引用目标不存在</em>
                  <h2>未找到对应图纸资料</h2>
                  <p>记录 ID：{missingReference.itemId}</p>
                </div>
                <p className="drawing-reference-recovery-note">这通常表示记录已被永久清理，或旧链接指向了错误 ID。可先在回收站按客户或规格搜索；若仍找不到，需要重新绑定正确资料，而不是新建同名空档案。</p>
                <div className="drawing-reference-recovery-actions">
                  {canManageDrawing && <button className="hm-workbench-button primary" type="button" onClick={openTrash}>从回收站查找</button>}
                </div>
              </div>
            ) : (
              <div className="drawing-empty-state">
                <FileImage aria-hidden="true" />
                <strong>{hasActiveFilters ? '当前筛选下没有可预览资料' : '选择一个规格开始查看'}</strong>
                <p>{hasActiveFilters ? '左侧结果会随搜索条件更新，清除筛选可返回全部资料。' : canManageDrawing ? '预览区会保持图纸原始比例，并提供版本、下载和资料维护入口。' : '预览区会保持图纸原始比例，并提供版本和下载入口。'}</p>
                {(hasActiveFilters || canManageDrawing) && <button className="hm-workbench-button" type="button" onClick={hasActiveFilters ? clearFilters : () => openModal('create')}>{hasActiveFilters ? '清除筛选' : '新增图纸资料'}</button>}
              </div>
            )
          ) : (
            <>
              <div className="drawing-detail-head">
                <div>
                  <span>当前资料</span>
                  <h1 title={selectedItem.specification}>{selectedItem.specification}</h1>
                  <p>
                    <b title={selectedItem.customerName}>{selectedItem.customerName}</b>
                    {hasText(selectedItem.productName) && <em title={selectedItem.productName || ''}>{selectedItem.productName}</em>}
                    <small>{selectedItem.fileCount ? selectedItem.completenessText : '档案已建立 · 待上传资料'}</small>
                    {selectedItem.fileCount > 0 && <small>{selectedItem.fileCount} 个文件</small>}
                    <small>更新于 {dt(selectedItem.updatedAt)}</small>
                    {selectedItem.isAnomaly && <small className="anomaly">{selectedItem.anomalyReason}</small>}
                  </p>
                </div>
                <div className="drawing-head-actions">
                  {canManageDrawing && isSopCategory && (
                    <div className="drawing-sop-mode-switch" role="group" aria-label="SOP 查看模式">
                      <button className="active" type="button" aria-pressed="true">文件预览</button>
                      <button type="button" disabled={pdfOverlayOpening || selectedFile?.fileType !== 'pdf'} onClick={() => { void openPdfOverlayEditor(); }}>
                        {pdfOverlayOpening ? '正在打开...' : '在线编辑'}
                      </button>
                    </div>
                  )}
                  <button className="hm-workbench-button" type="button" onClick={() => { void openProductTime(selectedItem.id); }}><Clock3 size={15} aria-hidden="true" />产品工时</button>
                  <button ref={filePanelTriggerRef} className="hm-workbench-button hm-drawing-file-toggle" type="button" aria-controls="drawing-library-file-panel" aria-expanded={filePanelOpen} onClick={() => filePanelOpen ? closeFilePanel() : setFilePanelOpen(true)}>文件 {activeFiles.length}</button>
                  {canManageDrawing && <button className="hm-workbench-button" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : '上传资料'}</button>}
                  {canManageDrawing && <button className="hm-workbench-button" type="button" onClick={() => openModal('edit', selectedItem)}>编辑</button>}
                  {canDeleteDrawing && selectedFile && (
                    <button
                      className="hm-workbench-button danger"
                      type="button"
                      title={`删除当前文件：${safeDisplayFilename(selectedFile)}`}
                      onClick={() => deleteFile(selectedFile)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      删除当前文件
                    </button>
                  )}
                </div>
              </div>

              <div className="drawing-library-main">
                <nav className="drawing-category-rail">
                  {categories.map(category => {
                    const fileCount = selectedItem.categoryFileCounts[category.id] || 0;
                    const structuredCount = category.code === 'material'
                      ? (selectedItem.structuredRecords || []).filter(record => record.kind === 'MATERIAL').length
                      : category.code === 'notice'
                        ? (selectedItem.structuredRecords || []).filter(record => record.kind === 'NOTICE' || record.kind === 'CUSTOM').length
                        : category.code === 'sample_parameters'
                          ? (selectedItem.connectorParameters || []).length
                          : 0;
                    const count = fileCount + structuredCount;
                    return (
                      <button key={category.id} className={activeCategoryId === category.id ? 'active' : ''} type="button" onClick={() => { void chooseCategory(category); }}>
                        <span className={count ? 'dot filled' : 'dot'} />
                        <strong title={category.name}>{categoryShortName(category.name)}</strong>
                        <em>{count}</em>
                      </button>
                    );
                  })}
                  <button className="drawing-product-time-link" type="button" title="维护当前产品的单位工时表" onClick={() => { void openProductTime(selectedItem.id); }}>
                    <Clock3 size={14} aria-hidden="true" />
                    <strong>工时表</strong>
                    <em>进入</em>
                  </button>
                </nav>

                <div className="drawing-preview">
                  <input ref={fileInputRef} hidden multiple type="file" accept="application/pdf,.pdf,image/*" onChange={event => uploadFiles(event.target.files)} />
                  <>
                      <div className="drawing-preview-head">
                        <span><b>{activeCategory?.name || '资料预览'}</b><small>{selectedFile ? `${selectedFile.version || 'V1.0'} · ${bytes(selectedFile.fileSize)}` : '当前分类'}</small></span>
                        <strong title={selectedFile ? safeDisplayFilename(selectedFile) : ''}>{selectedFile ? safeDisplayFilename(selectedFile) : '暂无文件'}</strong>
                      </div>

                      {!selectedFile && activeStructuredCount > 0 ? (
                        <div className="drawing-structured-records hm-scroll-region" tabIndex={0} aria-label={`${activeCategory?.name || '结构化资料'}，共 ${activeStructuredCount} 条`}>
                          {activeConnectorParameters.map(binding => (
                            <article key={binding.id}>
                              <header><span>剥皮参数</span><strong>{binding.positionLabel || binding.parameter.model || '未命名部位'}</strong><em>V{binding.version}</em></header>
                              <dl>
                                <div><dt>连接器型号</dt><dd>{binding.parameter.model || '-'}</dd></div>
                                <div><dt>外剥皮</dt><dd>{binding.parameter.outerPeelMm || '-'}</dd></div>
                                <div><dt>内剥皮</dt><dd>{binding.parameter.innerPeelMm || '-'}</dd></div>
                                <div><dt>入长</dt><dd>{binding.parameter.insertionLengthMm || '-'}</dd></div>
                              </dl>
                              {binding.parameter.remark && <p>{binding.parameter.remark}</p>}
                              <footer>来源：样品审核 · {binding.publishedBy || '系统'} · {dt(binding.publishedAt)}</footer>
                            </article>
                          ))}
                          {activeStructuredRecords.map(record => {
                            const fields = Object.entries(record.payload).map(([key, value]) => [key, structuredValue(value)] as const).filter(([, value]) => value);
                            return <article key={record.id}>
                              <header><span>{record.kind === 'NOTICE' ? '注意事项' : record.kind === 'MATERIAL' ? '辅料规则' : '补充资料'}</span><strong>{record.label || '未命名记录'}</strong><em>V{record.version}</em></header>
                              {!!fields.length && <dl>{fields.map(([key, value]) => <div key={key}><dt>{structuredFieldLabels[key] || key}</dt><dd>{value}</dd></div>)}</dl>}
                              <footer>来源：{record.sourceType === 'SAMPLE_TASK' ? '样品审核' : record.sourceType} · {record.publishedBy || '系统'} · {dt(record.publishedAt)}</footer>
                            </article>;
                          })}
                        </div>
                      ) : !selectedFile ? (
                        <div className="drawing-preview-placeholder" aria-label="当前分类暂无可预览文件">
                          <span aria-hidden="true">＋</span>
                          <strong>{activeCategory?.name || '当前分类'}暂无文件</strong>
                          <p>{canManageDrawing ? '产品档案已经建立，可直接上传 PDF、JPG、PNG 等资料，上传后会在这里预览。' : '产品档案已经建立，当前分类暂未上传文件。'}</p>
                          {canManageDrawing && <button className="hm-workbench-button primary" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : `上传到${activeCategory?.name || '当前分类'}`}</button>}
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
                  </>
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
                  {canDeleteDrawing && <button className="hm-workbench-button danger" type="button" onClick={() => deleteFile(selectedFile)}>删除文件</button>}
                </div>
              )}
            </>
          ) : (
            <div className="drawing-file-empty">
              <strong>{selectedItem ? '档案已建立，当前分类待上传' : '请选择规格'}</strong>
              <p>{selectedItem ? '上传 PDF 或图片后会在中间预览区查看。' : '选择左侧规格后查看当前分类文件。'}</p>
              {selectedItem && canManageDrawing && <button className="hm-workbench-button primary" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '上传中...' : '上传 PDF / 图片'}</button>}
            </div>
          )}
          </aside>}
        </section>
      </div>

      {canManageDrawing && modal && (
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

      {canManageDrawing && trashOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="drawing-dialog drawing-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="drawing-trash-title">
            <div className="dialog-title">
              <div>
                <span>资料文件回收站</span>
                <h3 id="drawing-trash-title">恢复误删文件并自动校准业务状态</h3>
              </div>
              <button type="button" aria-label="关闭图纸资料回收站" title="关闭" onClick={() => setTrashOpen(false)}>×</button>
            </div>
            <form className="drawing-trash-search" onSubmit={event => { event.preventDefault(); void loadTrash(); }}>
              <Search size={17} aria-hidden="true" />
              <input value={trashKeyword} onChange={event => setTrashKeyword(event.target.value)} placeholder="搜索文件名、客户、规格或品名" autoFocus />
              <button className="hm-workbench-button" type="submit" disabled={trashLoading}>{trashLoading ? '查询中...' : '查询'}</button>
            </form>
            <p className="cleanup-note">产品资料主档永久保留；这里只恢复软删除的原图、SOP、成品图、辅料规格和注意事项。恢复原图时会同步校准计划、生产执行和流程中心的图纸状态。</p>
            <div className="drawing-trash-content hm-scroll-region" tabIndex={0} aria-label={`回收站文件，共 ${trashFiles.length} 项`}>
              <header className="drawing-trash-section-title">
                <div><strong>已删除文件</strong><small>可逐个恢复，不会覆盖现有文件</small></div>
                <b>{trashFiles.length}</b>
              </header>
              <div className="drawing-trash-list drawing-trash-file-list">
                {trashFiles.map(file => (
                  <article key={file.id}>
                    <div>
                      <strong>{file.displayName || file.originalName}</strong>
                      <p>{file.libraryItem.specification} · {file.libraryItem.customerName} · {file.category.name}</p>
                      <small>{file.version || 'V1.0'} · {bytes(file.fileSize)} · 删除于 {dt(file.deletedAt)}</small>
                    </div>
                    <section aria-label="文件归属">
                      <span>分类 <b>{categoryShortName(file.category.name)}</b></span>
                      <span>品名 <b>{file.libraryItem.productName || '未设置'}</b></span>
                    </section>
                    <button className="hm-workbench-button primary" type="button" disabled={!!restoringId} onClick={() => void restoreFile(file)}>
                      <ArchiveRestore size={15} aria-hidden="true" />
                      {restoringId === file.id ? '恢复中...' : '恢复文件'}
                    </button>
                  </article>
                ))}
              </div>

              {!!trashItems.length && (
                <>
                  <header className="drawing-trash-section-title legacy">
                    <div><strong>历史遗留主档</strong><small>旧版本删除记录仅用于恢复，主档不再允许删除</small></div>
                    <b>{trashItems.length}</b>
                  </header>
                  <div className="drawing-trash-list drawing-trash-legacy-list">
                    {trashItems.map(item => (
                      <article key={item.id} className={missingReference?.kind === 'deleted' && item.id === missingReference.item.id ? 'active' : ''}>
                        <div>
                          <strong>{item.specification}</strong>
                          <p>{item.customerName} · {item.productName || '未设置品名'}</p>
                          <small>历史删除于 {dt(item.deletedAt)} · 更新于 {dt(item.updatedAt)}</small>
                        </div>
                        <section aria-label="关联数据">
                          <span>文件 <b>{item._count.files}</b></span>
                          <span>计划 <b>{item._count.productionPlanOrders}</b></span>
                          <span>工单 <b>{item._count.workOrders}</b></span>
                          <span>工序工时 <b>{item._count.productTimeProfiles}</b></span>
                        </section>
                        <button className="hm-workbench-button primary" type="button" disabled={!!restoringId} onClick={() => void restoreItem(item)}>
                          <ArchiveRestore size={15} aria-hidden="true" />
                          {restoringId === item.id ? '恢复中...' : '恢复主档'}
                        </button>
                      </article>
                    ))}
                  </div>
                </>
              )}

              {!trashLoading && !trashFiles.length && !trashItems.length && (
                <div className="drawing-trash-empty">
                  <ArchiveRestore aria-hidden="true" />
                  <strong>{trashKeyword.trim() ? '没有匹配的已删除文件' : '文件回收站为空'}</strong>
                  <p>{trashKeyword.trim() ? '请换用文件名、客户名、规格或品名搜索。' : '误删文件会显示在这里，产品资料主档始终保留。'}</p>
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setTrashOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {canManageDrawing && bulkHelpOpen && (
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

      {canManageDrawing && pdfOverlaySession && (
        <PdfOverlayEditorModal
          key={`${pdfOverlaySession.itemId}:${pdfOverlaySession.sourceFile.id}:${pdfOverlaySession.versionId}`}
          open
          sourceUrl={pdfOverlaySession.sourceFile.contentUrl}
          sourceId={pdfOverlaySession.itemId}
          baseFileId={pdfOverlaySession.sourceFile.id}
          fileName={safeDisplayFilename(pdfOverlaySession.sourceFile)}
          title={`修订 ${safeDisplayFilename(pdfOverlaySession.sourceFile)}`}
          versionLabel={pdfOverlaySession.sourceFile.version || '当前版本'}
          initialDocument={pdfOverlaySession.initialDocument}
          autoSaveDelayMs={1500}
          onClose={() => setPdfOverlaySession(null)}
          onSave={savePdfOverlay}
          onPublish={publishPdfOverlay}
          onUploadImage={uploadPdfOverlayImage}
        />
      )}

      <BulkOriginalDrawingImportModal
        open={canManageDrawing && bulkImportOpen}
        customers={customers}
        onClose={() => setBulkImportOpen(false)}
        onCompleted={loadData}
      />

      <ConfirmDialog
        open={canDeleteDrawing && Boolean(deleteTarget)}
        title="删除资料文件？"
        description={deleteTarget
          ? `“${safeDisplayFilename(deleteTarget)}”将移入文件回收站；产品主档、计划、工单、工序工时和历史记录均会保留。`
          : ''}
        confirmLabel="移入回收站"
        danger
        busy={deleting}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={() => { void confirmDelete(); }}
      />

    </main>
  );
}
