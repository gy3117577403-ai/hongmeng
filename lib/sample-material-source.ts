import type { Prisma, SampleTask } from '@prisma/client';
export const sampleMaterialSourceSelect = {
  id: true, code: true, customerNameSnapshot: true, specificationSnapshot: true, productNameSnapshot: true,
  sampleQuantity: true, plannedCompletionDate: true, planWeekStartDate: true, dueDate: true, status: true, deletedAt: true, taskType: true, priority: true,
} satisfies Prisma.SampleTaskSelect;
type Source = Pick<SampleTask, keyof typeof sampleMaterialSourceSelect>;
/** A display projection only; no production work order or labor records are created. */
export function sampleMaterialSource(task: Source | null | undefined) {
  const end = task?.planWeekStartDate ? new Date(task.planWeekStartDate.getTime() + 6 * 86400000) : null;
  return {
    id: task?.id || '', code: task?.code || '', customerName: task?.customerNameSnapshot || '',
    specification: task?.specificationSnapshot || '', productName: task?.productNameSnapshot || '', processName: '样品',
    productionTargetQty: task?.sampleQuantity || 0, uncompletedQty: String(task?.sampleQuantity || 0),
    plannedAt: task?.plannedCompletionDate || null, deliveryDay: task?.dueDate?.toISOString().slice(0, 10) || null,
    weekStartDate: task?.planWeekStartDate || null, weekEndDate: end,
    planActive: !!task && !task.deletedAt && !['COMPLETED','CANCELLED'].includes(task.status), stage: 'SAMPLE', priority: String(task?.priority || 0),
    productionPlanBatch: null,
  };
}
