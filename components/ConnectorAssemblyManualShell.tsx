'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import type { PdfTocSuggestion } from '@/components/PdfViewer';
import { PortalMenu } from '@/components/PortalMenu';
import { BulkConnectorManualImportModal } from '@/components/BulkConnectorManualImportModal';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { writeClipboardText } from '@/lib/client-platform';
import { inspectConnectorManualFile } from '@/lib/client-connector-manual-inspector';
import type { ClientManualInspection } from '@/lib/client-connector-manual-inspector';
import { stableManualTocId } from '@/lib/connector-manual-toc';
import { isGenericConnectorManualManufacturer } from '@/lib/connector-manual-parser';
import type {
  ConnectorAssemblyManualAssetDTO,
  ConnectorAssemblyManualDTO,
  ConnectorAssemblyManualTocDTO,
  ConnectorAssemblyManualVersionDTO,
  ConnectorParameterDTO,
  CurrentUserDTO,
} from '@/types';

type RightTab = 'summary' | 'toc' | 'versions' | 'bindings';
type ManualForm = {
  title: string;
  manufacturer: string;
  family: string;
  documentNo: string;
  summary: string;
  keywords: string;
  revision: string;
  issuedAt: string;
  fileMode: 'PDF' | 'IMAGE_SET';
  tocText: string;
  connectorParameterIds: string[];
};
type VersionForm = {
  revision: string;
  issuedAt: string;
  fileMode: 'PDF' | 'IMAGE_SET';
  status: string;
  remark: string;
  tocText: string;
};
type DeleteTarget = { type: 'manual'; item: ConnectorAssemblyManualDTO } | { type: 'version'; item: ConnectorAssemblyManualVersionDTO } | null;
type TocEditState = { id: string; title: string; pageStart: number; pageEnd: number } | null;
type TrashPayload = {
  connectorAssemblyManuals?: ConnectorAssemblyManualDTO[];
  connectorAssemblyManualVersions?: Array<ConnectorAssemblyManualVersionDTO & { manualTitle: string }>;
  connectorAssemblyManualAssets?: Array<ConnectorAssemblyManualAssetDTO & { manualTitle: string; revision: string }>;
};

const emptyManualForm: ManualForm = {
  title: '', manufacturer: '', family: '', documentNo: '', summary: '', keywords: '', revision: 'Rev 01', issuedAt: '', fileMode: 'PDF', tocText: '', connectorParameterIds: [],
};
const emptyVersionForm: VersionForm = { revision: '', issuedAt: '', fileMode: 'PDF', status: '有效', remark: '', tocText: '' };

function dateText(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replace(/\//g, '-');
}

function dateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function tocToText(items: ConnectorAssemblyManualTocDTO[]): string {
  return items.map(item => `${item.title}|${item.pageStart}|${item.pageEnd}`).join('\n');
}

function parseTocText(value: string): { items: ConnectorAssemblyManualTocDTO[]; error?: string } {
  const rows = value.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  const items: ConnectorAssemblyManualTocDTO[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const parts = rows[index].split('|').map(part => part.trim());
    const pageStart = Number(parts[1]);
    const pageEnd = Number(parts[2] || parts[1]);
    if (!parts[0] || !Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
      return { items: [], error: `第 ${index + 1} 行目录格式应为：章节名称|开始页|结束页` };
    }
    items.push({ title: parts[0], pageStart, pageEnd });
  }
  return { items };
}

function tocItemId(item: ConnectorAssemblyManualTocDTO, index: number): string {
  return item.id || stableManualTocId(item.title, item.pageStart, item.pageEnd, index);
}

function tocSuggestionKey(item: Pick<PdfTocSuggestion, 'title' | 'pageStart' | 'pageEnd'>): string {
  return `${item.title.trim().toLocaleLowerCase('zh-CN')}|${item.pageStart}|${item.pageEnd}`;
}

function versionFormFrom(version?: ConnectorAssemblyManualVersionDTO): VersionForm {
  if (!version) return emptyVersionForm;
  return {
    revision: version.revision,
    issuedAt: dateInput(version.issuedAt),
    fileMode: version.fileMode,
    status: version.status || '',
    remark: version.remark || '',
    tocText: tocToText(version.tocJson),
  };
}

function manualFormFrom(manual?: ConnectorAssemblyManualDTO): ManualForm {
  if (!manual) return emptyManualForm;
  return {
    title: manual.title,
    manufacturer: manual.manufacturer || '',
    family: manual.family || '',
    documentNo: manual.documentNo || '',
    summary: manual.summary || '',
    keywords: manual.keywords || '',
    revision: '',
    issuedAt: '',
    fileMode: 'PDF',
    tocText: '',
    connectorParameterIds: [],
  };
}

function meaningfulRevision(value?: string | null): string {
  const revision = String(value || '').trim();
  return ['', '待识别', '未识别'].includes(revision) ? '' : revision;
}

function manualCardMeta(manual: ConnectorAssemblyManualDTO): string[] {
  const version = manual.latestVersion;
  return [meaningfulRevision(version?.revision), version?.pageCount ? `${version.pageCount}页` : '', dateText(version?.issuedAt)].filter(Boolean);
}

function manualCardStatuses(manual: ConnectorAssemblyManualDTO): string[] {
  const version = manual.latestVersion;
  const incomplete = !manual.manufacturer || isGenericConnectorManualManufacturer(manual.manufacturer) || !version || !meaningfulRevision(version.revision) || !version.issuedAt || version.parseStatus === 'partial';
  const statuses: string[] = [];
  if (incomplete) statuses.push('待完善');
  if (!manual.bindingCount) statuses.push('待关联');
  if (version?.parseStatus === 'failed') statuses.push('解析失败');
  if (manual.versionCount > 1) statuses.push('有新版本');
  return statuses;
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function ConnectorAssemblyManualShell({ user }: { user: CurrentUserDTO }) {
  const [manuals, setManuals] = useState<ConnectorAssemblyManualDTO[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [imageIndex, setImageIndex] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [family, setFamily] = useState('');
  const [model, setModel] = useState('');
  const [issuedFrom, setIssuedFrom] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('summary');
  const [tocSuggestions, setTocSuggestions] = useState<PdfTocSuggestion[]>([]);
  const [tocSuggestionOpen, setTocSuggestionOpen] = useState(false);
  const [selectedTocSuggestions, setSelectedTocSuggestions] = useState<string[]>([]);
  const [tocEdit, setTocEdit] = useState<TocEditState>(null);
  const [highlightedTocId, setHighlightedTocId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [manualActionsOpen, setManualActionsOpen] = useState(false);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [manualModal, setManualModal] = useState<'create' | 'edit' | null>(null);
  const [manualForm, setManualForm] = useState<ManualForm>(emptyManualForm);
  const [singleFiles, setSingleFiles] = useState<File[]>([]);
  const [singleSuggestion, setSingleSuggestion] = useState<ClientManualInspection | null>(null);
  const [singleParsing, setSingleParsing] = useState(false);
  const [versionModal, setVersionModal] = useState<'create' | 'edit' | null>(null);
  const [versionForm, setVersionForm] = useState<VersionForm>(emptyVersionForm);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingKeyword, setBindingKeyword] = useState('');
  const [bindingOptions, setBindingOptions] = useState<ConnectorParameterDTO[]>([]);
  const [bindingSelection, setBindingSelection] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteText, setDeleteText] = useState('');
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<TrashPayload>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const manualActionsButtonRef = useRef<HTMLButtonElement>(null);
  const detailButtonRef = useRef<HTMLButtonElement>(null);
  const detailPanelRef = useRef<HTMLElement>(null);
  const detailCloseButtonRef = useRef<HTMLButtonElement>(null);
  const urlAppliedRef = useRef(false);
  const pendingNavigationRef = useRef<{ versionId: string; page: number } | null>(null);
  const pendingNavigationTimerRef = useRef<number | null>(null);

  const selectedManual = manuals.find(item => item.id === selectedId) || (statusFilter === 'deleted' ? null : manuals[0]) || null;
  const selectedVersion = selectedManual?.versions.find(item => item.id === selectedVersionId)
    || selectedManual?.latestVersion
    || selectedManual?.versions[0]
    || null;
  const activeAssets = useMemo(() => selectedVersion?.assets.filter(asset => !asset.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder) || [], [selectedVersion]);
  const selectedAsset = activeAssets[Math.max(0, Math.min(imageIndex, activeAssets.length - 1))] || null;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const advancedFilterActive = !!(manufacturer || family || model.trim() || issuedFrom || issuedTo);
  const listFiltersActive = !!keyword.trim() || statusFilter !== 'all' || advancedFilterActive;
  const currentPreviewPage = selectedVersion?.fileMode === 'IMAGE_SET' ? imageIndex + 1 : pdfPage;
  const availableTocSuggestions = useMemo(() => tocSuggestions.filter(suggestion => !selectedVersion?.tocJson.some(item => item.pageStart === suggestion.pageStart && item.title.trim().toLocaleLowerCase('zh-CN') === suggestion.title.trim().toLocaleLowerCase('zh-CN'))), [selectedVersion, tocSuggestions]);
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const statusLabels: Record<string, string> = { latest: '最新版', incomplete: '待完善', unbound: '未关联', parse_failed: '解析失败', deleted: '已删除' };
    if (keyword.trim()) labels.push(`关键词：${keyword.trim()}`);
    if (statusFilter !== 'all') labels.push(statusLabels[statusFilter] || statusFilter);
    if (manufacturer) labels.push(`制造商：${manufacturer}`);
    if (family) labels.push(`系列：${family}`);
    if (model.trim()) labels.push(`型号：${model.trim()}`);
    if (issuedFrom) labels.push(`从 ${issuedFrom}`);
    if (issuedTo) labels.push(`至 ${issuedTo}`);
    return labels;
  }, [family, issuedFrom, issuedTo, keyword, manufacturer, model, statusFilter]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => detailCloseButtonRef.current?.focus());

    function keepDetailPanelActive(event: KeyboardEvent): void {
      const panel = detailPanelRef.current;
      if (!panel) return;
      const blockingLayerOpen = !!(manualModal || versionModal || uploadOpen || bindingOpen || deleteTarget || trashOpen || moreInfoOpen || tocEdit || tocSuggestionOpen || bulkOpen);
      if (blockingLayerOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setDetailsOpen(false);
        window.requestAnimationFrame(() => detailButtonRef.current?.focus());
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

    window.addEventListener('keydown', keepDetailPanelActive);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keepDetailPanelActive);
    };
  }, [bindingOpen, bulkOpen, deleteTarget, detailsOpen, manualModal, moreInfoOpen, tocEdit, tocSuggestionOpen, trashOpen, uploadOpen, versionModal]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), pageSize: '20', latestOnly: 'false' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (manufacturer) params.set('manufacturer', manufacturer);
      if (family) params.set('family', family);
      if (model.trim()) params.set('model', model.trim());
      if (issuedFrom) params.set('issuedFrom', issuedFrom);
      if (issuedTo) params.set('issuedTo', issuedTo);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      try {
        const response = await fetch(`/api/connector-assembly-manuals?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        const data = await jsonResponse(response);
        if (!response.ok) throw new Error(String(data.error || '说明书加载失败'));
        const nextManuals = Array.isArray(data.manuals) ? data.manuals as ConnectorAssemblyManualDTO[] : [];
        setManuals(nextManuals);
        setTotal(Number(data.total || 0));
        const filters = data.filters as { manufacturers?: string[]; families?: string[] } | undefined;
        setManufacturers(filters?.manufacturers || []);
        setFamilies(filters?.families || []);
        setSelectedId(current => nextManuals.some(item => item.id === current) ? current : (statusFilter === 'deleted' ? '' : nextManuals[0]?.id || ''));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setToast(error instanceof Error ? error.message : '说明书加载失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [family, issuedFrom, issuedTo, keyword, manufacturer, model, page, refreshKey, statusFilter]);

  useEffect(() => {
    if (urlAppliedRef.current) return;
    urlAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const targetManualId = params.get('manualId') || '';
    const targetVersionId = params.get('versionId') || '';
    const targetPageValue = params.get('page');
    const targetPage = targetPageValue ? Number(targetPageValue) : 0;
    const targetModel = params.get('model') || '';
    if (targetModel) setModel(targetModel);
    if (targetManualId) {
      void loadManual(targetManualId, targetVersionId, Number.isInteger(targetPage) && targetPage >= 1 ? targetPage : 0);
    }
  }, []);

  useEffect(() => {
    if (!selectedManual) return;
    if (!selectedVersion || selectedVersion.manualId !== selectedManual.id) setSelectedVersionId(selectedManual.latestVersion?.id || selectedManual.versions[0]?.id || '');
  }, [selectedManual, selectedVersion]);

  useEffect(() => {
    if (!selectedVersionId || !selectedVersion || selectedVersion.id !== selectedVersionId) return;
    const pending = pendingNavigationRef.current?.versionId === selectedVersionId ? pendingNavigationRef.current : null;
    let targetPage = pending?.page || 1;
    if (!pending) {
      const stored = Number(window.localStorage.getItem(`connector-manual-reading:${user.id}:${selectedVersionId}`) || 1);
      if (Number.isInteger(stored) && stored >= 1) targetPage = stored;
    }
    const pageLimit = selectedVersion.pageCount || Math.max(1, selectedVersion.assets.length);
    targetPage = Math.max(1, Math.min(pageLimit, targetPage));
    setPdfPage(targetPage);
    setImageIndex(Math.max(0, targetPage - 1));
    setTocSuggestions([]);
    setTocSuggestionOpen(false);
  }, [selectedVersionId, selectedVersion, user.id]);

  useEffect(() => () => {
    if (pendingNavigationTimerRef.current !== null) window.clearTimeout(pendingNavigationTimerRef.current);
  }, []);

  useEffect(() => {
    if (!selectedVersionId || !selectedVersion || selectedVersion.id !== selectedVersionId) return undefined;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(`connector-manual-reading:${user.id}:${selectedVersionId}`, String(currentPreviewPage));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentPreviewPage, selectedVersion, selectedVersionId, user.id]);

  useEffect(() => {
    if (!highlightedTocId) return undefined;
    const timer = window.setTimeout(() => setHighlightedTocId(''), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedTocId]);

  async function loadManual(id: string, versionId = '', targetPage = 0): Promise<void> {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/connector-assembly-manuals/${id}`, { cache: 'no-store' });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '说明书详情加载失败'));
      const manual = data.manual as ConnectorAssemblyManualDTO;
      const nextVersionId = versionId || manual.latestVersion?.id || manual.versions[0]?.id || '';
      const hasExplicitPage = Number.isInteger(targetPage) && targetPage >= 1;
      pendingNavigationRef.current = nextVersionId && hasExplicitPage ? { versionId: nextVersionId, page: targetPage } : null;
      if (pendingNavigationTimerRef.current !== null) window.clearTimeout(pendingNavigationTimerRef.current);
      if (pendingNavigationRef.current) pendingNavigationTimerRef.current = window.setTimeout(() => { pendingNavigationRef.current = null; pendingNavigationTimerRef.current = null; }, 2000);
      setManuals(current => [manual, ...current.filter(item => item.id !== manual.id)]);
      setSelectedId(manual.id);
      setSelectedVersionId(nextVersionId);
      if (hasExplicitPage) {
        setPdfPage(targetPage);
        setImageIndex(Math.max(0, targetPage - 1));
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '说明书详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }

  function selectManual(manual: ConnectorAssemblyManualDTO): void {
    if (manual.deletedAt) {
      setToast('该说明书已删除，请在回收站中恢复后查看');
      return;
    }
    setSelectedId(manual.id);
    pendingNavigationRef.current = null;
    if (pendingNavigationTimerRef.current !== null) window.clearTimeout(pendingNavigationTimerRef.current);
    setSelectedVersionId(manual.latestVersion?.id || manual.versions[0]?.id || '');
    setRightTab('toc');
    window.history.replaceState(null, '', `/connector-assembly-manuals?manualId=${encodeURIComponent(manual.id)}`);
  }

  function openCreateManual(): void {
    setManualForm(emptyManualForm);
    setSingleFiles([]);
    setSingleSuggestion(null);
    setBindingKeyword('');
    setBindingOptions([]);
    setManualModal('create');
  }

  function openEditManual(): void {
    if (!selectedManual) return;
    setManualForm(manualFormFrom(selectedManual));
    setManualModal('edit');
  }

  async function saveManual(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!manualForm.title.trim()) return setToast('说明书名称不能为空');
    if (manualModal === 'create' && !singleFiles.length) return setToast('请选择 PDF 或图片文件');
    if (manualModal === 'create' && !manualForm.revision.trim()) return setToast('首版版本号不能为空');
    const toc = parseTocText(manualForm.tocText);
    if (toc.error) return setToast(toc.error);
    setSaving(true);
    try {
      const response = await fetch(manualModal === 'edit' && selectedManual ? `/api/connector-assembly-manuals/${selectedManual.id}` : '/api/connector-assembly-manuals', {
        method: manualModal === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualModal === 'create' ? { ...manualForm, tocJson: toc.items } : manualForm),
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '保存说明书失败'));
      const manual = data.manual as ConnectorAssemblyManualDTO;
      const creating = manualModal === 'create';
      let uploadMessage = '';
      if (creating && singleFiles.length && manual.latestVersion?.id) {
        const form = new FormData();
        singleFiles.forEach(file => form.append('files', file));
        const uploadResponse = await fetch(`/api/connector-assembly-manual-versions/${manual.latestVersion.id}/assets/upload`, { method: 'POST', body: form });
        const uploadData = await jsonResponse(uploadResponse);
        uploadMessage = uploadResponse.ok ? `并上传 ${singleFiles.length} 个文件` : `，但文件上传失败：${String(uploadData.error || '请稍后重试')}`;
      }
      setManualModal(null);
      setSingleFiles([]);
      setSingleSuggestion(null);
      setToast(manualModal === 'edit' ? '说明书信息已更新' : `说明书已创建${uploadMessage || '，可继续上传文件'}`);
      await loadManual(manual.id, manual.latestVersion?.id || '');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存说明书失败');
    } finally {
      setSaving(false);
    }
  }

  async function inspectSingleFiles(files: File[]): Promise<void> {
    setSingleSuggestion(null);
    if (!files.length) return;
    const pdf = files[0].type === 'application/pdf' || files[0].name.toLowerCase().endsWith('.pdf');
    const selectedFiles = pdf ? files.slice(0, 1) : files.filter(file => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'));
    setSingleFiles(selectedFiles);
    setManualForm(current => ({
      ...current,
      title: current.title.trim() ? current.title : selectedFiles[0].name.replace(/\.(?:pdf|jpe?g|png|webp)$/i, ''),
      fileMode: pdf ? 'PDF' : 'IMAGE_SET',
    }));
    setSingleParsing(true);
    try {
      const suggestion = await inspectConnectorManualFile(selectedFiles[0], selectedFiles[0].webkitRelativePath || selectedFiles[0].name);
      setSingleSuggestion(suggestion);
    } finally {
      setSingleParsing(false);
    }
  }

  async function applySingleSuggestion(): Promise<void> {
    if (!singleSuggestion) return;
    const matchedIds: string[] = [];
    for (const modelCandidate of singleSuggestion.modelCandidates.slice(0, 8)) {
      const params = new URLSearchParams({ page: '1', pageSize: '80', keyword: modelCandidate });
      const response = await fetch(`/api/connector-parameters?${params.toString()}`, { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) continue;
      const data = await jsonResponse(response);
      const options = Array.isArray(data.parameters) ? data.parameters as ConnectorParameterDTO[] : [];
      for (const option of options) {
        if (String(option.model || '').trim().toLocaleUpperCase() === modelCandidate.trim().toLocaleUpperCase()) matchedIds.push(option.id);
      }
    }
    setManualForm(current => ({
      ...current,
      manufacturer: current.manufacturer.trim() ? current.manufacturer : singleSuggestion.manufacturerCandidate,
      family: current.family.trim() ? current.family : singleSuggestion.familyCandidate,
      keywords: current.keywords.trim() ? current.keywords : singleSuggestion.keywordCandidates.join('、'),
      revision: current.revision.trim() && current.revision !== 'Rev 01' ? current.revision : singleSuggestion.revisionCandidate || current.revision,
      issuedAt: current.issuedAt || singleSuggestion.issuedAtCandidate,
      tocText: current.tocText.trim() ? current.tocText : tocToText(singleSuggestion.chapterCandidates),
      connectorParameterIds: Array.from(new Set([...current.connectorParameterIds, ...matchedIds])),
    }));
    setToast(`已填入识别建议；名称仍保留文件名${matchedIds.length ? `，精确关联 ${new Set(matchedIds).size} 个型号` : ''}`);
  }

  function openCreateVersion(): void {
    if (!selectedManual) return;
    setVersionForm({ ...emptyVersionForm, revision: `Rev ${String(selectedManual.versionCount + 1).padStart(2, '0')}` });
    setVersionModal('create');
  }

  function openEditVersion(): void {
    if (!selectedVersion) return;
    setVersionForm(versionFormFrom(selectedVersion));
    setVersionModal('edit');
  }

  async function saveVersion(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedManual || !versionForm.revision.trim()) return setToast('版本号不能为空');
    const toc = parseTocText(versionForm.tocText);
    if (toc.error) return setToast(toc.error);
    setSaving(true);
    try {
      const isEdit = versionModal === 'edit' && selectedVersion;
      const response = await fetch(isEdit ? `/api/connector-assembly-manual-versions/${selectedVersion.id}` : `/api/connector-assembly-manuals/${selectedManual.id}/versions`, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...versionForm, tocJson: toc.items, isLatest: isEdit ? selectedVersion.isLatest : true }),
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '保存版本失败'));
      const version = data.version as ConnectorAssemblyManualVersionDTO;
      setVersionModal(null);
      setToast(isEdit ? '版本与目录已更新' : '新版本已创建，请上传文件');
      await loadManual(selectedManual.id, version.id);
      if (!isEdit) setUploadOpen(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存版本失败');
    } finally {
      setSaving(false);
    }
  }

  function updateSelectedVersionToc(tocJson: ConnectorAssemblyManualTocDTO[], updatedAt: string): void {
    if (!selectedManual || !selectedVersion) return;
    const versionId = selectedVersion.id;
    setManuals(current => current.map(manual => {
      if (manual.id !== selectedManual.id) return manual;
      const updateVersion = (version: ConnectorAssemblyManualVersionDTO): ConnectorAssemblyManualVersionDTO => version.id === versionId ? { ...version, tocJson, updatedAt } : version;
      return {
        ...manual,
        versions: manual.versions.map(updateVersion),
        latestVersion: manual.latestVersion ? updateVersion(manual.latestVersion) : manual.latestVersion,
      };
    }));
  }

  async function addCurrentPageToToc(title: string, targetPage: number): Promise<boolean> {
    if (!selectedVersion || !selectedManual) return false;
    const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}/toc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, page: targetPage, expectedUpdatedAt: selectedVersion.updatedAt }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) {
      setToast(String(data.error || '添加目录失败'));
      return false;
    }
    const tocJson = Array.isArray(data.tocJson) ? data.tocJson as ConnectorAssemblyManualTocDTO[] : [];
    updateSelectedVersionToc(tocJson, String(data.updatedAt || selectedVersion.updatedAt));
    const addedIds = Array.isArray(data.addedIds) ? data.addedIds.map(value => String(value)) : [];
    setHighlightedTocId(addedIds[0] || '');
    setRightTab('toc');
    setDetailsOpen(true);
    setToast(`已添加目录“${title.trim()}” · 第 ${targetPage} 页`);
    return true;
  }

  async function copyCurrentPageLink(targetPage: number): Promise<void> {
    if (!selectedManual || !selectedVersion) return;
    const url = new URL('/connector-assembly-manuals', window.location.origin);
    url.searchParams.set('manualId', selectedManual.id);
    url.searchParams.set('versionId', selectedVersion.id);
    url.searchParams.set('page', String(targetPage));
    try {
      await writeClipboardText(url.toString());
      setToast(`已复制第 ${targetPage} 页链接`);
    } catch {
      setToast('复制失败，请手动复制当前页面地址');
    }
  }

  function openTocSuggestionDialog(): void {
    if (!selectedVersion) return;
    if (!availableTocSuggestions.length) {
      setToast('未检测到可用目录，可手动添加。');
      return;
    }
    setSelectedTocSuggestions(availableTocSuggestions.map(tocSuggestionKey));
    setTocSuggestionOpen(true);
  }

  async function saveTocSuggestions(): Promise<void> {
    if (!selectedVersion || !selectedManual) return;
    const items = availableTocSuggestions.filter(item => selectedTocSuggestions.includes(tocSuggestionKey(item)));
    if (!items.length) return setToast('请至少选择一条目录建议');
    setSaving(true);
    try {
      const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}/toc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, expectedUpdatedAt: selectedVersion.updatedAt }),
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '保存目录建议失败'));
      const tocJson = Array.isArray(data.tocJson) ? data.tocJson as ConnectorAssemblyManualTocDTO[] : [];
      updateSelectedVersionToc(tocJson, String(data.updatedAt || selectedVersion.updatedAt));
      const addedIds = Array.isArray(data.addedIds) ? data.addedIds.map(value => String(value)) : [];
      setHighlightedTocId(addedIds[0] || '');
      setTocSuggestionOpen(false);
      setToast(`已保存 ${items.length} 条目录建议`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存目录建议失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveTocEdit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedVersion || !tocEdit) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}/toc/${encodeURIComponent(tocEdit.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: tocEdit.title, pageStart: tocEdit.pageStart, pageEnd: tocEdit.pageEnd, expectedUpdatedAt: selectedVersion.updatedAt }),
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '更新目录失败'));
      updateSelectedVersionToc(Array.isArray(data.tocJson) ? data.tocJson as ConnectorAssemblyManualTocDTO[] : [], String(data.updatedAt || selectedVersion.updatedAt));
      setHighlightedTocId(tocEdit.id);
      setTocEdit(null);
      setToast('目录已更新');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '更新目录失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTocItem(item: ConnectorAssemblyManualTocDTO, index: number): Promise<void> {
    if (!selectedVersion || !window.confirm(`确认删除目录“${item.title}”？说明书文件不会删除。`)) return;
    const id = tocItemId(item, index);
    const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}/toc/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: selectedVersion.updatedAt }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '删除目录失败'));
    updateSelectedVersionToc(Array.isArray(data.tocJson) ? data.tocJson as ConnectorAssemblyManualTocDTO[] : [], String(data.updatedAt || selectedVersion.updatedAt));
    setToast('目录已删除，说明书文件未受影响');
  }

  async function moveTocItem(index: number, direction: -1 | 1): Promise<void> {
    if (!selectedVersion) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedVersion.tocJson.length) return;
    const ids = selectedVersion.tocJson.map(tocItemId);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}/toc/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, expectedUpdatedAt: selectedVersion.updatedAt }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '调整目录顺序失败'));
    updateSelectedVersionToc(Array.isArray(data.tocJson) ? data.tocJson as ConnectorAssemblyManualTocDTO[] : [], String(data.updatedAt || selectedVersion.updatedAt));
  }

  function goToTocItem(item: ConnectorAssemblyManualTocDTO): void {
    if (selectedVersion?.fileMode === 'IMAGE_SET') setImageIndex(Math.max(0, item.pageStart - 1));
    else setPdfPage(item.pageStart);
  }

  async function uploadAssets(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedManual || !selectedVersion || !uploadFiles.length) return setToast('请选择要上传的文件');
    setSaving(true);
    try {
      const form = new FormData();
      uploadFiles.forEach(file => form.append('files', file));
      const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}/assets/upload`, { method: 'POST', body: form });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '文件上传失败'));
      setUploadFiles([]);
      setUploadOpen(false);
      setToast(`上传完成，共 ${Array.isArray(data.assets) ? data.assets.length : 0} 个文件`);
      await loadManual(selectedManual.id, selectedVersion.id);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '文件上传失败');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const expected = deleteTarget.type === 'manual' ? 'DELETE_MANUAL' : 'DELETE_VERSION';
    if (deleteText.trim() !== expected) return setToast(`请输入 ${expected} 确认删除`);
    setSaving(true);
    try {
      const url = deleteTarget.type === 'manual'
        ? `/api/connector-assembly-manuals/${deleteTarget.item.id}`
        : `/api/connector-assembly-manual-versions/${deleteTarget.item.id}`;
      const response = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmText: expected }) });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '删除失败'));
      const manualId = selectedManual?.id || '';
      setDeleteTarget(null);
      setDeleteText('');
      setToast('已软删除，可在回收站恢复');
      if (deleteTarget.type === 'manual') setManuals(current => current.filter(item => item.id !== deleteTarget.item.id));
      else if (manualId) await loadManual(manualId);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function markLatest(version: ConnectorAssemblyManualVersionDTO): Promise<void> {
    if (!selectedManual) return;
    const response = await fetch(`/api/connector-assembly-manual-versions/${version.id}/mark-latest`, { method: 'POST' });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '设置最新版本失败'));
    setToast(`${version.revision} 已设为最新版`);
    await loadManual(selectedManual.id, version.id);
  }

  async function reorderAsset(asset: ConnectorAssemblyManualAssetDTO, direction: -1 | 1): Promise<void> {
    if (!selectedManual || !selectedVersion) return;
    const index = activeAssets.findIndex(item => item.id === asset.id);
    const other = activeAssets[index + direction];
    if (!other) return;
    const response = await fetch(`/api/connector-assembly-manual-versions/${selectedVersion.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetOrder: [{ id: asset.id, sortOrder: other.sortOrder }, { id: other.id, sortOrder: asset.sortOrder }] }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '调整图片顺序失败'));
    await loadManual(selectedManual.id, selectedVersion.id);
  }

  async function deleteAsset(asset: ConnectorAssemblyManualAssetDTO): Promise<void> {
    if (!selectedManual || !selectedVersion || !window.confirm(`确认移除文件“${asset.displayName || asset.originalName}”？对象存储原文件会保留。`)) return;
    const response = await fetch(`/api/connector-assembly-manual-assets/${asset.id}`, { method: 'DELETE' });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '删除文件失败'));
    setToast('文件已软删除');
    await loadManual(selectedManual.id, selectedVersion.id);
  }

  useEffect(() => {
    if (!bindingOpen && manualModal !== 'create') return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '80' });
      if (bindingKeyword.trim()) params.set('keyword', bindingKeyword.trim());
      try {
        const response = await fetch(`/api/connector-parameters?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        const data = await jsonResponse(response);
        if (response.ok) setBindingOptions(Array.isArray(data.parameters) ? data.parameters as ConnectorParameterDTO[] : []);
      } catch {
        if (!controller.signal.aborted) setToast('连接器参数加载失败');
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [bindingKeyword, bindingOpen, manualModal]);

  async function saveBindings(): Promise<void> {
    if (!selectedManual || !bindingSelection.length) return setToast('请选择要关联的连接器型号');
    const response = await fetch(`/api/connector-assembly-manuals/${selectedManual.id}/bindings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectorParameterIds: bindingSelection }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '关联失败'));
    setBindingOpen(false);
    setBindingSelection([]);
    setToast(`已新增 ${Number(data.count || 0)} 个关联`);
    await loadManual(selectedManual.id, selectedVersion?.id || '');
  }

  async function unbindParameter(id: string): Promise<void> {
    if (!selectedManual) return;
    const response = await fetch(`/api/connector-assembly-manuals/${selectedManual.id}/bindings`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectorParameterIds: [id] }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '解除关联失败'));
    setToast('已解除型号关联');
    await loadManual(selectedManual.id, selectedVersion?.id || '');
  }

  async function loadTrash(): Promise<void> {
    const response = await fetch('/api/trash', { cache: 'no-store' });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '回收站加载失败'));
    setTrash(data as TrashPayload);
    setTrashOpen(true);
  }

  async function restoreTrash(type: 'manual' | 'version' | 'asset', id: string): Promise<void> {
    const url = type === 'manual' ? `/api/connector-assembly-manuals/${id}/restore`
      : type === 'version' ? `/api/connector-assembly-manual-versions/${id}/restore`
        : `/api/connector-assembly-manual-assets/${id}/restore`;
    const response = await fetch(url, { method: 'POST' });
    const data = await jsonResponse(response);
    if (!response.ok) return setToast(String(data.error || '恢复失败'));
    setToast('恢复成功');
    await loadTrash();
  }

  function clearListFilters(): void {
    setKeyword('');
    setManufacturer('');
    setFamily('');
    setModel('');
    setIssuedFrom('');
    setIssuedTo('');
    setStatusFilter('all');
    setPage(1);
  }

  function openDetailPanel(tab?: RightTab): void {
    if (tab) setRightTab(tab);
    setDetailsOpen(true);
  }

  function closeDetailPanel(): void {
    setDetailsOpen(false);
    window.requestAnimationFrame(() => detailButtonRef.current?.focus());
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <main className="manual-page hm-manual-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/connector-assembly-manuals"
        subtitle="连接器工艺说明书阅读"
        menuItems={[
          { label: '回收站', onSelect: loadTrash },
          { label: '操作日志', href: '/dashboard?openLogs=1' },
          { label: '退出登录', onSelect: logout },
        ]}
      />

      <div className="hm-manual-main">
        <WorkbenchPageHeader
          kicker="工艺资料"
          title="连接器组装说明书"
          description="按制造商、系列与型号查找正确版本，在主阅读区定位章节和文件"
          titleId="connector-assembly-manuals-title"
          className="hm-manual-page-header"
          actionsClassName="hm-manual-page-actions"
          actions={
            <>
              <button className="hm-workbench-button" type="button" onClick={openCreateManual}>单份新增</button>
              <button className="hm-workbench-button primary" type="button" onClick={() => setBulkOpen(true)}>批量导入说明书</button>
            </>
          }
        />

        <nav className="manual-module-tabs hm-manual-module-tabs" aria-label="连接器资料库模块">
          <a href="/connector-parameters">连接器参数</a>
          <a className="active" href="/connector-assembly-manuals" aria-current="page">组装说明书</a>
          <a href="/connector-parameters?openFiles=1">原始资料附件</a>
          <a href="/connector-parameters?openBatches=1">导入批次</a>
        </nav>

        <section className="hm-manual-query" aria-label="说明书库搜索与筛选">
          <div className="hm-manual-search-field">
            <label htmlFor="manual-library-search">说明书库搜索</label>
            <div>
              <span aria-hidden="true">⌕</span>
              <input id="manual-library-search" className="hm-workbench-input" value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} placeholder="标题 / 型号 / 制造商 / 版本 / 关键词 / 已解析正文" />
              {keyword && <button type="button" aria-label="清空说明书库搜索" onClick={() => setKeyword('')}>清空</button>}
            </div>
            <small>搜索范围：全部说明书记录及后端已有正文索引</small>
          </div>
          <div className="manual-quick-filters hm-manual-quick-filters" aria-label="说明书快捷筛选">
            {([['all', '全部'], ['latest', '最新版'], ['incomplete', '待完善']] as Array<[string, string]>).map(([value, label]) => (
              <button className={statusFilter === value ? 'active' : ''} type="button" key={value} aria-pressed={statusFilter === value} onClick={() => { setStatusFilter(value); setPage(1); }}>{label}</button>
            ))}
            <button ref={filterButtonRef} className={filterOpen || advancedFilterActive ? 'active' : ''} type="button" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}>更多筛选{advancedFilterActive ? ` ${activeFilterLabels.length}` : ''}</button>
            <PortalMenu open={filterOpen} anchorRef={filterButtonRef} align="left" className="manual-filter-menu" width={310} onClose={() => setFilterOpen(false)} closeOnSelect={false}>
              <div className="manual-advanced-filters">
                <label><span>资料状态</span><select aria-label="资料状态筛选" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">全部状态</option><option value="latest">最新版</option><option value="incomplete">待完善</option><option value="unbound">待关联</option><option value="parse_failed">解析失败</option></select></label>
                <label><span>制造商</span><select aria-label="制造商筛选" value={manufacturer} onChange={event => { setManufacturer(event.target.value); setPage(1); }}><option value="">全部制造商</option>{manufacturers.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                <label><span>连接器系列</span><select aria-label="系列筛选" value={family} onChange={event => { setFamily(event.target.value); setPage(1); }}><option value="">全部系列</option>{families.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="wide"><span>适用型号</span><input aria-label="适用型号筛选" value={model} onChange={event => { setModel(event.target.value); setPage(1); }} placeholder="输入型号关键词" /></label>
                <label><span>发布起始日</span><input aria-label="发布起始日" type="date" value={issuedFrom} onChange={event => { setIssuedFrom(event.target.value); setPage(1); }} /></label>
                <label><span>发布结束日</span><input aria-label="发布结束日" type="date" value={issuedTo} onChange={event => { setIssuedTo(event.target.value); setPage(1); }} /></label>
                <div className="wide manual-filter-actions"><button type="button" onClick={clearListFilters}>清空条件</button><button className="primary-button" type="button" onClick={() => setFilterOpen(false)}>完成</button></div>
              </div>
            </PortalMenu>
          </div>
          <div className="hm-manual-query-summary" aria-live="polite">
            <strong>{loading ? '正在查询说明书' : `找到 ${total} 份说明书`}</strong>
            <span>{activeFilterLabels.length ? `已启用 ${activeFilterLabels.length} 个条件` : '当前显示全部说明书'}</span>
            {activeFilterLabels.length > 0 && <div>{activeFilterLabels.slice(0, 3).map(label => <i title={label} key={label}>{label}</i>)}{activeFilterLabels.length > 3 && <i>+{activeFilterLabels.length - 3}</i>}</div>}
            {listFiltersActive && <button type="button" onClick={clearListFilters}>清除全部</button>}
          </div>
        </section>

        <section className={`manual-workspace hm-manual-workspace ${detailsOpen ? 'detail-open' : 'detail-collapsed'}`}>
        <aside className="manual-list-panel hm-manual-list-panel" aria-label="说明书查询结果">
          <div className="manual-list-heading"><div><strong>说明书结果</strong><small>{loading ? '正在加载' : `${total} 份 · 第 ${page}/${totalPages} 页`}</small></div><span aria-hidden="true">LIST</span></div>
          <div className="manual-list-scroll" aria-busy={loading}>
            {manuals.map(manual => {
              const identity = [manual.manufacturer, manual.family].filter(Boolean).join(' · ');
              const metadata = manualCardMeta(manual);
              const statuses = manualCardStatuses(manual);
              return (
                <button className={`manual-card ${selectedManual?.id === manual.id ? 'active' : ''}`} type="button" key={manual.id} onClick={() => selectManual(manual)}>
                  <span className="hm-manual-card-eyebrow" title={identity || '制造商待完善'}>{identity || '制造商待完善'}</span>
                  <strong title={manual.title}>{manual.title}</strong>
                  {!!manual.models.length && <span className="hm-manual-card-models" title={manual.models.join(' / ')}>{manual.models.slice(0, 2).join(' / ')}{manual.models.length > 2 ? ` +${manual.models.length - 2}` : ''}</span>}
                  <div className="manual-card-foot">
                    {metadata.length > 0 && <small>{metadata.join(' · ')}</small>}
                    {statuses.length > 0 && <span className="manual-card-status">{statuses.map(status => <i className={status === '解析失败' ? 'danger' : ''} key={status}>{status}</i>)}</span>}
                  </div>
                </button>
              );
            })}
            {loading && !manuals.length && <div className="manual-list-empty loading"><span className="manual-loader" /><strong>正在加载说明书</strong><p>正在读取列表和筛选条件。</p></div>}
            {!loading && !manuals.length && <div className="manual-list-empty"><strong>{listFiltersActive ? '没有匹配的说明书' : '暂无组装说明书'}</strong><p>{listFiltersActive ? '当前条件没有结果，可清除筛选后重新查询。' : '可直接批量选择 PDF / 图片文件夹，或使用单份新增。'}</p><button type="button" onClick={listFiltersActive ? clearListFilters : () => setBulkOpen(true)}>{listFiltersActive ? '清除筛选' : '批量导入说明书'}</button></div>}
          </div>
          <div className="manual-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>
        </aside>

        <section className="manual-preview-panel hm-manual-preview-panel" aria-label="说明书主阅读区">
          <div className="manual-current-bar">
            <div className="manual-current-copy">
              <span className="hm-manual-current-kicker">当前说明书</span>
              <strong title={selectedManual?.title}>{selectedManual?.title || '请选择说明书'}</strong>
              {selectedManual && <span>{[selectedManual.manufacturer, meaningfulRevision(selectedVersion?.revision), selectedVersion?.pageCount ? `${selectedVersion.pageCount}页` : '', dateText(selectedVersion?.issuedAt)].filter(Boolean).join(' · ')}</span>}
              {!!selectedManual?.models.length && <div className="manual-current-models">{selectedManual.models.map(item => <i key={item}>{item}</i>)}</div>}
            </div>
            <div className="manual-current-actions">
              <button className="primary-button" type="button" disabled={!selectedManual} onClick={openCreateVersion}>上传新版本</button>
              <button ref={detailButtonRef} className="manual-detail-toggle" type="button" disabled={!selectedManual} aria-controls="manual-resource-panel" aria-expanded={detailsOpen} onClick={() => detailsOpen ? closeDetailPanel() : openDetailPanel()} title={detailsOpen ? '收起目录、版本与型号面板' : '打开目录、版本与型号面板'}>{detailsOpen ? '收起资料面板' : '目录 / 版本'}</button>
              <button ref={manualActionsButtonRef} type="button" disabled={!selectedManual} aria-expanded={manualActionsOpen} onClick={() => setManualActionsOpen(value => !value)}>更多</button>
              <PortalMenu open={manualActionsOpen} anchorRef={manualActionsButtonRef} className="manual-actions-menu" width={190} onClose={() => setManualActionsOpen(false)}>
                <button type="button" onClick={() => { openEditManual(); setManualActionsOpen(false); }}>编辑说明书信息</button>
                <button type="button" onClick={() => { setMoreInfoOpen(true); setManualActionsOpen(false); }}>更多信息</button>
                <button type="button" disabled={!selectedVersion} onClick={() => { openEditVersion(); setManualActionsOpen(false); }}>编辑当前版本与目录</button>
                <button className="danger" type="button" disabled={!selectedManual} onClick={() => { if (selectedManual) setDeleteTarget({ type: 'manual', item: selectedManual }); setManualActionsOpen(false); }}>删除说明书</button>
              </PortalMenu>
            </div>
          </div>
          <div className="manual-preview-stage">
            {(loading || detailLoading) && <div className="manual-empty-preview"><span className="manual-loader" /><strong>说明书加载中</strong><p>正在读取版本和文件信息</p></div>}
            {!loading && !detailLoading && !selectedManual && <div className="manual-empty-preview"><span>MANUAL</span><strong>{statusFilter === 'deleted' ? '已删除说明书只在回收站恢复' : '建立连接器组装说明书资料库'}</strong><p>{statusFilter === 'deleted' ? '选择用户菜单中的回收站执行恢复，S3 原文件仍然保留。' : '集中管理 PDF、多图说明书、版本、目录和适用型号。'}</p><button type="button" onClick={statusFilter === 'deleted' ? loadTrash : () => setBulkOpen(true)}>{statusFilter === 'deleted' ? '打开回收站' : '批量导入第一批说明书'}</button></div>}
            {!loading && !detailLoading && selectedManual && !selectedVersion && <div className="manual-empty-preview missing"><span>01</span><strong>这份说明书还没有版本</strong><p>先创建版本，再上传 PDF 或多张图片。</p><button type="button" onClick={openCreateVersion}>创建首个版本</button></div>}
            {!loading && !detailLoading && selectedVersion && !selectedAsset && <div className="manual-empty-preview missing"><span>{selectedVersion.fileMode === 'PDF' ? 'PDF' : 'IMG'}</span><strong>当前版本尚未上传文件</strong><p>{selectedVersion.fileMode === 'PDF' ? '上传一个 PDF，系统会识别页数并提取可搜索文字。' : '可一次选择多张图片，并在版本面板调整顺序。'}</p><button type="button" onClick={() => setUploadOpen(true)}>上传文件</button></div>}
            {!loading && !detailLoading && selectedVersion?.fileMode === 'PDF' && selectedAsset && (
              <PdfViewer key={selectedVersion.id} dashboardMode fileId={selectedAsset.id} title={selectedAsset.displayName || selectedAsset.originalName} contentUrl={selectedAsset.contentUrl} downloadUrl={selectedAsset.downloadUrl} viewUrl={selectedAsset.contentUrl} page={pdfPage} onPageChange={setPdfPage} onAddToToc={addCurrentPageToToc} onTocSuggestions={setTocSuggestions} onCopyPageLink={copyCurrentPageLink} readingMode />
            )}
            {!loading && !detailLoading && selectedVersion?.fileMode === 'IMAGE_SET' && selectedAsset && (
              <div className="manual-image-preview">
                <ImageViewer key={selectedVersion.id} dashboardMode fileId={selectedAsset.id} title={selectedAsset.displayName || selectedAsset.originalName} contentUrl={selectedAsset.contentUrl} downloadUrl={selectedAsset.downloadUrl} page={imageIndex + 1} pageCount={activeAssets.length} onPageChange={value => setImageIndex(Math.max(0, value - 1))} onAddToToc={addCurrentPageToToc} onCopyPageLink={copyCurrentPageLink} gestureResetKey={selectedVersion.id} readingMode />
              </div>
            )}
          </div>
          {activeAssets.length > 1 && (
            <div className="manual-thumbnails" aria-label="说明书文件缩略条">
              {activeAssets.map((asset, index) => <button className={selectedAsset?.id === asset.id ? 'active' : ''} type="button" key={asset.id} onClick={() => setImageIndex(index)}><span>{asset.assetType === 'PDF' ? 'PDF' : String(index + 1)}</span><strong title={asset.displayName || asset.originalName}>{asset.displayName || asset.originalName}</strong></button>)}
            </div>
          )}
        </section>

        {detailsOpen && <button className="manual-detail-scrim" type="button" aria-label="关闭说明书资料面板" onClick={closeDetailPanel} />}
        {detailsOpen && <aside ref={detailPanelRef} id="manual-resource-panel" className="manual-detail-panel open" aria-label="说明书摘要、目录、版本与型号" role="dialog" aria-modal="true" tabIndex={-1}>
          <div className="manual-detail-heading"><strong>说明书资料</strong><button ref={detailCloseButtonRef} type="button" onClick={closeDetailPanel} aria-label="关闭说明书资料面板" title="关闭资料面板">×</button></div>
          <div className="manual-detail-tabs">
            {([['summary', '摘要'], ['toc', '章节目录'], ['versions', '版本与文件'], ['bindings', '关联型号']] as Array<[RightTab, string]>).map(([key, label]) => <button className={rightTab === key ? 'active' : ''} type="button" key={key} aria-pressed={rightTab === key} onClick={() => setRightTab(key)}>{label}{key === 'versions' && selectedManual ? ` ${selectedManual.versionCount}` : ''}{key === 'bindings' && selectedManual ? ` ${selectedManual.bindingCount}` : ''}</button>)}
          </div>
          <div className="manual-detail-scroll">
            {rightTab === 'summary' && <ManualSideSummary manual={selectedManual} version={selectedVersion} />}
            {rightTab === 'toc' && (
              <div className="manual-toc-list">
                <div className="manual-section-head"><strong>章节目录</strong><div><button type="button" disabled={!selectedVersion || selectedVersion.fileMode !== 'PDF'} onClick={openTocSuggestionDialog}>生成目录建议</button><button type="button" disabled={!selectedVersion} onClick={openEditVersion}>编辑全部</button></div></div>
                {selectedVersion?.tocJson.map((item, index) => {
                  const id = tocItemId(item, index);
                  const active = currentPreviewPage >= item.pageStart && currentPreviewPage <= item.pageEnd;
                  return <article className={`${active ? 'active' : ''}${highlightedTocId === id ? ' highlighted' : ''}`} key={id}><button className="manual-toc-select" type="button" onClick={() => goToTocItem(item)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong><small>{item.pageStart === item.pageEnd ? `第 ${item.pageStart} 页` : `${item.pageStart}-${item.pageEnd} 页`}</small></button><div className="manual-toc-actions"><button type="button" disabled={index === 0} onClick={() => void moveTocItem(index, -1)} title="上移">↑</button><button type="button" disabled={index === selectedVersion.tocJson.length - 1} onClick={() => void moveTocItem(index, 1)} title="下移">↓</button><button type="button" onClick={() => setTocEdit({ id, title: item.title, pageStart: item.pageStart, pageEnd: item.pageEnd })}>编辑</button><button className="danger-text" type="button" onClick={() => void deleteTocItem(item, index)}>删除</button></div></article>;
                })}
                {!selectedVersion?.tocJson.length && <div className="manual-side-empty">暂未识别目录，可手动添加</div>}
              </div>
            )}
            {rightTab === 'versions' && (
              <div className="manual-version-list">
                <div className="manual-section-head"><strong>版本历史</strong><button type="button" disabled={!selectedManual} onClick={openCreateVersion}>新增版本</button></div>
                {selectedManual?.versions.map(version => (
                  <article className={selectedVersion?.id === version.id ? 'active' : ''} key={version.id}>
                    <button className="manual-version-select" type="button" onClick={() => setSelectedVersionId(version.id)}><strong>{version.revision}</strong>{(version.issuedAt || version.pageCount) && <span>{[dateText(version.issuedAt), version.pageCount ? `${version.pageCount} 页` : ''].filter(Boolean).join(' · ')}</span>}{version.isLatest && <b>最新版</b>}</button>
                    <div><button type="button" onClick={() => { setSelectedVersionId(version.id); setVersionForm(versionFormFrom(version)); setVersionModal('edit'); }}>编辑</button>{!version.isLatest && <button type="button" onClick={() => markLatest(version)}>设最新</button>}<button className="danger-text" type="button" onClick={() => setDeleteTarget({ type: 'version', item: version })}>删除</button></div>
                  </article>
                ))}
                {selectedVersion && <div className="manual-assets-manage"><div className="manual-section-head"><strong>当前版本文件</strong><button type="button" onClick={() => setUploadOpen(true)}>上传</button></div>{activeAssets.map((asset, index) => <div key={asset.id}><span>{index + 1}</span><strong title={asset.displayName || asset.originalName}>{asset.displayName || asset.originalName}</strong>{selectedVersion.fileMode === 'IMAGE_SET' && <><button type="button" title="上移文件" disabled={index === 0} onClick={() => reorderAsset(asset, -1)}>↑</button><button type="button" title="下移文件" disabled={index === activeAssets.length - 1} onClick={() => reorderAsset(asset, 1)}>↓</button></>}<a href={asset.downloadUrl}>下载</a><button className="danger-text" type="button" onClick={() => deleteAsset(asset)}>移除</button></div>)}</div>}
              </div>
            )}
            {rightTab === 'bindings' && (
              <div className="manual-binding-list">
                <div className="manual-section-head"><strong>关联连接器参数</strong><button type="button" disabled={!selectedManual} onClick={() => setBindingOpen(true)}>关联型号</button></div>
                {selectedManual?.bindings.map(binding => <article key={binding.id}><div><strong>{binding.model || '未设置型号'}</strong>{binding.rowNo !== null && binding.rowNo !== undefined && <span>序号 {binding.rowNo}</span>}</div><button type="button" onClick={() => unbindParameter(binding.id)}>解除</button></article>)}
                {!selectedManual?.bindings.length && <div className="manual-side-empty">暂无关联型号。系统不会自动关联无法确认的参数。</div>}
              </div>
            )}
          </div>
        </aside>}
      </section>

      </div>

      {manualModal && <ManualDialog mode={manualModal} form={manualForm} setForm={setManualForm} files={singleFiles} suggestion={singleSuggestion} parsing={singleParsing} setFiles={inspectSingleFiles} applySuggestion={applySingleSuggestion} bindingKeyword={bindingKeyword} setBindingKeyword={setBindingKeyword} bindingOptions={bindingOptions} saving={saving} close={() => setManualModal(null)} submit={saveManual} />}
      {versionModal && <VersionDialog mode={versionModal} form={versionForm} setForm={setVersionForm} saving={saving} close={() => setVersionModal(null)} submit={saveVersion} />}
      {uploadOpen && selectedVersion && <UploadDialog version={selectedVersion} files={uploadFiles} setFiles={setUploadFiles} saving={saving} close={() => { setUploadOpen(false); setUploadFiles([]); }} submit={uploadAssets} />}
      {bindingOpen && <BindingDialog keyword={bindingKeyword} setKeyword={setBindingKeyword} options={bindingOptions} selected={bindingSelection} setSelected={setBindingSelection} boundIds={new Set(selectedManual?.bindings.map(item => item.id) || [])} close={() => setBindingOpen(false)} save={saveBindings} />}
      {deleteTarget && <DeleteDialog target={deleteTarget} value={deleteText} setValue={setDeleteText} saving={saving} close={() => { setDeleteTarget(null); setDeleteText(''); }} confirm={confirmDelete} />}
      {trashOpen && <ManualTrashDialog trash={trash} close={() => setTrashOpen(false)} restore={restoreTrash} />}
      {moreInfoOpen && selectedManual && <ManualMoreInfoDialog manual={selectedManual} version={selectedVersion} close={() => setMoreInfoOpen(false)} />}
      {tocEdit && selectedVersion && <TocEditDialog value={tocEdit} setValue={setTocEdit} currentPage={currentPreviewPage} pageCount={selectedVersion.pageCount || Math.max(1, activeAssets.length)} saving={saving} close={() => setTocEdit(null)} submit={saveTocEdit} />}
      {tocSuggestionOpen && <TocSuggestionDialog suggestions={availableTocSuggestions} selected={selectedTocSuggestions} setSelected={setSelectedTocSuggestions} saving={saving} close={() => setTocSuggestionOpen(false)} save={saveTocSuggestions} />}
      <BulkConnectorManualImportModal open={bulkOpen} close={() => setBulkOpen(false)} completed={async () => { setRefreshKey(value => value + 1); }} />
      {toast && <div className="manual-toast" role="status">{toast}</div>}
    </main>
  );
}

function ManualSideSummary({ manual, version }: { manual: ConnectorAssemblyManualDTO | null; version: ConnectorAssemblyManualVersionDTO | null }) {
  const metadata = manual ? [
    manual.manufacturer ? ['制造商', manual.manufacturer] : null,
    meaningfulRevision(version?.revision) ? ['版本', meaningfulRevision(version?.revision)] : null,
    dateText(version?.issuedAt) ? ['发布日期', dateText(version?.issuedAt)] : null,
    version?.pageCount ? ['页数', `${version.pageCount} 页`] : null,
  ].filter((row): row is string[] => row !== null) : [];
  return (
    <div className="manual-side-summary">
      <div className="manual-side-summary-head"><strong>说明书摘要</strong></div>
      {!manual && <p>选择说明书后查看目录、版本和关联型号。</p>}
      {metadata.length > 0 && <div>{metadata.map(([label, value]) => <span key={label}><small>{label}</small><b title={value}>{value}</b></span>)}</div>}
      {!!manual?.models.length && <section><small>适用型号</small><div>{manual.models.map(model => <i key={model}>{model}</i>)}</div></section>}
    </div>
  );
}

function ManualMoreInfoDialog({ manual, version, close }: { manual: ConnectorAssemblyManualDTO; version: ConnectorAssemblyManualVersionDTO | null; close: () => void }) {
  const rows = [
    manual.documentNo ? ['文档编号', manual.documentNo] : null,
    manual.family ? ['连接器系列', manual.family] : null,
    manual.keywords ? ['关键词', manual.keywords] : null,
    manual.summary ? ['摘要', manual.summary] : null,
    version?.remark ? ['版本备注', version.remark] : null,
    version?.assets[0]?.uploadedBy ? ['上传人', version.assets[0].uploadedBy] : null,
    manual.createdBy ? ['创建人', manual.createdBy] : null,
    manual.createdAt ? ['创建时间', dateText(manual.createdAt)] : null,
  ].filter((row): row is string[] => row !== null);
  return <div className="modal-backdrop"><section className="manual-dialog manual-more-info"><DialogTitle title="更多信息" close={close} /><div>{rows.map(([label, value]) => <article key={label}><span>{label}</span><p>{value}</p></article>)}{!rows.length && <p className="manual-side-empty">暂无更多信息</p>}</div></section></div>;
}

type ManualDialogProps = {
  mode: 'create' | 'edit';
  form: ManualForm;
  setForm: (value: ManualForm) => void;
  files: File[];
  suggestion: ClientManualInspection | null;
  parsing: boolean;
  setFiles: (files: File[]) => Promise<void>;
  applySuggestion: () => Promise<void>;
  bindingKeyword: string;
  setBindingKeyword: (value: string) => void;
  bindingOptions: ConnectorParameterDTO[];
  saving: boolean;
  close: () => void;
  submit: (event: FormEvent) => void;
};

function ManualDialog({ mode, form, setForm, files, suggestion, parsing, setFiles, applySuggestion, bindingKeyword, setBindingKeyword, bindingOptions, saving, close, submit }: ManualDialogProps) {
  if (mode === 'edit') {
    return <div className="modal-backdrop"><form className="manual-dialog" onSubmit={submit}><DialogTitle title="编辑说明书信息" close={close} /><div className="manual-form-grid"><label className="wide"><span>说明书名称 *</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label><label><span>制造商</span><input value={form.manufacturer} onChange={event => setForm({ ...form, manufacturer: event.target.value })} /></label><label><span>连接器系列</span><input value={form.family} onChange={event => setForm({ ...form, family: event.target.value })} /></label><label><span>文档编号</span><input value={form.documentNo} onChange={event => setForm({ ...form, documentNo: event.target.value })} /></label><label><span>关键词</span><input value={form.keywords} onChange={event => setForm({ ...form, keywords: event.target.value })} /></label><label className="wide"><span>摘要</span><textarea value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} /></label></div><DialogActions saving={saving} close={close} label="保存" /></form></div>;
  }

  const visibleOptions = bindingOptions.slice(0, 30);
  return (
    <div className="modal-backdrop">
      <form className="manual-dialog manual-single-flow" onSubmit={submit}>
        <DialogTitle title="单份新增组装说明书" close={close} />
        <nav className="manual-single-steps"><span className={files.length ? 'done' : 'active'}><b>1</b>选择文件</span><span className={parsing ? 'active' : suggestion ? 'done' : ''}><b>2</b>自动解析</span><span className={suggestion && !parsing ? 'active' : ''}><b>3</b>确认保存</span></nav>
        <div className="manual-single-body">
          <label className="manual-single-file"><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={event => void setFiles(Array.from(event.target.files || []))} /><strong>{files.length ? `已选择 ${files.length} 个文件` : '选择 PDF 或图片'}</strong><span>PDF 选择 1 个；图片可多选。解析阶段不会上传。</span></label>
          <label className="manual-single-title"><span>说明书名称 *</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="选择文件后自动使用文件名" /></label>
          {(parsing || suggestion) && <div className="manual-single-suggestion"><div><strong>{parsing ? '正在识别文件...' : `检测标题：${suggestion?.detectedTitle || '未识别（保留文件名）'}`}</strong>{suggestion && <span>{suggestion.pageCount ? `${suggestion.pageCount} 页 · ` : ''}{suggestion.modelCandidates.join(' / ') || '型号待确认'} · {suggestion.revisionCandidate || '版本待确认'}</span>}</div><button type="button" disabled={parsing || !suggestion} onClick={() => void applySuggestion()}>使用识别结果</button></div>}
          <details className="manual-single-advanced">
            <summary>高级信息 <span>制造商、版本、目录、型号关联</span></summary>
            <div className="manual-form-grid">
              <label><span>制造商</span><input value={form.manufacturer} onChange={event => setForm({ ...form, manufacturer: event.target.value })} /></label>
              <label><span>连接器系列</span><input value={form.family} onChange={event => setForm({ ...form, family: event.target.value })} /></label>
              <label><span>文档编号</span><input value={form.documentNo} onChange={event => setForm({ ...form, documentNo: event.target.value })} /></label>
              <label><span>关键词</span><input value={form.keywords} onChange={event => setForm({ ...form, keywords: event.target.value })} /></label>
              <label className="wide"><span>摘要</span><textarea value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} /></label>
              <label><span>首版版本</span><input value={form.revision} onChange={event => setForm({ ...form, revision: event.target.value })} /></label>
              <label><span>发布日期</span><input type="date" value={form.issuedAt} onChange={event => setForm({ ...form, issuedAt: event.target.value })} /></label>
              <label className="wide"><span>章节目录</span><textarea value={form.tocText} onChange={event => setForm({ ...form, tocText: event.target.value })} placeholder={'产品零件清单|3|4\n剥线|5|5'} /><small>每行：章节名称|开始页|结束页</small></label>
              <div className="wide manual-single-bindings"><label><span>型号关联</span><input value={bindingKeyword} onChange={event => setBindingKeyword(event.target.value)} placeholder="搜索型号" /></label><small>已选择 {form.connectorParameterIds.length} 条；识别结果仅在点击“使用识别结果”后加入。</small><div>{visibleOptions.map(option => { const checked = form.connectorParameterIds.includes(option.id); return <label key={option.id}><input type="checkbox" checked={checked} onChange={() => setForm({ ...form, connectorParameterIds: checked ? form.connectorParameterIds.filter(id => id !== option.id) : [...form.connectorParameterIds, option.id] })} /><span>{option.model || '未设置型号'}</span></label>; })}</div></div>
            </div>
          </details>
        </div>
        <DialogActions saving={saving} close={close} label="确认保存并上传" />
      </form>
    </div>
  );
}

function VersionDialog({ mode, form, setForm, saving, close, submit }: { mode: 'create' | 'edit'; form: VersionForm; setForm: (value: VersionForm) => void; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  return <div className="modal-backdrop"><form className="manual-dialog" onSubmit={submit}><DialogTitle title={mode === 'create' ? '新增说明书版本' : '编辑版本与章节目录'} close={close} /><div className="manual-form-grid"><label><span>版本 *</span><input value={form.revision} onChange={event => setForm({ ...form, revision: event.target.value })} /></label><label><span>发布日期</span><input type="date" value={form.issuedAt} onChange={event => setForm({ ...form, issuedAt: event.target.value })} /></label><label><span>文件类型</span><select disabled={mode === 'edit'} value={form.fileMode} onChange={event => setForm({ ...form, fileMode: event.target.value as 'PDF' | 'IMAGE_SET' })}><option value="PDF">PDF</option><option value="IMAGE_SET">图片集</option></select></label><label><span>状态</span><input value={form.status} onChange={event => setForm({ ...form, status: event.target.value })} /></label><label className="wide"><span>章节目录</span><textarea value={form.tocText} onChange={event => setForm({ ...form, tocText: event.target.value })} placeholder={'产品零件清单|3|4\n剥线|5|5\n压接端子|6|6'} /><small>每行格式：章节名称|开始页|结束页</small></label><label className="wide"><span>备注</span><textarea value={form.remark} onChange={event => setForm({ ...form, remark: event.target.value })} /></label></div><DialogActions saving={saving} close={close} label="保存版本" /></form></div>;
}

function UploadDialog({ version, files, setFiles, saving, close, submit }: { version: ConnectorAssemblyManualVersionDTO; files: File[]; setFiles: (files: File[]) => void; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  const isPdf = version.fileMode === 'PDF';
  return <div className="modal-backdrop"><form className="manual-dialog upload" onSubmit={submit}><DialogTitle title={`上传 ${version.revision} 文件`} close={close} /><label className="manual-upload-drop"><input type="file" multiple={!isPdf} accept={isPdf ? '.pdf,application/pdf' : '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'} onChange={event => setFiles(Array.from(event.target.files || []))} /><strong>{isPdf ? '选择一个 PDF' : '选择多张图片'}</strong><span>{isPdf ? '最大 100MB，上传后自动识别页数并提取可搜索文字' : '支持 JPG / PNG / WEBP，单张 20MB，最多 50 张'}</span></label><div className="manual-upload-files">{files.map(file => <span key={`${file.name}-${file.size}`}><strong>{file.name}</strong><small>{bytes(file.size)}</small></span>)}</div><DialogActions saving={saving} close={close} label="开始上传" /></form></div>;
}

function TocEditDialog({ value, setValue, currentPage, pageCount, saving, close, submit }: { value: NonNullable<TocEditState>; setValue: (value: TocEditState) => void; currentPage: number; pageCount: number; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  return (
    <div className="modal-backdrop">
      <form className="manual-dialog toc-edit-dialog" onSubmit={submit}>
        <DialogTitle title="编辑目录条目" close={close} />
        <div className="manual-form-grid">
          <label className="wide"><span>目录标题 *</span><input autoFocus value={value.title} maxLength={160} onChange={event => setValue({ ...value, title: event.target.value })} /></label>
          <label><span>起始页</span><input type="number" min={1} max={pageCount} value={value.pageStart} onChange={event => setValue({ ...value, pageStart: Number(event.target.value || 1) })} /><button className="toc-current-page-button" type="button" onClick={() => setValue({ ...value, pageStart: currentPage })}>设当前页为起始页</button></label>
          <label><span>结束页</span><input type="number" min={1} max={pageCount} value={value.pageEnd} onChange={event => setValue({ ...value, pageEnd: Number(event.target.value || 1) })} /><button className="toc-current-page-button" type="button" onClick={() => setValue({ ...value, pageEnd: currentPage })}>设当前页为结束页</button></label>
        </div>
        <DialogActions saving={saving} close={close} label="保存目录" />
      </form>
    </div>
  );
}

function TocSuggestionDialog({ suggestions, selected, setSelected, saving, close, save }: { suggestions: PdfTocSuggestion[]; selected: string[]; setSelected: (items: string[]) => void; saving: boolean; close: () => void; save: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="manual-dialog toc-suggestion-dialog">
        <DialogTitle title="目录建议" close={close} />
        <p className="toc-suggestion-note">建议来自 PDF 书签或前 3 页可提取文本，可能存在误差，请确认后保存。扫描型 PDF 不使用 OCR。</p>
        <div className="toc-suggestion-list">
          {suggestions.map(item => {
            const key = tocSuggestionKey(item);
            const checked = selected.includes(key);
            return <label key={key}><input type="checkbox" checked={checked} onChange={() => setSelected(checked ? selected.filter(value => value !== key) : [...selected, key])} /><strong>{item.title}</strong><span>{item.pageStart === item.pageEnd ? `第 ${item.pageStart} 页` : `${item.pageStart}-${item.pageEnd} 页`}</span><small>{item.source === 'outline' ? 'PDF 书签' : '目录文本'}</small></label>;
          })}
        </div>
        <div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving || !selected.length} onClick={save}>{saving ? '保存中...' : `保存已选 ${selected.length} 条`}</button></div>
      </section>
    </div>
  );
}

function BindingDialog({ keyword, setKeyword, options, selected, setSelected, boundIds, close, save }: { keyword: string; setKeyword: (value: string) => void; options: ConnectorParameterDTO[]; selected: string[]; setSelected: (ids: string[]) => void; boundIds: Set<string>; close: () => void; save: () => void }) {
  return <div className="modal-backdrop"><section className="manual-dialog binding"><DialogTitle title="关联连接器参数" close={close} /><input className="manual-binding-search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索型号，可批量选择" /><div className="manual-binding-options">{options.map(item => { const bound = boundIds.has(item.id); const checked = selected.includes(item.id); return <label className={bound ? 'bound' : ''} key={item.id}><input type="checkbox" disabled={bound} checked={checked || bound} onChange={() => setSelected(checked ? selected.filter(id => id !== item.id) : [...selected, item.id])} /><strong>{item.model || '未设置型号'}</strong><span>外剥 {item.outerPeelMm || '-'} · 内剥 {item.innerPeelMm || '-'} · 入长 {item.insertionLengthMm || '-'}</span><small>{bound ? '已关联' : ''}</small></label>; })}</div><div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary-button" type="button" disabled={!selected.length} onClick={save}>关联已选 {selected.length} 条</button></div></section></div>;
}

function DeleteDialog({ target, value, setValue, saving, close, confirm }: { target: NonNullable<DeleteTarget>; value: string; setValue: (value: string) => void; saving: boolean; close: () => void; confirm: () => void }) {
  const code = target.type === 'manual' ? 'DELETE_MANUAL' : 'DELETE_VERSION';
  return <div className="modal-backdrop"><section className="manual-dialog danger"><DialogTitle title={target.type === 'manual' ? '删除组装说明书' : '删除说明书版本'} close={close} /><p>此操作只做软删除，不会删除 S3 文件，也不会影响连接器参数。请输入 <b>{code}</b> 确认。</p><input value={value} onChange={event => setValue(event.target.value)} placeholder={code} /><div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="danger-button" type="button" disabled={saving || value.trim() !== code} onClick={confirm}>{saving ? '处理中...' : '确认删除'}</button></div></section></div>;
}

function ManualTrashDialog({ trash, close, restore }: { trash: TrashPayload; close: () => void; restore: (type: 'manual' | 'version' | 'asset', id: string) => void }) {
  const manuals = trash.connectorAssemblyManuals || [];
  const versions = trash.connectorAssemblyManualVersions || [];
  const assets = trash.connectorAssemblyManualAssets || [];
  return <div className="modal-backdrop"><section className="manual-dialog trash"><DialogTitle title="组装说明书回收站" close={close} /><div className="manual-trash-columns"><section><strong>已删除说明书</strong>{manuals.map(item => <article key={item.id}><span>{item.title}</span><button type="button" onClick={() => restore('manual', item.id)}>恢复</button></article>)}{!manuals.length && <p>暂无</p>}</section><section><strong>已删除版本</strong>{versions.map(item => <article key={item.id}><span>{item.manualTitle} · {item.revision}</span><button type="button" onClick={() => restore('version', item.id)}>恢复</button></article>)}{!versions.length && <p>暂无</p>}</section><section><strong>已删除文件</strong>{assets.map(item => <article key={item.id}><span>{item.manualTitle} · {item.displayName || item.originalName}</span><button type="button" onClick={() => restore('asset', item.id)}>恢复</button></article>)}{!assets.length && <p>暂无</p>}</section></div></section></div>;
}

function DialogTitle({ title, close }: { title: string; close: () => void }) {
  return <div className="dialog-title"><strong>{title}</strong><button type="button" aria-label={`关闭${title}`} title="关闭" onClick={close}>×</button></div>;
}

function DialogActions({ saving, close, label }: { saving: boolean; close: () => void; label: string }) {
  return <div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : label}</button></div>;
}
