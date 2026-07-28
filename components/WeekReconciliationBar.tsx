'use client';

import { AlertTriangle, CheckCircle2, ChevronDown, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProductionWeekReconciliationDTO } from '@/types';

type ReconciliationResponse = {
  ok: boolean;
  data?: ProductionWeekReconciliationDTO;
  error?: string;
};

export function WeekReconciliationBar({
  weekStartDate,
  weekEndDate,
  className = '',
}: {
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  className?: string;
}) {
  const [data, setData] = useState<ProductionWeekReconciliationDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!weekStartDate) {
      setData(null);
      setError('');
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/production/week-reconciliation?weekStart=${encodeURIComponent(weekStartDate)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as ReconciliationResponse;
        if (!response.ok || !body.data) throw new Error(body.error || '生产周协同对账失败');
        setData(body.data);
      })
      .catch(fetchError => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : '生产周协同对账失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [weekStartDate]);

  if (!weekStartDate) return null;
  if (loading && !data) {
    return <section className={`hm-week-reconciliation loading ${className}`.trim()} aria-live="polite">
      <Link2 size={15} aria-hidden="true" />
      <span>正在核对计划、生产与流程关联…</span>
    </section>;
  }
  if (error || !data) {
    return <section className={`hm-week-reconciliation unavailable ${className}`.trim()} role="status">
      <AlertTriangle size={15} aria-hidden="true" />
      <span>{error || '协同对账暂不可用'}</span>
    </section>;
  }

  return <section className={`hm-week-reconciliation ${data.aligned ? 'aligned' : 'attention'} ${className}`.trim()} aria-label="生产周协同对账">
    <div className="hm-week-reconciliation-title">
      {data.aligned ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
      <span>
        <strong>{data.aligned ? '三模块数据已对齐' : '发现跨模块关联差异'}</strong>
        <small>{data.weekStartDate.slice(5)} - {(weekEndDate || data.weekEndDate).slice(5)}</small>
      </span>
    </div>
    <dl>
      <div><dt>计划批次</dt><dd>{data.planBatchCount}</dd></div>
      <div><dt>生产工单</dt><dd>{data.productionWorkOrderCount}</dd></div>
      <div><dt>流程实例</dt><dd>{data.workflowInstanceCount}</dd></div>
    </dl>
    {data.aligned
      ? <span className="hm-week-reconciliation-status">批次、主工单和流程一一对应</span>
      : <details>
          <summary>{data.differenceCount} 项差异 <ChevronDown size={13} aria-hidden="true" /></summary>
          <div className="hm-week-reconciliation-detail">
            {data.issues.map(item => <article key={item.code}>
              <header><strong>{item.label}</strong><b>{item.count}</b></header>
              <ul>{item.items.map(row => <li key={`${item.code}-${row.id}`}><span>{row.code}</span><small>{row.detail}</small></li>)}</ul>
              {item.count > item.items.length && <p>另有 {item.count - item.items.length} 项未展开</p>}
            </article>)}
          </div>
        </details>}
  </section>;
}
