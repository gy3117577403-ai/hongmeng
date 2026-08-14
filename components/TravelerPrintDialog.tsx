'use client';

import { AlertTriangle, Check, ChevronDown, FileImage, Files, FileText, Layers3, Loader2, Printer, RefreshCw, Settings2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkOrderTravelerPrintReadinessRecord } from '@/lib/work-order-qr-service';

export type TravelerPrintMode =
  | 'TRAVELER_ONLY'
  | 'TRAVELER_SOP_DUPLEX'
  | 'TRAVELER_SOP_SEPARATE'
  | 'DRAWING_SOP_TRAVELER_SEPARATE'
  | 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'
  | 'CUSTOM';
type TravelerPrintMaterial = 'TRAVELER' | 'SOP' | 'DRAWING';
type ReadinessState =
  | { status: 'idle' | 'loading'; items: WorkOrderTravelerPrintReadinessRecord[]; message: string }
  | { status: 'ready'; items: WorkOrderTravelerPrintReadinessRecord[]; message: string }
  | { status: 'error'; items: WorkOrderTravelerPrintReadinessRecord[]; message: string };

const printModes: Array<{
  value: TravelerPrintMode;
  title: string;
  description: string;
  icon: typeof Printer;
}> = [
  {
    value: 'TRAVELER_ONLY',
    title: '仅打印二维码流转单',
    description: '适合现场已有纸质 SOP，打印速度最快。',
    icon: Printer,
  },
  {
    value: 'TRAVELER_SOP_DUPLEX',
    title: '流转单 + SOP 双面打印',
    description: '先生成一份连续文档，打印时选择双面、长边翻转。',
    icon: Layers3,
  },
  {
    value: 'TRAVELER_SOP_SEPARATE',
    title: '流转单与 SOP 分开打印',
    description: '同一打印任务中分别打印流转单和 SOP，便于分类装订。',
    icon: FileText,
  },
  {
    value: 'DRAWING_SOP_TRAVELER_SEPARATE',
    title: '原图 + SOP + 二维码分开打印',
    description: '三类资料独立打印、独立确认，原图保持源 PDF 纸张尺寸。',
    icon: Files,
  },
];

const materialOptions: Array<{ value: TravelerPrintMaterial; label: string; description: string }> = [
  { value: 'TRAVELER', label: '二维码流转单', description: '现场扫码报工与纸面流转' },
  { value: 'SOP', label: 'SOP', description: '当前已发布 PDF 快照' },
  { value: 'DRAWING', label: '原图', description: '按源 PDF 的 A3/A4 尺寸打印' },
];

export function TravelerPrintDialog({
  open,
  workOrderIds,
  onClose,
  onSuccess,
}: {
  open: boolean;
  workOrderIds: string[];
  onClose: () => void;
  onSuccess?: (message: string) => void;
}) {
  const [mode, setMode] = useState<TravelerPrintMode>('TRAVELER_ONLY');
  const [copies, setCopies] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customMaterials, setCustomMaterials] = useState<TravelerPrintMaterial[]>(['TRAVELER']);
  const [materialCopies, setMaterialCopies] = useState<Record<TravelerPrintMaterial, number>>({ TRAVELER: 1, SOP: 1, DRAWING: 1 });
  const [reprintReason, setReprintReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [readiness, setReadiness] = useState<ReadinessState>({ status: 'idle', items: [], message: '' });
  const [readinessNonce, setReadinessNonce] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const workOrderIdKey = workOrderIds.join('\u001f');

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setMode('TRAVELER_ONLY');
      setCopies(1);
      setAdvancedOpen(false);
      setCustomMaterials(['TRAVELER']);
      setMaterialCopies({ TRAVELER: 1, SOP: 1, DRAWING: 1 });
      setReprintReason('');
      setSaving(false);
      setError('');
      setReadiness({ status: 'loading', items: [], message: '' });
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const selectedIds = workOrderIdKey ? workOrderIdKey.split('\u001f') : [];
    setReadiness({ status: 'loading', items: [], message: '' });
    void fetch('/api/work-order-qr/prints/readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workOrderIds: selectedIds }),
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '生产资料校验失败');
      const items = Array.isArray(body.data?.items) ? body.data.items as WorkOrderTravelerPrintReadinessRecord[] : [];
      if (items.length !== selectedIds.length) throw new Error('生产资料校验结果不完整，请刷新后重试');
      setReadiness({ status: 'ready', items, message: '' });
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setReadiness({
        status: 'error',
        items: [],
        message: reason instanceof Error ? reason.message : '生产资料校验失败，请重试',
      });
    });
    return () => controller.abort();
  }, [open, readinessNonce, workOrderIdKey]);

  useEffect(() => {
    if (!open) return;
    setError('');
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, saving]);

  if (!open) return null;

  const includesSop = mode === 'TRAVELER_SOP_DUPLEX'
    || mode === 'TRAVELER_SOP_SEPARATE'
    || mode === 'DRAWING_SOP_TRAVELER_SEPARATE'
    || mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'
    || (mode === 'CUSTOM' && customMaterials.includes('SOP'));
  const includesDrawing = mode === 'DRAWING_SOP_TRAVELER_SEPARATE'
    || mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'
    || (mode === 'CUSTOM' && customMaterials.includes('DRAWING'));

  function blockingIssue(targetMode: TravelerPrintMode, materials = customMaterials): string {
    if (readiness.status === 'idle' || readiness.status === 'loading') return '正在校验工艺路线和生产资料，请稍候';
    if (readiness.status === 'error') return readiness.message || '生产资料校验失败，请重试';
    const requiresSop = targetMode === 'TRAVELER_SOP_DUPLEX'
      || targetMode === 'TRAVELER_SOP_SEPARATE'
      || targetMode === 'DRAWING_SOP_TRAVELER_SEPARATE'
      || targetMode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'
      || (targetMode === 'CUSTOM' && materials.includes('SOP'));
    const requiresDrawing = targetMode === 'DRAWING_SOP_TRAVELER_SEPARATE'
      || targetMode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'
      || (targetMode === 'CUSTOM' && materials.includes('DRAWING'));
    const checks = readiness.items.flatMap(item => [
      item.traveler,
      ...(requiresSop ? [item.sop] : []),
      ...(requiresDrawing ? [item.drawing] : []),
    ]);
    const issues = checks.filter(check => !check.ready);
    if (!issues.length) return '';
    return `${issues[0].message}${issues.length > 1 ? `（另有 ${issues.length - 1} 项待处理）` : ''}`;
  }

  function selectMode(nextMode: TravelerPrintMode) {
    const issue = blockingIssue(nextMode);
    if (issue) {
      setError(issue);
      return;
    }
    setMode(nextMode);
    setError('');
  }

  const currentBlockingIssue = blockingIssue(mode);
  const readyCount = (material: 'traveler' | 'sop' | 'drawing') => readiness.status === 'ready'
    ? readiness.items.filter(item => item[material].ready).length
    : 0;

  async function submit() {
    if (!workOrderIds.length || saving) return;
    if (currentBlockingIssue) {
      setError(currentBlockingIssue);
      return;
    }
    setSaving(true);
    setError('');
    let navigating = false;
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const response = await fetch('/api/work-order-qr/prints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderIds,
          mode,
          copies,
          materials: mode === 'CUSTOM' ? customMaterials : undefined,
          materialCopies: mode === 'CUSTOM' ? materialCopies : undefined,
          reprintReason,
          returnTo,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) setReadinessNonce(value => value + 1);
        throw new Error(body.error || '打印任务生成失败');
      }
      const url = String(body.data?.url || '');
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin || parsed.pathname !== '/production/qr-print') throw new Error('打印地址生成失败');
      onSuccess?.(`已生成 ${body.data?.count || workOrderIds.length} 张流转单，请打印后确认`);
      navigating = true;
      window.location.assign(`${parsed.pathname}${parsed.search}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '打印任务生成失败');
    } finally {
      if (!navigating) setSaving(false);
    }
  }

  return <div className="modal-backdrop traveler-print-dialog-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialogRef} tabIndex={-1} className="traveler-print-dialog" role="dialog" aria-modal="true" aria-labelledby="traveler-print-dialog-title">
      <header>
        <div><span>生产资料打印</span><h2 id="traveler-print-dialog-title">选择流转单打印方式</h2><p>已选择 {workOrderIds.length} 张生产工单</p></div>
        <button type="button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="traveler-print-dialog-body">
        <div className="traveler-print-mode-grid">
          {printModes.map(option => {
            const Icon = option.icon;
            const selected = mode === option.value;
            const issue = blockingIssue(option.value);
            return <button className={`${selected ? 'selected' : ''}${issue ? ' blocked' : ''}`} aria-disabled={Boolean(issue)} type="button" key={option.value} onClick={() => selectMode(option.value)}>
              <i><Icon size={20} /></i><span><strong>{option.title}</strong><small>{issue && readiness.status === 'ready' ? `暂不可用：${issue}` : option.description}</small></span>{selected && <em><Check size={15} /></em>}
            </button>;
          })}
        </div>
        <section className={`traveler-print-readiness ${readiness.status}`} aria-live="polite">
          {readiness.status === 'loading' && <><Loader2 className="spin" size={20} /><span><strong>正在校验打印条件</strong><small>检查工艺路线、当前发布 SOP、PDF 文件状态和原图关联。</small></span></>}
          {readiness.status === 'error' && <><AlertTriangle size={20} /><span><strong>打印前校验失败</strong><small>{readiness.message}</small></span><button type="button" onClick={() => setReadinessNonce(value => value + 1)}><RefreshCw size={15} />重新校验</button></>}
          {readiness.status === 'ready' && <><ShieldCheck size={20} /><span><strong>打印条件已校验</strong><small>流转单 {readyCount('traveler')}/{readiness.items.length} · SOP {readyCount('sop')}/{readiness.items.length} · 原图 {readyCount('drawing')}/{readiness.items.length}；不可用方式已标出具体原因。</small></span><button type="button" aria-label="重新校验打印条件" onClick={() => setReadinessNonce(value => value + 1)}><RefreshCw size={15} /></button></>}
        </section>
        <section className={`traveler-print-advanced ${advancedOpen ? 'open' : ''}`}>
          <button type="button" className="traveler-print-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(current => !current)}>
            <span><Settings2 size={17} /><strong>更多组合与自定义补打</strong><small>原图单独打印 + 流转单/SOP 双面，或只补打指定资料</small></span><ChevronDown size={18} />
          </button>
          {advancedOpen && <div className="traveler-print-advanced-body">
            <button type="button" aria-disabled={Boolean(blockingIssue('DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'))} className={`traveler-print-hybrid ${mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX' ? 'selected' : ''}${blockingIssue('DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX') ? ' blocked' : ''}`} onClick={() => selectMode('DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX')}>
              <i><Layers3 size={20} /></i><span><strong>原图单独 + 流转单/SOP 双面</strong><small>{blockingIssue('DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX') && readiness.status === 'ready' ? `暂不可用：${blockingIssue('DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX')}` : '图纸保持原尺寸，现场资料合并双面，兼顾尺寸与装订。'}</small></span>{mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX' && <em><Check size={15} /></em>}
            </button>
            <div className={`traveler-print-custom ${mode === 'CUSTOM' ? 'selected' : ''}`}>
              <button type="button" onClick={() => selectMode('CUSTOM')}><i><FileImage size={20} /></i><span><strong>自定义补打</strong><small>按资料单独选择并设置份数，不重复打印已完成资料。</small></span>{mode === 'CUSTOM' && <em><Check size={15} /></em>}</button>
              {mode === 'CUSTOM' && <div className="traveler-print-material-options">{materialOptions.map(option => {
                const checked = customMaterials.includes(option.value);
                const materialIssue = option.value === 'SOP'
                  ? readiness.status === 'ready' ? readiness.items.find(item => !item.sop.ready)?.sop.message || '' : blockingIssue('CUSTOM', [option.value])
                  : option.value === 'DRAWING'
                    ? readiness.status === 'ready' ? readiness.items.find(item => !item.drawing.ready)?.drawing.message || '' : blockingIssue('CUSTOM', [option.value])
                    : readiness.status === 'ready' ? readiness.items.find(item => !item.traveler.ready)?.traveler.message || '' : blockingIssue('CUSTOM', [option.value]);
                return <div key={option.value} className={`traveler-print-material-row ${checked ? 'checked' : ''}`}>
                  <label className="traveler-print-material-choice">
                    <input type="checkbox" checked={checked} disabled={Boolean(materialIssue) && !checked} onChange={() => setCustomMaterials(current => checked ? current.filter(item => item !== option.value) : [...current, option.value])} />
                    <span><strong>{option.label}</strong><small>{materialIssue ? `不可选：${materialIssue}` : option.description}</small></span>
                  </label>
                  <label className="traveler-print-material-copy">
                    <input aria-label={`${option.label}份数`} type="number" min={1} max={10} disabled={!checked} value={materialCopies[option.value]} onChange={event => setMaterialCopies(current => ({ ...current, [option.value]: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} />
                    <span aria-hidden="true">份</span>
                  </label>
                </div>;
              })}</div>}
            </div>
          </div>}
        </section>
        {(includesSop || includesDrawing) && <div className="traveler-print-hint"><FileText size={18} /><span><strong>{includesDrawing ? '原图与 SOP 均使用当前文件快照' : '将使用当前已发布 SOP 的 PDF 快照'}</strong><small>{includesDrawing ? '原图必须为 PDF，并会在独立标签页中按源文件纸张尺寸打印；资料更新后系统会提示重打。' : '如果 SOP 尚未上传、不是 PDF 或已删除，系统会阻止生成，避免错印旧版资料。'}</small></span></div>}
        <div className="traveler-print-form-row">
          {mode !== 'CUSTOM' && <label><span>打印份数</span><input type="number" min={1} max={10} value={copies} onChange={event => setCopies(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>}
          <label className="reason"><span>重打原因（选填）</span><input maxLength={500} value={reprintReason} onChange={event => setReprintReason(event.target.value)} placeholder="例如：SOP 更新、纸张污损、数量调整" /></label>
        </div>
        <div className="traveler-print-confirm-note"><Printer size={18} /><span>打开预览不等于已打印。完成实体打印后，请在预览页点击“确认已打印”，系统才会标记为已打印。</span></div>
        {error && <div className="traveler-print-dialog-error">{error}</div>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={saving || !workOrderIds.length || Boolean(currentBlockingIssue) || (mode === 'CUSTOM' && !customMaterials.length)} onClick={() => { void submit(); }}>{saving ? <><Loader2 className="spin" size={17} />生成中...</> : <><Printer size={17} />生成打印任务</>}</button></footer>
    </section>
  </div>;
}
