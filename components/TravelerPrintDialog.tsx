'use client';

import { Check, ChevronDown, FileImage, Files, FileText, Layers3, Loader2, Printer, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type TravelerPrintMode =
  | 'TRAVELER_ONLY'
  | 'TRAVELER_SOP_DUPLEX'
  | 'TRAVELER_SOP_SEPARATE'
  | 'DRAWING_SOP_TRAVELER_SEPARATE'
  | 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX'
  | 'CUSTOM';
type TravelerPrintMaterial = 'TRAVELER' | 'SOP' | 'DRAWING';

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
  const dialogRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

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
    }
    wasOpenRef.current = open;
  }, [open]);

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

  async function submit() {
    if (!workOrderIds.length || saving) return;
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
      if (!response.ok) throw new Error(body.error || '打印任务生成失败');
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
            return <button className={selected ? 'selected' : ''} type="button" key={option.value} onClick={() => setMode(option.value)}>
              <i><Icon size={20} /></i><span><strong>{option.title}</strong><small>{option.description}</small></span>{selected && <em><Check size={15} /></em>}
            </button>;
          })}
        </div>
        <section className={`traveler-print-advanced ${advancedOpen ? 'open' : ''}`}>
          <button type="button" className="traveler-print-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(current => !current)}>
            <span><Settings2 size={17} /><strong>更多组合与自定义补打</strong><small>原图单独打印 + 流转单/SOP 双面，或只补打指定资料</small></span><ChevronDown size={18} />
          </button>
          {advancedOpen && <div className="traveler-print-advanced-body">
            <button type="button" className={`traveler-print-hybrid ${mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX' ? 'selected' : ''}`} onClick={() => setMode('DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX')}>
              <i><Layers3 size={20} /></i><span><strong>原图单独 + 流转单/SOP 双面</strong><small>图纸保持原尺寸，现场资料合并双面，兼顾尺寸与装订。</small></span>{mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX' && <em><Check size={15} /></em>}
            </button>
            <div className={`traveler-print-custom ${mode === 'CUSTOM' ? 'selected' : ''}`}>
              <button type="button" onClick={() => setMode('CUSTOM')}><i><FileImage size={20} /></i><span><strong>自定义补打</strong><small>按资料单独选择并设置份数，不重复打印已完成资料。</small></span>{mode === 'CUSTOM' && <em><Check size={15} /></em>}</button>
              {mode === 'CUSTOM' && <div className="traveler-print-material-options">{materialOptions.map(option => {
                const checked = customMaterials.includes(option.value);
                return <div key={option.value} className={`traveler-print-material-row ${checked ? 'checked' : ''}`}>
                  <label className="traveler-print-material-choice">
                    <input type="checkbox" checked={checked} onChange={() => setCustomMaterials(current => checked ? current.filter(item => item !== option.value) : [...current, option.value])} />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
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
      <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={saving || !workOrderIds.length || (mode === 'CUSTOM' && !customMaterials.length)} onClick={() => { void submit(); }}>{saving ? <><Loader2 className="spin" size={17} />生成中...</> : <><Printer size={17} />生成打印任务</>}</button></footer>
    </section>
  </div>;
}
