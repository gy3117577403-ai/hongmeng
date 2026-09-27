'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CalendarDays, Check, CirclePause, Loader2, X } from 'lucide-react';
import { useModalLayer } from './useModalLayer';
import type { PlanningWeekPreview, WeekCommandInput } from '@/lib/planning-week-service';
import styles from './PlanningWeekDialog.module.css';

const hours = (ms: string | null) => ms === null ? '待维护' : `${Number((Number(ms) / 3600000).toFixed(3))} h`;
export default function PlanningWeekDialog({ action, batchIds, weeks, initialWeek, onClose, onSaved }: {
  action: WeekCommandInput['action']; batchIds: string[];
  weeks: { weekStartDate: string; weekEndDate: string }[]; initialWeek: string;
  onClose: () => void; onSaved: (message: string) => void;
}) {
  const title = action === 'defer' ? '暂退周计划' : action === 'join' ? '加入周计划' : '转移周计划';
  const [week, setWeek] = useState(weeks.some(w => w.weekStartDate === initialWeek) ? initialWeek : weeks[0]?.weekStartDate || '');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState(action === 'defer' ? '关键物料未齐，暂缓排产' : action === 'join' ? '重新安排生产' : '调整生产周');
  const [preview, setPreview] = useState<PlanningWeekPreview | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const request = useRef<{ key: string; body: string } | null>(null);
  const layer = useRef<HTMLElement>(null);
  useModalLayer({ open: true, layerRef: layer, onClose: () => { if (!saving) onClose(); }, interactionEnabled: !saving });
  const selected = weeks.find(w => w.weekStartDate === week);
  const completionDate = date || selected?.weekEndDate;
  const selection = batchIds.slice().sort().join(',');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPreview(null); setAcknowledged(false); request.current = null;
    fetch('/api/planning/week-membership', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, batchIds: selection.split(','), targetWeek: week, completionDate }), signal: controller.signal })
      .then(async r => { const b = await r.json(); if (!r.ok || !b.ok) throw new Error(b.error || '预览失败'); if (!controller.signal.aborted) setPreview(b.result); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [action, selection, week, completionDate, revision]);
  const missing = action !== 'defer' && preview?.rows.some(r => !r.materialReady);
  const submit = async () => {
    if (saving || !preview) return;
    setSaving(true); setError('');
    const body = JSON.stringify({ action, batchIds, targetWeek: week, completionDate, reason, fingerprint: preview.fingerprint, commit: true });
    if (!request.current || request.current.body !== body) request.current = { key: crypto.randomUUID(), body };
    try {
      const r = await fetch('/api/planning/week-membership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(body), requestKey: request.current.key }) });
      const b = await r.json();
      if (!r.ok || !b.ok) { if (r.status === 409) setPreview(null); throw new Error(b.error || '提交失败，请重试'); }
      window.dispatchEvent(new Event('material-orders-changed'));
      window.dispatchEvent(new Event('production-control-changed'));
      onSaved(action === 'defer' ? `${batchIds.length} 个订单已暂退，仍在原周及“暂退待排”中查看` : `${batchIds.length} 个订单已加入 ${week} 周，资料与配料记录已保留`);
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败，请重试'); }
    finally { setSaving(false); }
  };
  return createPortal(<div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <section className={styles.dialog} ref={layer} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header><span className={styles.icon}>{action === 'defer' ? <CirclePause /> : <CalendarDays />}</span><div><h2>{title}</h2><span>{batchIds.length} 个周订单</span></div><button disabled={saving} onClick={onClose} aria-label="关闭周计划操作"><X /></button></header>
      <div className={styles.body}>
        {action !== 'defer' && <div className={styles.fields}><label>目标周<select aria-label="目标周" disabled={saving} value={week} onChange={e => { setWeek(e.target.value); setDate(''); }}>{weeks.map((w, i) => <option key={w.weekStartDate} value={w.weekStartDate}>{i === 0 ? '本周' : i === 1 ? '下周' : i === 2 ? '下下周' : '未来周'} {w.weekStartDate} — {w.weekEndDate.slice(5)}</option>)}</select></label><label>内部完成日期<input type="date" aria-label="内部完成日期" disabled={saving} min={selected?.weekStartDate} max={selected?.weekEndDate} value={completionDate || ''} onChange={e => setDate(e.target.value)} /></label></div>}
        {loading && <p className={styles.loading} role="status"><Loader2 />正在核对剩余工作量</p>}
        {preview && <><div className={styles.rows}>{preview.rows.map(row => <article key={row.id}><div><strong>{row.specification}</strong><small>{row.customer} · 第 {row.sourceWeek} 周</small><span>{action === 'defer' ? <b className={styles.orange}>暂退待排</b> : <><ArrowRight size={14} />{row.targetWeek} 周</>}</span></div><dl><div><dt>剩余数量</dt><dd>{row.remainingQuantity} 件</dd></div><div><dt>{action === 'defer' ? '移出计划工时' : '加入计划工时'}</dt><dd>{hours(row.remainingPlanned)}</dd></div><div><dt>剩余工序工时</dt><dd>{hours(row.remainingStandard)}</dd></div></dl>{row.started && <small className={styles.notice}>已开工部分保留实际报工；未完成的日安排需重新安排。</small>}{row.independentPause && <small className={styles.notice}>另有生产暂停，本次操作保留该暂停。</small>}</article>)}</div>
          <div className={styles.preserved}><Check size={15} />图纸、工时资料、配料进展及历史报工保留</div></>}
        <label className={styles.reason}>调整原因<textarea value={reason} disabled={saving} maxLength={400} onChange={e => setReason(e.target.value)} rows={2}/></label>
        {missing && <label className={styles.warning}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={saving}/>包含未配齐订单，按计划决定安排生产</label>}
        {error && <div className={styles.error} role="alert">{error}<button type="button" disabled={saving} onClick={() => setRevision(v => v + 1)}>重新核对</button></div>}
      </div>
      <footer><button disabled={saving} onClick={onClose}>取消</button><button className={styles.primary} disabled={saving || loading || !preview || !reason.trim() || (!!missing && !acknowledged)} onClick={submit}>{saving ? '正在保存…' : `确认${title}`}</button></footer>
    </section>
  </div>, document.body);
}
