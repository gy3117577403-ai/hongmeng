'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2, Maximize2, RefreshCw, Search, Table2, X } from 'lucide-react';
import { PdfViewer } from '@/components/PdfViewer';
import { useModalLayer } from '@/components/useModalLayer';
import { isExcelFile, type OfficePreviewStatus, type SheetPage } from '@/lib/knowledge-preview-types';
import type { KnowledgePreviewDTO } from '@/types';
import styles from './KnowledgeOfficePreview.module.css';

function columnName(index: number) { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }

export function KnowledgeOfficePreview({ file, active = true }: { file: KnowledgePreviewDTO; active?: boolean }) {
  const excel = isExcelFile(file.officeType || '');
  const [status, setStatus] = useState<OfficePreviewStatus | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'table' | 'pdf'>(excel ? 'table' : 'pdf');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<SheetPage | null>(null);
  const [sheetError, setSheetError] = useState('');
  const [tableBusy, setTableBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [freezeRow, setFreezeRow] = useState(true);
  const [freezeColumn, setFreezeColumn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const layer = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const url = `/api/knowledge/attachments/${file.fileId}/preview`;
  useModalLayer({ open: active && fullscreen, layerRef: layer, triggerRef: trigger, onClose: () => setFullscreen(false) });
  useEffect(() => { if (window.matchMedia('(max-width: 767px)').matches) setFullscreen(true); }, []);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load(first: boolean) {
      try {
        const response = await fetch(url, { method: first && retry ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal });
        const data = await response.json(); if (!response.ok) throw Error(data.error || '预览加载失败');
        if (stopped) return;
        setStatus(data.preview); setError('');
        if (['pending', 'processing'].includes(data.preview.status)) timer = setTimeout(() => void load(false), 2000);
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : '预览加载失败'); }
    }
    void load(true);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [url, retry]);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (status?.tableStatus !== 'ready' || mode !== 'table') return;
    const controller = new AbortController(); let stopped = false;
    setTableBusy(true); setSheetError('');
    void fetch(`${url}/table?sheet=${sheetIndex}&page=${page}&q=${encodeURIComponent(search)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data.sheet as SheetPage; })
      .then(data => { if (!stopped) { setSheet(data); if (scroll.current) scroll.current.scrollTop = 0; } })
      .catch(failure => { if (!stopped) { setSheet(null); setSheetError(failure.message || '工作表加载失败'); } })
      .finally(() => { if (!stopped) setTableBusy(false); });
    return () => { stopped = true; controller.abort(); };
  }, [url, status?.tableStatus, sheetIndex, page, search, mode, retry]);
  const doRetry = useCallback(() => { setError(''); setRetry(value => value + 1); }, []);
  const currentState = mode === 'table' ? status?.tableStatus : status?.pdfStatus;
  const currentError = mode === 'table' ? status?.tableError : status?.pdfError;
  const ready = currentState === 'ready';
  return <div ref={layer} data-office-fullscreen={fullscreen || undefined} className={`${styles.viewer} ${fullscreen ? styles.fullscreen : ''}`} role={fullscreen ? 'dialog' : 'region'} aria-modal={fullscreen || undefined} aria-label={`Office 预览：${file.title}`} tabIndex={-1}>
    <header className={styles.header}>
      <div className={styles.title}><FileText size={17} /><strong title={file.title}>{file.title}</strong><span>只读</span></div>
      <div className={styles.actions}><a href={file.downloadUrl} title="下载原件"><Download size={15} /><span>下载原件</span></a>
        {fullscreen ? <button type="button" onClick={() => setFullscreen(false)} aria-label="退出全屏预览"><X size={17} />返回</button>
          : <button ref={trigger} type="button" onClick={() => setFullscreen(true)} aria-label="全屏预览"><Maximize2 size={17} />全屏</button>}</div>
    </header>
    {excel && <nav className={styles.modes} aria-label="预览方式">
      <button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}><Table2 size={15} />表格预览</button>
      <button type="button" aria-pressed={mode === 'pdf'} onClick={() => setMode('pdf')}><FileText size={15} />版式预览</button>
      <span>图片、图表和原始排版请查看版式预览</span>
    </nav>}
    {error ? <div className={styles.state} role="alert"><strong>{error}</strong><button type="button" onClick={doRetry}><RefreshCw size={16} />重新加载</button></div>
      : !ready ? <div className={styles.state} aria-live="polite">
        {currentState === 'failed' ? <><FileText size={28} /><strong>暂时无法预览</strong><p>{currentError}</p><button type="button" onClick={doRetry}><RefreshCw size={16} />重试预览</button></>
          : <><Loader2 className="spin" size={28} /><strong>{status?.status === 'processing' ? '正在生成预览' : '预览排队中'}</strong><p>首次打开需要生成预览，完成后会自动显示。原文件已保存。</p></>}
      </div>
        : mode === 'pdf' && status?.pdfUrl ? <div className={styles.pdf}>
          <PdfViewer dashboardMode fileId={`${file.fileId}-office-pdf`} title={file.title} contentUrl={status.pdfUrl} downloadUrl={file.downloadUrl} viewUrl={status.pdfUrl} page={pdfPage} onPageChange={setPdfPage} />
        </div> : <>
          <nav className={styles.sheets} aria-label="工作表">{status?.sheets.map((item, index) => <button type="button" key={index} aria-pressed={sheetIndex === index}
            onClick={() => { setSheetIndex(index); setPage(1); setQuery(''); setSearch(''); setSheet(null); }}>{item.name}</button>)}</nav>
          <div className={styles.tools}>
            <label className={styles.search}><Search size={15} /><input type="search" aria-label="搜索当前工作表" placeholder="搜索当前工作表" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label><input type="checkbox" checked={freezeRow} onChange={event => setFreezeRow(event.target.checked)} />冻结首行</label>
            <label><input type="checkbox" checked={freezeColumn} onChange={event => setFreezeColumn(event.target.checked)} />冻结首列</label>
            <select aria-label="表格缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}</select>
          </div>
          <div className={styles.tableWrap} ref={scroll} aria-busy={tableBusy} tabIndex={0} aria-label="工作表内容">
            {tableBusy && <div className={styles.loading}><Loader2 className="spin" size={16} />加载工作表…</div>}
            {sheetError ? <div className={styles.state} role="alert"><p>{sheetError}</p><button type="button" onClick={doRetry}>重新加载工作表</button></div>
              : sheet && <table className={`${freezeRow ? styles.freezeRow : ''} ${freezeColumn ? styles.freezeColumn : ''}`} style={{ fontSize: `${12 * zoom / 100}px` }}>
                <thead><tr><th scope="col" className={styles.rowNumber}>行</th>{Array.from({ length: sheet.columnCount }, (_, col) => <th key={col} scope="col" style={{ minWidth: sheet.widths[col] * zoom / 100 }}>{columnName(col)}</th>)}</tr>
                  {freezeRow && sheet.header && <tr className={styles.firstRow}><th scope="row" className={styles.rowNumber}>1</th>{sheet.header.cells.map((value, col) => <th key={col} scope="col">{value}</th>)}</tr>}
                </thead>
                <tbody>{sheet.rows.filter(row => !freezeRow || row.index !== 1).map(row => <tr key={row.index}>
                  <th scope="row" className={styles.rowNumber}>{row.index}</th>{row.cells.map((value, col) => <td key={col}>{value}</td>)}
                </tr>)}</tbody>
              </table>}
            {sheet && !sheet.rows.length && <p className={styles.empty}>{search ? '未找到匹配的单元格' : '此工作表没有内容'}</p>}
          </div>
          <footer className={styles.footer}><span>{sheet ? `${sheet.totalRows} 行${search ? '匹配' : ''} · ${sheet.columnCount} 列` : '加载中'}</span>
            <div><button type="button" disabled={tableBusy || !sheet || sheet.page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
              <label>第 <input type="number" aria-label="工作表页码" min={1} max={sheet?.totalPages || 1} value={page} onChange={event => setPage(Math.max(1, Math.min(sheet?.totalPages || 1, Number(event.target.value) || 1)))} /> / {sheet?.totalPages || 1} 页</label>
              <button type="button" disabled={tableBusy || !sheet || sheet.page >= sheet.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>
          </footer>
          <p className={styles.note}>可选中文字复制。表格视图展开合并内容便于查询；显示文件已保存的公式结果，不重新计算。</p>
        </>}
  </div>;
}
