'use client';
import { useState } from 'react';
import { CheckCircle2, Search, AlertCircle } from 'lucide-react';
import type { ProductionPlanImportRow } from '@/lib/production-plan-import';
import type { ImportDrawingArchive } from '@/lib/import-drawing-association';
import { productionPlanImportNeedsProductDecision, resolvePlanningImportTime, planningImportTimeSourceText } from '@/lib/planning-import-time';
import { DrawingAssociationCell } from './ImportDrawingAssociation';
import styles from './ImportReview.module.css';

export function importRowPending(row: ProductionPlanImportRow, decisions: Record<string, string>, orders: Record<string, string>) {
  if (orders[row.rowNo] === 'skip' || ['duplicate', 'skipped'].includes(row.status)) return false;
  return row.status === 'invalid' || (productionPlanImportNeedsProductDecision(row, orders[row.rowNo]) && !decisions[row.rowNo]) || (!!row.requiresOrderDecision && !orders[row.rowNo]);
}

export default function PlanningImportReview({ rows, decisions, orders, busy, onProduct, onOrder, onOverlayChange }: {
  rows: ProductionPlanImportRow[]; decisions: Record<string, string>; orders: Record<string, string>; busy: boolean;
  onProduct: (row: number, item: ImportDrawingArchive) => void; onOrder: (row: number, value: string) => void; onOverlayChange: (open: boolean) => void;
}) {
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const attention = (row: ProductionPlanImportRow) => importRowPending(row, decisions, orders);
  const chosen = (row: ProductionPlanImportRow) => !['skipped', 'duplicate', 'invalid'].includes(row.status) && orders[row.rowNo] !== 'skip';
  const visible = rows.filter(row => (filter !== 'pending' || attention(row)) && (filter !== 'create' || row.productAction === 'create') && (filter !== 'linked' || row.productAction === 'reuse' || !!decisions[row.rowNo]) && (!search || [row.input?.customerName, row.input?.specification, row.input?.sourceOrderNo].some(value => value?.toLowerCase().includes(search.toLowerCase()))));
  return <section className={styles.review} aria-label="量产导入核对"><div className={styles.toolbar}>
    {([['all', '全部', rows.length], ['linked', '已匹配资料', rows.filter(row => row.productAction === 'reuse' || decisions[row.rowNo]).length], ['create', '待建档', rows.filter(row => row.productAction === 'create').length], ['pending', '待确认', rows.filter(attention).length]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} {count}</button>)}
    <label><Search size={17}/><input aria-label="搜索导入产品" placeholder="搜索客户 / 产品规格" value={search} onChange={event => setSearch(event.target.value)}/></label>
  </div><div className={styles.tableScroll}><table className={styles.table}><colgroup><col style={{width:'4%'}}/><col style={{width:'18%'}}/><col style={{width:'6%'}}/><col style={{width:'13%'}}/><col style={{width:'8%'}}/><col style={{width:'22%'}}/><col style={{width:'16%'}}/><col style={{width:'13%'}}/></colgroup><thead><tr><th>行</th><th>客户 / 产品规格</th><th>数量</th><th>单件 / 总工时</th><th>客户交期</th><th>关联图纸资料库</th><th>订单处理</th><th>校验</th></tr></thead><tbody>{visible.map(row => {
    const choice = orders[row.rowNo], selectedOrder = row.orderCandidates?.find(order => order.id === choice);
    const productId = selectedOrder?.drawingLibraryItemId || decisions[row.rowNo] || row.matchedDrawingLibraryItemId;
    const archive = row.candidates.find(item => item.id === productId);
    const time = row.input ? resolvePlanningImportTime({ imported: row.input.planningUnitMilliseconds, published: selectedOrder ? selectedOrder.productUnitMilliseconds : archive?.productUnitMilliseconds, order: selectedOrder?.planningUnitMilliseconds || (row.timePreview?.source === 'order' ? row.timePreview.unitMilliseconds : null), quantity: row.input.plannedQuantity }) : null;
    const ignored = !chosen(row), pending = attention(row), missing = !archive?.drawingFileCount;
    return <tr key={row.rowNo} data-import-needs-attention={pending || undefined} className={row.status === 'invalid' ? styles.errorRow : ignored ? styles.skipped : ''}>
      <td>{!['skipped','duplicate','invalid'].includes(row.status) && <input type="checkbox" aria-label={`导入第 ${row.rowNo} 行`} disabled={busy} checked={chosen(row)} onChange={event => onOrder(row.rowNo, event.target.checked ? (row.requiresOrderDecision ? '' : 'new') : 'skip')}/>}<small>{row.rowNo}</small></td>
      <td><strong>{row.input?.specification || '无效数据行'}</strong><small>{row.input?.customerName}</small>{row.input?.sourceIdentity === 'provided' && <small>订单 {row.input.sourceOrderNo} / {row.input.sourceLineNo}</small>}</td>
      <td><strong>{row.input?.plannedQuantity.toLocaleString() || '—'}</strong><small>件</small></td>
      <td>{time?.unitMilliseconds ? <><strong>{Number((time.unitMilliseconds/60000).toFixed(3))} 分/件</strong><small>{Number((Number(time.totalMilliseconds)/3600000).toFixed(3)).toLocaleString()} h</small><small>{planningImportTimeSourceText[time.source]}</small></> : <span className={styles.warn}>工时待补</span>}</td>
      <td>{row.input?.customerDueDate.slice(5) || '—'}</td>
      <td>{row.input && !['skipped','duplicate','invalid'].includes(row.status) ? <DrawingAssociationCell disabled={busy} customerName={row.input.customerName} specification={row.input.specification} archive={archive || (productId ? { id: productId, libraryKey: '', customerName: row.input.customerName, specification: row.input.specification, productName: row.input.productName } : null)} locked={!!row.existingPlanOrderId || !!selectedOrder?.drawingLibraryItemId} pending={row.status === 'conflict' && !productId} onOpenChange={onOverlayChange} onPick={item => onProduct(row.rowNo, item)}/> : <small>{row.status === 'duplicate' ? '沿用原关联' : '—'}</small>}</td>
      <td>{row.input && !['skipped','duplicate','invalid'].includes(row.status) ? row.existingPlanOrderId ? <span>继续排原订单</span> : <><select aria-label={`第 ${row.rowNo} 行订单处理`} disabled={busy} value={choice ?? (row.requiresOrderDecision ? '' : 'new')} onChange={event => onOrder(row.rowNo,event.target.value)}>{row.requiresOrderDecision && <option value="">确认是否重复</option>}<option value="new">新建独立订单</option><option value="skip">跳过本行</option>{!!row.orderCandidates?.length && <optgroup label="继续排已有订单">{row.orderCandidates.map(order => <option key={order.id} value={order.id}>{order.orderDate} · 剩余 {order.remainingQuantity} 件 · {order.sourceOrderNo.startsWith('PLAN-') ? `交期 ${order.customerDueDate.slice(5)}` : order.sourceOrderNo}</option>)}</optgroup>}</select>{row.possibleDuplicate && <small className={styles.warn}>有相同业务记录，需核对</small>}{selectedOrder && <small>余量 {selectedOrder.remainingQuantity} 件 · 原订单资料</small>}</> : <small>{row.status === 'duplicate' ? '重复跳过' : '不导入'}</small>}</td>
      <td>{ignored ? <small>{choice === 'skip' ? '已跳过' : row.reason}</small> : pending ? <span className={styles.pending}><AlertCircle size={14}/> 待确认</span> : <span className={missing ? styles.warn : styles.status}><CheckCircle2 size={14}/> 可导入</span>}{chosen(row) && !pending && missing && <small className={styles.warn}>图纸待上传</small>}{pending && <small>{!choice && row.requiresOrderDecision ? '核对订单处理' : '选择资料档案'}</small>}</td>
    </tr>;
  })}</tbody></table>{!visible.length && <div className={styles.empty}>没有符合筛选条件的行<button type="button" className={styles.link} onClick={() => { setFilter('all'); setSearch(''); }}>显示全部</button></div>}</div></section>;
}
