import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  completedBatchQuantityBasisPoints,
  deriveCompletedBatchState,
  summarizeCompletedBatches,
} from '@/lib/report-completed-batches';
import { ReportDateRangeError, reportRangeQuery } from '@/lib/report-date-range';
import type { ReportCompletedBatchRowDTO, ReportCompletedBatchesDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const { period, date, start, end } = reportRangeQuery(req.nextUrl.searchParams);
    const now = new Date();
    const cutoffAt = new Date(Math.min(now.getTime(), end.getTime() - 1));
    const customer = String(req.nextUrl.searchParams.get('customer') || '').trim().slice(0, 120);
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 120);
    const includeAll = req.nextUrl.searchParams.get('all') === 'true';
    const requestedPage = positiveInteger(req.nextUrl.searchParams.get('page'), 1, 1_000_000);
    const requestedPageSize = positiveInteger(req.nextUrl.searchParams.get('pageSize'), 25, 100);

    const keywordFilter: Prisma.ProductionPlanBatchWhereInput | undefined = keyword ? {
      OR: [
        { planOrder: { sourceOrderNo: { contains: keyword, mode: 'insensitive' } } },
        { planOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
        { planOrder: { productName: { contains: keyword, mode: 'insensitive' } } },
        { planOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { is: { code: { contains: keyword, mode: 'insensitive' } } } },
      ],
    } : undefined;
    const where: Prisma.ProductionPlanBatchWhereInput = {
      deletedAt: null,
      releaseState: { not: 'cancelled' },
      plannedCompletionDate: { gte: start, lt: end },
      planOrder: {
        deletedAt: null,
        ...(customer ? { customerName: customer } : {}),
      },
      ...(keywordFilter || {}),
    };
    const customerWhere: Prisma.ProductionPlanBatchWhereInput = {
      deletedAt: null,
      releaseState: { not: 'cancelled' },
      plannedCompletionDate: { gte: start, lt: end },
      planOrder: { deletedAt: null },
    };

    const [batches, customerRows] = await Promise.all([
      prisma.productionPlanBatch.findMany({
        where,
        orderBy: [
          { plannedCompletionDate: 'asc' },
          { planOrder: { sourceOrderNo: 'asc' } },
          { planOrder: { sourceLineNo: 'asc' } },
          { batchNo: 'asc' },
        ],
        select: {
          id: true,
          batchNo: true,
          quantity: true,
          plannedCompletionDate: true,
          releaseState: true,
          workOrderId: true,
          planOrder: {
            select: {
              sourceOrderNo: true,
              sourceLineNo: true,
              customerName: true,
              productName: true,
              specification: true,
            },
          },
          workOrder: {
            select: {
              code: true,
              stage: true,
              status: true,
              startedAt: true,
              productionOwner: true,
              processRoute: {
                select: {
                  startedAt: true,
                  steps: {
                    where: { retiredAt: null },
                    orderBy: { position: 'asc' },
                    select: {
                      id: true,
                      processName: true,
                      status: true,
                      startedAt: true,
                      position: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.productionPlanBatch.findMany({
        where: customerWhere,
        distinct: ['planOrderId'],
        select: { planOrder: { select: { customerName: true } } },
      }),
    ]);

    const finalStepIds = batches.flatMap(batch => {
      const steps = batch.workOrder?.processRoute?.steps || [];
      return steps.length ? [steps[steps.length - 1].id] : [];
    });
    const completions = finalStepIds.length ? await prisma.processCompletion.findMany({
      where: {
        voidedAt: null,
        stepId: { in: finalStepIds },
        completedAt: { lte: cutoffAt },
      },
      orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        workOrderId: true,
        stepId: true,
        completedAt: true,
        goodQty: true,
      },
    }) : [];
    const completionsByWorkOrder = new Map<string, typeof completions>();
    for (const completion of completions) {
      const list = completionsByWorkOrder.get(completion.workOrderId) || [];
      list.push(completion);
      completionsByWorkOrder.set(completion.workOrderId, list);
    }

    const allRows: ReportCompletedBatchRowDTO[] = batches.map(batch => {
      const route = batch.workOrder?.processRoute;
      const steps = route?.steps || [];
      const finalStep = steps.length ? steps[steps.length - 1] : null;
      const currentStep = steps.find(step => !['completed', 'skipped'].includes(step.status)) || finalStep;
      const finalCompletions = batch.workOrderId && finalStep
        ? (completionsByWorkOrder.get(batch.workOrderId) || []).filter(item => item.stepId === finalStep.id)
        : [];
      const state = deriveCompletedBatchState({
        quantity: batch.quantity,
        plannedCompletionDate: batch.plannedCompletionDate,
        cutoffAt,
        releaseState: batch.releaseState,
        workOrderId: batch.workOrderId,
        hasFinalRouteStep: Boolean(finalStep),
        started: Boolean(
          batch.workOrder?.startedAt
          || route?.startedAt
          || steps.some(step => step.startedAt || step.status === 'in_progress' || step.status === 'completed'),
        ),
        completions: finalCompletions.map(item => ({
          completedAt: item.completedAt,
          goodQty: item.goodQty,
        })),
      });
      return {
        id: batch.id,
        sourceOrderNo: batch.planOrder.sourceOrderNo,
        sourceLineNo: batch.planOrder.sourceLineNo,
        batchNo: batch.batchNo,
        batchLabel: `${batch.planOrder.sourceOrderNo}-${batch.planOrder.sourceLineNo}-${batch.batchNo}`,
        workOrderId: batch.workOrderId,
        workOrderCode: batch.workOrder?.code || null,
        customerName: batch.planOrder.customerName,
        productName: batch.planOrder.productName,
        specification: batch.planOrder.specification,
        quantity: Math.max(0, batch.quantity),
        completedQuantity: state.completedQuantity,
        quantityBasisPoints: completedBatchQuantityBasisPoints(state.completedQuantity, batch.quantity),
        plannedCompletionDate: batch.plannedCompletionDate.toISOString(),
        actualCompletionAt: state.actualCompletionAt?.toISOString() || null,
        status: state.status,
        statusLabel: state.statusLabel,
        overdue: state.overdue,
        currentProcess: currentStep?.processName || null,
        owner: batch.workOrder?.productionOwner || null,
        releaseState: batch.releaseState,
      };
    });
    const summary = summarizeCompletedBatches(allRows);
    const total = allRows.length;
    const pageSize = includeAll ? Math.max(1, total) : requestedPageSize;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = includeAll ? 1 : Math.min(requestedPage, pageCount);
    const rows = includeAll ? allRows : allRows.slice((page - 1) * pageSize, page * pageSize);
    const report: ReportCompletedBatchesDTO = {
      period,
      date,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      cutoffAt: cutoffAt.toISOString(),
      generatedAt: now.toISOString(),
      customer,
      keyword,
      customers: [...new Set(customerRows.map(item => item.planOrder.customerName).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, 'zh-CN')),
      summary,
      page,
      pageSize,
      total,
      rows,
    };
    const response = NextResponse.json({ ok: true, report });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ReportDateRangeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error('completed batch report failed', error);
    return NextResponse.json({ ok: false, error: '批次达成报表加载失败' }, { status: 500 });
  }
}
