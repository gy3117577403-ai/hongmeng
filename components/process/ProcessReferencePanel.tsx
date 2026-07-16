'use client';

import {
  BookOpenText,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  FolderOpen,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { safeDisplayFilename } from '@/lib/filenames';
import type {
  ProcessReferenceFileDTO,
  ProcessReferencePayloadDTO,
  ProcessRouteWorkOrderDTO,
} from '@/types';

type ReferenceCategoryCode = 'drawing' | 'sop';

type ReferenceResponse = {
  ok?: boolean;
  references?: ProcessReferencePayloadDTO;
  error?: string;
};

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileName(file: ProcessReferenceFileDTO): string {
  return safeDisplayFilename(file);
}

function sourceHref(file: ProcessReferenceFileDTO, order: ProcessRouteWorkOrderDTO): string {
  const params = new URLSearchParams();
  if (file.source === 'work_order') {
    params.set('workOrderId', order.id);
    params.set('categoryCode', file.categoryCode);
    params.set('fileId', file.id);
    return `/dashboard?${params.toString()}`;
  }
  if (file.libraryItemId) params.set('itemId', file.libraryItemId);
  params.set('fileId', file.id);
  return `/drawing-library?${params.toString()}`;
}

export function ProcessReferencePanel({ order }: { order: ProcessRouteWorkOrderDTO | null }) {
  const [payload, setPayload] = useState<ProcessReferencePayloadDTO | null>(null);
  const [category, setCategory] = useState<ReferenceCategoryCode>('drawing');
  const [selectedFileId, setSelectedFileId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const orderId = order?.id || '';

  useEffect(() => {
    if (!orderId) {
      setPayload(null);
      setSelectedFileId('');
      setError('');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPayload(null);
    fetch(`/api/process-management/work-orders/${orderId}/references`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as ReferenceResponse;
        if (response.status === 401) {
          location.href = '/login';
          return null;
        }
        if (!response.ok || !body.references) throw new Error(body.error || '工艺参考资料加载失败');
        return body.references;
      })
      .then(references => {
        if (!references) return;
        setPayload(references);
        const nextCategory = references.files.some(file => file.categoryCode === 'drawing')
          ? 'drawing'
          : references.files.some(file => file.categoryCode === 'sop')
            ? 'sop'
            : 'drawing';
        const firstFile = references.files.find(file => file.categoryCode === nextCategory);
        setCategory(nextCategory);
        setSelectedFileId(firstFile?.id || '');
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orderId, reloadToken]);

  const files = useMemo(
    () => payload?.files.filter(file => file.categoryCode === category) || [],
    [category, payload?.files],
  );
  const selectedFile = useMemo(
    () => files.find(file => file.id === selectedFileId) || files[0] || null,
    [files, selectedFileId],
  );

  function chooseCategory(nextCategory: ReferenceCategoryCode): void {
    setCategory(nextCategory);
    const firstFile = payload?.files.find(file => file.categoryCode === nextCategory);
    setSelectedFileId(firstFile?.id || '');
  }

  if (!order) {
    return (
      <section className="process-reference-panel process-reference-empty-shell" aria-label="工艺参考资料">
        <div className="process-reference-empty">
          <BookOpenText aria-hidden="true" />
          <strong>选择工单后查看参考资料</strong>
          <span>原图与SOP指导书会在这里打开，编排工序时无需离开当前页面。</span>
        </div>
      </section>
    );
  }

  const categoryCounts = new Map(payload?.categories.map(item => [item.code, item.fileCount]) || []);
  const fileLabel = selectedFile ? fileName(selectedFile) : '';
  const manageHref = selectedFile
    ? sourceHref(selectedFile, order)
    : `/dashboard?${new URLSearchParams({ workOrderId: order.id, categoryCode: category }).toString()}`;

  return (
    <section className={`process-reference-panel ${selectedFile ? 'has-file' : ''}`} aria-labelledby="process-reference-heading">
      <header className="process-reference-header">
        <div>
          <span>工艺依据</span>
          <h2 id="process-reference-heading">图纸与作业指导书</h2>
        </div>
        <div className="process-reference-header-actions">
          <a href={manageHref} title="在资料页面打开当前资料"><ExternalLink size={15} aria-hidden="true" />资料页</a>
          <button type="button" aria-label="重新加载参考资料" title="重新加载" disabled={loading} onClick={() => setReloadToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /></button>
        </div>
      </header>

      <div className="process-reference-tabs" role="tablist" aria-label="参考资料分类">
        <button type="button" role="tab" aria-selected={category === 'drawing'} className={category === 'drawing' ? 'active' : ''} onClick={() => chooseCategory('drawing')}>
          <FileImage size={15} aria-hidden="true" /><span>原图</span><em>{categoryCounts.get('drawing') || 0}</em>
        </button>
        <button type="button" role="tab" aria-selected={category === 'sop'} className={category === 'sop' ? 'active' : ''} onClick={() => chooseCategory('sop')}>
          <FileText size={15} aria-hidden="true" /><span>SOP指导书</span><em>{categoryCounts.get('sop') || 0}</em>
        </button>
      </div>

      {loading && <div className="process-reference-loading"><RefreshCw className="spin" aria-hidden="true" /><strong>正在加载参考资料</strong><span>只读取文件信息和同源预览，不会修改资料。</span></div>}
      {!loading && error && <div className="process-reference-loading error" role="alert"><TriangleAlert aria-hidden="true" /><strong>{error}</strong><button type="button" onClick={() => setReloadToken(value => value + 1)}>重新加载</button></div>}
      {!loading && !error && !selectedFile && (
        <div className="process-reference-empty">
          <FolderOpen aria-hidden="true" />
          <strong>当前工单暂无{category === 'drawing' ? '原图' : 'SOP指导书'}</strong>
          <span>可以继续编排工艺，也可以前往生产工单补充资料后重新加载。</span>
          <a href={manageHref}>前往生产工单补充资料</a>
        </div>
      )}
      {!loading && !error && selectedFile && (
        <>
          <div className="process-reference-filebar">
            <div>
              <span className={`process-reference-source ${selectedFile.source}`}>{selectedFile.sourceLabel}</span>
              <strong title={fileLabel}>{fileLabel}</strong>
              <small>{selectedFile.version || 'V1.0'} · {bytes(selectedFile.fileSize)}</small>
            </div>
            <a href={selectedFile.downloadUrl} target="_blank" rel="noreferrer" title="下载当前文件"><Download size={15} aria-hidden="true" /><span>下载</span></a>
          </div>
          <div className="process-reference-viewer">
            {selectedFile.fileType === 'pdf' && (
              <PdfViewer
                key={selectedFile.id}
                dashboardMode
                fileId={selectedFile.id}
                title={fileLabel}
                contentUrl={selectedFile.contentUrl}
                downloadUrl={selectedFile.downloadUrl}
                viewUrl={selectedFile.contentUrl}
              />
            )}
            {selectedFile.fileType === 'image' && (
              <ImageViewer
                key={selectedFile.id}
                dashboardMode
                fileId={selectedFile.id}
                title={fileLabel}
                contentUrl={selectedFile.contentUrl}
                downloadUrl={selectedFile.downloadUrl}
                gestureResetKey={`${order.id}-${selectedFile.id}`}
              />
            )}
            {selectedFile.fileType === 'other' && (
              <div className="process-reference-empty">
                <FileText aria-hidden="true" />
                <strong>该文件暂不支持页面预览</strong>
                <a href={selectedFile.downloadUrl} target="_blank" rel="noreferrer">下载文件查看</a>
              </div>
            )}
          </div>
          {files.length > 1 && (
            <div className="process-reference-files hm-scroll-region" role="listbox" aria-label={`${category === 'drawing' ? '原图' : 'SOP指导书'}文件列表`}>
              {files.map(file => (
                <button
                  type="button"
                  role="option"
                  aria-selected={file.id === selectedFile.id}
                  className={file.id === selectedFile.id ? 'active' : ''}
                  key={`${file.source}-${file.id}`}
                  title={fileName(file)}
                  onClick={() => setSelectedFileId(file.id)}
                >
                  <b>{file.fileType === 'pdf' ? 'PDF' : file.fileType === 'image' ? 'IMG' : 'FILE'}</b>
                  <span><strong>{fileName(file)}</strong><small>{file.sourceLabel} · {file.version || 'V1.0'}</small></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
