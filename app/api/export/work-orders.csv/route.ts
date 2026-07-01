import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse, iso } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const priorityText: Record<string, string> = { urgent: '紧急', high: '高', normal: '一般' };
const statusText: Record<string, string> = { pending: '待处理', processing: '进行中', done: '已完成' };

export async function GET() {
  try {
    const user = await requireUser();
    const workOrders = await prisma.workOrder.findMany({
      orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
    });
    await logOp({ userId: user.id, action: 'export_work_orders', targetType: 'export', detail: { count: workOrders.length } });

    const rows = [
      ['工单号', '产品名称', '阶段', '优先级', '状态', '进度', '备注', '创建时间', '更新时间', '是否删除'],
      ...workOrders.map(o => [
        o.code,
        o.productName,
        o.stage,
        priorityText[o.priority] || o.priority,
        statusText[o.status] || o.status,
        o.progress,
        o.remark || '',
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
