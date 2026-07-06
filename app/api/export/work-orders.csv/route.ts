import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse, iso } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { displayWorkOrderCode, workOrderStageText } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const priorityText: Record<string, string> = { urgent: '紧急', high: '高', normal: '一般' };

export async function GET() {
  try {
    const user = await requireUser();
    const workOrders = await prisma.workOrder.findMany({
      orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
    });
    await logOp({ userId: user.id, action: 'export_work_orders', targetType: 'export', detail: { count: workOrders.length } });

    const rows = [
      ['生产编号', '内部编号', '来源订单号', '客户', '业务员', '客户等级', '产品名称', '规格', '工序', '未交量', '工时', '总工时', '图纸', '交期', '配料', '计划时间', '订单日期', '图纸下发日期', '图纸说明', '状态', '优先级', '进度', '备注', '导入批次', '来源表', '来源行号', '创建时间', '更新时间', '是否删除'],
      ...workOrders.map(o => [
        displayWorkOrderCode(o),
        o.code,
        o.sourceOrderNo || '',
        o.customerName || '',
        o.salesperson || '',
        o.customerLevel || '',
        o.productName,
        o.specification || '',
        o.processName || '',
        o.uncompletedQty || '',
        o.unitWorkHours || '',
        o.totalWorkHours || '',
        o.drawingStatus || '',
        o.deliveryDay || '',
        o.materialStatus || '',
        iso(o.plannedAt),
        iso(o.orderDate),
        iso(o.drawingIssuedAt),
        o.drawingIssueNote || '',
        workOrderStageText(o.stage || o.status),
        priorityText[o.priority] || o.priority,
        o.progress,
        o.remark || '',
        o.importBatchId || '',
        o.sourceSheetName || '',
        o.sourceRowNo || '',
        iso(o.createdAt),
        iso(o.updatedAt),
        o.deletedAt ? '是' : '否',
      ]),
    ];

    return csvResponse('工单列表.csv', csv(rows));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导出工单失败' }, { status: 500 });
  }
}
