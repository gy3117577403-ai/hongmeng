import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { detailSummary, iso, jsonDownloadResponse, sanitizeDetail } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { displayWorkOrderCode, workOrderStageText } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const [workOrders, resourceCategories, resourceFiles, operationLogs] = await Promise.all([
      prisma.workOrder.findMany({ orderBy: [{ createdAt: 'desc' }, { code: 'asc' }] }),
      prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.resourceFile.findMany({
        include: {
          workOrder: { select: { code: true, specification: true } },
          category: { select: { name: true, code: true } },
          uploadedBy: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.operationLog.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, displayName: true } } },
      }),
    ]);

    await logOp({
      userId: user.id,
      action: 'export_metadata',
      targetType: 'export',
      detail: { workOrders: workOrders.length, resourceFiles: resourceFiles.length, operationLogs: operationLogs.length },
    });

    return jsonDownloadResponse('系统元数据.json', {
      exportedAt: new Date().toISOString(),
      app: { name: '工单资料库', version: 'v1.7.0-rc.1' },
      workOrders: workOrders.map(o => ({
        id: o.id,
        code: o.code,
        displayCode: displayWorkOrderCode(o),
        customerName: o.customerName,
        productName: o.productName,
        specification: o.specification,
        planType: o.planType,
        weekStartDate: iso(o.weekStartDate),
        weekEndDate: iso(o.weekEndDate),
        planActive: o.planActive,
        planClearedAt: iso(o.planClearedAt),
        planClearedBy: o.planClearedBy,
        libraryKey: o.libraryKey,
        stage: o.stage,
        stageText: workOrderStageText(o.stage || o.status),
        priority: o.priority,
        status: o.status,
        progress: o.progress,
        plannedAt: iso(o.plannedAt),
        remark: o.remark,
        createdAt: iso(o.createdAt),
        updatedAt: iso(o.updatedAt),
        deletedAt: iso(o.deletedAt),
      })),
      resourceCategories: resourceCategories.map(c => ({
        id: c.id,
        name: c.name,
        code: c.code,
        sortOrder: c.sortOrder,
      })),
      resourceFiles: resourceFiles.map(f => ({
        id: f.id,
        workOrderId: f.workOrderId,
        workOrderCode: displayWorkOrderCode(f.workOrder),
        categoryId: f.categoryId,
        categoryName: f.category.name,
        categoryCode: f.category.code,
        originalName: f.originalName,
        displayName: f.displayName,
        version: f.version,
        mimeType: f.mimeType,
        fileType: f.fileType,
        fileSize: f.fileSize,
        status: f.status,
        uploadedBy: f.uploadedBy?.displayName || f.uploadedBy?.username || null,
        remark: f.remark,
        createdAt: iso(f.createdAt),
        updatedAt: iso(f.updatedAt),
        deletedAt: iso(f.deletedAt),
      })),
      operationLogs: operationLogs.map(log => ({
        id: log.id,
        createdAt: iso(log.createdAt),
        user: log.user?.displayName || log.user?.username || '系统',
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        detail: sanitizeDetail(log.detail),
        detailSummary: detailSummary(log.detail),
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导出元数据失败' }, { status: 500 });
  }
}
