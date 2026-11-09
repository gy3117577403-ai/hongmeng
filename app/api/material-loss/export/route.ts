import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { listMaterialLoss } from '@/lib/material-loss-service';
import { lossCsvCell, lossStatuses, replenishmentStatuses } from '@/lib/material-loss-domain';
import { materialLossFailure } from '@/lib/material-loss-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(), { records } = await listMaterialLoss(req.nextUrl.searchParams, user.id, true);
    const rows: unknown[][] = [['损耗单号', '审批状态', '统计有效', '关联订单', '物料名称', '规格型号', '来源', '损耗数量', '单位', '损耗日期', '原因分类', '具体原因', '申报人', '审批人', '审批意见', '需要补料', '补料数量', '累计可用到料', '补料状态', '更正原单ID', '更正原因']];
    for (const r of records) rows.push([r.number, lossStatuses[r.status as keyof typeof lossStatuses], r.status === 'APPROVED' && !r.supersededAt ? '是' : '否', r.targetLabel, r.materialName, r.materialModel, r.supplySource === 'CUSTOMER' ? '客供' : '采购', r.quantity, r.unit, r.occurredOn, r.category, r.reason, r.applicantName, r.reviewerName, r.reviewNote, r.needReplenishment ? '是' : '否', r.replenishmentQuantity, r.replenishment?.receivedQuantity, r.replenishment ? replenishmentStatuses[r.replenishment.status] : '不需要', r.correctsId, r.correctionReason]);
    return new NextResponse('\uFEFF' + rows.map(row => row.map(lossCsvCell).join(',')).join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': "attachment; filename=material-loss.csv; filename*=UTF-8''%E7%89%A9%E6%96%99%E6%8D%9F%E8%80%97.csv", 'Cache-Control': 'private, no-store' } });
  } catch (e) { return materialLossFailure(e); }
}
