'use client';

import { Check, FileText, Layers3, Loader2, Printer, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type TravelerPrintMode = 'TRAVELER_ONLY' | 'TRAVELER_SOP_DUPLEX' | 'TRAVELER_SOP_SEPARATE';

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
  const [reprintReason, setReprintReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);

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

  async function submit() {
    if (!workOrderIds.length || saving) return;
    const printWindow = window.open('about:blank', '_blank');
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/work-order-qr/prints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderIds, mode, copies, reprintReason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '打印任务生成失败');
      const url = String(body.data?.url || '');
      if (!url.startsWith('/production/qr-print?')) throw new Error('打印地址生成失败');
      if (printWindow) printWindow.location.href = url;
      else window.location.href = url;
      onSuccess?.(`已生成 ${body.data?.count || workOrderIds.length} 张流转单，请打印后确认`);
      onClose();
    } catch (reason) {
      printWindow?.close();
      setError(reason instanceof Error ? reason.message : '打印任务生成失败');
    } finally {
      setSaving(false);
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
        {mode !== 'TRAVELER_ONLY' && <div className="traveler-print-hint"><FileText size={18} /><span><strong>将使用当前已发布 SOP 的 PDF 快照</strong><small>如果 SOP 尚未上传、不是 PDF 或已删除，系统会阻止生成，避免错印旧版资料。</small></span></div>}
        <div className="traveler-print-form-row">
          <label><span>打印份数</span><input type="number" min={1} max={10} value={copies} onChange={event => setCopies(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
          <label className="reason"><span>重打原因（选填）</span><input maxLength={500} value={reprintReason} onChange={event => setReprintReason(event.target.value)} placeholder="例如：SOP 更新、纸张污损、数量调整" /></label>
        </div>
        <div className="traveler-print-confirm-note"><Printer size={18} /><span>打开预览不等于已打印。完成实体打印后，请在预览页点击“确认已打印”，系统才会标记为已打印。</span></div>
        {error && <div className="traveler-print-dialog-error">{error}</div>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={saving || !workOrderIds.length} onClick={() => { void submit(); }}>{saving ? <><Loader2 className="spin" size={17} />生成中...</> : <><Printer size={17} />生成打印任务</>}</button></footer>
    </section>
  </div>;
}
