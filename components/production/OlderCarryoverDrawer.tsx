'use client';

import { AlertTriangle, CalendarClock, Check, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type OlderCarryoverItem = {
  batchId: string;
  workOrderId: string;
  code: string;
  businessCode?: string | null;
  customerName?: string | null;
  productName: string;
  specification?: string | null;
  quantity: number;
  originalWeekStartDate: string;
  originalWeekEndDate: string;
  plannedCompletionDate: string;
  weeksOld: number;
};

type OlderCarryoverPayload = {
  total: number;
  targetWeekStartDate: string;
  previousWeekStartDate: string;
  items: OlderCarryoverItem[];
};

export function OlderCarryoverDrawer({
  open,
  targetWeekStart,
  onClose,
  onIncluded,
}: {
  open: boolean;
  targetWeekStart: string;
  onClose: () => void;
  onIncluded: (count: number) => void;
}) {
  const [data, setData] = useState<OlderCarryoverPayload | null>(null);
  const [keyword, setKeyword] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !targetWeekStart) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ targetWeekStart, limit: '500' });
    if (keyword) params.set('keyword', keyword);
    void fetch(`/api/production/carryovers?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '更早遗留加载失败');
        setData(payload.data);
        setSelected(current => current.filter(id => payload.data.items.some((item: OlderCarryoverItem) => item.batchId === id)));
      })
      .catch(fetchError => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setError(fetchError instanceof Error ? fetchError.message : '更早遗留加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [keyword, open, targetWeekStart]);

  const allSelected = Boolean(data?.items.length) && data!.items.every(item => selected.includes(item.batchId));
  const selectedItems = useMemo(() => data?.items.filter(item => selected.includes(item.batchId)) || [], [data, selected]);

  function toggle(batchId: string) {
    setSelected(current => current.includes(batchId) ? current.filter(id => id !== batchId) : [...current, batchId]);
  }

  async function includeSelected() {
    if (!selected.length || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/production/carryovers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWeekStart, batchIds: selected, reason }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '加入本周失败');
      onIncluded(payload.data.includedCount);
      setSelected([]);
      setReason('');
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '加入本周失败');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return <div className="production-carryover-drawer-layer">
    <button className="production-carryover-drawer-scrim" type="button" aria-label="关闭更早遗留" onClick={() => !saving && onClose()} />
    <aside className="production-carryover-drawer" role="dialog" aria-modal="true" aria-labelledby="older-carryover-title">
      <header>
        <div><span><CalendarClock size={16} />跨周承接</span><strong id="older-carryover-title">选择更早遗留</strong><small>默认本周已自动带入上周实际处理但未完成的订单；这里只处理两周前及更早的订单。</small></div>
        <button type="button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={20} /></button>
      </header>
      <section className="production-carryover-rule"><AlertTriangle size={18} /><p><strong>不会复制或改动原订单</strong><span>加入后仍使用原工单、图纸、SOP、流程与仓库记录；原生产周继续保留。</span></p></section>
      <div className="production-carryover-search">
        <label><Search size={17} /><input value={searchValue} onChange={event => setSearchValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') setKeyword(searchValue.trim()); }} placeholder="搜索客户、规格、工单或品名" /></label>
        <button type="button" onClick={() => setKeyword(searchValue.trim())}>查询</button>
      </div>
      <div className="production-carryover-selectbar">
        <label><input type="checkbox" checked={allSelected} disabled={!data?.items.length} onChange={() => setSelected(allSelected ? [] : (data?.items || []).map(item => item.batchId))} /><span>全选当前结果</span></label>
        <span>可选 {data?.total || 0} 单 · 已选 {selected.length} 单</span>
      </div>
      <div className="production-carryover-list hm-scroll-region" aria-busy={loading}>
        {loading && <div className="production-carryover-empty"><Loader2 className="spin" /><strong>正在核对更早遗留</strong></div>}
        {!loading && !data?.items.length && <div className="production-carryover-empty"><Check /><strong>没有需要人工加入的更早遗留</strong><span>上周未完成订单会由系统自动承接，无需在这里重复选择。</span></div>}
        {!loading && data?.items.map(item => <label className={selected.includes(item.batchId) ? 'selected' : ''} key={item.batchId}>
          <input type="checkbox" checked={selected.includes(item.batchId)} onChange={() => toggle(item.batchId)} />
          <span><strong>{item.specification || item.businessCode || item.code}</strong><small>{item.customerName || '客户待补充'} · {item.productName || '品名待补充'}</small><em>原周 {item.originalWeekStartDate} - {item.originalWeekEndDate} · {item.quantity} 套</em></span>
          <b>{item.weeksOld} 周前</b>
        </label>)}
      </div>
      <footer>
        <label><span>承接说明（可选）</span><input value={reason} maxLength={300} onChange={event => setReason(event.target.value)} placeholder="例如：客户仍需交付，本周继续推进" /></label>
        {error && <p role="alert">{error}</p>}
        <div><span>{selectedItems.length ? `将承接 ${selectedItems.length} 单到本周` : '请选择要加入本周的订单'}</span><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary" type="button" disabled={!selected.length || saving} onClick={() => void includeSelected()}>{saving ? '正在加入...' : `加入本周（${selected.length}）`}</button></div>
      </footer>
    </aside>
  </div>;
}
