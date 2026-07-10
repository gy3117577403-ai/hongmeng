'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { PortalMenu } from '@/components/PortalMenu';
import { BulkConnectorManualImportModal } from '@/components/BulkConnectorManualImportModal';
import { inspectConnectorManualFile } from '@/lib/client-connector-manual-inspector';
import type { ClientManualInspection } from '@/lib/client-connector-manual-inspector';
import type {
  ConnectorAssemblyManualAssetDTO,
  ConnectorAssemblyManualDTO,
  ConnectorAssemblyManualTocDTO,
  ConnectorAssemblyManualVersionDTO,
  ConnectorParameterDTO,
  CurrentUserDTO,
} from '@/types';

type RightTab = 'info' | 'toc' | 'versions' | 'bindings';
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
type TrashPayload = {
  connectorAssemblyManuals?: ConnectorAssemblyManualDTO[];
  connectorAssemblyManualVersions?: Array<ConnectorAssemblyManualVersionDTO & { manualTitle: string }>;
  connectorAssemblyManualAssets?: Array<ConnectorAssemblyManualAssetDTO & { manualTitle: string; revision: string }>;
};

const emptyManualForm: ManualForm = {
  title: '', manufacturer: '', family: '', documentNo: '', summary: '', keywords: '', revision: 'Rev 01', issuedAt: '', fileMode: 'PDF',
};
const emptyVersionForm: VersionForm = { revision: '', issuedAt: '', fileMode: 'PDF', status: '有效', remark: '', tocText: '' };

function dateText(value?: string | null): string {
  if (!value) return '-';
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
  };
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
  const [statusFilter, setStatusFilter] = useState('all');
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('info');
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
  const [libraryMenu, setLibraryMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const libraryButtonRef = useRef<HTMLButtonElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const urlAppliedRef = useRef(false);

  const accountName = user.displayName || user.username;
  const selectedManual = manuals.find(item => item.id === selectedId) || (statusFilter === 'deleted' ? null : manuals[0]) || null;
  const selectedVersion = selectedManual?.versions.find(item => item.id === selectedVersionId)
    || selectedManual?.latestVersion
    || selectedManual?.versions[0]
    || null;
  const activeAssets = useMemo(() => selectedVersion?.assets.filter(asset => !asset.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder) || [], [selectedVersion]);
  const selectedAsset = activeAssets[Math.max(0, Math.min(imageIndex, activeAssets.length - 1))] || null;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), pageSize: '20', latestOnly: 'false' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (manufacturer) params.set('manufacturer', manufacturer);
      if (family) params.set('family', family);
      if (model.trim()) params.set('model', model.trim());
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
  }, [family, keyword, manufacturer, model, page, refreshKey, statusFilter]);

  useEffect(() => {
    if (urlAppliedRef.current) return;
    urlAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const targetManualId = params.get('manualId') || '';
    const targetVersionId = params.get('versionId') || '';
    const targetPage = Number(params.get('page') || 1);
    const targetModel = params.get('model') || '';
    if (targetModel) setModel(targetModel);
    if (targetManualId) {
      void loadManual(targetManualId, targetVersionId, Number.isInteger(targetPage) ? targetPage : 1);
    }
  }, []);

  useEffect(() => {
    if (!selectedManual) return;
    if (!selectedVersion || selectedVersion.manualId !== selectedManual.id) setSelectedVersionId(selectedManual.latestVersion?.id || selectedManual.versions[0]?.id || '');
  }, [selectedManual, selectedVersion]);

  useEffect(() => {
    setPdfPage(1);
    setImageIndex(0);
  }, [selectedVersionId]);

  async function loadManual(id: string, versionId = '', targetPage = 1): Promise<void> {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/connector-assembly-manuals/${id}`, { cache: 'no-store' });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '说明书详情加载失败'));
      const manual = data.manual as ConnectorAssemblyManualDTO;
      setManuals(current => [manual, ...current.filter(item => item.id !== manual.id)]);
      setSelectedId(manual.id);
      setSelectedVersionId(versionId || manual.latestVersion?.id || manual.versions[0]?.id || '');
      setPdfPage(Math.max(1, targetPage));
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
    setSelectedVersionId(manual.latestVersion?.id || manual.versions[0]?.id || '');
    setRightTab('info');
    window.history.replaceState(null, '', `/connector-assembly-manuals?manualId=${encodeURIComponent(manual.id)}`);
  }

  function openCreateManual(): void {
    setManualForm(emptyManualForm);
    setSingleFiles([]);
    setSingleSuggestion(null);
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
    if (manualModal === 'create' && !manualForm.revision.trim()) return setToast('首版版本号不能为空');
    setSaving(true);
    try {
      const response = await fetch(manualModal === 'edit' && selectedManual ? `/api/connector-assembly-manuals/${selectedManual.id}` : '/api/connector-assembly-manuals', {
        method: manualModal === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualForm),
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
    setSingleFiles(files);
    setSingleSuggestion(null);
    if (!files.length) return;
    const pdf = files[0].type === 'application/pdf' || files[0].name.toLowerCase().endsWith('.pdf');
    setManualForm(current => ({
      ...current,
      title: current.title.trim() ? current.title : files[0].name.replace(/\.(?:pdf|jpe?g|png|webp)$/i, ''),
      fileMode: pdf ? 'PDF' : 'IMAGE_SET',
    }));
    setSingleParsing(true);
    try {
      const suggestion = await inspectConnectorManualFile(files[0], files[0].webkitRelativePath || files[0].name);
      setSingleSuggestion(suggestion);
    } finally {
      setSingleParsing(false);
    }
  }

  function applySingleSuggestion(): void {
    if (!singleSuggestion) return;
    setManualForm(current => ({
      ...current,
      manufacturer: singleSuggestion.manufacturerCandidate || current.manufacturer,
      family: singleSuggestion.familyCandidate || current.family,
      keywords: singleSuggestion.keywordCandidates.join('、') || current.keywords,
      revision: singleSuggestion.revisionCandidate || current.revision,
      issuedAt: singleSuggestion.issuedAtCandidate || current.issuedAt,
    }));
    setToast('已填入识别建议；说明书名称仍保留文件名');
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
    if (!bindingOpen) return undefined;
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
  }, [bindingKeyword, bindingOpen]);

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

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <main className="manual-page">
      <header className="topbar manual-topbar">
        <button className="home-button" type="button" aria-label="生产执行首页" onClick={() => { location.href = '/production'; }}>⌂</button>
        <div className="brand-block"><strong>连接器组装说明书</strong><span>PDF / 图片 · 版本 · 型号关联</span></div>
        <div className="manual-global-search">
          <b>⌕</b>
          <input value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索标题 / 型号 / 制造商 / 版本 / 关键词 / 正文" />
          {keyword && <button type="button" onClick={() => setKeyword('')}>清空</button>}
        </div>
        <div className="top-actions">
          <button className="primary-button manual-bulk-primary" type="button" onClick={() => setBulkOpen(true)}>批量导入说明书</button>
          <button className="manual-single-create" type="button" onClick={openCreateManual}>单份新增</button>
          <div className="library-wrap">
            <button ref={libraryButtonRef} className="library-button" type="button" onClick={() => setLibraryMenu(value => !value)}>▱ 资料库</button>
            <PortalMenu open={libraryMenu} anchorRef={libraryButtonRef} className="library-menu" width={230}>
              <button type="button" onClick={() => { location.href = '/production'; }}>生产执行中心</button>
              <button type="button" onClick={() => { location.href = '/dashboard'; }}>生产工单</button>
              <button type="button" onClick={() => { location.href = '/drawing-library'; }}>图纸资料库</button>
              <button type="button" onClick={() => { location.href = '/connector-parameters'; }}>连接器参数资料</button>
              <button className="active" type="button">连接器组装说明书 ✓</button>
            </PortalMenu>
          </div>
          <div className="user-wrap">
            <button ref={userButtonRef} className="user-button" type="button" onClick={() => setUserMenu(value => !value)}><span>♙</span><b title={accountName}>{accountName}</b><em>⌄</em></button>
            <PortalMenu open={userMenu} anchorRef={userButtonRef} className="user-menu app-user-menu" width={176}>
              <button type="button" onClick={loadTrash}>回收站</button>
              <button type="button" onClick={() => { location.href = '/dashboard?openLogs=1'; }}>操作日志</button>
              <button type="button" onClick={logout}>退出登录</button>
            </PortalMenu>
          </div>
        </div>
      </header>

      <nav className="manual-module-tabs" aria-label="连接器资料库模块">
        <a href="/connector-parameters">连接器参数</a>
        <a className="active" href="/connector-assembly-manuals">组装说明书</a>
        <a href="/connector-parameters?openFiles=1">原始资料附件</a>
        <a href="/connector-parameters?openBatches=1">导入批次</a>
      </nav>

      <section className="manual-workspace">
        <aside className="manual-list-panel">
          <div className="manual-list-filters">
            <p className="manual-list-import-note">可直接选择包含 PDF / 图片说明书的本地文件夹，文件名将作为默认说明书名称。</p>
            <select aria-label="制造商筛选" value={manufacturer} onChange={event => { setManufacturer(event.target.value); setPage(1); }}><option value="">全部制造商</option>{manufacturers.map(item => <option key={item} value={item}>{item}</option>)}</select>
            <select aria-label="系列筛选" value={family} onChange={event => { setFamily(event.target.value); setPage(1); }}><option value="">全部系列</option>{families.map(item => <option key={item} value={item}>{item}</option>)}</select>
            <input value={model} onChange={event => { setModel(event.target.value); setPage(1); }} placeholder="适用型号" />
            <select aria-label="完善状态筛选" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">全部</option><option value="latest">最新版</option><option value="incomplete">待完善</option><option value="parse_failed">解析失败</option><option value="unbound">未关联型号</option><option value="deleted">已删除</option></select>
          </div>
          <div className="manual-list-heading"><strong>{loading ? '加载中...' : `${total} 份说明书`}</strong><span>{page}/{totalPages}</span></div>
          <div className="manual-list-scroll">
            {manuals.map(manual => (
              <button className={`manual-card ${selectedManual?.id === manual.id ? 'active' : ''}`} type="button" key={manual.id} onClick={() => selectManual(manual)}>
                <strong title={manual.title}>{manual.title}</strong>
                <span className="manual-models" title={manual.models.join(' / ')}>{manual.models.length ? manual.models.join(' / ') : '暂未关联型号'}</span>
                <span>{manual.manufacturer || '未设置制造商'}</span>
                <small><b>{manual.latestVersion?.revision || '暂无版本'}</b><i>{manual.latestVersion?.pageCount ? `${manual.latestVersion.pageCount}页` : '待上传'}</i><i>{dateText(manual.latestVersion?.issuedAt)}</i></small>
              </button>
            ))}
            {!loading && !manuals.length && <div className="manual-list-empty"><strong>暂无组装说明书</strong><p>可直接批量选择 PDF / 图片文件夹，或使用单份新增。</p><button type="button" onClick={() => setBulkOpen(true)}>批量导入说明书</button></div>}
          </div>
          <div className="manual-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>
        </aside>

        <section className="manual-preview-panel">
          <div className="manual-current-bar">
            <div><span>{selectedManual?.manufacturer || '制造商未设置'}</span><strong title={selectedManual?.title}>{selectedManual?.title || '请选择说明书'}</strong><small>{selectedManual?.models.join(' / ') || '未关联型号'} · {selectedVersion?.revision || '暂无版本'}</small></div>
            <div>
              <button type="button" disabled={!selectedManual} onClick={openEditManual}>编辑信息</button>
              <button type="button" disabled={!selectedManual} onClick={openCreateVersion}>上传新版本</button>
              <button className="danger-text" type="button" disabled={!selectedManual} onClick={() => selectedManual && setDeleteTarget({ type: 'manual', item: selectedManual })}>删除</button>
            </div>
          </div>
          <div className="manual-preview-stage">
            {(loading || detailLoading) && <div className="manual-empty-preview"><span className="manual-loader" /><strong>说明书加载中</strong><p>正在读取版本和文件信息</p></div>}
            {!loading && !detailLoading && !selectedManual && <div className="manual-empty-preview"><span>MANUAL</span><strong>{statusFilter === 'deleted' ? '已删除说明书只在回收站恢复' : '建立连接器组装说明书资料库'}</strong><p>{statusFilter === 'deleted' ? '选择用户菜单中的回收站执行恢复，S3 原文件仍然保留。' : '集中管理 PDF、多图说明书、版本、目录和适用型号。'}</p><button type="button" onClick={statusFilter === 'deleted' ? loadTrash : () => setBulkOpen(true)}>{statusFilter === 'deleted' ? '打开回收站' : '批量导入第一批说明书'}</button></div>}
            {!loading && !detailLoading && selectedManual && !selectedVersion && <div className="manual-empty-preview missing"><span>01</span><strong>这份说明书还没有版本</strong><p>先创建版本，再上传 PDF 或多张图片。</p><button type="button" onClick={openCreateVersion}>创建首个版本</button></div>}
            {!loading && !detailLoading && selectedVersion && !selectedAsset && <div className="manual-empty-preview missing"><span>{selectedVersion.fileMode === 'PDF' ? 'PDF' : 'IMG'}</span><strong>当前版本尚未上传文件</strong><p>{selectedVersion.fileMode === 'PDF' ? '上传一个 PDF，系统会识别页数并提取可搜索文字。' : '可一次选择多张图片，并在版本面板调整顺序。'}</p><button type="button" onClick={() => setUploadOpen(true)}>上传文件</button></div>}
            {!loading && !detailLoading && selectedVersion?.fileMode === 'PDF' && selectedAsset && (
              <PdfViewer key={selectedVersion.id} fileId={selectedAsset.id} title={selectedAsset.displayName || selectedAsset.originalName} contentUrl={selectedAsset.contentUrl} downloadUrl={selectedAsset.downloadUrl} viewUrl={selectedAsset.contentUrl} page={pdfPage} onPageChange={setPdfPage} />
            )}
            {!loading && !detailLoading && selectedVersion?.fileMode === 'IMAGE_SET' && selectedAsset && (
              <div className="manual-image-preview">
                <div className="manual-image-pager"><button type="button" disabled={imageIndex <= 0} onClick={() => setImageIndex(value => Math.max(0, value - 1))}>上一页</button><span>{imageIndex + 1} / {activeAssets.length}</span><button type="button" disabled={imageIndex >= activeAssets.length - 1} onClick={() => setImageIndex(value => Math.min(activeAssets.length - 1, value + 1))}>下一页</button></div>
                <ImageViewer key={selectedAsset.id} fileId={selectedAsset.id} title={selectedAsset.displayName || selectedAsset.originalName} contentUrl={selectedAsset.contentUrl} downloadUrl={selectedAsset.downloadUrl} />
              </div>
            )}
          </div>
          {activeAssets.length > 1 && (
            <div className="manual-thumbnails" aria-label="说明书文件缩略条">
              {activeAssets.map((asset, index) => <button className={selectedAsset?.id === asset.id ? 'active' : ''} type="button" key={asset.id} onClick={() => setImageIndex(index)}><span>{asset.assetType === 'PDF' ? 'PDF' : String(index + 1)}</span><strong title={asset.displayName || asset.originalName}>{asset.displayName || asset.originalName}</strong></button>)}
            </div>
          )}
        </section>

        <aside className="manual-detail-panel">
          <div className="manual-detail-tabs">
            {([['info', '信息'], ['toc', '目录'], ['versions', '版本'], ['bindings', '型号']] as Array<[RightTab, string]>).map(([key, label]) => <button className={rightTab === key ? 'active' : ''} type="button" key={key} onClick={() => setRightTab(key)}>{label}{key === 'versions' && selectedManual ? ` ${selectedManual.versionCount}` : ''}{key === 'bindings' && selectedManual ? ` ${selectedManual.bindingCount}` : ''}</button>)}
          </div>
          <div className="manual-detail-scroll">
            {rightTab === 'info' && <ManualInfo manual={selectedManual} version={selectedVersion} />}
            {rightTab === 'toc' && (
              <div className="manual-toc-list">
                <div className="manual-section-head"><strong>章节目录</strong><button type="button" disabled={!selectedVersion} onClick={openEditVersion}>编辑</button></div>
                {selectedVersion?.tocJson.map((item, index) => <button type="button" key={`${item.title}-${index}`} onClick={() => setPdfPage(item.pageStart)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong><small>{item.pageStart === item.pageEnd ? `第 ${item.pageStart} 页` : `${item.pageStart}-${item.pageEnd} 页`}</small></button>)}
                {!selectedVersion?.tocJson.length && <div className="manual-side-empty">暂无章节目录，可在“编辑版本”中按行录入。</div>}
              </div>
            )}
            {rightTab === 'versions' && (
              <div className="manual-version-list">
                <div className="manual-section-head"><strong>版本历史</strong><button type="button" disabled={!selectedManual} onClick={openCreateVersion}>新增版本</button></div>
                {selectedManual?.versions.map(version => (
                  <article className={selectedVersion?.id === version.id ? 'active' : ''} key={version.id}>
                    <button className="manual-version-select" type="button" onClick={() => setSelectedVersionId(version.id)}><strong>{version.revision}</strong><span>{dateText(version.issuedAt)} · {version.pageCount || 0} 页</span>{version.isLatest && <b>最新版</b>}</button>
                    <div><button type="button" onClick={() => { setSelectedVersionId(version.id); setVersionForm(versionFormFrom(version)); setVersionModal('edit'); }}>编辑</button>{!version.isLatest && <button type="button" onClick={() => markLatest(version)}>设最新</button>}<button className="danger-text" type="button" onClick={() => setDeleteTarget({ type: 'version', item: version })}>删除</button></div>
                  </article>
                ))}
                {selectedVersion && <div className="manual-assets-manage"><div className="manual-section-head"><strong>当前版本文件</strong><button type="button" onClick={() => setUploadOpen(true)}>上传</button></div>{activeAssets.map((asset, index) => <div key={asset.id}><span>{index + 1}</span><strong title={asset.displayName || asset.originalName}>{asset.displayName || asset.originalName}</strong>{selectedVersion.fileMode === 'IMAGE_SET' && <><button type="button" disabled={index === 0} onClick={() => reorderAsset(asset, -1)}>↑</button><button type="button" disabled={index === activeAssets.length - 1} onClick={() => reorderAsset(asset, 1)}>↓</button></>}<a href={asset.downloadUrl}>下载</a><button className="danger-text" type="button" onClick={() => deleteAsset(asset)}>移除</button></div>)}</div>}
              </div>
            )}
            {rightTab === 'bindings' && (
              <div className="manual-binding-list">
                <div className="manual-section-head"><strong>关联连接器参数</strong><button type="button" disabled={!selectedManual} onClick={() => setBindingOpen(true)}>关联型号</button></div>
                {selectedManual?.bindings.map(binding => <article key={binding.id}><div><strong>{binding.model || '未设置型号'}</strong><span>序号 {binding.rowNo ?? '-'}</span></div><button type="button" onClick={() => unbindParameter(binding.id)}>解除</button></article>)}
                {!selectedManual?.bindings.length && <div className="manual-side-empty">暂无关联型号。系统不会自动关联无法确认的参数。</div>}
              </div>
            )}
          </div>
        </aside>
      </section>

      {manualModal && <ManualDialog mode={manualModal} form={manualForm} setForm={setManualForm} files={singleFiles} suggestion={singleSuggestion} parsing={singleParsing} setFiles={inspectSingleFiles} useSuggestion={applySingleSuggestion} saving={saving} close={() => setManualModal(null)} submit={saveManual} />}
      {versionModal && <VersionDialog mode={versionModal} form={versionForm} setForm={setVersionForm} saving={saving} close={() => setVersionModal(null)} submit={saveVersion} />}
      {uploadOpen && selectedVersion && <UploadDialog version={selectedVersion} files={uploadFiles} setFiles={setUploadFiles} saving={saving} close={() => { setUploadOpen(false); setUploadFiles([]); }} submit={uploadAssets} />}
      {bindingOpen && <BindingDialog keyword={bindingKeyword} setKeyword={setBindingKeyword} options={bindingOptions} selected={bindingSelection} setSelected={setBindingSelection} boundIds={new Set(selectedManual?.bindings.map(item => item.id) || [])} close={() => setBindingOpen(false)} save={saveBindings} />}
      {deleteTarget && <DeleteDialog target={deleteTarget} value={deleteText} setValue={setDeleteText} saving={saving} close={() => { setDeleteTarget(null); setDeleteText(''); }} confirm={confirmDelete} />}
      {trashOpen && <ManualTrashDialog trash={trash} close={() => setTrashOpen(false)} restore={restoreTrash} />}
      <BulkConnectorManualImportModal open={bulkOpen} close={() => setBulkOpen(false)} completed={async () => { setRefreshKey(value => value + 1); }} />
      {toast && <div className="manual-toast" role="status">{toast}</div>}
    </main>
  );
}

function ManualInfo({ manual, version }: { manual: ConnectorAssemblyManualDTO | null; version: ConnectorAssemblyManualVersionDTO | null }) {
  if (!manual) return <div className="manual-side-empty">选择一份说明书后查看详细信息。</div>;
  const rows = [
    ['说明书名称', manual.title], ['制造商', manual.manufacturer || '-'], ['连接器系列', manual.family || '-'], ['文档编号', manual.documentNo || '-'],
    ['当前版本', version?.revision || '-'], ['发布日期', dateText(version?.issuedAt)], ['文件类型', version?.fileMode === 'IMAGE_SET' ? '图片集' : 'PDF'], ['页数', String(version?.pageCount || 0)],
  ];
  return <div className="manual-info-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}<section><span>关键词</span><p>{manual.keywords || '未设置'}</p></section><section><span>摘要</span><p>{manual.summary || '未设置'}</p></section><section><span>版本备注</span><p>{version?.remark || '未设置'}</p></section></div>;
}

function ManualDialog({ mode, form, setForm, files, suggestion, parsing, setFiles, useSuggestion, saving, close, submit }: { mode: 'create' | 'edit'; form: ManualForm; setForm: (value: ManualForm) => void; files: File[]; suggestion: ClientManualInspection | null; parsing: boolean; setFiles: (files: File[]) => Promise<void>; useSuggestion: () => void; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  return <div className="modal-backdrop"><form className="manual-dialog" onSubmit={submit}><DialogTitle title={mode === 'create' ? '单份新增组装说明书' : '编辑说明书信息'} close={close} /><div className="manual-form-grid"><label className="wide"><span>说明书名称 *</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="默认使用文件名，可手工修改" /></label><label><span>制造商</span><input value={form.manufacturer} onChange={event => setForm({ ...form, manufacturer: event.target.value })} /></label><label><span>连接器系列</span><input value={form.family} onChange={event => setForm({ ...form, family: event.target.value })} /></label><label><span>文档编号</span><input value={form.documentNo} onChange={event => setForm({ ...form, documentNo: event.target.value })} /></label><label><span>关键词</span><input value={form.keywords} onChange={event => setForm({ ...form, keywords: event.target.value })} placeholder="型号、工序、材料等" /></label><label className="wide"><span>摘要</span><textarea value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} /></label>{mode === 'create' && <><label><span>首版版本 *</span><input value={form.revision} onChange={event => setForm({ ...form, revision: event.target.value })} /></label><label><span>发布日期</span><input type="date" value={form.issuedAt} onChange={event => setForm({ ...form, issuedAt: event.target.value })} /></label><label><span>文件类型</span><select value={form.fileMode} onChange={event => setForm({ ...form, fileMode: event.target.value as 'PDF' | 'IMAGE_SET' })}><option value="PDF">PDF</option><option value="IMAGE_SET">图片集</option></select></label><label className="wide manual-single-upload"><span>直接上传文件</span><input type="file" multiple={form.fileMode === 'IMAGE_SET'} accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={event => void setFiles(Array.from(event.target.files || []))} /><small>{files.length ? `已选择 ${files.length} 个文件` : '选择后只读取 PDF 前两页生成建议，不会立即上传'}</small></label>{(parsing || suggestion) && <div className="wide manual-single-suggestion"><div><strong>{parsing ? '正在识别...' : `识别标题：${suggestion?.detectedTitle || '未识别'}`}</strong>{suggestion && <span>页数 {suggestion.pageCount || '-'} · 型号 {suggestion.modelCandidates.join(' / ') || '未识别'} · 版本 {suggestion.revisionCandidate || '未识别'}</span>}</div><button type="button" disabled={parsing || !suggestion} onClick={useSuggestion}>使用识别结果</button></div>}</>}</div><DialogActions saving={saving} close={close} label={mode === 'create' && files.length ? '保存并上传' : '保存'} /></form></div>;
}

function VersionDialog({ mode, form, setForm, saving, close, submit }: { mode: 'create' | 'edit'; form: VersionForm; setForm: (value: VersionForm) => void; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  return <div className="modal-backdrop"><form className="manual-dialog" onSubmit={submit}><DialogTitle title={mode === 'create' ? '新增说明书版本' : '编辑版本与章节目录'} close={close} /><div className="manual-form-grid"><label><span>版本 *</span><input value={form.revision} onChange={event => setForm({ ...form, revision: event.target.value })} /></label><label><span>发布日期</span><input type="date" value={form.issuedAt} onChange={event => setForm({ ...form, issuedAt: event.target.value })} /></label><label><span>文件类型</span><select disabled={mode === 'edit'} value={form.fileMode} onChange={event => setForm({ ...form, fileMode: event.target.value as 'PDF' | 'IMAGE_SET' })}><option value="PDF">PDF</option><option value="IMAGE_SET">图片集</option></select></label><label><span>状态</span><input value={form.status} onChange={event => setForm({ ...form, status: event.target.value })} /></label><label className="wide"><span>章节目录</span><textarea value={form.tocText} onChange={event => setForm({ ...form, tocText: event.target.value })} placeholder={'产品零件清单|3|4\n剥线|5|5\n压接端子|6|6'} /><small>每行格式：章节名称|开始页|结束页</small></label><label className="wide"><span>备注</span><textarea value={form.remark} onChange={event => setForm({ ...form, remark: event.target.value })} /></label></div><DialogActions saving={saving} close={close} label="保存版本" /></form></div>;
}

function UploadDialog({ version, files, setFiles, saving, close, submit }: { version: ConnectorAssemblyManualVersionDTO; files: File[]; setFiles: (files: File[]) => void; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  const isPdf = version.fileMode === 'PDF';
  return <div className="modal-backdrop"><form className="manual-dialog upload" onSubmit={submit}><DialogTitle title={`上传 ${version.revision} 文件`} close={close} /><label className="manual-upload-drop"><input type="file" multiple={!isPdf} accept={isPdf ? '.pdf,application/pdf' : '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'} onChange={event => setFiles(Array.from(event.target.files || []))} /><strong>{isPdf ? '选择一个 PDF' : '选择多张图片'}</strong><span>{isPdf ? '最大 100MB，上传后自动识别页数并提取可搜索文字' : '支持 JPG / PNG / WEBP，单张 20MB，最多 50 张'}</span></label><div className="manual-upload-files">{files.map(file => <span key={`${file.name}-${file.size}`}><strong>{file.name}</strong><small>{bytes(file.size)}</small></span>)}</div><DialogActions saving={saving} close={close} label="开始上传" /></form></div>;
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
  return <div className="dialog-title"><strong>{title}</strong><button type="button" onClick={close}>×</button></div>;
}

function DialogActions({ saving, close, label }: { saving: boolean; close: () => void; label: string }) {
  return <div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : label}</button></div>;
}
