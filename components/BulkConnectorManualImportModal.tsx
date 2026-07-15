'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { inspectConnectorManualFile, inspectConnectorManualFiles } from '@/lib/client-connector-manual-inspector';
import { connectorManualDefaultTitle, parseConnectorManual } from '@/lib/connector-manual-parser';
import type {
  ConnectorManualBulkAction,
  ConnectorManualBulkCandidateDTO,
  ConnectorManualBulkPreviewRowDTO,
  ConnectorManualBulkPreviewSummaryDTO,
  ConnectorManualImportBatchDTO,
} from '@/types';

type LocalAsset = {
  file: File;
  fileName: string;
  relativePath: string;
  size: number;
  mimeType: string;
  hash: string;
};

type QueueState = 'idle' | 'uploading' | 'success' | 'duplicate' | 'failed' | 'cancelled';

type LocalRow = ConnectorManualBulkPreviewRowDTO & {
  localAssets: LocalAsset[];
  queueState: QueueState;
  queueError: string;
  selected: boolean;
  autoBindUnique: boolean;
  selectedParameterIds: string[];
};

type JsonPayload = Record<string, unknown>;

const supportedExtensions = /\.(?:pdf|jpe?g|png|webp)$/i;
const ignoredNames = /(?:\.part|\.crdownload)$/i;
const steps = ['选择文件', '自动解析', '预览去重', '确认导入', '上传进度', '结果报告'];

function jsonResponse(response: Response): Promise<JsonPayload> {
  return response.json().catch(() => ({})) as Promise<JsonPayload>;
}

function naturalSort(a: LocalAsset, b: LocalAsset): number {
  return a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function relativePath(file: File): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, '/');
}

function isIgnored(file: File): boolean {
  const path = relativePath(file);
  const parts = path.split('/');
  return file.size <= 0
    || !supportedExtensions.test(file.name)
    || ignoredNames.test(file.name)
    || file.name.startsWith('~$')
    || parts.some(part => part.startsWith('.') && part.length > 1);
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function clientId(file: File, index: number): string {
  return `${file.lastModified}-${file.size}-${relativePath(file)}-${index}`.slice(0, 160);
}

function blankCandidate(id: string, title: string, path: string, fileMode: 'PDF' | 'IMAGE_SET', assets: LocalAsset[]): ConnectorManualBulkCandidateDTO {
  const parsed = parseConnectorManual({ fileName: `${title}${fileMode === 'PDF' ? '.pdf' : '.png'}`, relativePath: path, fileSize: assets.reduce((sum, asset) => sum + asset.size, 0) });
  return {
    clientId: id,
    relativePath: path,
    fileName: fileMode === 'PDF' ? assets[0].fileName : title,
    size: assets.reduce((sum, asset) => sum + asset.size, 0),
    mimeType: fileMode === 'PDF' ? 'application/pdf' : 'image/*',
    fileMode,
    defaultTitle: title,
    detectedTitle: '',
    manufacturerCandidate: parsed.manufacturerCandidate,
    familyCandidate: parsed.familyCandidate,
    revisionCandidate: '',
    issuedAtCandidate: '',
    modelCandidates: parsed.modelCandidates,
    keywordCandidates: parsed.keywordCandidates,
    chapterCandidates: [],
    metadataConfidence: parsed.metadataConfidence,
    pageCount: fileMode === 'PDF' ? 0 : assets.length,
    hash: '',
    parseFailed: false,
    warnings: [],
    assets: assets.map(asset => ({ fileName: asset.fileName, relativePath: asset.relativePath, size: asset.size, mimeType: asset.mimeType, hash: asset.hash })),
  };
}

function blankRow(candidate: ConnectorManualBulkCandidateDTO, localAssets: LocalAsset[]): LocalRow {
  return {
    ...candidate,
    action: 'manual_review',
    matchedManualId: '',
    matchedManualTitle: '',
    suggestedVersionAction: '等待预览',
    duplicateReason: '',
    conflictReason: '',
    suggestedRevision: candidate.revisionCandidate || '待识别',
    parameterMatches: [],
    uniqueParameterIds: [],
    localAssets,
    queueState: 'idle',
    queueError: '',
    selected: false,
    autoBindUnique: true,
    selectedParameterIds: [],
  };
}

function groupFiles(files: File[]): { rows: LocalRow[]; ignored: number; sourceName: string } {
  const supported = files.filter(file => !isIgnored(file));
  const ignored = files.length - supported.length;
  const rows: LocalRow[] = [];
  const imageGroups = new Map<string, LocalAsset[]>();
  supported.forEach((file, index) => {
    const path = relativePath(file);
    const asset: LocalAsset = { file, fileName: file.name, relativePath: path, size: file.size, mimeType: file.type || (file.name.toLowerCase().endsWith('.png') ? 'image/png' : file.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg'), hash: '' };
    if (isPdf(file)) {
      const candidate = blankCandidate(clientId(file, index), connectorManualDefaultTitle(file.name), path, 'PDF', [asset]);
      rows.push(blankRow(candidate, [asset]));
      return;
    }
    const parts = path.split('/').filter(Boolean);
    const directories = parts.slice(0, -1);
    const groupKey = directories.length >= 2 ? directories.join('/') : `${path}::single`;
    const current = imageGroups.get(groupKey) || [];
    current.push(asset);
    imageGroups.set(groupKey, current);
  });
  let groupIndex = rows.length;
  for (const [groupKey, groupAssets] of imageGroups) {
    const sorted = [...groupAssets].sort(naturalSort);
    const grouped = !groupKey.endsWith('::single');
    const pathParts = groupKey.split('/').filter(Boolean);
    const title = grouped ? pathParts[pathParts.length - 1] || connectorManualDefaultTitle(sorted[0].fileName) : connectorManualDefaultTitle(sorted[0].fileName);
    const id = `${sorted[0].file.lastModified}-${groupKey}-${groupIndex}`.slice(0, 160);
    const candidate = blankCandidate(id, title, sorted[0].relativePath, 'IMAGE_SET', sorted);
    rows.push(blankRow(candidate, sorted));
    groupIndex += 1;
  }
  rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));
  const firstPath = supported[0] ? relativePath(supported[0]).split('/')[0] : '';
  return { rows, ignored, sourceName: firstPath && firstPath !== supported[0]?.name ? firstPath : '多文件选择' };
}

async function compositeHash(hashes: string[]): Promise<string> {
  const buffer = await new Blob([hashes.join('|')]).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

function toPreviewPayload(row: LocalRow): ConnectorManualBulkCandidateDTO & Record<string, unknown> {
  return {
    clientId: row.clientId,
    relativePath: row.relativePath,
    fileName: row.fileName,
    size: row.size,
    mimeType: row.mimeType,
    fileMode: row.fileMode,
    defaultTitle: row.defaultTitle,
    detectedTitle: row.detectedTitle,
    manufacturerCandidate: row.manufacturerCandidate,
    familyCandidate: row.familyCandidate,
    revisionCandidate: row.revisionCandidate,
    issuedAtCandidate: row.issuedAtCandidate,
    modelCandidates: row.modelCandidates,
    keywordCandidates: row.keywordCandidates,
    chapterCandidates: row.chapterCandidates,
    metadataConfidence: row.metadataConfidence,
    pageCount: row.pageCount,
    hash: row.hash,
    parseFailed: row.parseFailed,
    warnings: row.warnings,
    assets: row.localAssets.map(asset => ({ fileName: asset.fileName, relativePath: asset.relativePath, size: asset.size, mimeType: asset.mimeType, hash: asset.hash })),
    action: row.action,
    suggestedRevision: row.suggestedRevision,
    matchedManualId: row.matchedManualId,
    uniqueParameterIds: row.uniqueParameterIds,
    selectedParameterIds: row.selectedParameterIds,
    autoBindUnique: row.autoBindUnique,
  };
}

function actionLabel(action: ConnectorManualBulkAction): string {
  const labels: Record<ConnectorManualBulkAction, string> = {
    create_manual: '新建说明书', create_version: '新增版本', duplicate: '重复跳过', conflict: '版本冲突', invalid: '无效', manual_review: '待确认', skip: '跳过',
  };
  return labels[action];
}

function queueLabel(state: QueueState): string {
  return { idle: '等待', uploading: '上传中', success: '成功', duplicate: '重复', failed: '失败', cancelled: '已取消' }[state];
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportFailed(rows: LocalRow[]): void {
  const failed = rows.filter(row => row.queueState === 'failed');
  if (!failed.length) return;
  const csv = ['文件名,相对路径,说明书名称,错误', ...failed.map(row => [row.fileName, row.relativePath, row.defaultTitle, row.queueError].map(csvCell).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'connector-manual-import-failed.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export function BulkConnectorManualImportModal({ open, close, completed }: { open: boolean; close: () => void; completed: () => Promise<void> | void }) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<LocalRow[]>([]);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [sourceName, setSourceName] = useState('');
  const [parseProgress, setParseProgress] = useState(0);
  const [summary, setSummary] = useState<ConnectorManualBulkPreviewSummaryDTO | null>(null);
  const [batch, setBatch] = useState<ConnectorManualImportBatchDTO | null>(null);
  const [batchHistory, setBatchHistory] = useState<ConnectorManualImportBatchDTO[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [bulkManufacturer, setBulkManufacturer] = useState('');
  const [bulkFamily, setBulkFamily] = useState('');
  const [bulkKeywords, setBulkKeywords] = useState('');
  const [autoBindUnique, setAutoBindUnique] = useState(true);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => {
    if (!folderInputRef.current) return;
    folderInputRef.current.setAttribute('webkitdirectory', '');
    folderInputRef.current.setAttribute('directory', '');
  }, [open]);

  const unresolvedCount = rows.filter(row => ['conflict', 'manual_review', 'invalid'].includes(row.action)).length;
  const queueRows = rows.filter(row => ['create_manual', 'create_version'].includes(row.action));
  const queueStats = useMemo(() => ({
    completed: rows.filter(row => ['success', 'duplicate', 'failed', 'cancelled'].includes(row.queueState)).length,
    success: rows.filter(row => row.queueState === 'success').length,
    duplicate: rows.filter(row => row.queueState === 'duplicate').length,
    failed: rows.filter(row => row.queueState === 'failed').length,
  }), [rows]);

  if (!open) return null;

  function updateRows(updater: (current: LocalRow[]) => LocalRow[]): void {
    setRows(current => {
      const next = updater(current);
      rowsRef.current = next;
      return next;
    });
  }

  function reset(nextRows: LocalRow[], ignored: number, source: string): void {
    cancelledRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setRows(nextRows);
    rowsRef.current = nextRows;
    setIgnoredCount(ignored);
    setSourceName(source);
    setSummary(null);
    setBatch(null);
    setConfirmText('');
    setError('');
    setMessage(`${nextRows.length} 份说明书候选已加入，忽略 ${ignored} 个无效或临时文件`);
    setStep(1);
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const grouped = groupFiles(files);
    reset(grouped.rows, grouped.ignored, grouped.sourceName);
    event.target.value = '';
  }

  async function parseAndPreview(): Promise<void> {
    if (!rows.length) return setError('请先选择文件夹或多个文件');
    setBusy(true);
    setError('');
    setStep(2);
    setParseProgress(0);
    const next = rows.map(row => ({ ...row, warnings: [], queueState: 'idle' as const, queueError: '' }));
    let completedRows = 0;
    await inspectConnectorManualFiles(next, async row => {
      if (row.fileMode === 'PDF') {
        const asset = row.localAssets[0];
        const inspection = await inspectConnectorManualFile(asset.file, asset.relativePath);
        asset.hash = inspection.hash;
        Object.assign(row, inspection, {
          defaultTitle: row.defaultTitle,
          assets: [{ fileName: asset.fileName, relativePath: asset.relativePath, size: asset.size, mimeType: asset.mimeType, hash: asset.hash }],
        });
      } else {
        for (const asset of row.localAssets) {
          const inspection = await inspectConnectorManualFile(asset.file, asset.relativePath);
          asset.hash = inspection.hash;
        }
        const parsed = parseConnectorManual({ fileName: `${row.defaultTitle}.png`, relativePath: row.relativePath, fileSize: row.size });
        Object.assign(row, parsed, {
          defaultTitle: row.defaultTitle,
          pageCount: row.localAssets.length,
          hash: await compositeHash(row.localAssets.map(asset => asset.hash)),
          parseFailed: false,
          assets: row.localAssets.map(asset => ({ fileName: asset.fileName, relativePath: asset.relativePath, size: asset.size, mimeType: asset.mimeType, hash: asset.hash })),
        });
      }
      completedRows += 1;
      setParseProgress(completedRows);
    }, 2);
    setRows(next);
    rowsRef.current = next;
    try {
      const response = await fetch('/api/connector-assembly-manuals/bulk/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: next.map(toPreviewPayload) }),
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '批量预览失败'));
      const previewRows = Array.isArray(data.rows) ? data.rows as ConnectorManualBulkPreviewRowDTO[] : [];
      const byId = new Map(next.map(row => [row.clientId, row]));
      const merged: LocalRow[] = [];
      for (const preview of previewRows) {
        const local = byId.get(preview.clientId);
        if (!local) continue;
        merged.push({ ...local, ...preview, localAssets: local.localAssets, queueState: 'idle', queueError: '', selected: false, autoBindUnique, selectedParameterIds: preview.uniqueParameterIds });
      }
      setRows(merged);
      rowsRef.current = merged;
      setSummary(data.summary as ConnectorManualBulkPreviewSummaryDTO);
      setStep(3);
      setMessage('自动解析与数据库去重完成；默认名称仍为文件名，可在表格中修改');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批量预览失败');
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  function updateRow(clientIdValue: string, patch: Partial<LocalRow>): void {
    updateRows(current => current.map(row => row.clientId === clientIdValue ? { ...row, ...patch } : row));
  }

  function applyBulkValues(): void {
    updateRows(current => current.map(row => ({
      ...row,
      manufacturerCandidate: bulkManufacturer.trim() || row.manufacturerCandidate,
      familyCandidate: bulkFamily.trim() || row.familyCandidate,
      keywordCandidates: bulkKeywords.trim() ? Array.from(new Set([...row.keywordCandidates, ...bulkKeywords.split(/[，,、\s]+/).filter(Boolean)])) : row.keywordCandidates,
      autoBindUnique,
      selectedParameterIds: autoBindUnique ? row.uniqueParameterIds : [],
    })));
    setMessage('批量设置已应用到当前候选');
  }

  function mergeSelectedImages(): void {
    const selected = rows.filter(row => row.selected && row.fileMode === 'IMAGE_SET');
    if (selected.length < 2) return setError('请选择至少两条图片候选再合并');
    const assets = selected.flatMap(row => row.localAssets).sort(naturalSort);
    const title = selected[0].defaultTitle;
    const candidate = blankCandidate(`${selected[0].clientId}-merged`, title, selected[0].relativePath, 'IMAGE_SET', assets);
    const merged = blankRow(candidate, assets);
    const ids = new Set(selected.map(row => row.clientId));
    reset([...rows.filter(row => !ids.has(row.clientId)), merged], ignoredCount, sourceName);
    setMessage('图片候选已合并，请重新自动解析');
  }

  function splitSelectedImages(): void {
    const selected = rows.filter(row => row.selected && row.fileMode === 'IMAGE_SET' && row.localAssets.length > 1);
    if (!selected.length) return setError('请选择包含多张图片的候选再拆分');
    const ids = new Set(selected.map(row => row.clientId));
    const split = selected.flatMap(row => row.localAssets.map((asset, index) => blankRow(blankCandidate(`${row.clientId}-split-${index}`, connectorManualDefaultTitle(asset.fileName), asset.relativePath, 'IMAGE_SET', [asset]), [asset])));
    reset([...rows.filter(row => !ids.has(row.clientId)), ...split], ignoredCount, sourceName);
    setMessage('图片集已拆分为单页说明书，请重新自动解析');
  }

  async function createBatch(): Promise<void> {
    if (confirmText.trim() !== 'IMPORT_MANUALS') return setError('请输入 IMPORT_MANUALS 确认导入');
    if (unresolvedCount) return setError(`仍有 ${unresolvedCount} 条冲突、无效或待确认项`);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/connector-assembly-manuals/bulk/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmText, sourceName, rows: rows.map(toPreviewPayload) }),
      });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '导入批次创建失败'));
      const nextBatch = data.batch as ConnectorManualImportBatchDTO;
      setBatch(nextBatch);
      setStep(5);
      cancelledRef.current = false;
      pausedRef.current = false;
      setPaused(false);
      await runQueue(queueRows, nextBatch.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入批次创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function uploadRow(row: LocalRow, batchIdValue: string): Promise<void> {
    updateRow(row.clientId, { queueState: 'uploading', queueError: '' });
    const form = new FormData();
    form.append('batchId', batchIdValue);
    form.append('clientId', row.clientId);
    form.append('confirmText', 'IMPORT_MANUALS');
    row.localAssets.forEach(asset => form.append('files', asset.file));
    try {
      const response = await fetch('/api/connector-assembly-manuals/bulk/import-item', { method: 'POST', body: form });
      const data = await jsonResponse(response);
      if (!response.ok) throw new Error(String(data.error || '文件导入失败'));
      updateRow(row.clientId, { queueState: data.duplicate ? 'duplicate' : 'success', queueError: '' });
    } catch (caught) {
      updateRow(row.clientId, { queueState: 'failed', queueError: caught instanceof Error ? caught.message : '文件导入失败' });
    }
  }

  async function runQueue(inputRows: LocalRow[], batchIdValue: string): Promise<void> {
    const pending = inputRows.filter(row => ['idle', 'failed'].includes(row.queueState));
    const activeTitles = new Set<string>();
    async function takeNext(): Promise<LocalRow | null> {
      while (pending.length) {
        if (cancelledRef.current) return null;
        while (pausedRef.current && !cancelledRef.current) await new Promise(resolve => window.setTimeout(resolve, 120));
        const index = pending.findIndex(row => !activeTitles.has(row.defaultTitle.toLocaleLowerCase('zh-CN')));
        if (index >= 0) {
          const [row] = pending.splice(index, 1);
          activeTitles.add(row.defaultTitle.toLocaleLowerCase('zh-CN'));
          return row;
        }
        await new Promise(resolve => window.setTimeout(resolve, 80));
      }
      return null;
    }
    const worker = async (): Promise<void> => {
      while (true) {
        const row = await takeNext();
        if (!row) return;
        await uploadRow(row, batchIdValue);
        activeTitles.delete(row.defaultTitle.toLocaleLowerCase('zh-CN'));
      }
    };
    await Promise.all([worker(), worker()]);
    const response = await fetch(`/api/connector-assembly-manuals/bulk/batches/${batchIdValue}`, { cache: 'no-store' });
    const data = await jsonResponse(response);
    if (response.ok) setBatch(data.batch as ConnectorManualImportBatchDTO);
    setStep(6);
    await completed();
  }

  function togglePause(): void {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }

  async function cancelPending(): Promise<void> {
    if (!batch) return;
    cancelledRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    await fetch(`/api/connector-assembly-manuals/bulk/batches/${batch.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
    updateRows(current => current.map(row => row.queueState === 'idle' ? { ...row, queueState: 'cancelled' } : row));
  }

  async function retryFailed(): Promise<void> {
    if (!batch) return;
    const failed = rowsRef.current.filter(row => row.queueState === 'failed');
    if (!failed.length) return;
    const response = await fetch(`/api/connector-assembly-manuals/bulk/batches/${batch.id}/retry`, { method: 'POST' });
    const data = await jsonResponse(response);
    if (!response.ok) return setError(String(data.error || '失败任务重置失败'));
    updateRows(current => current.map(row => row.queueState === 'failed' ? { ...row, queueState: 'idle', queueError: '' } : row));
    setStep(5);
    cancelledRef.current = false;
    await runQueue(failed.map(row => ({ ...row, queueState: 'idle', queueError: '' })), batch.id);
  }

  async function loadHistory(): Promise<void> {
    const response = await fetch('/api/connector-assembly-manuals/bulk/batches?limit=30', { cache: 'no-store' });
    const data = await jsonResponse(response);
    if (!response.ok) return setError(String(data.error || '批次加载失败'));
    setBatchHistory(Array.isArray(data.batches) ? data.batches as ConnectorManualImportBatchDTO[] : []);
    setHistoryOpen(true);
  }

  const stats = summary || {
    totalFiles: rows.length, readyCount: 0, createManualCount: 0, versionCandidateCount: 0, duplicateCount: 0, conflictCount: 0, invalidCount: 0, manualReviewCount: 0,
  };

  return (
    <div className="modal-backdrop manual-bulk-backdrop">
      <section className="manual-bulk-dialog" role="dialog" aria-modal="true" aria-label="批量导入组装说明书">
        <header className="manual-bulk-head">
          <div><strong>批量导入组装说明书</strong><span>文件名作为默认名称；自动识别失败不阻塞导入</span></div>
          <div><button type="button" onClick={loadHistory}>导入批次</button><button type="button" disabled={busy || step === 5} onClick={close}>×</button></div>
        </header>
        <nav className="manual-bulk-steps">{steps.map((label, index) => <span className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''} key={label}><b>{index + 1}</b><em>{label}</em></span>)}</nav>

        <div className="manual-bulk-summary">
          <span><small>总候选</small><strong>{stats.totalFiles}</strong></span><span><small>准备新建</small><strong>{stats.createManualCount}</strong></span><span><small>新增版本</small><strong>{stats.versionCandidateCount}</strong></span><span><small>重复跳过</small><strong>{stats.duplicateCount}</strong></span><span><small>冲突</small><strong>{stats.conflictCount}</strong></span><span><small>待确认</small><strong>{stats.manualReviewCount}</strong></span><span><small>失败</small><strong>{queueStats.failed || stats.invalidCount}</strong></span>
        </div>

        {step <= 2 && (
          <section className="manual-bulk-picker">
            <div className="manual-bulk-picker-actions">
              <label className="primary-button">选择本地文件夹<input ref={folderInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={chooseFiles} /></label>
              <label>选择多个文件<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={chooseFiles} /></label>
              <button type="button" onClick={mergeSelectedImages}>合并所选图片</button>
              <button type="button" onClick={splitSelectedImages}>拆分所选图片集</button>
            </div>
            <p>同一子文件夹中的图片自动组成一份说明书；根目录图片按单页说明书处理。临时、隐藏、空文件和不支持格式自动忽略。</p>
            <div className="manual-bulk-file-list hm-scroll-region" tabIndex={0} aria-label={`已选择资料，共 ${rows.length} 组`}>
              {rows.map(row => <label key={row.clientId}><input type="checkbox" checked={row.selected} onChange={event => updateRow(row.clientId, { selected: event.target.checked })} /><span>{row.fileMode === 'PDF' ? 'PDF' : `${row.localAssets.length} 图`}</span><strong title={row.relativePath}>{row.defaultTitle}</strong><small>{row.relativePath}</small></label>)}
              {!rows.length && <div>选择一个文件夹或一批 PDF / 图片开始；不会在预览阶段上传文件。</div>}
            </div>
            {step === 2 && <div className="manual-parse-progress"><span style={{ width: `${rows.length ? (parseProgress / rows.length) * 100 : 0}%` }} /><b>正在轻量解析 {parseProgress}/{rows.length}，并发 2</b></div>}
          </section>
        )}

        {step >= 3 && step <= 4 && (
          <>
            <section className="manual-bulk-settings">
              <label><span>批量制造商</span><input value={bulkManufacturer} placeholder="统一制造商（可选）" onChange={event => setBulkManufacturer(event.target.value)} /></label>
              <label><span>批量连接器系列</span><input value={bulkFamily} placeholder="统一系列（可选）" onChange={event => setBulkFamily(event.target.value)} /></label>
              <label><span>追加关键词</span><input value={bulkKeywords} placeholder="追加关键词（可选）" onChange={event => setBulkKeywords(event.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={autoBindUnique} onChange={event => setAutoBindUnique(event.target.checked)} />自动关联唯一精确型号</label>
              <button type="button" onClick={applyBulkValues}>应用批量设置</button>
            </section>
            <div className="manual-bulk-table-wrap hm-scroll-region" tabIndex={0} aria-label="说明书批量导入预览结果">
              <table className="manual-bulk-table">
                <thead><tr><th>文件</th><th>默认名称</th><th>页数</th><th>检测型号</th><th>版本</th><th>建议动作</th><th>关联参数</th><th>警告</th></tr></thead>
                <tbody>{rows.map(row => <tr className={`action-${row.action}`} key={row.clientId}><td><strong>{row.fileName}</strong><small title={row.relativePath}>{row.relativePath}</small></td><td><input value={row.defaultTitle} onChange={event => updateRow(row.clientId, { defaultTitle: event.target.value })} /><small title={row.detectedTitle}>{row.detectedTitle ? `识别：${row.detectedTitle}` : '未识别封面标题'}</small></td><td>{row.pageCount || '-'}</td><td><span>{row.modelCandidates.join(' / ') || '未识别'}</span></td><td><input value={row.suggestedRevision} onChange={event => updateRow(row.clientId, { suggestedRevision: event.target.value })} /></td><td><select value={row.action} onChange={event => updateRow(row.clientId, { action: event.target.value as ConnectorManualBulkAction })}><option value="create_manual">新建说明书</option><option value="create_version">新增版本</option><option value="skip">跳过</option>{['duplicate', 'conflict', 'invalid', 'manual_review'].includes(row.action) && <option value={row.action}>{actionLabel(row.action)}</option>}</select><small>{row.suggestedVersionAction}</small></td><td><b>{row.uniqueParameterIds.length} 唯一</b><small>{row.parameterMatches.filter(item => item.matchType === 'multiple_matches').length} 待确认</small></td><td><span title={row.warnings.join('；')}>{row.conflictReason || row.duplicateReason || row.warnings[0] || '无'}</span></td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {step === 4 && <section className="manual-bulk-confirm"><p>正式导入会按单个 PDF / 图片集排队写入对象存储，不覆盖历史版本。请输入 <b>IMPORT_MANUALS</b>。</p><input value={confirmText} onChange={event => setConfirmText(event.target.value)} placeholder="IMPORT_MANUALS" /><span>将上传 {queueRows.length} 份；重复和跳过项不上传。</span></section>}

        {step >= 5 && (
          <section className="manual-queue-panel">
            <div className="manual-queue-progress"><span style={{ width: `${queueRows.length ? (queueStats.completed / queueRows.length) * 100 : 100}%` }} /><b>{queueStats.completed}/{queueRows.length}</b></div>
            <div className="manual-queue-stats"><span>成功 {queueStats.success}</span><span>重复 {queueStats.duplicate}</span><span>失败 {queueStats.failed}</span><span>{paused ? '队列已暂停' : step === 5 ? '并发上传 2' : batch?.status || '已完成'}</span></div>
            <div className="manual-queue-list hm-scroll-region" tabIndex={0} aria-label="说明书上传队列">{rows.filter(row => ['create_manual', 'create_version'].includes(row.action)).map(row => <article className={row.queueState} key={row.clientId}><strong>{row.defaultTitle}</strong><span>{queueLabel(row.queueState)}</span><small>{row.queueError || row.fileName}</small></article>)}</div>
          </section>
        )}

        {(message || error) && <div className={error ? 'manual-bulk-message error' : 'manual-bulk-message'}>{error || message}</div>}
        <footer className="manual-bulk-actions">
          <span>{sourceName || '尚未选择来源'} · 忽略 {ignoredCount} 个文件</span>
          <div>
            {step === 1 && <button className="primary-button" type="button" disabled={!rows.length || busy} onClick={parseAndPreview}>{busy ? '解析中...' : '自动解析并预览'}</button>}
            {step === 3 && <button className="primary-button" type="button" disabled={unresolvedCount > 0} onClick={() => setStep(4)}>确认预览结果</button>}
            {step === 4 && <><button type="button" onClick={() => setStep(3)}>返回调整</button><button className="primary-button" type="button" disabled={busy || confirmText.trim() !== 'IMPORT_MANUALS'} onClick={createBatch}>{busy ? '创建批次...' : '开始批量导入'}</button></>}
            {step === 5 && <><button type="button" onClick={togglePause}>{paused ? '继续' : '暂停'}</button><button className="danger-button" type="button" onClick={cancelPending}>取消未开始任务</button></>}
            {step === 6 && <><button type="button" disabled={!queueStats.failed} onClick={() => exportFailed(rows)}>导出失败清单</button><button type="button" disabled={!queueStats.failed} onClick={retryFailed}>重试失败</button><button className="primary-button" type="button" onClick={close}>完成</button></>}
          </div>
        </footer>

        {historyOpen && <div className="manual-batch-history"><header><strong>最近导入批次</strong><button type="button" onClick={() => setHistoryOpen(false)}>×</button></header><div>{batchHistory.map(item => <article key={item.id}><strong>{item.sourceName || '多文件选择'}</strong><span>{item.status}</span><small>总数 {item.totalCount} · 成功 {item.successCount} · 重复 {item.duplicateCount} · 失败 {item.failedCount}</small></article>)}{!batchHistory.length && <p>暂无批次记录</p>}</div></div>}
      </section>
    </div>
  );
}
