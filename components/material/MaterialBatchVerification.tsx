'use client';
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import type { MaterialOrderDTO } from '@/lib/material-order-service';

export function MaterialBatchVerification({ order, saving, error, onClose, onSubmit }: {
  order: MaterialOrderDTO; saving: boolean; error: string; onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const rows = order.events.filter(e => e.status === 'OPEN').flatMap(item => item.arrivals.filter(b => b.status === 'ARRIVED').map(batch => ({ item, batch })));
  const [selected, setSelected] = useState(() => new Set(rows.map(r => r.batch.id)));
  const [amounts, setAmounts] = useState(() => Object.fromEntries(rows.map(r => [r.batch.id, String(r.batch.quantity)])));
  const [completeItems, setCompleteItems] = useState<Set<string>>(new Set());
  const [finish, setFinish] = useState(false), [prepared, setPrepared] = useState(''), [physical, setPhysical] = useState(false), [note, setNote] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const version = useRef(order.version);
  const layer = useRef<HTMLElement>(null);
  useModalLayer({ open: true, layerRef: layer, onClose: () => { if (!saving) onClose(); } });
  const abnormal = rows.some(r => selected.has(r.batch.id) && Number(amounts[r.batch.id]) < r.batch.quantity);
  const unknownItems = order.events.filter(item => item.required === null && rows.some(r => r.item.id === item.id && selected.has(r.batch.id)));
  return <div className="mo-overlay"><section ref={layer} className="mo-dialog" role="dialog" aria-modal="true" aria-label="批量核验到料"><header><div><h2>批量核验到料</h2><small>{order.specification} · 已选 {selected.size} 批</small></div><button className="mo-icon" aria-label="关闭" disabled={saving} onClick={onClose}><X size={20}/></button></header>
    <form onSubmit={e => { e.preventDefault(); onSubmit({ action: 'verify_arrivals', version: version.current, requestKey: requestKey.current,
      entries: rows.filter(r => selected.has(r.batch.id)).map(r => ({ arrivalId: r.batch.id, acceptedQuantity: amounts[r.batch.id], itemComplete: completeItems.has(r.item.id) })),
      note, confirmComplete: finish, preparedQuantity: prepared === '' ? undefined : Number(prepared), physicalConfirmed: physical }); }}>
      <div className="mo-dialog-body">{error && <p role="alert" className="mo-wide mo-error">{error}</p>}
        <p className="mo-wide mo-pool-hint">请逐批核对可用数量；少到、错料或不合格数量继续跟进补货。</p>
        <div className="mo-wide mo-verify-list">{rows.map(({ item, batch }) => <div className="mo-verify-row" key={batch.id}>
          <label className="mo-check"><input aria-label={`选择核验 ${item.model} ${batch.id}`} type="checkbox" checked={selected.has(batch.id)} disabled={saving} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(batch.id); else next.delete(batch.id); return next; })}/><span>{item.model}<small>报到 {batch.quantity} {item.unit} · {batch.trackingNumber || '无物流单号'}</small></span></label>
          <label>可用数量<input aria-label={`可用数量 ${item.model} ${batch.id}`} type="number" min="0" step="0.001" max={batch.quantity} required={selected.has(batch.id)} disabled={saving || !selected.has(batch.id)} value={amounts[batch.id] ?? ''} onChange={e => setAmounts(old => ({ ...old, [batch.id]: e.target.value }))}/></label>
        </div>)}</div>
        {unknownItems.map(item => <label key={item.id} className="mo-wide mo-check"><input type="checkbox" checked={completeItems.has(item.id)} onChange={e => setCompleteItems(old => { const next = new Set(old); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next; })}/>实物核对：{item.model} 本项全部补齐</label>)}
        <label className="mo-wide mo-check"><input type="checkbox" checked={finish} onChange={e => { setFinish(e.target.checked); setPhysical(false); }}/>{order.planOrderId ? '同时确认产品可配套数量' : '同时确认整单物料齐全'}</label>
        {finish && <>{order.planOrderId && <label className="mo-wide">累计可配套产品数量（套）<input aria-label="累计可配套数量" required type="number" step="1" min={order.poolQuantities?.consumed || 0} max={order.poolQuantities?.targetTotal} value={prepared} onChange={e => setPrepared(e.target.value)}/></label>}<label className="mo-wide mo-check"><input type="checkbox" required checked={physical} onChange={e => setPhysical(e.target.checked)}/>已按实物核对；物料个数不直接换算为产品套数</label></>}
        <label className="mo-wide">{abnormal ? '异常说明（必填）' : '核验备注'}<textarea maxLength={600} required={abnormal} value={note} onChange={e => setNote(e.target.value)}/></label>
      </div><footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="mo-primary" disabled={saving || !selected.size} type="submit">{saving ? '保存中…' : finish ? '核验并确认配套' : '确认所选批次'}</button></footer>
    </form></section></div>;
}
