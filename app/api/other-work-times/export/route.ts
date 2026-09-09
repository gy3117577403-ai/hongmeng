import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { otherWorkListWhere, OtherWorkError } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse } from '@/lib/other-work-time-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const where = otherWorkListWhere(user, req.nextUrl.searchParams);
    // Export a consistent snapshot, without silently truncating the selected period.
    const rows = await prisma.$transaction(async tx => {
      if (await tx.otherWorkTimeRequest.count({ where }) > 10000) throw new OtherWorkError('记录超过 10000 条，请缩小日期范围后导出');
      return tx.otherWorkTimeRequest.findMany({ where, orderBy: [{ workDate: 'asc' }, { employeeNoSnapshot: 'asc' }, { createdAt: 'asc' }], include: { reviews: { include: { actor: { select: { displayName: true, username: true } } }, orderBy: { createdAt: 'asc' } } } });
    }, { isolationLevel: 'RepeatableRead' });
    const book = new ExcelJS.Workbook();
    book.creator = '杭连电子协同平台';
    const sheet = book.addWorksheet('其他工时台账');
    sheet.addRow(['其他工时台账 · 按实际工作日期归属']);
    sheet.addRow(['个人达成率＝（完成＋已确认损耗＋已通过其他工时）÷（出勤×95%）×100%；本台账不计入订单成本。']);
    sheet.addRow(['工作日期','工号','员工','班组','事项分类','申报小时','批准小时','状态','工作说明','安排人','样品追溯','补报原因','审批人','审批时间','更正原单','申请编号']);
    const states: Record<string, string> = { DRAFT: '草稿', PENDING: '待审批', APPROVED: '已通过', REJECTED: '已退回', WITHDRAWN: '已撤回', VOIDED: '已作废' };
    for (const row of rows) sheet.addRow([row.workDate.toISOString().slice(0,10), row.employeeNoSnapshot, row.employeeNameSnapshot, row.teamSnapshot, row.categoryNameSnapshot, row.requestedMinutes / 60,
      row.status === 'APPROVED' ? (row.approvedMinutes || 0) / 60 : 0, states[row.status], row.description, row.arranger, row.sampleReference, row.backfillReason,
      row.reviewedByName, row.reviewedAt?.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), row.correctionOfId, row.id]);
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
    sheet.autoFilter = 'A3:P3';
    sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
    sheet.columns.forEach((col, i) => { col.width = [8,9,11].includes(i) ? 35 : i === 15 ? 40 : 18; });
    sheet.getColumn(6).numFmt = '0.00'; sheet.getColumn(7).numFmt = '0.00';
    const audit = book.addWorksheet('处理轨迹');
    audit.addRow(['申请编号','工作日期','员工','动作','版本','处理人','时间','原因']);
    rows.forEach(row => row.reviews.forEach(r => audit.addRow([row.id, row.workDate.toISOString().slice(0,10), row.employeeNameSnapshot, r.action, r.requestVersion, r.actor.displayName || r.actor.username,
      r.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), r.reason])));
    audit.columns.forEach(c => { c.width = 25; });
    const buffer = await book.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('其他工时台账.xlsx'), 'Cache-Control': 'private, no-store' } });
  } catch (error) { return otherWorkErrorResponse(error); }
}
