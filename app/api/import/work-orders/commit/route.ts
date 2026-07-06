import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  nextUniqueCode,
  summarizeWorkOrderImport,
  toWorkOrderCreateData,
  type DuplicateStrategy,
  type WorkOrderImportPreviewRow,
} from '@/lib/work-order-import';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CommitBody = {
  rows?: WorkOrderImportPreviewRow[];
  duplicateStrategy?: DuplicateStrategy;
  sourceFileName?: string | null;
  sourceSheetName?: string | null;
  mode?: string;
};

async function codeExists(code: string) {
  return !!(await prisma.workOrder.findUnique({ where: { code } }));
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as CommitBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return NextResponse.json({ ok: false, error: '缺少待确认导入的数据' }, { status: 400 });

    const duplicateStrategy: DuplicateStrategy = body.duplicateStrategy === 'import' ? 'import' : 'skip';
    const importBatchId = `wo-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const summary = summarizeWorkOrderImport(rows);
    const userName = user.displayName || user.username;
    const results: { row: number; code: string; status: 'created' | 'skipped' | 'failed'; message: string }[] = [];
    const createdOrders = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let duplicateSkipped = 0;

    for (const row of rows) {
      const rowNo = Number(row.rowNo || 0) || results.length + 1;
      if (row.status === 'skipped') {
        skipped += 1;
        results.push({ row: rowNo, code: row.code || '-', status: 'skipped', message: row.reason || '已跳过' });
        continue;
      }
      if (row.status === 'invalid') {
        failed += 1;
        results.push({ row: rowNo, code: row.code || '-', status: 'failed', message: row.reason || '行数据异常' });
        continue;
      }
      if (row.status === 'duplicate' && duplicateStrategy === 'skip') {
        skipped += 1;
        duplicateSkipped += 1;
        results.push({ row: rowNo, code: row.code || '-', status: 'skipped', message: row.reason || '重复行已跳过' });
        continue;
      }

      try {
        const data = toWorkOrderCreateData(row, importBatchId);
        if (!data.code || !data.productName) {
          failed += 1;
          results.push({ row: rowNo, code: data.code || '-', status: 'failed', message: '工单号或产品名称缺失' });
          continue;
        }
        data.code = await nextUniqueCode(data.code, codeExists);
        const workOrder = await prisma.workOrder.create({
          data,
          include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        });
        created += 1;
        createdOrders.push(serializeWorkOrder(workOrder));
        await snapshotChange({
          entityType: 'work_order',
          entityId: workOrder.id,
          action: 'import_work_orders',
          after: workOrderSnapshot(workOrder),
          changedBy: userName,
        });
        results.push({ row: rowNo, code: workOrder.code, status: 'created', message: row.status === 'duplicate' ? '重复行已按策略导入' : '已新增' });
      } catch (e) {
        failed += 1;
        results.push({ row: rowNo, code: row.code || '-', status: 'failed', message: e instanceof Error ? e.message : '导入失败' });
      }
    }

    await logOp({
      userId: user.id,
      action: 'import_work_orders',
      targetType: 'work_order',
      detail: {
        importBatchId,
        mode: body.mode || 'unknown',
        sourceFileName: body.sourceFileName || null,
        sourceSheetName: body.sourceSheetName || null,
        created,
        skipped,
        failed,
        duplicateSkipped,
        duplicateStrategy,
        total: rows.length,
        previewSummary: summary,
      },
    });

    return NextResponse.json({
      ok: true,
      importBatchId,
      summary: { created, skipped, failed, duplicateSkipped, total: rows.length },
      results,
      workOrders: createdOrders,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '确认导入失败' }, { status: 500 });
  }
}
