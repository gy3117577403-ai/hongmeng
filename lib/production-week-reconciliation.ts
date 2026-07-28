import { chinaDateKey } from '@/lib/china-date';
import { prisma } from '@/lib/prisma';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import type {
  ProductionWeekReconciliationDTO,
  ProductionWeekReconciliationIssueCode,
  ProductionWeekReconciliationIssueDTO,
} from '@/types';

export type ReconciliationBatchRow = {
  id: string;
  specification: string;
  workOrderId: string | null;
  workOrder: {
    id: string;
    code: string;
    specification: string | null;
    weekStartDate: Date | null;
    deletedAt: Date | null;
  } | null;
};

export type ReconciliationWorkOrderRow = {
  id: string;
  code: string;
  specification: string | null;
  weekStartDate: Date | null;
  planActive: boolean;
  productionPlanBatch: {
    id: string;
    weekStartDate: Date;
    deletedAt: Date | null;
    planOrder: { deletedAt: Date | null };
  } | null;
};

function issue(
  code: ProductionWeekReconciliationIssueCode,
  label: string,
  rows: Array<{ id: string; code: string; detail: string }>,
): ProductionWeekReconciliationIssueDTO | null {
  if (!rows.length) return null;
  return { code, label, count: rows.length, items: rows.slice(0, 20) };
}

export function buildProductionWeekReconciliation(input: {
  weekStartDate: string;
  weekEndDate: string;
  batches: ReconciliationBatchRow[];
  workOrders: ReconciliationWorkOrderRow[];
}): ProductionWeekReconciliationDTO {
  const selectedBatchIds = new Set(input.batches.map(batch => batch.id));
  const validLinkedWorkOrderIds = new Set<string>();
  const planMissingWorkOrders: Array<{ id: string; code: string; detail: string }> = [];
  const weekMismatches: Array<{ id: string; code: string; detail: string }> = [];

  for (const batch of input.batches) {
    if (!batch.workOrderId || !batch.workOrder || batch.workOrder.deletedAt) {
      planMissingWorkOrders.push({
        id: batch.id,
        code: batch.specification,
        detail: '计划批次尚未生成或关联生产工单',
      });
      continue;
    }
    const workOrderWeek = chinaDateKey(batch.workOrder.weekStartDate);
    if (workOrderWeek !== input.weekStartDate) {
      weekMismatches.push({
        id: batch.workOrder.id,
        code: batch.workOrder.specification || batch.workOrder.code,
        detail: `计划属于 ${input.weekStartDate}，工单属于 ${workOrderWeek || '未设置生产周'}`,
      });
      continue;
    }
    validLinkedWorkOrderIds.add(batch.workOrder.id);
  }

  const workOrdersMissingPlan = input.workOrders
    .filter(order => !order.productionPlanBatch || !selectedBatchIds.has(order.productionPlanBatch.id))
    .map(order => ({
      id: order.id,
      code: order.specification || order.code,
      detail: order.productionPlanBatch
        ? `关联批次属于 ${chinaDateKey(order.productionPlanBatch.weekStartDate) || '其他生产周'}`
        : '生产工单没有关联计划批次',
    }));

  const workflowMissingWorkOrders = input.batches
    .filter(batch => batch.workOrderId && !validLinkedWorkOrderIds.has(batch.workOrderId))
    .map(batch => ({
      id: batch.id,
      code: batch.specification,
      detail: '计划批次未形成同周有效工单，流程只能显示计划准备状态',
    }));

  const issues = [
    issue('plan_missing_work_order', '计划批次缺少生产工单', planMissingWorkOrders),
    issue('work_order_week_mismatch', '计划与工单生产周不一致', weekMismatches),
    issue('work_order_missing_plan', '旧版工单未关联本周计划', workOrdersMissingPlan),
    issue('workflow_missing_work_order', '流程缺少同周有效生产工单', workflowMissingWorkOrders),
  ].filter((item): item is ProductionWeekReconciliationIssueDTO => Boolean(item));

  // 规范周视图只以计划批次为主线；旧版独立工单留在差异清单，不混入三端统计。
  const productionWorkOrderCount = validLinkedWorkOrderIds.size;
  const workflowInstanceCount = input.batches.length;
  const differenceCount = issues.reduce((sum, item) => sum + item.count, 0);
  return {
    weekStartDate: input.weekStartDate,
    weekEndDate: input.weekEndDate,
    planBatchCount: input.batches.length,
    productionWorkOrderCount,
    workflowInstanceCount,
    alignedWorkOrderCount: validLinkedWorkOrderIds.size,
    aligned: differenceCount === 0
      && input.batches.length === productionWorkOrderCount
      && input.batches.length === workflowInstanceCount,
    differenceCount,
    issues,
  };
}

export async function loadProductionWeekReconciliation(
  weekStartInput?: string | null,
): Promise<ProductionWeekReconciliationDTO> {
  const weekStart = parseWeek(weekStartInput);
  if (!weekStart) throw new Error('生产周开始日期格式不正确');
  const weekEnd = addDays(weekStart, 6);
  const weekStartDate = chinaDateKey(weekStart);
  const weekEndDate = chinaDateKey(weekEnd);
  const sameWeekStart = { gte: weekStart, lt: addDays(weekStart, 1) };

  const [batches, workOrders] = await Promise.all([
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        weekStartDate: sameWeekStart,
        planOrder: { deletedAt: null },
      },
      select: {
        id: true,
        workOrderId: true,
        planOrder: { select: { specification: true } },
        workOrder: {
          select: {
            id: true,
            code: true,
            specification: true,
            weekStartDate: true,
            deletedAt: true,
          },
        },
      },
      orderBy: [{ planOrder: { specification: 'asc' } }, { batchNo: 'asc' }],
    }),
    prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        parentWorkOrderId: null,
        planType: { in: ['weekly_plan', 'managed_plan'] },
        weekStartDate: sameWeekStart,
      },
      select: {
        id: true,
        code: true,
        specification: true,
        weekStartDate: true,
        planActive: true,
        productionPlanBatch: {
          select: {
            id: true,
            weekStartDate: true,
            deletedAt: true,
            planOrder: { select: { deletedAt: true } },
          },
        },
      },
      orderBy: [{ specification: 'asc' }, { code: 'asc' }],
    }),
  ]);

  return buildProductionWeekReconciliation({
    weekStartDate,
    weekEndDate,
    batches: batches.map(batch => ({
      id: batch.id,
      specification: batch.planOrder.specification,
      workOrderId: batch.workOrderId,
      workOrder: batch.workOrder,
    })),
    workOrders,
  });
}
