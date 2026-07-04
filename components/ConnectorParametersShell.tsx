'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [lib, setLib] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
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

  const pageSize = 80;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const accountName = user.displayName || user.username;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pageIds = useMemo(() => items.map(item => item.id), [items]);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedSet.has(id));
  const searchTerm = keyword.trim();
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

  function openModal(mode: 'create' | 'edit', item?: ConnectorParameterDTO) {
    setRowMenuId(null);
    setModal({ mode, item });
    setForm(formFrom(item));
    setFormError('');
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
  }

  async function writeClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('copy failed');
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
    <main className="connector-page">
      <header className="topbar connector-topbar">
        <button className="home-button" type="button" aria-label="首页" onClick={() => { location.href = '/dashboard'; }}>⌂</button>
        <div className="brand-block">
          <strong>连接器参数资料</strong>
          <span>线束连接器剥皮与入长参数管理</span>
        </div>
        <div className="connector-search">
          <input
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPage(1); }}
            onKeyDown={e => { if (e.key === 'Enter') loadData(); }}
            placeholder="搜索型号 / 参数 / 备注"
          />
          {keyword && <button type="button" onClick={() => { setKeyword(''); setPage(1); }}>清空</button>}
          <b>⌕</b>
        </div>
        <div className="top-actions">
          <button className="log-button" type="button" onClick={loadLogs}>操作日志</button>
          <div className="library-wrap">
            <button className="library-button" type="button" onClick={() => setLib(v => !v)}>▱ 资料库</button>
            {lib && (
              <div className="library-menu">
                <button type="button" onClick={() => { location.href = '/dashboard'; }}>▤ 生产资料</button>
                <button className="active" type="button">连接器参数资料 ✓</button>
              </div>
            )}
          </div>
          <div className="user-wrap">
            <button className="user-button" type="button" onClick={() => setUserMenu(v => !v)}>
              <span>♙</span><b title={accountName}>{accountName}</b><em>⌄</em>
            </button>
            {userMenu && (
              <div className="user-menu">
                <button type="button" onClick={() => { location.href = '/dashboard'; }}>返回生产资料</button>
                <button type="button" onClick={loadLogs}>操作日志</button>
                <button type="button" onClick={logout}>退出登录</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="connector-shell">
        <div className="connector-hero">
          <div>
            <span>参数资料</span>
            <h1>连接器参数资料</h1>
            <p>线束连接器剥皮与入长参数管理</p>
          </div>
          <div className="connector-actions">
            <button className="primary-button" type="button" onClick={() => openModal('create')}>新增参数</button>
            <button type="button" onClick={() => setImportOpen(true)}>导入 Excel / CSV</button>
            <button type="button" onClick={() => { setBatchDrawerOpen(true); loadImportBatches(); }}>导入批次</button>
            <button type="button" disabled={!!exporting} onClick={() => downloadFile('/api/connector-parameters/export.csv', '导出 CSV', '连接器参数资料.csv')}>导出 CSV</button>
            <button type="button" disabled={!!exporting} onClick={() => downloadFile('/api/connector-parameters/template.csv', '下载模板', '连接器参数导入模板.csv')}>下载模板</button>
            <button type="button" onClick={() => { location.href = '/dashboard'; }}>返回生产资料</button>
          </div>
        </div>

        <input ref={fileImportRef} hidden type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e => importFile(e.target.files)} />
        <input ref={sourceFileRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls,application/pdf,image/*,text/csv" onChange={e => uploadSourceFile(e.target.files)} />

        <div className="connector-stats" aria-label="连接器参数统计">
          <button className={filter === 'all' ? 'active' : ''} type="button" onClick={() => { setFilter('all'); setPage(1); }}><span>总数</span><strong>{stats.total}</strong></button>
          <button className={filter === 'outer' ? 'active' : ''} type="button" onClick={() => { setFilter('outer'); setPage(1); }}><span>缺外剥皮</span><strong>{stats.missingOuter}</strong></button>
          <button className={filter === 'inner' ? 'active' : ''} type="button" onClick={() => { setFilter('inner'); setPage(1); }}><span>缺内剥皮</span><strong>{stats.missingInner}</strong></button>
          <button className={filter === 'insertion' ? 'active' : ''} type="button" onClick={() => { setFilter('insertion'); setPage(1); }}><span>缺入长</span><strong>{stats.missingInsertion}</strong></button>
          <button className={filter === 'highlighted' ? 'active' : ''} type="button" onClick={() => { setFilter('highlighted'); setPage(1); }}><span>重点</span><strong>{stats.highlighted}</strong></button>
          <button className={fileDrawerOpen ? 'active' : ''} type="button" onClick={() => setFileDrawerOpen(true)}><span>附件</span><strong>{stats.fileCount}</strong></button>
          <button className={batchDrawerOpen ? 'active' : ''} type="button" onClick={() => { setBatchDrawerOpen(true); loadImportBatches(); }}><span>导入批次</span><strong>{importBatches.length}</strong></button>
        </div>

        <div className="connector-filter-row">
          <div className="filter-tabs connector-filter-tabs">
            {filters.map(([key, label, count]) => (
              <button key={key} className={filter === key ? 'active' : ''} type="button" onClick={() => { setFilter(key); setPage(1); }}>{label}<span>{count}</span></button>
            ))}
          </div>
          <button type="button" onClick={() => { setDeletedOpen(v => !v); loadDeleted(); }}>恢复删除</button>
        </div>

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
            <button className="danger-button" type="button" disabled={batching} onClick={() => setBatchDeleteOpen(true)}>批量删除</button>
          </section>
        )}

        <button className="connector-file-drawer-toggle" type="button" onClick={() => setFileDrawerOpen(true)}>
          原始资料 <span>{stats.fileCount}</span>
        </button>

        <section className="connector-content-grid">
          <div className="connector-table-panel">
            <div className="connector-table-head">
              <strong>{loading ? '加载中...' : `查询结果 ${total} 条`}</strong>
              <span>第 {page} / {totalPages} 页</span>
            </div>
            <div className="connector-table-wrap">
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
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className={`${item.isHighlighted ? 'highlighted' : ''} ${selectedSet.has(item.id) ? 'selected' : ''}`}>
                      <td className="sticky-cell select-cell"><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`选择 ${item.model || item.rowNo || '参数'}`} /></td>
                      <td className="sticky-cell row-no">{blank(item.rowNo)}</td>
                      <td className="sticky-cell model-cell">{highlightText(item.model)}</td>
                      <td className={isMissingCell('outer', item.outerPeelMm) ? 'missing-cell' : ''}>{highlightText(item.outerPeelMm)}</td>
                      <td className={isMissingCell('inner', item.innerPeelMm) ? 'missing-cell' : ''}>{highlightText(item.innerPeelMm)}</td>
                      <td className={isMissingCell('insertion', item.insertionLengthMm) ? 'missing-cell' : ''}>{highlightText(item.insertionLengthMm)}</td>
                      <td className="remark-cell">{highlightText(item.remark)}</td>
                      <td>{item.isHighlighted ? <span className="connector-highlight-tag">重点</span> : ''}</td>
                      <td>{dt(item.updatedAt)}</td>
                      <td>
                        <div className="connector-row-actions">
                          <button type="button" onClick={() => openModal('edit', item)}>编辑</button>
                          <div className="connector-more-wrap">
                            <button type="button" aria-expanded={rowMenuId === item.id} onClick={() => setRowMenuId(rowMenuId === item.id ? null : item.id)}>更多</button>
                            {rowMenuId === item.id && (
                              <div className="connector-row-menu">
                                <button type="button" onClick={() => toggleHighlight(item)}>{item.isHighlighted ? '取消重点' : '标记重点'}</button>
                                <button type="button" onClick={() => copyParameter(item)}>复制整行参数</button>
                                <button className="danger-text" type="button" onClick={() => { setRowMenuId(null); setDeleteTarget(item); }}>删除</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={10}>
                        <div className="connector-empty-state">
                          <strong>未找到连接器参数</strong>
                          <p>可以清空搜索条件，或通过新增参数、导入 Excel / CSV、粘贴导入来补充资料。</p>
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

        {fileDrawerOpen && <button className="connector-file-scrim" type="button" aria-label="关闭原始资料抽屉" onClick={() => setFileDrawerOpen(false)} />}
        <aside className={`connector-file-drawer ${fileDrawerOpen ? 'open' : ''}`} aria-hidden={!fileDrawerOpen}>
            <div className="connector-file-head">
              <strong>原始资料附件</strong>
              <div>
                <button type="button" disabled={uploadingFile} onClick={() => sourceFileRef.current?.click()}>{uploadingFile ? '上传中...' : '上传'}</button>
                <button type="button" onClick={() => setFileDrawerOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="connector-file-list">
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
                    <a href={file.downloadUrl} target="_blank">下载</a>
                    <button type="button" onClick={() => setFileDeleteTarget(file)}>删除</button>
                  </div>
                </article>
              ))}
              {!files.length && <div className="empty-list">暂无原始资料，可上传 Excel / PDF / 图片作为留档。</div>}
            </div>
          </aside>
        {batchDrawerOpen && <button className="connector-file-scrim" type="button" aria-label="关闭导入批次抽屉" onClick={() => setBatchDrawerOpen(false)} />}
        <aside className={`connector-file-drawer import-batch-drawer ${batchDrawerOpen ? 'open' : ''}`} aria-hidden={!batchDrawerOpen}>
          <div className="connector-file-head">
            <strong>导入批次</strong>
            <div>
              <button type="button" disabled={batchLoading} onClick={loadImportBatches}>{batchLoading ? '刷新中...' : '刷新'}</button>
              <button type="button" onClick={() => setBatchDrawerOpen(false)}>关闭</button>
            </div>
          </div>
          <div className="connector-file-list">
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
                  <button type="button" disabled={!!batch.rolledBackAt || !(batch.activeParameterCount || 0)} onClick={() => setRollbackTarget(batch)}>回滚</button>
                </div>
              </article>
            ))}
            {!batchLoading && !importBatches.length && <div className="empty-list">暂无导入批次。</div>}
          </div>
        </aside>
      </section>

      {msg && <div className="status-toast">{msg}</div>}

      {modal && (
        <div className="modal-backdrop" role="presentation">
          <form className="connector-dialog" onSubmit={saveParameter}>
            <div className="dialog-title">
              <strong>{modal.mode === 'create' ? '新增参数' : '编辑参数'}</strong>
              <button type="button" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="connector-form-grid">
              <label>序号<input value={form.rowNo} onChange={e => setForm(v => ({ ...v, rowNo: e.target.value }))} inputMode="numeric" /></label>
              <label>型号<input value={form.model} onChange={e => setForm(v => ({ ...v, model: e.target.value }))} /></label>
              <label>外剥皮mm<input value={form.outerPeelMm} onChange={e => setForm(v => ({ ...v, outerPeelMm: e.target.value }))} /></label>
              <label>内剥皮mm<input value={form.innerPeelMm} onChange={e => setForm(v => ({ ...v, innerPeelMm: e.target.value }))} /></label>
              <label>入长mm<input value={form.insertionLengthMm} onChange={e => setForm(v => ({ ...v, insertionLengthMm: e.target.value }))} /></label>
              <label className="check-line"><input type="checkbox" checked={form.isHighlighted} onChange={e => setForm(v => ({ ...v, isHighlighted: e.target.checked }))} /> 重点标记</label>
              <label className="wide">备注<textarea value={form.remark} onChange={e => setForm(v => ({ ...v, remark: e.target.value }))} /></label>
            </div>
            {formError && <div className="form-error">{formError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setModal(null)}>取消</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="connector-import-dialog" role="dialog" aria-modal="true" aria-label="导入连接器参数">
            <div className="dialog-title">
              <strong>导入连接器参数</strong>
              <button type="button" onClick={closeImport}>×</button>
            </div>
            <div className="trash-tabs">
              <button className={importTab === 'file' ? 'active' : ''} type="button" onClick={() => setImportTab('file')}>文件导入</button>
              <button className={importTab === 'paste' ? 'active' : ''} type="button" onClick={() => setImportTab('paste')}>粘贴导入</button>
            </div>
            {importTab === 'file' ? (
              <div className="connector-import-pane">
                <p>支持 CSV、XLSX、XLS。选择文件后先解析预览，不会直接写入数据库。</p>
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
                <div className="import-summary">
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
                <div className="import-confirm-summary">
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
                  <button className="primary-button" type="button" onClick={commitImport} disabled={importing || (importPreview.summary.totalRows > 100 && importConfirmText.trim() !== 'IMPORT_CONFIRM')}>{importing ? '导入中...' : '确认导入'}</button>
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
                  <div className="import-result-list">
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
              <button type="button" onClick={() => setLogsOpen(false)}>×</button>
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
              <button type="button" onClick={() => setDeleteTarget(null)}>×</button>
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
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
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
              <button type="button" onClick={() => setBatchDeleteOpen(false)}>×</button>
            </div>
            <p>将软删除已选 {selectedIds.length} 条参数记录，此操作可恢复。</p>
            <label className="confirm-input-label">
              输入 DELETE 确认批量删除
              <input value={batchDeleteConfirmText} onChange={e => setBatchDeleteConfirmText(e.target.value)} placeholder="DELETE" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setBatchDeleteOpen(false)}>取消</button>
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
              <button type="button" onClick={() => setFileDeleteTarget(null)}>×</button>
            </div>
            <p>仅软删除附件记录，不删除对象存储中的历史对象。</p>
            <div className="delete-file-name">{fileDeleteTarget.originalName}</div>
            <label className="confirm-input-label">
              输入 DELETE 确认删除附件
              <input value={fileDeleteConfirmText} onChange={e => setFileDeleteConfirmText(e.target.value)} placeholder="DELETE" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setFileDeleteTarget(null)}>取消</button>
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
              <button type="button" onClick={() => setRollbackTarget(null)}>×</button>
            </div>
            <p>将软删除该批次导入且尚未删除的 {rollbackTarget.activeParameterCount || 0} 条参数，不影响手动新增参数。</p>
            <div className="delete-file-name">{rollbackTarget.fileName || '粘贴导入'} · {dt(rollbackTarget.createdAt)}</div>
            <label className="confirm-input-label">
              输入 ROLLBACK 确认回滚
              <input value={rollbackConfirmText} onChange={e => setRollbackConfirmText(e.target.value)} placeholder="ROLLBACK" />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setRollbackTarget(null)}>取消</button>
              <button className="danger-button" type="button" disabled={batchLoading || rollbackConfirmText.trim() !== 'ROLLBACK'} onClick={rollbackBatch}>{batchLoading ? '回滚中...' : '确认回滚'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
