'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectorParameterDTO,
  ConnectorParameterFileDTO,
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
type ImportResult = { summary: { created: number; skipped: number; failed: number; total: number }; results: ImportRow[] };

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
  upload_connector_parameter_file: '上传原始资料',
  delete_connector_parameter_file: '删除原始资料',
  download_connector_parameter_file: '下载原始资料',
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
  return text || <span className="connector-empty-value">空</span>;
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
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<OperationLogDTO[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const fileImportRef = useRef<HTMLInputElement>(null);
  const sourceFileRef = useRef<HTMLInputElement>(null);

  const pageSize = 80;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const accountName = user.displayName || user.username;
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

  useEffect(() => {
    const timer = window.setTimeout(() => loadData(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuery]);

  useEffect(() => {
    loadFiles();
  }, []);

  function openModal(mode: 'create' | 'edit', item?: ConnectorParameterDTO) {
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
    const r = await fetch(`/api/connector-parameters/${deleteTarget.id}`, { method: 'DELETE' });
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
    setImportResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/api/connector-parameters/import', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '导入失败');
        return;
      }
      setImportResult(d);
      setMsg(`导入完成：新增 ${d.summary?.created || 0}，跳过 ${d.summary?.skipped || 0}，失败 ${d.summary?.failed || 0}`);
      await loadData();
    } catch {
      setMsg('导入失败，请检查文件格式');
    } finally {
      setImporting(false);
      if (fileImportRef.current) fileImportRef.current.value = '';
    }
  }

  async function importPaste() {
    if (!pasteText.trim()) return setMsg('请先粘贴 Excel 表格内容');
    setImporting(true);
    setImportResult(null);
    try {
      const r = await fetch('/api/connector-parameters/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error || '粘贴导入失败');
        return;
      }
      setImportResult(d);
      setMsg(`粘贴导入完成：新增 ${d.summary?.created || 0}，跳过 ${d.summary?.skipped || 0}，失败 ${d.summary?.failed || 0}`);
      await loadData();
    } catch {
      setMsg('粘贴导入失败');
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
    const r = await fetch(`/api/connector-parameter-files/${fileDeleteTarget.id}`, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error || '删除原始资料失败');
    setFileDeleteTarget(null);
    setMsg('原始资料已删除');
    await loadFiles();
    await loadData();
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

  const filters = [
    ['all', '全部', stats.total],
    ['outer', '缺外剥皮', stats.missingOuter],
    ['inner', '缺内剥皮', stats.missingInner],
    ['insertion', '缺入长', stats.missingInsertion],
    ['any', '任意缺失', stats.missingAny || 0],
    ['highlighted', '重点标记', stats.highlighted],
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
            <button type="button" disabled={!!exporting} onClick={() => downloadFile('/api/connector-parameters/export.csv', '导出 CSV', '连接器参数资料.csv')}>导出 CSV</button>
            <button type="button" disabled={uploadingFile} onClick={() => sourceFileRef.current?.click()}>{uploadingFile ? '上传中...' : '上传原始资料'}</button>
            <button type="button" disabled={!!exporting} onClick={() => downloadFile('/api/connector-parameters/template.csv', '下载模板', '连接器参数导入模板.csv')}>下载模板</button>
            <button type="button" onClick={() => { location.href = '/dashboard'; }}>返回生产资料</button>
          </div>
        </div>

        <input ref={fileImportRef} hidden type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e => importFile(e.target.files)} />
        <input ref={sourceFileRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls,application/pdf,image/*,text/csv" onChange={e => uploadSourceFile(e.target.files)} />

        <div className="connector-stats">
          <button type="button" onClick={() => setFilter('all')}><small>总条数</small><strong>{stats.total}</strong></button>
          <button type="button" onClick={() => setFilter('outer')}><small>缺外剥皮</small><strong>{stats.missingOuter}</strong></button>
          <button type="button" onClick={() => setFilter('inner')}><small>缺内剥皮</small><strong>{stats.missingInner}</strong></button>
          <button type="button" onClick={() => setFilter('insertion')}><small>缺入长</small><strong>{stats.missingInsertion}</strong></button>
          <button type="button" onClick={() => setFilter('highlighted')}><small>重点标记</small><strong>{stats.highlighted}</strong></button>
          <button type="button" onClick={() => sourceFileRef.current?.click()}><small>原始资料附件</small><strong>{stats.fileCount}</strong></button>
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
                    <tr key={item.id} className={item.isHighlighted ? 'highlighted' : ''}>
                      <td className="sticky-cell row-no">{blank(item.rowNo)}</td>
                      <td className="sticky-cell model-cell">{blank(item.model)}</td>
                      <td>{blank(item.outerPeelMm)}</td>
                      <td>{blank(item.innerPeelMm)}</td>
                      <td>{blank(item.insertionLengthMm)}</td>
                      <td className="remark-cell">{blank(item.remark)}</td>
                      <td>{item.isHighlighted ? '是' : '否'}</td>
                      <td>{dt(item.updatedAt)}</td>
                      <td>
                        <div className="connector-row-actions">
                          <button type="button" onClick={() => openModal('edit', item)}>编辑</button>
                          <button type="button" onClick={() => toggleHighlight(item)}>{item.isHighlighted ? '取消重点' : '标记重点'}</button>
                          <button className="danger-text" type="button" onClick={() => setDeleteTarget(item)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={9}>
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

          <aside className="connector-file-panel">
            <div className="connector-file-head">
              <strong>原始资料附件</strong>
              <button type="button" onClick={() => sourceFileRef.current?.click()}>上传</button>
            </div>
            <div className="connector-file-list">
              {files.map(file => (
                <article key={file.id} className="connector-file-card">
                  <div>
                    <strong title={file.displayName || file.originalName}>{file.displayName || file.originalName}</strong>
                    <span>{file.fileType.toUpperCase()} · {bytes(file.fileSize)}</span>
                    <small>{dt(file.createdAt)} · {file.uploadedBy || '-'}</small>
                  </div>
                  <div>
                    <a href={file.downloadUrl} target="_blank">下载</a>
                    <button type="button" onClick={() => setFileDeleteTarget(file)}>删除</button>
                  </div>
                </article>
              ))}
              {!files.length && <div className="empty-list">暂无原始资料附件</div>}
            </div>
          </aside>
        </section>
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
              <button type="button" onClick={() => setImportOpen(false)}>×</button>
            </div>
            <div className="trash-tabs">
              <button className={importTab === 'file' ? 'active' : ''} type="button" onClick={() => setImportTab('file')}>文件导入</button>
              <button className={importTab === 'paste' ? 'active' : ''} type="button" onClick={() => setImportTab('paste')}>粘贴导入</button>
            </div>
            {importTab === 'file' ? (
              <div className="connector-import-pane">
                <p>支持 CSV、XLSX、XLS。表头可使用中文：序号、型号、外剥皮mm、内剥皮mm、入长mm、备注、重点。</p>
                <div className="system-actions">
                  <button type="button" onClick={() => fileImportRef.current?.click()} disabled={importing}>{importing ? '导入中...' : '选择 Excel / CSV'}</button>
                  <button type="button" onClick={() => downloadFile('/api/connector-parameters/template.csv', '下载模板', '连接器参数导入模板.csv')}>下载模板</button>
                </div>
              </div>
            ) : (
              <div className="connector-import-pane">
                <p>从 Excel 复制整块表格后粘贴到下方。支持 TSV / CSV，空单元格会保持为空。</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="序号	型号	外剥皮mm	内剥皮mm	入长mm	备注	重点" />
                <div className="system-actions">
                  <button className="primary-button" type="button" onClick={importPaste} disabled={importing}>{importing ? '导入中...' : '开始粘贴导入'}</button>
                  <button type="button" onClick={() => setPasteText('')}>清空</button>
                </div>
              </div>
            )}
            {importResult && (
              <div className="import-result">
                <div className="import-summary">
                  <span>新增 {importResult.summary.created}</span>
                  <span>跳过 {importResult.summary.skipped}</span>
                  <span>失败 {importResult.summary.failed}</span>
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
            <div className="dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" onClick={confirmDelete}>确认删除</button>
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
            <div className="dialog-actions">
              <button type="button" onClick={() => setFileDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" onClick={confirmDeleteFile}>确认删除</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
