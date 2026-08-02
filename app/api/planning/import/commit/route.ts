import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  automaticallyReleaseProductionPlanBatch,
  chinaDate,
  editableProductionPlanningWeek,
  effectivePlanningUnitMilliseconds,
  parsePlanDate,
  planBatchSnapshot,
  refreshProductionPlanOrderStatus,
  resolvePlanningReferences,
} from '@/lib/production-planning';
import type { WorkOrderImportPreviewRow } from '@/lib/work-order-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CommitBody = {
  rows?: WorkOrderImportPreviewRow[];
  targetWeekStartDate?: string;
  sourceFileName?: string | null;
  sourceSheetName?: string | null;
};

type ImportResult = {
  row: number;
  specification: string;
  status: 'created' | 'skipped' | 'failed';
  message: string;
};

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim().slice(0, max);
}

function positiveQuantity(value: unknown): number | null {
  const normalized = clean(value, 80).replace(/,/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function unitMilliseconds(value: unknown): number | null {
  const source = clean(value, 80).replace(/,/g, '');
  if (!source) return null;
  const match = source.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = source.includes('秒')
    ? 1_000
    : source.includes('小时') || source.toLocaleLowerCase().includes('hour')
      ? 3_600_000
      : 60_000;
  const milliseconds = Math.round(amount * multiplier);
  return milliseconds > 0 && milliseconds <= 86_400_000 ? milliseconds : null;
}

function priority(value: unknown): 'normal' | 'urgent' | 'insert' {
  const source = clean(value, 30).toLocaleLowerCase();
  if (source.includes('插') || source === 'insert') return 'insert';
  if (source.includes('急') || source === 'high' || source === 'urgent') return 'urgent';
  return 'normal';
}

function identityNumber(value: string): number {
  const digest = createHash('sha256').update(value).digest();
  return (digest.readUInt32BE(0) & 0x7fffffff) || 1;
}

function normalizedDate(value: unknown, fallback: Date): Date {
  return parsePlanDate(value) || fallback;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as CommitBody;
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: '缺少待确认导入的数据' }, { status: 400 });
    }
    const targetWeek = editableProductionPlanningWeek(body.targetWeekStartDate);
    if (!targetWeek) {
      return NextResponse.json({ ok: false, error: '导入目标只能是本周、下周或下下周' }, { status: 400 });
    }
    const targetWeekStartDate = chinaDate(targetWeek.start);
    const targetWeekEndDate = chinaDate(targetWeek.end);
    const sourceFileName = clean(body.sourceFileName, 180) || '周排单清单';
    const sourceSheetName = clean(body.sourceSheetName, 160);
    const results: ImportResult[] = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let automaticallyActive = 0;
    let automaticallyPrepared = 0;

    for (const row of rows) {
      const rowNo = Number(row.rowNo || 0) || results.length + 1;
      const item = row.workOrder;
      const specification = clean(item?.specification || item?.productName);
      if (row.status === 'skipped' || row.status === 'duplicate') {
        skipped += 1;
        results.push({
          row: rowNo,
          specification: specification || '-',
          status: 'skipped',
          message: row.reason || '该行已跳过',
        });
        continue;
      }
      if (row.status === 'invalid') {
        failed += 1;
        results.push({
          row: rowNo,
          specification: specification || '-',
          status: 'failed',
          message: row.reason || '行数据异常',
        });
        continue;
      }

      const customerName = clean(item?.customerName, 120);
      const productName = clean(item?.productName || specification, 160);
      const quantity = positiveQuantity(item?.uncompletedQty);
      if (!customerName || !specification || !productName || !quantity) {
        failed += 1;
        results.push({
          row: rowNo,
          specification: specification || '-',
          status: 'failed',
          message: !customerName
            ? '客户名称缺失'
            : !quantity
              ? '未交量必须是正整数'
              : '品名或规格缺失',
        });
        continue;
      }

      try {
        const importedUnitMilliseconds = unitMilliseconds(item?.unitWorkHours);
        const rawSourceOrderNo = clean(item?.sourceOrderNo, 120);
        const identitySeed = [customerName, specification, clean(item?.salesperson, 80)].join('|');
        const sourceOrderNo = rawSourceOrderNo || `WEEKLY-${createHash('sha256').update(identitySeed).digest('hex').slice(0, 20)}`;
        const sourceLineNo = rawSourceOrderNo
          ? identityNumber(`${rawSourceOrderNo}|${identitySeed}`)
          : 1;
        const orderDate = normalizedDate(item?.orderDate, targetWeek.start);
        const rawCompletionDate = normalizedDate(item?.plannedAt, targetWeek.end);
        const plannedCompletionDate = rawCompletionDate < targetWeek.start || rawCompletionDate > targetWeek.end
          ? targetWeek.end
          : rawCompletionDate;
        const customerDueDate = plannedCompletionDate < orderDate ? targetWeek.end : plannedCompletionDate;

        const outcome = await prisma.$transaction(async tx => {
          const existing = await tx.productionPlanOrder.findUnique({
            where: { sourceOrderNo_sourceLineNo: { sourceOrderNo, sourceLineNo } },
            include: {
              batches: {
                orderBy: { batchNo: 'asc' },
              },
            },
          });
          const activeBatches = existing?.batches.filter(batch => !batch.deletedAt) || [];
          const restoringDeletedOrder = Boolean(existing?.deletedAt);
          if (existing && !restoringDeletedOrder && (existing.status === 'cancelled' || existing.status === 'completed')) {
            throw new Error('PLAN_IMPORT_ORDER_CLOSED');
          }
          if (activeBatches.some(batch => chinaDate(batch.weekStartDate) === targetWeekStartDate)) {
            return {
              duplicate: true,
              restored: false,
              planOrderId: existing!.id,
              batchId: null,
              automaticReleaseTarget: null,
            };
          }

          const references = await resolvePlanningReferences(tx, {
            drawingLibraryItemId: existing?.drawingLibraryItemId,
            customerName,
            specification,
          });
          const effectiveUnit = effectivePlanningUnitMilliseconds(
            importedUnitMilliseconds,
            references.unitMilliseconds,
            existing?.planningUnitMilliseconds,
          );
          const nextBatchNo = existing
            ? Math.max(0, ...existing.batches.map(batch => batch.batchNo)) + 1
            : 1;
          const planOrder = existing
            ? await tx.productionPlanOrder.update({
                where: { id: existing.id },
                data: restoringDeletedOrder
                  ? {
                      customerName: references.customerName || customerName,
                      salesperson: clean(item?.salesperson, 80) || existing.salesperson || null,
                      productName: references.productName || productName,
                      specification: references.specification || specification,
                      drawingLibraryItemId: references.drawingLibraryItemId || existing.drawingLibraryItemId,
                      orderQuantity: quantity,
                      planningUnitMilliseconds: effectiveUnit,
                      orderDate,
                      customerDueDate,
                      priority: priority(item?.priority),
                      status: 'scheduled',
                      remark: clean(item?.remark, 500) || null,
                      deletedAt: null,
                      updatedById: user.id,
                    }
                  : {
                      orderQuantity: existing.orderQuantity + quantity,
                      customerDueDate: customerDueDate > existing.customerDueDate ? customerDueDate : existing.customerDueDate,
                      salesperson: existing.salesperson || clean(item?.salesperson, 80) || null,
                      planningUnitMilliseconds: existing.planningUnitMilliseconds || effectiveUnit,
                      drawingLibraryItemId: existing.drawingLibraryItemId || references.drawingLibraryItemId,
                      updatedById: user.id,
                    },
              })
            : await tx.productionPlanOrder.create({
                data: {
                  sourceOrderNo,
                  sourceLineNo,
                  customerName,
                  salesperson: clean(item?.salesperson, 80) || null,
                  productName,
                  specification,
                  drawingLibraryItemId: references.drawingLibraryItemId,
                  orderQuantity: quantity,
                  planningUnitMilliseconds: effectiveUnit,
                  orderDate,
                  customerDueDate,
                  priority: priority(item?.priority),
                  status: 'scheduled',
                  remark: clean(item?.remark, 500) || null,
                  createdById: user.id,
                  updatedById: user.id,
                },
              });
          const batch = await tx.productionPlanBatch.create({
            data: {
              planOrderId: planOrder.id,
              batchNo: nextBatchNo,
              quantity,
              weekStartDate: targetWeek.start,
              weekEndDate: targetWeek.end,
              plannedCompletionDate,
              productTimeProfileId: references.productTimeProfileId,
              productTimeProfileVersion: references.productTimeProfileVersion,
              unitMillisecondsSnapshot: effectiveUnit,
              totalMillisecondsSnapshot: effectiveUnit ? BigInt(effectiveUnit) * BigInt(quantity) : null,
            },
          });
          await refreshProductionPlanOrderStatus(tx, planOrder.id);
          await tx.productionPlanChange.create({
            data: {
              planOrderId: planOrder.id,
              batchId: batch.id,
              action: restoringDeletedOrder ? 'restore_deleted_plan_order_from_import' : 'import_plan_week',
              afterData: planBatchSnapshot({
                quantity,
                weekStartDate: targetWeek.start,
                weekEndDate: targetWeek.end,
                plannedCompletionDate,
                unitMilliseconds: effectiveUnit,
                batchNo: nextBatchNo,
                releaseState: 'draft',
              }),
              impactData: {
                sourceFileName,
                sourceSheetName: sourceSheetName || null,
                sourceRowNo: rowNo,
                targetWeekStartDate,
              },
              reason: `导入到 ${targetWeekStartDate} 周排单清单`,
              actorId: user.id,
            },
          });
          const automaticRelease = await automaticallyReleaseProductionPlanBatch(tx, {
            batchId: batch.id,
            actorId: user.id,
            trigger: 'automatic_schedule',
          });
          return {
            duplicate: false,
            restored: restoringDeletedOrder,
            planOrderId: planOrder.id,
            batchId: batch.id,
            automaticReleaseTarget: automaticRelease?.target || null,
          };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });

        if (outcome.duplicate) {
          skipped += 1;
          results.push({
            row: rowNo,
            specification,
            status: 'skipped',
            message: '该订单在目标周已经存在，未重复写入',
          });
        } else {
          created += 1;
          if (outcome.automaticReleaseTarget === 'active') automaticallyActive += 1;
          if (outcome.automaticReleaseTarget === 'preparation') automaticallyPrepared += 1;
          results.push({
            row: rowNo,
            specification,
            status: 'created',
            message: outcome.automaticReleaseTarget === 'active'
              ? '已加入目标周并自动进入本周生产执行'
              : outcome.automaticReleaseTarget === 'preparation'
                ? '已加入目标周并自动进入下周生产执行'
                : outcome.restored
                  ? '已恢复该计划并加入目标周排单清单'
                  : '已加入目标周排单清单',
          });
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error && error.message === 'PLAN_IMPORT_ORDER_CLOSED'
            ? '关联计划订单已经完成或取消，不能继续追加周批次'
            : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
              ? '数据刚被其他操作更新，请重新导入'
              : error instanceof Error
                ? error.message
                : '导入失败';
        results.push({ row: rowNo, specification, status: 'failed', message });
      }
    }

    await prisma.operationLog.create({
      data: {
        userId: user.id,
        action: 'import_production_plan_week',
        targetType: 'production_plan_week',
        targetId: targetWeekStartDate,
        detail: {
          sourceFileName,
          sourceSheetName: sourceSheetName || null,
          targetWeekStartDate,
          targetWeekEndDate,
          created,
          skipped,
          failed,
          automaticallyActive,
          automaticallyPrepared,
          total: rows.length,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      targetWeekStartDate,
      targetWeekEndDate,
      summary: {
        created,
        skipped,
        failed,
        automaticallyActive,
        automaticallyPrepared,
        total: rows.length,
      },
      results,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning week import failed', error);
    return NextResponse.json({ ok: false, error: '周排单清单导入失败' }, { status: 500 });
  }
}
