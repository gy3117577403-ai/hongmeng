'use client';

import type { ProductionWorkloadReport } from '@/lib/production-workload';
import { summarizeTimeComparison } from '@/lib/production-time-comparison';
import styles from './ProductionWorkload.module.css';

const hours = (n: number) => (n / 3600000).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
const signed = (n: number) => `${n > 0 ? '+' : ''}${hours(n)}`;
const sourceText = { batch: '批次计划', order: '订单计划', published: '产品标准补算', total: '历史总工时', missing: '计划待补' };

export function ProductionTimeComparison({ data, batchIds, compact = false, onOpen }: {
  data: ProductionWorkloadReport; batchIds?: string[]; compact?: boolean; onOpen?: () => void;
}) {
  const tasks = data.tasks.filter(t => t.kind === 'plan' && (!batchIds || batchIds.includes(t.id)));
  const rows = tasks.flatMap(t => t.timeComparison ? [t.timeComparison] : []);
  if (!data.timeComparison || rows.length !== tasks.length) return <p className={styles.warning}>工时口径明细待刷新，请稍后重试。</p>;
  const c = batchIds ? summarizeTimeComparison(rows) : data.timeComparison;
  const missingTasks = batchIds ? batchIds.filter(id => !tasks.some(t => t.id === id)).length : 0;
  const difference = missingTasks ? null : c.difference;
  const sorted = [...tasks].sort((a, b) => Math.abs((b.timeComparison!.originalPlan || 0) - b.timeComparison!.currentStandard)
    - Math.abs((a.timeComparison!.originalPlan || 0) - a.timeComparison!.currentStandard));
  return <section className={styles.comparison} aria-label="计划与执行工时对照">
    <div className={styles.comparisonValues}>
      <div><span>原始计划工时</span><strong>{hours(c.originalPlan)}<small>小时{c.missingPlanCount ? '（部分已知）' : ''}</small></strong><small>{c.count} 个正常批次 · 保留计划值</small></div>
      <div><span>当前工序标准</span><strong>{hours(c.currentStandard)}<small>小时{c.missingRouteCount ? '（部分已知）' : ''}</small></strong><small>同批次完整工序 · 未扣已报</small></div>
      {!batchIds && <div><span>本周执行基准</span><strong>{hours(c.executionBasis)}<small>小时</small></strong><small>已做跨周调整 · 含半成品续作</small></div>}
    </div>
    <div className={styles.comparisonHint}>
      <span>{difference === null ? '标准或计划未齐，暂不判断总差额' : difference === 0 ? `总额一致${c.changedCount ? `，仍有 ${c.changedCount} 批正负差额相抵` : '，逐批标准一致'}`
        : `原始计划${difference > 0 ? '高于' : '低于'}当前工序标准 ${hours(Math.abs(difference))} 小时 · ${c.changedCount} 批有差额`}</span>
      {compact && <button type="button" onClick={onOpen}>查看差额与计算明细 ›</button>}
    </div>
    {!compact && <details className={styles.comparisonDetails}>
      <summary>查看差额与计算明细</summary>
      <p>差额 = 原始计划 − 当前工序标准。两列比较同一批次、同一数量的完整工时，不含遗留及半成品续作。差额仅提示标准需核对，不自动修改计划或报工。</p>
      {missingTasks > 0 && <p role="status">当前列表有 {missingTasks} 批未进入执行汇总，不能据此认定全表工时一致。</p>}
      {(c.missingPlanCount > 0 || c.missingRouteCount > 0) && <p>计划待补 {c.missingPlanCount} 批，工序标准待补 {c.missingRouteCount} 批；未知值不按零参与差额判断。</p>}
      {c.fallbackCount > 0 && <p>{c.fallbackCount} 批未保存批次或订单计划工时，沿用计划中心规则，以当前产品标准补算；补算值不代表历史计划快照。</p>}
      {!batchIds && <div className={styles.basisFormula} aria-label="本周执行基准计算">
        <b>本周执行基准计算</b>
        <span>当前工序标准 {hours(c.currentStandard)}h</span><span>− 跨周已报扣减 {hours(c.priorDeducted)}h</span>
        <span>＋ 已调整工序本周报工 {hours(c.adjustedReported)}h</span><span>− 转仓 / 改排移出 {hours(c.movedOut)}h</span>
        <span>＋ 待补工序计划估算 {hours(c.estimate)}h</span><span>＋ 半成品续作基准 {hours(c.wipBasis)}h</span>
        <strong>＝ {hours(c.executionBasis)}h</strong>
      </div>}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>规格 / 工单</th><th>原始计划 h</th><th>当前工序 h</th><th>差额 h</th><th>本周执行基准 h</th></tr></thead>
        <tbody>{sorted.map(t => { const r = t.timeComparison!; const delta = r.originalPlan !== null && !r.missingSteps ? r.originalPlan - r.currentStandard : null;
          return <tr key={t.id}><td><strong>{t.specification}</strong><small>{t.code}</small></td>
            <td>{r.originalPlan === null ? '待补' : hours(r.originalPlan)}<small>{sourceText[r.originalSource]}</small></td>
            <td>{hours(r.currentStandard)}{r.missingSteps > 0 && <small>标准未齐</small>}</td><td>{delta === null ? '待核对' : signed(delta)}</td>
            <td>{hours(r.executionBasis)}<small>跨周扣减 {hours(r.priorDeducted)} · 调整报工 +{hours(r.adjustedReported)}</small>
              {(r.movedOut > 0 || r.estimate > 0) && <small>移出 −{hours(r.movedOut)} · 估算 +{hours(r.estimate)}</small>}</td></tr>;
        })}</tbody></table></div>
    </details>}
  </section>;
}
