import ExcelJS from 'exceljs';
import { PC_FUND_STATES, PC_SETTLEMENTS, PC_STATES, PurchasingError } from './purchasing-domain';
import type { PcExportFund } from './purchasing-queries';

const adjustments: Record<string, string> = { NONE: '无', PARTIAL: '部分请款', DISCOUNT: '优惠冲减', FREIGHT: '运费', ROUNDING: '舍入调整' };
const date = (v: Date) => v.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
type Snapshot = Record<string, unknown>;
const number = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const text = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;

export function buildPurchasingFundWorkbook(funds: PcExportFund[], creator: string) {
  const book = new ExcelJS.Workbook();
  book.creator = creator;
  const summary = book.addWorksheet('付款汇总');
  const details = book.addWorksheet('采购明细');
  summary.columns = ['资金单号','收款人','结算方式','申请人','申请金额','有效请款金额','已付金额','剩余待付','资金状态','申请日期','期望付款日期','明细项数','差额类型','差额 / 处理说明'].map(header => ({ header, key: header, width: header === '差额 / 处理说明' ? 40 : 22 }));
  details.columns = ['资金单号','采购明细号','收款人','供应商','物品名称','规格型号','采购数量','单位','单价（元）','单价来源','商品金额','登记运费','登记优惠','采购原总额','本单申请分摊','本单有效请款金额','本单已付','本单剩余待付','资金状态','采购当前状态','明细依据'].map(header => ({ header, key: header, width: ['物品名称','规格型号','单价来源','明细依据'].includes(header) ? 30 : 22 }));
  for (const f of funds) {
    const snapshots = Array.isArray(f.snapshot) ? f.snapshot.filter(v => v && typeof v === 'object') as Snapshot[] : [];
    const byLine = new Map(snapshots.map(s => [s.lineId, s]));
    let requested = 0, effective = 0, paid = 0;
    for (const al of f.allocations) {
      const p = al.line, snap = byLine.get(p.id) || {};
      const frozen = snap.snapshotVersion === 2;
      const quantity = frozen ? number(snap.quantity, p.quantity) : p.quantity;
      const actualCents = frozen ? number(snap.actualCents, p.actualCents) : p.actualCents;
      const price = frozen ? text(snap.unitPrice) : p.unitPrice?.toString() || '';
      const allocation = number(snap.allocationCents, al.amountCents);
      const activeAmount = al.active ? al.amountCents : 0;
      requested += allocation; effective += activeAmount; paid += al.paidCents;
      details.addRow([
        f.number, text(snap.number, p.number), f.payee, text(snap.supplier, p.supplier?.name || ''), text(snap.name, p.name),
        frozen ? text(snap.spec) : p.spec, quantity, frozen ? text(snap.unit) : p.unit,
        price ? Number(price) : quantity > 0 ? actualCents / 100 / quantity : null,
        price ? '登记成交单价' : '总额折算（可能含运费或优惠）',
        (frozen ? snap.goodsCents : p.goodsCents) == null ? null : number(frozen ? snap.goodsCents : p.goodsCents, 0) / 100,
        price ? number(frozen ? snap.freightCents : p.freightCents, 0) / 100 : null,
        price ? number(frozen ? snap.discountCents : p.discountCents, 0) / 100 : null,
        actualCents / 100, allocation / 100, activeAmount / 100, al.paidCents / 100, Math.max(0, activeAmount - al.paidCents) / 100,
        PC_FUND_STATES[f.status] || f.status, p.completedAt ? '已完成' : PC_STATES[p.status] || p.status,
        frozen ? (quantity !== p.quantity || text(snap.unit) !== p.unit ? '资金申请时快照；当前采购计量已更正，请核对更正记录' : '资金申请时快照') : '历史关联记录（原单未存完整快照）',
      ]);
    }
    const expected = ['RETURNED', 'WITHDRAWN'].includes(f.status) ? 0 : f.amountCents;
    if (effective !== expected || paid !== f.paidCents) throw new PurchasingError(`${f.number} 的资金分摊与汇总不一致，请核对后导出`);
    summary.addRow([f.number, f.payee, PC_SETTLEMENTS[f.settlement] || f.settlement, f.actorName, requested / 100, effective / 100,
      paid / 100, Math.max(0, effective - paid) / 100, PC_FUND_STATES[f.status] || f.status,
      date(f.createdAt), f.dueDate || "未约定", f.allocations.length, adjustments[f.adjustment] || f.adjustment, f.reason]);
  }
  for (const sheet of [summary, details]) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE77332' } };
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: sheet === details ? 2 : 1 }];
    sheet.autoFilter = { from: 'A1', to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    sheet.eachRow((row, index) => { if (index > 1) row.alignment = { vertical: 'middle', wrapText: true }; });
    for (const column of sheet === summary ? [5,6,7,8] : [11,12,13,14,15,16,17,18]) sheet.getColumn(column).numFmt = '#,##0.00';
  }
  details.getColumn(9).numFmt = '0.00####';
  details.getCell('N1').note = '采购原总额属于原采购明细；同一明细分次请款时会重复出现，请按采购明细号去重。付款统计请使用本单有效请款金额、本单已付和本单剩余待付。';
  details.getCell('I1').note = '登记成交单价保留最多六位小数；没有登记单价时，以原采购总额除以原数量折算，单价来源列会明确标注。';
  summary.getCell('F1').note = '关闭资金单保留已付金额，撤回或退回资金单不再占用待付款金额。原申请金额单独保留，便于追溯。';
  return book;
}
