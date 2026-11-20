'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { formatProductionQuantity } from '@/lib/production-quantity';
import type { ProductionForceCloseMode, ProductionForceClosePreview } from '@/lib/production-force-close';
import './production-force-close.css';

type Props = {
  workOrderId: string;
  unit: string;
  close: () => void;
  onClosed: (closure: NonNullable<ProductionForceClosePreview['closure']>) => void;
};

export function ProductionForceCloseDialog({ workOrderId, unit, close, onClosed }: Props) {
  const [preview, setPreview] = useState<ProductionForceClosePreview | null>(null);
  const [mode, setMode] = useState<ProductionForceCloseMode>('verified_output');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [stale, setStale] = useState(false);
  const requestId = useRef('');
  const inFlight = useRef(false);
  const endpoint = `/api/work-orders/${encodeURIComponent(workOrderId)}/force-close`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setStale(false);
    requestId.current = '';
    fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.data) throw new Error(body.error || '结单预览加载失败');
        setPreview(body.data);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '结单预览加载失败');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, reload]);

  function changeInput(update: () => void) {
    requestId.current = '';
    update();
  }

  const actualQty = actual.trim() === '' ? null : Number(actual);
  const quantityValid = actualQty === null
    ? mode === 'stop_execution'
    : /^\d+$/.test(actual) && Number.isInteger(actualQty) && actualQty <= 2147483647;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !preview?.canClose || !quantityValid || !reason.trim() || stale) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      requestId.current ||= window.crypto?.randomUUID?.() || `force-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, actualQty, reason, version: preview.version, requestId: requestId.current }),
      });
      const body = await response.json();
      if (!response.ok || !body.data?.closure) {
        if (response.status === 409) setStale(true);
        throw new Error(body.error || '结单未确认，请核对当前状态');
      }
      const result: ProductionForceClosePreview = body.data;
      setPreview(result);
      if (result.closure) onClosed(result.closure);
    } catch (error) {
      setError(error instanceof Error ? error.message : '结单结果待确认，请重试');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function quantity(value: number | null) {
    return value === null ? '待核定' : `${formatProductionQuantity(value)} ${unit}`;
  }

  const closure = preview?.closure;
  const outstanding = preview?.steps.filter(step => (
    (step.status !== 'completed' && step.status !== 'skipped') || step.pendingCoverage > 0 || step.supplementalRemaining > 0
  )) || [];

  return (
    <div className="modal-backdrop production-risk-confirm-backdrop">
      <form className="production-dialog production-force-close" role="dialog" aria-modal="true" aria-label={closure ? '强制结单记录' : '强制结单'} onSubmit={submit}>
        <header className="dialog-title">
          <div>
            <strong>{closure ? '已结单（强制）' : '强制结单'}</strong>
            {preview && <small>{[preview.specification, preview.code].filter(Boolean).join(' · ')}</small>}
          </div>
          <button type="button" aria-label="关闭结单窗口" onClick={close} disabled={saving}><X size={18} /></button>
        </header>
        <div className="production-force-close-body">
          {loading && <p role="status">正在读取工单进度…</p>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {!loading && preview && <>
            <div className="production-confirm-quantity">
              <span>目标数量 <b>{quantity(preview.targetQty)}</b></span>
              <span>末道已报 <b>{quantity(preview.lastReportedQty)}</b></span>
              <span>已核销成品 <b>{quantity(preview.verifiedQty)}</b></span>
            </div>
            {closure && <section className="production-force-close-result">
              <strong>{closure.mode === 'verified_output' ? '现场已完工' : '停止执行'} · 现场核定 {quantity(closure.actualQty)}</strong>
              <p>{closure.reason}</p>
              <small>{closure.actor} · {new Date(closure.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</small>
            </section>}
            <details className="production-force-close-outstanding" open>
              <summary>结单时未闭环工序（{outstanding.length} 道）</summary>
              {outstanding.length ? <ul>{outstanding.map(step => (
                <li key={step.id}>
                  <strong>{step.position}. {step.name}</strong>
                  <span>已报 {quantity(step.reported)} · 已核销 {quantity(step.covered)}
                    {step.pendingCoverage > 0 && ` · 待核销 ${quantity(step.pendingCoverage)}`}
                    {step.supplementalRemaining > 0 && ` · 补充工序剩余 ${quantity(step.supplementalRemaining)}`}
                  </span>
                </li>
              ))}</ul> : <p>当前工序已闭环。</p>}
              {preview.pendingSubmissionCount > 0 && <p>有 {preview.pendingSubmissionCount} 笔待处理申报随结单保留。</p>}
              {preview.relatedOpenOrders.length > 0 && <p>关联未结分支保留原记录，生产执行随主单停止：{preview.relatedOpenOrders.join('、')}。</p>}
            </details>
            {preview.canClose && <fieldset disabled={saving}>
              <legend>处理方式</legend>
              <div className="production-force-close-modes">
                <label><input type="radio" name="close-mode" checked={mode === 'verified_output'} onChange={() => changeInput(() => setMode('verified_output'))} />现场已完工</label>
                <label><input type="radio" name="close-mode" checked={mode === 'stop_execution'} onChange={() => changeInput(() => setMode('stop_execution'))} />停止执行</label>
              </div>
              <label className="production-force-close-field">
                <span>实际完成数量{mode === 'stop_execution' ? '（留空为待核定）' : ''}</span>
                <input aria-label="实际完成数量" inputMode="numeric" pattern="[0-9]*" value={actual} onChange={event => changeInput(() => setActual(event.target.value))} />
                {actualQty !== null && quantityValid && preview.targetQty !== null && (
                  <small>目标余量 {quantity(Math.max(0, preview.targetQty - actualQty))}</small>
                )}
              </label>
              <label className="production-force-close-field">
                <span>结单原因</span>
                <textarea rows={3} maxLength={500} value={reason} onChange={event => changeInput(() => setReason(event.target.value))} />
              </label>
              <p>提交后停止生产报工，留存工序现状。现场核定数量单独记录，本次新增工时为 0。</p>
            </fieldset>}
            {!preview.canClose && !closure && <p>当前工单仅供查看。</p>}
          </>}
        </div>
        <footer className="dialog-actions">
          <button type="button" onClick={close} disabled={saving}>{closure ? '关闭' : '取消'}</button>
          {!loading && (stale || !preview) && <button type="button" onClick={() => setReload(value => value + 1)}>刷新预览</button>}
          {preview?.canClose && <button type="submit" className="danger-button" disabled={saving || loading || stale || !quantityValid || !reason.trim()}>
            {saving ? '结单中…' : '确认强制结单'}
          </button>}
        </footer>
      </form>
    </div>
  );
}
