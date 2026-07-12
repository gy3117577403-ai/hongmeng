import { NextRequest, NextResponse } from 'next/server';
import { localImportErrorResponse, localImportTaskSummary, requireTaskViewer } from '@/lib/local-import';
import { prisma } from '@/lib/prisma';
import { displayWorkOrderCode } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const { task } = await requireTaskViewer(req, params.taskId);
    const [workOrder, category, summary] = await Promise.all([
      prisma.workOrder.findFirst({
        where: { id: task.detail.workOrderId, deletedAt: null },
        select: { id: true, code: true, specification: true, customerName: true, productName: true },
      }),
      prisma.resourceCategory.findUnique({ where: { id: task.detail.categoryId }, select: { id: true, code: true, name: true } }),
      localImportTaskSummary(task),
    ]);
    if (!workOrder || !category) return NextResponse.json({ ok: false, error: '任务目标工单或分类不存在' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      data: {
        taskId: task.id,
        createdAt: task.createdAt.toISOString(),
        expiresAt: task.detail.expiresAt,
        limits: {
          maxFiles: task.detail.maxFiles,
          maxFileBytes: task.detail.maxFileBytes,
          maxTotalBytes: task.detail.maxTotalBytes,
        },
        workOrder: {
          id: workOrder.id,
          displayCode: displayWorkOrderCode(workOrder),
          customerName: workOrder.customerName || '未设置',
          productName: workOrder.productName,
        },
        category,
        summary,
      },
    });
  } catch (error) {
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
