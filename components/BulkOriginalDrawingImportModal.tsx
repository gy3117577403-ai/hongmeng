'use client';

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { parseOriginalDrawingFile } from '@/lib/bulk-original-drawing-parser';
import type { DrawingLibraryCustomerDTO } from '@/types';

type DirectoryFile = File & { webkitRelativePath?: string };
type UploadState = 'idle' | 'uploading' | 'success' | 'failed' | 'skipped';
type PreviewStatus =
  | 'ready'
  | 'duplicate'
  | 'customer-unconfirmed'
  | 'missing-spec'
  | 'suspected-non-original'
  | 'unsupported'
  | 'need-create-item';
type PreviewAction = 'upload' | 'create-item-and-upload' | 'skip' | 'need-create-item';

type PreviewRow = {
  rowId: string;
  relativePath: string;
  fileName: string;
  size: number;
  mimeType: string;
  customerFolder: string;
  customerName: string;
  specification: string;
  productName: string;
  existingItemId: string;
  duplicateFileId: string;
  status: PreviewStatus;
  action: PreviewAction;
  reason: string;
  warnings: string[];
};

type PreviewSummary = {
  scannedFiles: number;
  supportedFiles: number;
  readyFiles: number;
  uploadFiles: number;
  createItemAndUploadFiles: number;
  unmatchedFiles: number;
  duplicateFiles: number;
  suspectedNonOriginalFiles: number;
  ignoredFiles: number;
  willCreateItems: number;
  category: string;
};

type LocalRow = {
  id: string;
  file: File;
  relativePath: string;
  fileName: string;
  size: number;
  mimeType: string;
  customerFolder: string;
  localSpecification: string;
  localProductName: string;
  localWarnings: string[];
  preview: PreviewRow | null;
  uploadState: UploadState;
  error: string;
  uploadedFileId: string;
};

type CreateItemResponse = {
  ok?: boolean;
  error?: string;
  item?: { id?: string; customerName?: string; specification?: string };
};

type UploadResponse = {
  ok?: boolean;
  error?: string;
  file?: { id?: string };
};

const confirmedAliases: Array<[string, string]> = [
  ['昆泰', '杭州昆泰(10033)'],
  ['伽利略', '伽利略（天津）(10304)'],
  ['守卫者', '守卫者(10198)'],
  ['威进', '江苏威进(10053)'],
  ['云深处', '杭州云深处(10126)'],
];

const supportedAccept = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function statusText(row: PreviewRow | null) {
  if (!row) return '待预览';
  if (row.status === 'ready' && row.action === 'upload') return '可上传';
  if (row.status === 'ready' && row.action === 'create-item-and-upload') return '新建并上传';
  if (row.status === 'duplicate') return '重复跳过';
  if (row.status === 'customer-unconfirmed') return '客户待确认';
  if (row.status === 'missing-spec') return '规格无法识别';
  if (row.status === 'suspected-non-original') return '疑似非原图';
  if (row.status === 'need-create-item') return '需先建资料';
  return '跳过';
}

function statusClass(row: PreviewRow | null) {
  if (!row) return 'pending';
  if (row.status === 'ready') return 'ready';
  if (row.status === 'duplicate') return 'duplicate';
  return 'blocked';
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number | null | undefined>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(',')),
  ].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BulkOriginalDrawingImportModal({
  open,
  customers,
  onClose,
  onCompleted,
}: {
  open: boolean;
  customers: DrawingLibraryCustomerDTO[];
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [folderAliases, setFolderAliases] = useState<Record<string, string>>({});
  const [createMissing, setCreateMissing] = useState(true);
  const [allowSuspectedNonOriginal, setAllowSuspectedNonOriginal] = useState(false);
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const aliasDefaults = useMemo(() => Object.fromEntries(confirmedAliases), []);
  const folders = useMemo(() => Array.from(new Set(rows.map(row => row.customerFolder).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [rows]);
  const customerOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of customers) {
      if (item.customerName && item.customerName !== '全部客户') values.add(item.customerName);
    }
    for (const [, customerName] of confirmedAliases) values.add(customerName);
    for (const customerName of Object.values(folderAliases)) {
      if (customerName) values.add(customerName);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [customers, folderAliases]);

  const eligibleRows = rows.filter(row => row.preview?.status === 'ready' && (row.preview.action === 'upload' || row.preview.action === 'create-item-and-upload'));
  const failedRows = rows.filter(row => row.uploadState === 'failed');
  const uploadedCount = rows.filter(row => row.uploadState === 'success').length;
  const failedCount = rows.filter(row => row.uploadState === 'failed').length;
  const skippedCount = rows.filter(row => row.uploadState === 'skipped').length;

  if (!open) return null;

  function resetPreview(nextRows?: LocalRow[]) {
    setPreviewSummary(null);
    setRows((nextRows || rows).map(row => ({ ...row, preview: null, uploadState: 'idle', error: '', uploadedFileId: '' })));
  }

  function handleFileChange(fileList: FileList | null) {
    setError('');
    setMessage('');
    setConfirmText('');
    if (!fileList?.length) return;
    const nextRows = Array.from(fileList).map((file, index) => {
      const inputFile = file as DirectoryFile;
      const relativePath = inputFile.webkitRelativePath || file.name;
      const parsed = parseOriginalDrawingFile({
        relativePath,
        fileName: file.name,
        size: file.size,
      });
      return {
        id: `${index}-${relativePath || file.name}`,
        file,
        relativePath,
        fileName: file.name,
        size: file.size,
        mimeType: file.type || '',
        customerFolder: parsed.customerFolder,
        localSpecification: parsed.specification,
        localProductName: parsed.productName,
        localWarnings: parsed.warnings,
        preview: null,
        uploadState: 'idle' as const,
        error: '',
        uploadedFileId: '',
      };
    });
    const nextAliases: Record<string, string> = {};
    for (const row of nextRows) {
      if (!row.customerFolder) continue;
      nextAliases[row.customerFolder] = folderAliases[row.customerFolder] || aliasDefaults[row.customerFolder] || '';
    }
    setFolderAliases(nextAliases);
    setRows(nextRows);
    setPreviewSummary(null);
    setMessage(`已选择 ${nextRows.length} 个文件，请先确认客户映射并预览。`);
  }

  function updateAlias(folderName: string, customerName: string) {
    setFolderAliases(current => ({ ...current, [folderName]: customerName }));
    resetPreview();
  }

  async function preview() {
    if (!rows.length) {
      setError('请先选择包含图纸的本地文件夹');
      return;
    }
    setPreviewLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/drawing-library/bulk-originals/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createMissing,
          allowSuspectedNonOriginal,
          customerAliases: folders.map(folderName => ({ folderName, customerName: folderAliases[folderName] || '' })),
          files: rows.map(row => ({
            relativePath: row.relativePath,
            fileName: row.fileName,
            size: row.size,
            mimeType: row.mimeType,
            customerFolder: row.customerFolder,
            specification: row.localSpecification,
            productName: row.localProductName,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || '批量导入预览失败');
        return;
      }
      const previewRows: PreviewRow[] = Array.isArray(data.data?.rows) ? data.data.rows : [];
      const byId = new Map(previewRows.map(row => [row.rowId, row]));
      setRows(current => current.map(row => ({
        ...row,
        preview: byId.get(row.id) || null,
        uploadState: byId.get(row.id)?.status === 'ready' ? 'idle' : 'skipped',
        error: '',
        uploadedFileId: '',
      })));
      setPreviewSummary(data.data?.summary || null);
      setMessage('预览完成，本步骤没有上传文件，也没有写入数据库。');
    } catch {
      setError('批量导入预览失败，请检查网络');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function findExistingItemId(customerName: string, specification: string) {
    const params = new URLSearchParams({ keyword: specification, filter: 'all' });
    const res = await fetch(`/api/drawing-library?${params.toString()}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return '';
    const items = Array.isArray(data.items) ? data.items : [];
    const found = items.find((item: { id?: string; customerName?: string; specification?: string }) => (
      item.customerName === customerName && item.specification === specification && item.id
    ));
    return found?.id || '';
  }

  async function ensureItem(row: LocalRow, createdItems: Map<string, string>) {
    const previewRow = row.preview;
    if (!previewRow) throw new Error('缺少预览结果');
    if (previewRow.existingItemId) return previewRow.existingItemId;
    const cacheKey = `${previewRow.customerName}::${previewRow.specification}`;
    const cached = createdItems.get(cacheKey);
    if (cached) return cached;
    const res = await fetch('/api/drawing-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: previewRow.customerName,
        specification: previewRow.specification,
        productName: previewRow.productName || '',
        remark: '网页批量原图导入自动创建',
      }),
    });
    const data = await res.json().catch(() => ({})) as CreateItemResponse;
    if (res.status === 409) {
      const existingId = await findExistingItemId(previewRow.customerName, previewRow.specification);
      if (existingId) {
        createdItems.set(cacheKey, existingId);
        return existingId;
      }
    }
    if (!res.ok || !data.item?.id) throw new Error(data.error || '创建图纸资料记录失败');
    createdItems.set(cacheKey, data.item.id);
    return data.item.id;
  }

  function markRow(rowId: string, patch: Partial<LocalRow>) {
    setRows(current => current.map(row => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  async function uploadOne(row: LocalRow, createdItems: Map<string, string>) {
    if (!row.preview) return;
    markRow(row.id, { uploadState: 'uploading', error: '' });
    try {
      const itemId = await ensureItem(row, createdItems);
      const body = new FormData();
      body.set('categoryName', '原图');
      body.set('displayName', row.fileName);
      body.set('remark', '网页批量原图导入');
      body.set('file', row.file);
      const res = await fetch(`/api/drawing-library/${itemId}/files/upload`, { method: 'POST', body });
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || '上传失败');
      markRow(row.id, { uploadState: 'success', uploadedFileId: data.file?.id || '', error: '' });
    } catch (uploadError) {
      markRow(row.id, { uploadState: 'failed', error: uploadError instanceof Error ? uploadError.message : String(uploadError) });
    }
  }

  async function uploadRows(targetRows: LocalRow[]) {
    if (!targetRows.length) {
      setError('没有可上传的文件，请先预览并处理客户/规格问题');
      return;
    }
    if (confirmText.trim() !== 'IMPORT_ORIGINALS') {
      setError('请输入 IMPORT_ORIGINALS 确认批量上传');
      return;
    }
    setUploading(true);
    setError('');
    setMessage('开始上传，过程不会删除任何资料。');
    const createdItems = new Map<string, string>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(2, targetRows.length) }, async () => {
      while (cursor < targetRows.length) {
        const current = targetRows[cursor];
        cursor += 1;
        await uploadOne(current, createdItems);
      }
    });
    await Promise.all(workers);
    setUploading(false);
    setMessage('批量上传已结束，请查看成功 / 失败统计。');
    await onCompleted();
  }

  function exportUnmatched() {
    const data = rows
      .filter(row => row.preview && row.preview.status !== 'ready' && row.preview.status !== 'duplicate')
      .map(row => ({
        relativePath: row.relativePath,
        folderName: row.customerFolder,
        fileName: row.fileName,
        reason: row.preview?.reason || '',
        suggestedCustomer: row.preview?.customerName || '',
        suggestedSpecification: row.preview?.specification || row.localSpecification,
      }));
    downloadCsv('bulk-original-unmatched.csv', data);
  }

  function exportFailed() {
    const data = rows
      .filter(row => row.uploadState === 'failed')
      .map(row => ({
        relativePath: row.relativePath,
        fileName: row.fileName,
        customerName: row.preview?.customerName || '',
        specification: row.preview?.specification || '',
        error: row.error,
      }));
    downloadCsv('bulk-original-failed.csv', data);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="drawing-dialog bulk-original-dialog" role="dialog" aria-modal="true">
        <div className="dialog-title">
          <div>
            <span>批量导入原图</span>
            <h3>网页端文件夹预览 · 确认后上传到“原图”</h3>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <div className="bulk-import-steps">
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>选择本地图纸文件夹</button>
          <input
            ref={inputRef}
            hidden
            multiple
            type="file"
            accept={supportedAccept}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => handleFileChange(event.target.files)}
          />
          <label className="bulk-check">
            <input type="checkbox" checked={createMissing} onChange={event => { setCreateMissing(event.target.checked); resetPreview(); }} />
            <span>缺少图纸资料记录时自动新建客户 + 规格记录</span>
          </label>
          <label className="bulk-check">
            <input type="checkbox" checked={allowSuspectedNonOriginal} onChange={event => { setAllowSuspectedNonOriginal(event.target.checked); resetPreview(); }} />
            <span>允许疑似非原图文件进入预览上传</span>
          </label>
        </div>

        <div className="bulk-summary-grid">
          <span>已选 {rows.length}</span>
          <span>可上传 {previewSummary?.readyFiles ?? 0}</span>
          <span>将新建 {previewSummary?.willCreateItems ?? 0}</span>
          <span>重复 {previewSummary?.duplicateFiles ?? 0}</span>
          <span>未匹配 {previewSummary?.unmatchedFiles ?? 0}</span>
          <span>已成功 {uploadedCount}</span>
          <span>失败 {failedCount}</span>
          <span>跳过 {skippedCount}</span>
        </div>

        {!!folders.length && (
          <section className="bulk-folder-map">
            <div className="bulk-section-title">
              <strong>客户文件夹映射</strong>
              <span>储力、具微、重启易猫等未确认客户保持空值，不会上传。</span>
            </div>
            <div className="bulk-folder-grid">
              {folders.map(folderName => (
                <label key={folderName}>
                  <span>{folderName}</span>
                  <select value={folderAliases[folderName] || ''} onChange={event => updateAlias(folderName, event.target.value)}>
                    <option value="">请选择客户</option>
                    {customerOptions.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>
        )}

        <div className="bulk-actions">
          <button type="button" disabled={!rows.length || previewLoading || uploading} onClick={preview}>
            {previewLoading ? '预览中...' : '预览匹配和重复'}
          </button>
          <input value={confirmText} onChange={event => setConfirmText(event.target.value)} placeholder="输入 IMPORT_ORIGINALS 后允许上传" />
          <button className="primary-button" type="button" disabled={!eligibleRows.length || uploading || confirmText.trim() !== 'IMPORT_ORIGINALS'} onClick={() => uploadRows(eligibleRows)}>
            {uploading ? '上传中...' : `确认上传 ${eligibleRows.length} 个`}
          </button>
          <button type="button" disabled={!failedRows.length || uploading || confirmText.trim() !== 'IMPORT_ORIGINALS'} onClick={() => uploadRows(failedRows)}>
            重试失败 {failedRows.length}
          </button>
        </div>

        {(message || error) && <div className={error ? 'form-error' : 'bulk-info'}>{error || message}</div>}

        <div className="bulk-table-wrap">
          <table className="bulk-import-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>客户</th>
                <th>规格</th>
                <th>文件</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 220).map(row => (
                <tr key={row.id}>
                  <td><span className={`bulk-status ${statusClass(row.preview)}`}>{statusText(row.preview)}</span></td>
                  <td>
                    <strong>{row.preview?.customerName || folderAliases[row.customerFolder] || row.customerFolder || '-'}</strong>
                    <small>{row.customerFolder || '-'}</small>
                  </td>
                  <td>
                    <strong title={row.preview?.specification || row.localSpecification}>{row.preview?.specification || row.localSpecification || '-'}</strong>
                    <small>{row.preview?.productName || row.localProductName || row.preview?.reason || '-'}</small>
                  </td>
                  <td>
                    <strong title={row.relativePath}>{row.fileName}</strong>
                    <small>{bytes(row.size)} {row.localWarnings.join('、')}</small>
                  </td>
                  <td>
                    <strong>{row.uploadState === 'success' ? '已上传' : row.uploadState === 'failed' ? '失败' : row.preview?.action || '-'}</strong>
                    <small>{row.error || row.preview?.reason || '-'}</small>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5}>请选择企业微信微盘下载后的“图纸”文件夹，系统会先预览，不会立即上传。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="dialog-actions">
          <button type="button" onClick={exportUnmatched}>导出未匹配 CSV</button>
          <button type="button" onClick={exportFailed}>导出失败 CSV</button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
