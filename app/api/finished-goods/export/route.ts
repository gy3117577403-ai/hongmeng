import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { FinishedGoodsError, type FgRow } from '@/lib/finished-goods-domain';
import { fgErrorResponse } from '@/lib/finished-goods-http';
import { loadFinishedGoods } from '@/lib/finished-goods-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    await requireUser(); const p = request.nextUrl.searchParams;
    const query = { date: p.get('date') || undefined, dateTo: p.get('dateTo') || undefined, dateBasis: p.get('dateBasis') || undefined, sort: p.get('sort') || undefined, scope: p.get('scope') || undefined, view: p.get('view') || 'history', filter: p.get('filter') || undefined, q: p.get('q') || undefined, batchId: p.get('batchId') || undefined, pageSize: 100 };
    const initial = await loadFinishedGoods({ ...query, page: 1 });
    if (initial.total > 20000) throw new FinishedGoodsError('导出记录超过 20000 条，请缩小筛选范围');
    const rows: FgRow[] = [...initial.rows];
    for (let page = 2; page <= Math.ceil(initial.total / 100); page++) rows.push(...(await loadFinishedGoods({ ...query, page })).rows);
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('成品仓');
    const headers = ['状态','工单号','客户','产品','规格','单位','待入库','在库数量','已出数量','累计入库','可用','占用','留库','隔离','本次出库','已退回','出库记录号','日出货批次','实际出库时间','出货方式','外部单号','备注','库位','留库原因','留库到期','入库时间','历史结清时间','历史结清数量','本次入库','现场完成日期','完成登记时间','转入待入库时间'];
    sheet.addRow(headers); sheet.columns = headers.map((_, i) => ({ width: [3,4,17,20,23].includes(i) ? 30 : 18 }));
    const states: Record<string,string> = { ready: '待发货', pending: '待接收', opening: '期初待核对', shipped: '已发出', held: '留库', reserved: '已占用', blocked: '隔离', restricted: '生产受限', legacy: '历史默认已出', received: '已入库' };
    const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '';
    for (const r of rows) sheet.addRow([states[r.status] || r.status,r.workOrderCode,r.customerName || '公共备货',r.productName,r.specification,r.unit,r.pending,r.onHand,r.legacyClosedAt ? null : r.shippedQuantity,r.legacyClosedAt ? null : r.receivedQuantity,r.available,r.reserved,r.held,r.blocked,r.status === 'shipped' ? r.quantity : 0,r.returned,r.shipmentNumber || '',r.batchNumber,time(r.status==='shipped' ? r.shippedAt : r.lastShippedAt),({COURIER:'快递 / 物流',PICKUP:'自提',DELIVERY:'送货'} as Record<string,string>)[r.method] || r.method,r.externalReference,r.shipmentNote || r.note,r.location,r.holdReason,r.holdDueDate,time(r.status==='received' ? r.receivedAt : r.lastReceivedAt),time(r.legacyClosedAt),r.legacyQuantity,r.status === 'received' ? r.quantity : 0,r.productionWorkDate || '',time(r.productionCompletedAt || null),time(r.transferredAt || null)]);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF36B12' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = { from: 'A1', to: { row: 1, column: headers.length } };
    const body = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(body), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`仓库收发记录-${initial.date}.xlsx`)}`, 'Cache-Control': 'no-store' } });
  } catch (error) { return fgErrorResponse(error); }
}
