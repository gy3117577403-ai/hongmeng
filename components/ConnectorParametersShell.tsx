'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PortalMenu } from '@/components/PortalMenu';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { writeClipboardText } from '@/lib/client-platform';
import type {
  ConnectorParameterDTO,
  ConnectorParameterFileDTO,
  ConnectorParameterImportBatchDTO,
  ConnectorImportPreviewRowDTO,
  ConnectorImportPreviewSummaryDTO,
  ConnectorParameterStatsDTO,
  CurrentUserDTO,
  OperationLogDTO,
} from '@/types';

type ParameterForm = {
  rowNo: string;
  model: string;
  outerPeelMm: string;
  innerPeelMm: string;
  insertionLengthMm: string;
  remark: string;
  isHighlighted: boolean;
};
type ParameterModal = { mode: 'create' | 'edit'; item?: ConnectorParameterDTO } | null;
type ImportRow = { row: number; model: string; status: 'created' | 'skipped' | 'failed'; message: string };
type ImportResult = { summary: { created: number; skipped: number; failed: number; duplicateSkipped?: number; total: number }; results: ImportRow[] };
type ImportPreview = { rows: ConnectorImportPreviewRowDTO[]; summary: ConnectorImportPreviewSummaryDTO; sourceName: string };

const emptyForm: ParameterForm = {
  rowNo: '',
  model: '',
  outerPeelMm: '',
  innerPeelMm: '',
  insertionLengthMm: '',
  remark: '',
  isHighlighted: false,
};

const actionText: Record<string, string> = {
  create_connector_parameter: '新增连接器参数',
  update_connector_parameter: '编辑连接器参数',
  delete_connector_parameter: '删除连接器参数',
  restore_connector_parameter: '恢复连接器参数',
  import_connector_parameters: '导入连接器参数',
  export_connector_parameters: '导出连接器参数',
  batch_update_connector_parameters: '批量更新连接器参数',
  batch_delete_connector_parameters: '批量删除连接器参数',
  copy_connector_parameter: '复制连接器参数',
  upload_connector_parameter_file: '上传原始资料',
  delete_connector_parameter_file: '删除原始资料',
  download_connector_parameter_file: '下载原始资料',
  create_connector_parameter_import_batch: '创建导入批次',
  rollback_connector_parameter_import_batch: '回滚导入批次',
};

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const k = n / 1024;
  if (k < 1024) return `${k.toFixed(1)} KB`;
  return `${(k / 1024).toFixed(2)} MB`;
}

function dt(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d).replace(/\//g, '-');
}

function formFrom(item?: ConnectorParameterDTO): ParameterForm {
  if (!item) return emptyForm;
  return {
    rowNo: item.rowNo === null || item.rowNo === undefined ? '' : String(item.rowNo),
    model: item.model || '',
    outerPeelMm: item.outerPeelMm || '',
    innerPeelMm: item.innerPeelMm || '',
    insertionLengthMm: item.insertionLengthMm || '',
    remark: item.remark || '',
    isHighlighted: item.isHighlighted,
  };
}

function blank(value?: string | number | null) {
  const text = String(value ?? '').trim();
  return text || '';
}

function fileIcon(type: string) {
  const value = type.toLowerCase();
  if (value === 'pdf') return 'PDF';
  if (value === 'xlsx' || value === 'xls') return 'XLS';
  if (value === 'csv') return 'CSV';
  if (['jpg', 'jpeg', 'png'].includes(value)) return '图片';
  return 'FILE';
}

function downloadName(headers: Headers, fallback: string) {
  const value = headers.get('Content-Disposition') || '';
  const m = value.match(/filename\*=UTF-8''([^;]+)/);
  return m ? decodeURIComponent(m[1]) : fallback;
}

export function ConnectorParametersShell({ user }: { user: CurrentUserDTO }) {
  const [items, setItems] = useState<ConnectorParameterDTO[]>([]);
  const [files, setFiles] = useState<ConnectorParameterFileDTO[]>([]);
  const [deletedItems, setDeletedItems] = useState<ConnectorParameterDTO[]>([]);
  const [stats, setStats] = useState<ConnectorParameterStatsDTO>({ total: 0, missingOuter: 0, missingInner: 0, missingInsertion: 0, missingAny: 0, highlighted: 0, fileCount: 0 });
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<ParameterModal>(null);
  const [form, setForm] = useState<ParameterForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConnectorParameterDTO | null>(null);
  const [fileDeleteTarget, setFileDeleteTarget] = useState<ConnectorParameterFileDTO | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [batchDeleteConfirmText, setBatchDeleteConfirmText] = useState('');
  const [fileDeleteConfirmText, setFileDeleteConfirmText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'import'>('skip');
  const [importConfirmText, setImportConfirmText] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batching, setBatching] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<OperationLogDTO[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [batchDrawerOpen, setBatchDrawerOpen] = useState(false);
  const [importBatches, setImportBatches] = useState<ConnectorParameterImportBatchDTO[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<ConnectorParameterImportBatchDTO | null>(null);
  const [rollbackConfirmText, setRollbackConfirmText] = useState('');
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const fileImportRef = useRef<HTMLInputElement>(null);
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const rowMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const parameterDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const fileDrawerButtonRef = useRef<HTMLButtonElement>(null);
  const batchDrawerButtonRef = useRef<HTMLButtonElement>(null);
  const fileDrawerRef = useRef<HTMLElement>(null);
  const batchDrawerRef = useRef<HTMLElement>(null);
  const fileDrawerCloseButtonRef = useRef<HTMLButtonElement>(null);
  const batchDrawerCloseButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);

  const pageSize = 80;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pageIds = useMemo(() => items.map(item => item.id), [items]);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedSet.has(id));
  const searchTerm = keyword.trim();
  const hasActiveFilters = !!searchTerm || filter !== 'all';
  const formDirty = !!modal && JSON.stringify(form) !== JSON.stringify(formFrom(modal.item));
  const messageIsError = /失败|异常/.test(msg);
  const currentQuery = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (filter === 'outer') params.set('missing', 'outer');
    if (filter === 'inner') params.set('missing', 'inner');
    if (filter === 'insertion') params.set('missing', 'insertion');
    if (filter === 'any') params.set('missing', 'any');
    if (filter === 'highlighted') params.set('highlighted', 'true');
    return params;
  }, [filter, keyword, page]);

  async function loadData() {
    setLoading(true);
    try {
      const r = await fetch(`/api/connector-parameters?${currentQuery.toString()}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '连接器参数加载失败');
        return;
      }
      setItems(Array.isArray(d.parameters) ? d.parameters : []);
      setTotal(Number(d.total || 0));
      if (d.stats) setStats(d.stats);
    } catch {
      setMsg('连接器参数加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadFiles() {
    try {
      const r = await fetch('/api/connector-parameter-files', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setFiles(Array.isArray(d.files) ? d.files : []);
    } catch {
      setMsg('原始资料附件加载失败');
    }
  }

  async function loadDeleted() {
    try {
      const r = await fetch('/api/connector-parameters?deleted=true&pageSize=80', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setDeletedItems(Array.isArray(d.parameters) ? d.parameters : []);
    } catch {
      setMsg('已删除参数加载失败');
    }
  }

  async function loadImportBatches() {
    setBatchLoading(true);
    try {
      const r = await fetch('/api/connector-parameter-import-batches?limit=50', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '导入批次加载失败');
        return;
      }
      setImportBatches(Array.isArray(d.batches) ? d.batches : []);
    } catch {
      setMsg('导入批次加载失败');
    } finally {
      setBatchLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetKeyword = params.get('keyword') || '';
    if (targetKeyword) setKeyword(targetKeyword);
    if (params.get('openFiles') === '1') setFileDrawerOpen(true);
    if (params.get('openBatches') === '1') {
      setBatchDrawerOpen(true);
      void loadImportBatches();
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadData(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuery]);

  useEffect(() => {
    loadFiles();
  }, []);

  useEffect(() => {
    setSelectedIds(prev => prev.filter(id => pageIds.includes(id)));
  }, [pageIds]);

  useEffect(() => {
    setDeleteConfirmText('');
  }, [deleteTarget?.id]);

  useEffect(() => {
    setFileDeleteConfirmText('');
  }, [fileDeleteTarget?.id]);

  useEffect(() => {
    setRollbackConfirmText('');
  }, [rollbackTarget?.id]);

  useEffect(() => {
    if (batchDrawerOpen) {
      window.requestAnimationFrame(() => batchDrawerCloseButtonRef.current?.focus());
    } else if (fileDrawerOpen) {
      window.requestAnimationFrame(() => fileDrawerCloseButtonRef.current?.focus());
    }
  }, [batchDrawerOpen, fileDrawerOpen]);

  useEffect(() => {
    function closeTransientLayer(event: KeyboardEvent) {
      const drawerFocusActive = !rollbackTarget && !fileDeleteTarget && !batchDeleteOpen && !deleteTarget && !logsOpen && !importOpen && !modal;
      const activeDrawer = drawerFocusActive
        ? (batchDrawerOpen ? batchDrawerRef.current : fileDrawerOpen ? fileDrawerRef.current : null)
        : null;

      if (event.key === 'Tab' && activeDrawer) {
        const focusableElements = Array.from(activeDrawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
        if (!focusableElements.length) {
          event.preventDefault();
          activeDrawer.focus();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const focusOutsideDrawer = !activeDrawer.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === firstElement || focusOutsideDrawer)) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && (document.activeElement === lastElement || focusOutsideDrawer)) {
          event.preventDefault();
          firstElement.focus();
        }
        return;
      }

      if (event.key !== 'Escape') return;
      if (rollbackTarget) {
        setRollbackTarget(null);
        window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
      } else if (fileDeleteTarget) {
        setFileDeleteTarget(null);
        window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
      } else if (batchDeleteOpen) {
        setBatchDeleteOpen(false);
        window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
      } else if (deleteTarget) {
        setDeleteTarget(null);
        window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
      }
      else if (logsOpen) setLogsOpen(false);
      else if (importOpen) {
        setImportOpen(false);
        setImportPreview(null);
        setImportResult(null);
        setPasteText('');
        setImportConfirmText('');
        window.requestAnimationFrame(() => importButtonRef.current?.focus());
      } else if (modal) {
        setModal(null);
        window.requestAnimationFrame(() => parameterDialogTriggerRef.current?.focus());
      } else if (batchDrawerOpen) {
        setBatchDrawerOpen(false);
        window.requestAnimationFrame(() => batchDrawerButtonRef.current?.focus());
      } else if (fileDrawerOpen) {
        setFileDrawerOpen(false);
        window.requestAnimationFrame(() => fileDrawerButtonRef.current?.focus());
      }
    }
    window.addEventListener('keydown', closeTransientLayer);
    return () => window.removeEventListener('keydown', closeTransientLayer);
  }, [batchDeleteOpen, batchDrawerOpen, deleteTarget, fileDeleteTarget, fileDrawerOpen, importOpen, logsOpen, modal, rollbackTarget]);

  function clearFilters() {
    setKeyword('');
    setFilter('all');
    setPage(1);
  }

  function closeFileDrawer() {
    setFileDrawerOpen(false);
    window.requestAnimationFrame(() => fileDrawerButtonRef.current?.focus());
  }

  function closeBatchDrawer() {
    setBatchDrawerOpen(false);
    window.requestAnimationFrame(() => batchDrawerButtonRef.current?.focus());
  }

  function restoreConfirmationFocus() {
    window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
  }

  function closeDeleteConfirmation() {
    setDeleteTarget(null);
    restoreConfirmationFocus();
  }

  function closeBatchDeleteConfirmation() {
    setBatchDeleteOpen(false);
    restoreConfirmationFocus();
  }

  function closeFileDeleteConfirmation() {
    setFileDeleteTarget(null);
    restoreConfirmationFocus();
  }

  function closeRollbackConfirmation() {
    setRollbackTarget(null);
    restoreConfirmationFocus();
  }

  function openModal(mode: 'create' | 'edit', item?: ConnectorParameterDTO, trigger?: HTMLButtonElement | null) {
    setRowMenuId(null);
    parameterDialogTriggerRef.current = trigger || (mode === 'create' ? createButtonRef.current : null);
    setModal({ mode, item });
    setForm(formFrom(item));
    setFormError('');
  }

  function closeParameterModal() {
    setModal(null);
    window.requestAnimationFrame(() => parameterDialogTriggerRef.current?.focus());
  }

  async function saveParameter(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const isEdit = modal?.mode === 'edit' && modal.item;
      const r = await fetch(isEdit ? `/api/connector-parameters/${modal.item!.id}` : '/api/connector-parameters', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormError(d.error || '保存失败');
        return;
      }
      setModal(null);
      setMsg(isEdit ? '参数已更新' : '参数已新增');
      await loadData();
    } catch {
      setFormError('网络异常，保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleHighlight(item: ConnectorParameterDTO) {
    setRowMenuId(null);
    const r = await fetch(`/api/connector-parameters/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isHighlighted: !item.isHighlighted }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error || '重点标记失败');
    setMsg(!item.isHighlighted ? '已标记重点' : '已取消重点');
    await loadData();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim() !== 'DELETE') {
      setMsg('请输入 DELETE 后再删除参数');
      return;
    }
    const r = await fetch(`/api/connector-parameters/${deleteTarget.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmText: 'DELETE' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || '删除失败');
      return;
    }
    setDeleteTarget(null);
    setMsg('参数已软删除');
    await loadData();
    await loadDeleted();
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  function togglePageSelected() {
    setSelectedIds(allPageSelected ? [] : pageIds);
  }

  async function runBatch(action: 'highlight' | 'unhighlight' | 'delete') {
    if (!selectedIds.length) return setMsg('请先选择参数行');
    if (action === 'delete' && batchDeleteConfirmText.trim() !== 'DELETE') return setMsg('请输入 DELETE 后再批量删除');
    if (action !== 'delete' && !window.confirm(`将对已选 ${selectedIds.length} 条参数执行批量${action === 'highlight' ? '标记重点' : '取消重点'}，是否继续？`)) return;
    setBatching(true);
    try {
      const r = await fetch('/api/connector-parameters/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, action, confirmText: action === 'delete' ? batchDeleteConfirmText.trim() : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '批量操作失败');
        return;
      }
      setMsg(`批量操作完成：${d.count || 0} 条`);
      setSelectedIds([]);
      setBatchDeleteOpen(false);
      setBatchDeleteConfirmText('');
      await loadData();
      if (action === 'delete') await loadDeleted();
    } catch {
      setMsg('批量操作失败');
    } finally {
      setBatching(false);
    }
  }

  async function restoreParameter(id: string) {
    const r = await fetch(`/api/connector-parameters/${id}/restore`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error || '恢复失败');
    setMsg('参数已恢复');
    await loadData();
    await loadDeleted();
  }

  async function downloadFile(path: string, label: string, fallback: string) {
    setExporting(label);
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || `${label}失败`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(r.headers, fallback);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`${label}已开始下载`);
    } catch {
      setMsg(`${label}失败`);
    } finally {
      setExporting('');
    }
  }

  async function importFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setImporting(true);
    setImportPreview(null);
    setImportResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/api/connector-parameters/import/preview', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '导入预览失败');
        return;
      }
      setImportPreview({ rows: d.rows || [], summary: d.summary, sourceName: file.name });
      setDuplicateStrategy('skip');
      setMsg(`预览完成：可导入 ${d.summary?.readyCount || 0}，重复 ${d.summary?.duplicateCount || 0}，异常 ${d.summary?.invalidCount || 0}`);
    } catch {
      setMsg('导入预览失败，请检查文件格式');
    } finally {
      setImporting(false);
      if (fileImportRef.current) fileImportRef.current.value = '';
    }
  }

  async function importPaste() {
    if (!pasteText.trim()) return setMsg('请先粘贴 Excel 表格内容');
    setImporting(true);
    setImportPreview(null);
    setImportResult(null);
    try {
      const r = await fetch('/api/connector-parameters/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '粘贴导入预览失败');
        return;
      }
      setImportPreview({ rows: d.rows || [], summary: d.summary, sourceName: '粘贴内容' });
      setDuplicateStrategy('skip');
      setMsg(`预览完成：可导入 ${d.summary?.readyCount || 0}，重复 ${d.summary?.duplicateCount || 0}，异常 ${d.summary?.invalidCount || 0}`);
    } catch {
      setMsg('粘贴导入预览失败');
    } finally {
      setImporting(false);
    }
  }

  async function commitImport() {
    if (!importPreview) return;
    if (importPreview.summary.totalRows > 100 && importConfirmText.trim() !== 'IMPORT_CONFIRM') {
      setMsg('导入超过 100 行，请输入 IMPORT_CONFIRM 确认');
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const r = await fetch('/api/connector-parameters/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importPreview.rows, duplicateStrategy, sourceType: importTab, fileName: importPreview.sourceName }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '确认导入失败');
        return;
      }
      setImportResult(d);
      setImportPreview(null);
      setImportConfirmText('');
      setPasteText('');
      setMsg(`确认导入完成：新增 ${d.summary?.created || 0}，跳过 ${d.summary?.skipped || 0}，失败 ${d.summary?.failed || 0}`);
      await loadData();
      await loadImportBatches();
    } catch {
      setMsg('确认导入失败');
    } finally {
      setImporting(false);
    }
  }

  async function uploadSourceFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setUploadingFile(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/api/connector-parameter-files/upload', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '上传原始资料失败');
        return;
      }
      setMsg('原始资料已上传');
      setFileDrawerOpen(true);
      await loadFiles();
      await loadData();
    } catch {
      setMsg('上传原始资料失败');
    } finally {
      setUploadingFile(false);
      if (sourceFileRef.current) sourceFileRef.current.value = '';
    }
  }

  async function confirmDeleteFile() {
    if (!fileDeleteTarget) return;
    if (fileDeleteConfirmText.trim() !== 'DELETE') return setMsg('请输入 DELETE 后再删除原始资料');
    const r = await fetch(`/api/connector-parameter-files/${fileDeleteTarget.id}`, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error || '删除原始资料失败');
    setFileDeleteTarget(null);
    setMsg('原始资料已删除');
    await loadFiles();
    await loadData();
  }

  async function rollbackBatch() {
    if (!rollbackTarget) return;
    if (rollbackConfirmText.trim() !== 'ROLLBACK') return setMsg('请输入 ROLLBACK 后再回滚批次');
    setBatchLoading(true);
    try {
      const r = await fetch(`/api/connector-parameter-import-batches/${rollbackTarget.id}/rollback`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '导入批次回滚失败');
        return;
      }
      setMsg(`导入批次已回滚，软删除 ${d.count || 0} 条参数`);
      setRollbackTarget(null);
      setRollbackConfirmText('');
      await loadImportBatches();
      await loadData();
      await loadDeleted();
    } catch {
      setMsg('导入批次回滚失败');
    } finally {
      setBatchLoading(false);
    }
  }

  async function loadLogs() {
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      const r = await fetch('/api/operation-logs?limit=100', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setLogs(Array.isArray(d.logs) ? d.logs : []);
    } catch {
      setMsg('操作日志加载失败');
    } finally {
      setLogsLoading(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function closeImport() {
    setImportOpen(false);
    setImportPreview(null);
    setImportResult(null);
    setPasteText('');
    setImportConfirmText('');
    window.requestAnimationFrame(() => importButtonRef.current?.focus());
  }

  async function writeClipboard(text: string) {
    await writeClipboardText(text);
  }

  function openManuals(item: ConnectorParameterDTO) {
    if (!item.manualCount || !item.model) return;
    location.href = `/connector-assembly-manuals?model=${encodeURIComponent(item.model)}`;
  }

  async function copyParameter(item: ConnectorParameterDTO) {
    const text = [
      `型号：${blank(item.model)}`,
      `外剥皮：${blank(item.outerPeelMm)}`,
      `内剥皮：${blank(item.innerPeelMm)}`,
      `入长：${blank(item.insertionLengthMm)}`,
      `备注：${blank(item.remark)}`,
    ].join('\n');
    try {
      await writeClipboard(text);
      await fetch('/api/operation-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copy_connector_parameter',
          targetType: 'connector_parameter',
          targetId: item.id,
          detail: { model: item.model || '', rowNo: item.rowNo ?? null },
        }),
      });
      setMsg('已复制参数');
      setRowMenuId(null);
    } catch {
      setMsg('复制失败，请手动选择文本');
    }
  }

  function isMissingCell(field: 'outer' | 'inner' | 'insertion', value?: string | null) {
    if (filter !== field && filter !== 'any') return false;
    return !blank(value);
  }

  function highlightText(value?: string | number | null) {
    const text = blank(value);
    if (!searchTerm || !text) return text;
    const lowerText = text.toLowerCase();
    const lowerTerm = searchTerm.toLowerCase();
    const parts = [];
    let start = 0;
    let index = lowerText.indexOf(lowerTerm);
    let key = 0;
    while (index >= 0) {
      if (index > start) parts.push(text.slice(start, index));
      parts.push(<mark className="connector-search-hit" key={`hit-${key}`}>{text.slice(index, index + searchTerm.length)}</mark>);
      key += 1;
      start = index + searchTerm.length;
      index = lowerText.indexOf(lowerTerm, start);
    }
    if (start < text.length) parts.push(text.slice(start));
    return parts;
  }

  const filters = [
    ['all', '全部', stats.total],
    ['outer', '缺外剥皮', stats.missingOuter],
    ['inner', '缺内剥皮', stats.missingInner],
    ['insertion', '缺入长', stats.missingInsertion],
    ['any', '任意缺失', stats.missingAny || 0],
    ['highlighted', '重点', stats.highlighted],
  ] as const;

  return (
    <main className="connector-page hm-parameters-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/connector-parameters"
        subtitle="连接器工艺参数维护"
        menuItems={[
          { label: '操作日志', onSelect: loadLogs },
          { label: '返回生产工单', href: '/dashboard' },
          { label: '退出登录', onSelect: logout },
        ]}
      />

      <div className="hm-parameters-main">
        <WorkbenchPageHeader
          kicker="工艺参数"
          title="连接器参数库"
          description="集中查询、维护和导入连接器剥皮与入长参数"
          titleId="connector-parameters-page-title"
          actionsClassName="hm-parameters-page-actions"
          actions={<>
            <button ref={createButtonRef} className="hm-workbench-button primary" type="button" onClick={event => openModal('create', undefined, event.currentTarget)}>新增参数</button>
            <button ref={importButtonRef} className="hm-workbench-button" type="button" onClick={() => setImportOpen(true)}>批量导入</button>
            <button ref={fileDrawerButtonRef} className="hm-workbench-button" type="button" aria-controls="connector-parameter-files" aria-expanded={fileDrawerOpen} onClick={() => setFileDrawerOpen(true)}>附件 {stats.fileCount}</button>
            <button ref={batchDrawerButtonRef} className="hm-workbench-button" type="button" aria-controls="connector-import-batches" aria-expanded={batchDrawerOpen} onClick={() => { setBatchDrawerOpen(true); loadImportBatches(); }}>导入批次</button>
            <button className="hm-workbench-button" type="button" disabled={!!exporting} onClick={() => downloadFile('/api/connector-parameters/export.csv', '导出 CSV', '连接器参数资料.csv')}>{exporting === '导出 CSV' ? '导出中…' : '导出 CSV'}</button>
          </>}
        />

        <nav className="manual-module-tabs connector-library-tabs hm-parameters-library-tabs" aria-label="连接器资料库模块">
          <a className="active" href="/connector-parameters">连接器参数</a>
          <a href="/connector-assembly-manuals">组装说明书</a>
          <a href="/connector-parameters?openFiles=1">原始资料附件</a>
          <a href="/connector-parameters?openBatches=1">导入批次</a>
        </nav>

        <input ref={fileImportRef} hidden type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e => importFile(e.target.files)} />
        <input ref={sourceFileRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls,application/pdf,image/*,text/csv" onChange={e => uploadSourceFile(e.target.files)} />

        <section className="hm-parameters-query" aria-label="连接器参数搜索与筛选">
          <label className="hm-parameters-search" htmlFor="connector-parameter-search">
            <span>搜索参数</span>
            <span className="hm-parameters-search-control">
              <b aria-hidden="true">⌕</b>
              <input
                id="connector-parameter-search"
                className="hm-workbench-input"
                value={keyword}
                onChange={e => { setKeyword(e.target.value); setPage(1); }}
                onKeyDown={e => { if (e.key === 'Enter') loadData(); }}
                placeholder="型号、剥皮参数、入长或备注"
              />
              {keyword && <button type="button" aria-label="清空搜索关键词" onClick={() => { setKeyword(''); setPage(1); }}>清空</button>}
            </span>
          </label>

          <div className="hm-parameters-filter" role="group" aria-label="参数状态筛选">
            <span>数据状态</span>
            <div>
              {filters.map(([key, label, count]) => (
                <button key={key} className={filter === key ? 'active' : ''} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{label}<b>{count}</b></button>
              ))}
            </div>
          </div>

          <div className="hm-parameters-result-count" aria-live="polite">
            <span>{loading ? '正在查询' : '当前结果'}</span>
            <strong>{loading ? '…' : total}</strong>
            <small>条参数</small>
          </div>

          <button className="hm-workbench-button hm-parameters-restore-button" type="button" aria-expanded={deletedOpen} onClick={() => { setDeletedOpen(v => !v); loadDeleted(); }}>恢复删除</button>
        </section>

        {hasActiveFilters && (
          <section className="hm-parameters-active-filters" aria-label="已应用筛选条件">
            <span>已应用</span>
            {searchTerm && <b title={searchTerm}>关键词：{searchTerm}</b>}
            {filter !== 'all' && <b>状态：{filters.find(([key]) => key === filter)?.[1] || filter}</b>}
            <button type="button" onClick={clearFilters}>清除全部</button>
          </section>
        )}

        {deletedOpen && (
          <section className="connector-deleted-panel">
            <strong>已删除参数</strong>
            <div>
              {deletedItems.map(item => (
                <button key={item.id} type="button" onClick={() => restoreParameter(item.id)}>
                  {item.rowNo ?? '-'} · {item.model || '未填型号'} · 恢复
                </button>
              ))}
              {!deletedItems.length && <span>暂无已删除参数</span>}
            </div>
          </section>
        )}

        {!!selectedIds.length && (
          <section className="connector-batch-bar">
            <strong>已选 {selectedIds.length} 条</strong>
            <button type="button" disabled={batching} onClick={() => runBatch('highlight')}>批量标记重点</button>
            <button type="button" disabled={batching} onClick={() => runBatch('unhighlight')}>批量取消重点</button>
            <button className="danger-button" type="button" disabled={batching} onClick={event => { confirmationTriggerRef.current = event.currentTarget; setBatchDeleteOpen(true); }}>批量删除</button>
          </section>
        )}

        {msg && (
          <div className={messageIsError ? 'hm-parameters-message error' : 'hm-parameters-message'} role={messageIsError ? 'alert' : 'status'}>
            <span>{msg}</span>
            {messageIsError && <button type="button" onClick={() => { void loadData(); void loadFiles(); }}>重新加载</button>}
          </div>
        )}

        <section className="connector-content-grid">
          <div className="connector-table-panel" aria-busy={loading}>
            <div className="connector-table-head">
              <div><strong>参数结果</strong><span>{loading ? '正在刷新数据…' : hasActiveFilters ? '当前筛选范围' : '全部有效参数'}</span></div>
              <span>第 {page} / {totalPages} 页 · 共 {total} 条</span>
            </div>
            <div className="connector-table-wrap hm-scroll-region" tabIndex={0} aria-label="连接器参数结果表，可滚动查看更多记录和字段">
              <table className="connector-table">
                <thead>
                  <tr>
                    <th className="select-col"><input type="checkbox" checked={allPageSelected} onChange={togglePageSelected} aria-label="全选当前页" /></th>
                    <th>序号</th>
                    <th>型号</th>
                    <th>外剥皮mm</th>
                    <th>内剥皮mm</th>
                    <th>入长mm</th>
                    <th>备注</th>
                    <th>重点</th>
                    <th>更新时间</th>
                    <th>说明书</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className={`${item.isHighlighted ? 'highlighted' : ''} ${selectedSet.has(item.id) ? 'selected' : ''}`}>
                      <td className="sticky-cell select-cell"><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`选择 ${item.model || item.rowNo || '参数'}`} /></td>
                      <td className="sticky-cell row-no" title={blank(item.rowNo)}>{blank(item.rowNo)}</td>
                      <td className="sticky-cell model-cell" title={blank(item.model)}>{highlightText(item.model)}</td>
                      <td className={isMissingCell('outer', item.outerPeelMm) ? 'missing-cell' : ''} title={blank(item.outerPeelMm)}>{highlightText(item.outerPeelMm)}</td>
                      <td className={isMissingCell('inner', item.innerPeelMm) ? 'missing-cell' : ''} title={blank(item.innerPeelMm)}>{highlightText(item.innerPeelMm)}</td>
                      <td className={isMissingCell('insertion', item.insertionLengthMm) ? 'missing-cell' : ''} title={blank(item.insertionLengthMm)}>{highlightText(item.insertionLengthMm)}</td>
                      <td className="remark-cell" title={blank(item.remark)}>{highlightText(item.remark)}</td>
                      <td>{item.isHighlighted ? <span className="connector-highlight-tag">重点</span> : ''}</td>
                      <td>{dt(item.updatedAt)}</td>
                      <td><button className="connector-manual-count" type="button" disabled={!item.manualCount} onClick={() => openManuals(item)}>{item.manualCount ? `说明书 ${item.manualCount}` : '暂无说明书'}</button></td>
                      <td>
                        <div className="connector-row-actions">
                          <button type="button" onClick={event => openModal('edit', item, event.currentTarget)}>编辑</button>
                          <div className="connector-more-wrap">
                            <button
                              type="button"
                              aria-expanded={rowMenuId === item.id}
                              onClick={event => {
                                rowMenuButtonRef.current = event.currentTarget;
                                setRowMenuId(rowMenuId === item.id ? null : item.id);
                              }}
                            >
                              更多
                            </button>
                            <PortalMenu open={rowMenuId === item.id} anchorRef={rowMenuButtonRef} className="connector-row-menu" width={168} onClose={() => setRowMenuId(null)}>
                                <button type="button" onClick={() => toggleHighlight(item)}>{item.isHighlighted ? '取消重点' : '标记重点'}</button>
                                <button type="button" onClick={() => copyParameter(item)}>复制整行参数</button>
                                <button className="danger-text" type="button" onClick={event => { confirmationTriggerRef.current = rowMenuButtonRef.current || event.currentTarget; setRowMenuId(null); setDeleteTarget(item); }}>删除</button>
                            </PortalMenu>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={11}>
                        <div className="connector-empty-state">
                          <strong>{loading ? '正在加载参数' : hasActiveFilters ? '没有符合条件的参数' : '参数库中还没有记录'}</strong>
                          <p>{loading ? '数据返回后会保持当前表格位置。' : hasActiveFilters ? '尝试清除关键词或数据状态筛选。' : '可以新增单条参数，或先预览再批量导入。'}</p>
                          {!loading && <button className="hm-workbench-button" type="button" onClick={event => hasActiveFilters ? clearFilters() : openModal('create', undefined, event.currentTarget)}>{hasActiveFilters ? '清除筛选' : '新增参数'}</button>}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="connector-pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage(v => Math.max(1, v - 1))}>上一页</button>
              <span>{page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(v => Math.min(totalPages, v + 1))}>下一页</button>
            </div>
          </div>

        </section>

        {fileDrawerOpen && <>
        <button className="connector-file-scrim" type="button" aria-label="关闭原始资料抽屉" onClick={closeFileDrawer} />
        <aside ref={fileDrawerRef} id="connector-parameter-files" className="connector-file-drawer open" aria-label="原始资料附件" role="dialog" aria-modal="true" tabIndex={-1}>
            <div className="connector-file-head">
              <div><strong>原始资料附件</strong><span>{files.length} 个文件</span></div>
              <div>
                <button type="button" disabled={uploadingFile} onClick={() => sourceFileRef.current?.click()}>{uploadingFile ? '上传中...' : '上传'}</button>
                <button ref={fileDrawerCloseButtonRef} type="button" aria-label="关闭原始资料抽屉" title="关闭" onClick={closeFileDrawer}>×</button>
              </div>
            </div>
            <div className="connector-file-list hm-scroll-region" tabIndex={0} aria-label={`原始资料附件，共 ${files.length} 个文件`}>
              {files.map(file => (
                <article key={file.id} className="connector-file-card">
                  <div className="connector-file-meta">
                    <span className={`connector-file-icon ${file.fileType}`}>{fileIcon(file.fileType)}</span>
                    <div>
                      <strong title={file.displayName || file.originalName}>{file.displayName || file.originalName}</strong>
                      <span>{bytes(file.fileSize)}</span>
                      <small>{dt(file.createdAt)} · {file.uploadedBy || '-'}</small>
                    </div>
                  </div>
                  <div>
                    <a href={file.downloadUrl} target="_blank" rel="noreferrer">下载</a>
                    <button type="button" onClick={event => { confirmationTriggerRef.current = event.currentTarget; setFileDeleteTarget(file); }}>删除</button>
                  </div>
                </article>
              ))}
              {!files.length && <div className="empty-list">暂无原始资料，可上传 Excel / PDF / 图片作为留档。</div>}
            </div>
          </aside>
        </>}
        {batchDrawerOpen && <>
        <button className="connector-file-scrim" type="button" aria-label="关闭导入批次抽屉" onClick={closeBatchDrawer} />
        <aside ref={batchDrawerRef} id="connector-import-batches" className="connector-file-drawer import-batch-drawer open" aria-label="参数导入批次" role="dialog" aria-modal="true" tabIndex={-1}>
          <div className="connector-file-head">
            <div><strong>导入批次</strong><span>最近 {importBatches.length} 个批次</span></div>
            <div>
              <button type="button" disabled={batchLoading} onClick={loadImportBatches}>{batchLoading ? '刷新中...' : '刷新'}</button>
              <button ref={batchDrawerCloseButtonRef} type="button" aria-label="关闭导入批次抽屉" title="关闭" onClick={closeBatchDrawer}>×</button>
            </div>
          </div>
          <div className="connector-file-list hm-scroll-region" tabIndex={0} aria-label={`参数导入批次，共 ${importBatches.length} 项`}>
            {batchLoading && <div className="empty-list">导入批次加载中...</div>}
            {importBatches.map(batch => (
              <article key={batch.id} className="connector-file-card import-batch-card">
                <div className="connector-file-meta">
                  <span className="connector-file-icon csv">批次</span>
                  <div>
                    <strong title={batch.fileName || batch.id}>{batch.fileName || '粘贴导入'}</strong>
                    <span>{dt(batch.createdAt)} · 新增 {batch.insertedCount} / 总行 {batch.totalRows}</span>
                    <small>重复 {batch.duplicateCount} · 失败 {batch.invalidCount} · 跳过 {batch.skippedCount}</small>
                    <small>{batch.rolledBackAt ? `已回滚：${dt(batch.rolledBackAt)}` : `可回滚 ${batch.activeParameterCount ?? 0} 条`}</small>
                  </div>
                </div>
                <div>
                  <button className="hm-parameters-danger-action" type="button" disabled={!!batch.rolledBackAt || !(batch.activeParameterCount || 0)} title="软删除该批次仍有效的导入记录" onClick={event => { confirmationTriggerRef.current = event.currentTarget; setRollbackTarget(batch); }}>回滚此批次</button>
                </div>
              </article>
            ))}
            {!batchLoading && !importBatches.length && <div className="empty-list">暂无导入批次。</div>}
          </div>
        </aside>
        </>}
      </div>

      {modal && (
        <div className="modal-backdrop" role="presentation">
          <form className="connector-dialog" role="dialog" aria-modal="true" aria-labelledby="connector-parameter-dialog-title" aria-describedby="connector-parameter-dialog-help" onSubmit={saveParameter}>
            <div className="dialog-title">
              <div>
                <span>{modal.mode === 'create' ? '新增记录' : '维护记录'}</span>
                <strong id="connector-parameter-dialog-title">{modal.mode === 'create' ? '新增连接器参数' : modal.item?.model || `编辑参数 #${modal.item?.rowNo ?? '-'}`}</strong>
              </div>
              {formDirty && <em>未保存</em>}
              <button type="button" aria-label="关闭参数编辑窗口" title="关闭" onClick={closeParameterModal}>×</button>
            </div>
            <p id="connector-parameter-dialog-help" className="hm-parameters-form-help">至少填写一项记录内容；序号必须为整数。保存时继续使用现有服务端校验。</p>
            <section className="hm-parameters-form-section" aria-labelledby="parameter-basic-heading">
              <h2 id="parameter-basic-heading">基础识别信息</h2>
              <div className="connector-form-grid basic">
                <label><span>序号</span><input value={form.rowNo} onChange={e => setForm(v => ({ ...v, rowNo: e.target.value }))} inputMode="numeric" aria-invalid={formError.includes('序号')} placeholder="数字序号，可留空" /></label>
                <label><span>型号</span><input value={form.model} onChange={e => setForm(v => ({ ...v, model: e.target.value }))} placeholder="连接器型号，可留空" /></label>
              </div>
            </section>
            <section className="hm-parameters-form-section" aria-labelledby="parameter-process-heading">
              <h2 id="parameter-process-heading">剥皮与入长参数</h2>
              <div className="connector-form-grid process">
                <label><span>外剥皮 <small>mm</small></span><input value={form.outerPeelMm} onChange={e => setForm(v => ({ ...v, outerPeelMm: e.target.value }))} /></label>
                <label><span>内剥皮 <small>mm</small></span><input value={form.innerPeelMm} onChange={e => setForm(v => ({ ...v, innerPeelMm: e.target.value }))} /></label>
                <label><span>入长 <small>mm</small></span><input value={form.insertionLengthMm} onChange={e => setForm(v => ({ ...v, insertionLengthMm: e.target.value }))} /></label>
              </div>
            </section>
            <section className="hm-parameters-form-section" aria-labelledby="parameter-note-heading">
              <h2 id="parameter-note-heading">记录信息</h2>
              <div className="connector-form-grid note">
                <label className="wide"><span>备注</span><textarea value={form.remark} onChange={e => setForm(v => ({ ...v, remark: e.target.value }))} placeholder="补充工艺说明或注意事项" /></label>
                <label className="check-line"><input type="checkbox" checked={form.isHighlighted} onChange={e => setForm(v => ({ ...v, isHighlighted: e.target.checked }))} /> 标记为重点参数</label>
              </div>
            </section>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <div className="dialog-actions">
              <span>{formDirty ? '当前有未保存修改' : '尚未修改'}</span>
              <button type="button" onClick={closeParameterModal}>取消</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : modal.mode === 'create' ? '新增参数' : '保存修改'}</button>
            </div>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="connector-import-dialog" role="dialog" aria-modal="true" aria-label="导入连接器参数">
            <div className="dialog-title">
              <div><span>批量维护</span><strong>导入连接器参数</strong></div>
              <button type="button" aria-label="关闭参数导入窗口" title="关闭" onClick={closeImport}>×</button>
            </div>
            <div className="trash-tabs">
              <button className={importTab === 'file' ? 'active' : ''} type="button" onClick={() => setImportTab('file')}>文件导入</button>
              <button className={importTab === 'paste' ? 'active' : ''} type="button" onClick={() => setImportTab('paste')}>粘贴导入</button>
            </div>
            {importTab === 'file' ? (
              <div className="connector-import-pane">
                <p>支持 CSV、XLSX、XLS。选择文件后仅解析预览，不会直接写入数据库；确认导入后才创建批次。</p>
                <div className="system-actions">
                  <button type="button" onClick={() => fileImportRef.current?.click()} disabled={importing}>{importing ? '解析中...' : '选择 Excel / CSV 预览'}</button>
                  <button type="button" onClick={() => downloadFile('/api/connector-parameters/template.csv', '下载模板', '连接器参数导入模板.csv')}>下载模板</button>
                </div>
              </div>
            ) : (
              <div className="connector-import-pane">
                <p>从 Excel 复制整块表格后粘贴到下方。点击预览后不会直接入库，空单元格会保持为空。</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="序号	型号	外剥皮mm	内剥皮mm	入长mm	备注	重点" />
                <div className="system-actions">
                  <button className="primary-button" type="button" onClick={importPaste} disabled={importing}>{importing ? '解析中...' : '预览粘贴内容'}</button>
                  <button type="button" onClick={() => setPasteText('')}>清空</button>
                </div>
              </div>
            )}
            {importPreview && (
              <div className="import-preview">
                <div className="import-summary" aria-label="导入预览统计">
                  <span>总行 {importPreview.summary.totalRows}</span>
                  <span>可导入 {importPreview.summary.readyCount}</span>
                  <span>重复 {importPreview.summary.duplicateCount}</span>
                  <span>异常 {importPreview.summary.invalidCount}</span>
                  <span>跳过 {importPreview.summary.skippedCount}</span>
                  <span>重点 {importPreview.summary.highlightedCount}</span>
                </div>
                <div className="duplicate-strategy">
                  <label><input type="radio" checked={duplicateStrategy === 'skip'} onChange={() => setDuplicateStrategy('skip')} /> 跳过重复行</label>
                  <label><input type="radio" checked={duplicateStrategy === 'import'} onChange={() => setDuplicateStrategy('import')} /> 仍然导入重复行</label>
                </div>
                <div className="import-confirm-summary" role="status">
                  <span>将新增 {importPreview.summary.readyCount + (duplicateStrategy === 'import' ? importPreview.summary.duplicateCount : 0)} 条</span>
                  <span>跳过重复 {duplicateStrategy === 'skip' ? importPreview.summary.duplicateCount : 0} 条</span>
                  <span>失败 {importPreview.summary.invalidCount} 条</span>
                </div>
                {importPreview.summary.totalRows > 100 && (
                  <label className="confirm-input-label">
                    超过 100 行，输入 IMPORT_CONFIRM 后才能确认导入
                    <input value={importConfirmText} onChange={e => setImportConfirmText(e.target.value)} placeholder="IMPORT_CONFIRM" />
                  </label>
                )}
                <div className="import-preview-table">
                  <div className="import-preview-head">
                    <span>行</span><span>型号</span><span>外剥皮</span><span>内剥皮</span><span>入长</span><span>备注</span><span>状态</span>
                  </div>
                  {importPreview.rows.slice(0, 120).map(row => (
                    <div className={`import-preview-row ${row.status}`} key={`${row.index}-${row.model}-${row.status}`}>
                      <span>{row.index}</span>
                      <span title={row.model || ''}>{row.model || ''}</span>
                      <span>{row.outerPeelMm || ''}</span>
                      <span>{row.innerPeelMm || ''}</span>
                      <span>{row.insertionLengthMm || ''}</span>
                      <span title={row.remark || ''}>{row.remark || ''}</span>
                      <span>{row.status === 'ready' ? '可导入' : row.status === 'duplicate' ? '疑似重复' : row.status === 'invalid' ? '异常' : '跳过'}{row.reason ? ` · ${row.reason}` : ''}</span>
                    </div>
                  ))}
                </div>
                <div className="dialog-actions">
                  <button type="button" onClick={() => setImportPreview(null)}>重新选择</button>
                  <button className="primary-button" type="button" onClick={commitImport} disabled={importing || (importPreview.summary.totalRows > 100 && importConfirmText.trim() !== 'IMPORT_CONFIRM')}>{importing ? '正在写入…' : `确认写入 ${importPreview.summary.readyCount + (duplicateStrategy === 'import' ? importPreview.summary.duplicateCount : 0)} 条`}</button>
                </div>
              </div>
            )}
            {importResult && (
              <div className="import-result">
                <div className="import-summary">
                  <span>新增 {importResult.summary.created}</span>
                  <span>跳过 {importResult.summary.skipped}</span>
                  <span>失败 {importResult.summary.failed}</span>
                  {!!importResult.summary.duplicateSkipped && <span>重复跳过 {importResult.summary.duplicateSkipped}</span>}
                </div>
                <details>
                  <summary>查看明细</summary>
                  <div className="import-result-list hm-scroll-region" tabIndex={0} aria-label="参数导入预览结果">
                    {importResult.results.map(row => (
                      <div className={`import-row ${row.status}`} key={`${row.row}-${row.model}-${row.message}`}>
                        <span>第 {row.row} 行</span>
                        <b>{row.model || '-'}</b>
                        <em>{row.status === 'created' ? '新增' : row.status === 'skipped' ? '跳过' : '失败'}</em>
                        <small>{row.message}</small>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </section>
        </div>
      )}

      {logsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="logs-dialog" role="dialog" aria-modal="true" aria-label="操作日志">
            <div className="dialog-title">
              <strong>操作日志</strong>
              <button type="button" aria-label="关闭操作日志" title="关闭" onClick={() => setLogsOpen(false)}>×</button>
            </div>
            {logsLoading ? <div className="empty-list">日志加载中...</div> : (
              <div className="logs-table">
                <div className="logs-head"><span>时间</span><span>用户</span><span>操作</span><span>目标</span><span>详情摘要</span></div>
                {logs.map(log => (
                  <div className="logs-row" key={log.id}>
                    <span>{dt(log.createdAt)}</span>
                    <span>{log.user}</span>
                    <span>{actionText[log.action] || log.action}</span>
                    <span>{log.targetType || '-'}<small>{log.targetId || ''}</small></span>
                    <span>{log.detailSummary || '-'}</span>
                  </div>
                ))}
                {!logs.length && <div className="empty-list">暂无操作日志</div>}
              </div>
            )}
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除连接器参数">
            <div className="dialog-title">
              <strong>确认删除参数</strong>
              <button type="button" aria-label="关闭参数删除确认" title="关闭" onClick={closeDeleteConfirmation}>×</button>
            </div>
            <p>仅软删除参数记录，可在恢复删除中找回。</p>
            <div className="delete-file-name">{deleteTarget.rowNo ?? '-'} · {deleteTarget.model || '未填型号'}</div>
            <div className="danger-confirm-detail">
              <span>外剥皮：{deleteTarget.outerPeelMm || '-'}</span>
              <span>内剥皮：{deleteTarget.innerPeelMm || '-'}</span>
              <span>入长：{deleteTarget.insertionLengthMm || '-'}</span>
            </div>
            <label className="confirm-input-label">
              输入 DELETE 确认删除
              <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={closeDeleteConfirmation}>取消</button>
              <button className="danger-button" type="button" disabled={deleteConfirmText.trim() !== 'DELETE'} onClick={confirmDelete}>确认删除</button>
            </div>
          </section>
        </div>
      )}

      {batchDeleteOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="批量删除连接器参数">
            <div className="dialog-title">
              <strong>确认批量删除</strong>
              <button type="button" aria-label="关闭批量删除确认" title="关闭" onClick={closeBatchDeleteConfirmation}>×</button>
            </div>
            <p>将软删除已选 {selectedIds.length} 条参数记录，此操作可恢复。</p>
            <label className="confirm-input-label">
              输入 DELETE 确认批量删除
              <input value={batchDeleteConfirmText} onChange={e => setBatchDeleteConfirmText(e.target.value)} placeholder="DELETE" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={closeBatchDeleteConfirmation}>取消</button>
              <button className="danger-button" type="button" disabled={batching || batchDeleteConfirmText.trim() !== 'DELETE'} onClick={() => runBatch('delete')}>{batching ? '删除中...' : '确认删除'}</button>
            </div>
          </section>
        </div>
      )}

      {fileDeleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除原始资料">
            <div className="dialog-title">
              <strong>确认删除原始资料</strong>
              <button type="button" aria-label="关闭附件删除确认" title="关闭" onClick={closeFileDeleteConfirmation}>×</button>
            </div>
            <p>仅软删除附件记录，不删除对象存储中的历史对象。</p>
            <div className="delete-file-name">{fileDeleteTarget.originalName}</div>
            <label className="confirm-input-label">
              输入 DELETE 确认删除附件
              <input value={fileDeleteConfirmText} onChange={e => setFileDeleteConfirmText(e.target.value)} placeholder="DELETE" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={closeFileDeleteConfirmation}>取消</button>
              <button className="danger-button" type="button" disabled={fileDeleteConfirmText.trim() !== 'DELETE'} onClick={confirmDeleteFile}>确认删除</button>
            </div>
          </section>
        </div>
      )}

      {rollbackTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="回滚导入批次">
            <div className="dialog-title">
              <strong>确认回滚导入批次</strong>
              <button type="button" aria-label="关闭批次回滚确认" title="关闭" onClick={closeRollbackConfirmation}>×</button>
            </div>
            <p>将软删除该批次导入且尚未删除的 {rollbackTarget.activeParameterCount || 0} 条参数，不影响手动新增参数。本批次回滚后不能重复回滚，记录可在“恢复删除”中找回。</p>
            <div className="delete-file-name">{rollbackTarget.fileName || '粘贴导入'} · {dt(rollbackTarget.createdAt)}</div>
            <div className="danger-confirm-detail">
              <span>批次总行：{rollbackTarget.totalRows}</span>
              <span>已新增：{rollbackTarget.insertedCount}</span>
              <span>本次影响：{rollbackTarget.activeParameterCount || 0} 条有效参数</span>
            </div>
            <label className="confirm-input-label">
              输入 ROLLBACK 确认回滚
              <input value={rollbackConfirmText} onChange={e => setRollbackConfirmText(e.target.value)} placeholder="ROLLBACK" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={closeRollbackConfirmation}>取消</button>
              <button className="danger-button" type="button" disabled={batchLoading || rollbackConfirmText.trim() !== 'ROLLBACK'} onClick={rollbackBatch}>{batchLoading ? '回滚中...' : '确认回滚'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
