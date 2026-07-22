import { prisma } from '@/lib/prisma';
import { changeCode, changeStatusLabels, changeTypeLabels } from '@/lib/changes';
import { issueCode, issueStatusLabels, issueTypeLabels } from '@/lib/issues';
import { PLANNING_FLOW_STEPS, planningFlowStepStates, resolvePlanningFlow } from '@/lib/planning-flow';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import { chinaWeekRange } from '@/lib/production-planning';
import { normalizeWorkOrderStage, stageText } from '@/lib/work-orders';
import type {
  ChangeStatus,
  ChangeType,
  IssueStatus,
  IssueType,
  ProcessRouteStatus,
  ProcessStageGroup,
  ProcessStepStatus,
  ProductionPlanReleaseState,
  WarehouseMaterialStatus,
  WorkflowActivityDTO,
  WorkflowEntityType,
  WorkflowItemDTO,
  WorkflowProcessStatus,
  WorkflowStepDTO,
  WorkflowSummaryDTO,
  WorkflowTemplateDTO,
  WorkflowWeekScope,
} from '@/types';

export const workflowTemplates: WorkflowTemplateDTO[] = [
  {
    key: 'issue',
    name: '问题闭环',
    description: '生产、计划与技术问题的受理、处理、验证和关闭。',
    steps: ['待受理', '处理中', '待验证', '已关闭'],
    route: '/workspace/issues',
  },
  {
    key: 'change',
    name: '变更闭环',
    description: '图纸、工艺、计划与物料变更的评估、执行和验证。',
    steps: ['草稿', '待评估', '执行中', '待验证', '已关闭'],
    route: '/workspace/changes',
  },
  {
    key: 'production',
    name: '生产流转',
    description: '从计划排程、图纸、仓库、工时和工艺准备，到生产执行与完成归档。',
    steps: [...PLANNING_FLOW_STEPS],
    route: '/weekly-plan-center',
  },
];

function steps(labels: string[], currentIndex: number, closed = false): WorkflowStepDTO[] {
  return labels.map((label, index) => ({
    key: String(index),
    label,
    state: closed || index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
  }));
}

function processStatus(status: string, entityType: WorkflowEntityType): WorkflowProcessStatus {
  if (entityType === 'issue') {
    if (status === 'closed') return 'closed';
    if (status === 'verifying') return 'verifying';
    return status === 'processing' ? 'processing' : 'waiting';
  }
  if (entityType === 'change') {
    if (status === 'closed') return 'closed';
    if (status === 'verifying') return 'verifying';
    return status === 'implementing' ? 'processing' : 'waiting';
  }
  if (status === 'completed') return 'closed';
  return status === 'frontend' || status === 'backend' ? 'processing' : 'waiting';
}

function nextLabel(labels: string[], index: number): string | null {
  return index >= 0 && index + 1 < labels.length ? labels[index + 1] : null;
}

function activity(id: string, action: string, label: string, actor: string | null | undefined, createdAt: Date): WorkflowActivityDTO {
  return { id, action, label, actor: actor || null, createdAt: createdAt.toISOString() };
}

function dedupeProductionActivities(items: WorkflowActivityDTO[]): WorkflowActivityDTO[] {
  const sorted = [...items].sort(
    (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
  );
  const deduped: WorkflowActivityDTO[] = [];

  for (const item of sorted) {
    const duplicateIndex = deduped.findIndex(existing => (
      existing.label === item.label
      && (existing.actor || null) === (item.actor || null)
      && Math.abs(new Date(existing.createdAt).getTime() - new Date(item.createdAt).getTime()) <= 1_000
      && (existing.action === 'production_progress' || item.action === 'production_progress')
    ));
    if (duplicateIndex < 0) {
      deduped.push(item);
    } else if (deduped[duplicateIndex].action === 'production_progress' && item.action !== 'production_progress') {
      deduped[duplicateIndex] = item;
    }
  }

  return deduped;
}

function summary(items: WorkflowItemDTO[]): WorkflowSummaryDTO {
  const value: WorkflowSummaryDTO = {
    total: items.length, waiting: 0, processing: 0, verifying: 0, closed: 0, overdue: 0,
    issue: 0, change: 0, production: 0,
  };
  for (const item of items) {
    value[item.processStatus] += 1;
    value[item.entityType] += 1;
    if (item.isOverdue) value.overdue += 1;
  }
  return value;
}

type WorkflowRouteStepRecord = {
  id: string;
  processName: string;
  status: string;
  position: number;
  sequenceGroup: number;
  stageGroup: string;
  standardMillisecondsPerUnit: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  remark: string | null;
  productTimeEntry: { remark: string | null } | null;
  executions: Array<{
    goodQty: number;
    endedAt: Date;
    employee: { name: string };
  }>;
};

type WorkflowRouteRecord = {
  id: string;
  status: string;
  version: number;
  templateName: string;
  templateVersion: number;
  productTimeProfileVersion: number | null;
  routeSource: string;
  confirmedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  productTimeProfile: { remark: string | null } | null;
  steps: WorkflowRouteStepRecord[];
};

function routeSteps(route: WorkflowRouteRecord, targetQuantity: number | null): WorkflowStepDTO[] {
  return route.steps.map(step => {
    const reportedGoodQuantity = step.executions.reduce((total, execution) => total + execution.goodQty, 0);
    const latestExecution = step.executions[0] || null;
    return {
      key: step.id,
      label: step.processName,
      state: step.status === 'completed' || step.status === 'skipped'
        ? 'done'
        : step.status === 'current'
          ? 'current'
          : 'pending',
      sequenceGroup: step.sequenceGroup,
      status: step.status as ProcessStepStatus,
      stageGroup: step.stageGroup as ProcessStageGroup,
      standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
      reportedGoodQuantity,
      remainingGoodQuantity: targetQuantity === null ? null : Math.max(0, targetQuantity - reportedGoodQuantity),
      startedAt: step.startedAt?.toISOString() || null,
      completedAt: step.completedAt?.toISOString() || null,
      remark: step.remark,
      productRemark: step.productTimeEntry?.remark || route.productTimeProfile?.remark || null,
      latestEmployeeName: latestExecution?.employee.name || null,
      latestReportedAt: latestExecution?.endedAt.toISOString() || null,
    };
  });
}

function routeState(route: WorkflowRouteRecord, mappedSteps: WorkflowStepDTO[]): {
  processStatus: WorkflowProcessStatus;
  currentStep: string;
  nextStep: string | null;
  closed: boolean;
} {
  const closed = route.status === 'completed'
    || (mappedSteps.length > 0 && mappedSteps.every(step => step.status === 'completed' || step.status === 'skipped'));
  const currentGroup = mappedSteps.filter(step => step.status === 'current');
  const firstPendingGroupNumber = mappedSteps.find(step => step.status === 'pending')?.sequenceGroup;
  const firstPendingGroup = mappedSteps.filter(step => (
    step.status === 'pending' && step.sequenceGroup === firstPendingGroupNumber
  ));
  const activeGroupNumber = currentGroup[0]?.sequenceGroup;
  const nextGroupNumber = mappedSteps.find(step => (
    step.status === 'pending'
    && (activeGroupNumber === undefined || (step.sequenceGroup || 0) > activeGroupNumber)
  ))?.sequenceGroup;
  const nextGroup = currentGroup.length > 0
    ? mappedSteps.filter(step => step.status === 'pending' && step.sequenceGroup === nextGroupNumber)
    : firstPendingGroup;
  return {
    processStatus: closed ? 'closed' : route.status === 'in_progress' ? 'processing' : 'waiting',
    currentStep: closed
      ? '全部工序完成'
      : currentGroup.length > 0
        ? currentGroup.map(step => step.label).join('、')
        : route.status === 'confirmed' && !route.startedAt
          ? '等待图纸下发'
          : '等待工序开始',
    nextStep: nextGroup.length > 0 ? nextGroup.map(step => step.label).join('、') : null,
    closed,
  };
}

function inWeekRange(value: Date | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = value.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

export type WorkflowCenterFilters = {
  keyword?: string;
  entityType?: WorkflowEntityType | 'all';
  status?: WorkflowProcessStatus | 'all';
  overdue?: boolean;
  batchId?: string;
  workOrderId?: string;
  weekScope?: WorkflowWeekScope;
};

export async function loadWorkflowCenter(filters: WorkflowCenterFilters = {}): Promise<{
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  templates: WorkflowTemplateDTO[];
}> {
  const now = Date.now();
  const currentWeek = chinaWeekRange(new Date());
  const nextWeekStart = new Date(currentWeek.start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeek = chinaWeekRange(nextWeekStart);
  const [issues, changes, productionBatches, standaloneProductionOrders] = await Promise.all([
    prisma.issue.findMany({
      where: { deletedAt: null },
      select: {
        id: true, sequence: true, title: true, type: true, priority: true, status: true, dueAt: true, updatedAt: true,
        assignee: { select: { username: true, displayName: true } },
        workOrder: { select: { code: true, specification: true, customerName: true } },
        activities: {
          select: { id: true, action: true, content: true, toStatus: true, createdAt: true, actor: { select: { username: true, displayName: true } } },
          orderBy: { createdAt: 'desc' }, take: 8,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.changeRequest.findMany({
      where: { deletedAt: null },
      select: {
        id: true, sequence: true, title: true, type: true, priority: true, status: true, dueAt: true, updatedAt: true,
        owner: { select: { username: true, displayName: true } },
        workOrder: { select: { code: true, specification: true, customerName: true } },
        activities: {
          select: { id: true, action: true, content: true, toStatus: true, createdAt: true, actor: { select: { username: true, displayName: true } } },
          orderBy: { createdAt: 'desc' }, take: 8,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.productionPlanBatch.findMany({
      where: { deletedAt: null, planOrder: { deletedAt: null } },
      select: {
        id: true,
        batchNo: true,
        quantity: true,
        weekStartDate: true,
        weekEndDate: true,
        plannedCompletionDate: true,
        releaseState: true,
        workOrderId: true,
        productTimeProfileVersion: true,
        unitMillisecondsSnapshot: true,
        releasedAt: true,
        activatedAt: true,
        createdAt: true,
        updatedAt: true,
        planOrder: {
          select: {
            id: true,
            customerName: true,
            salesperson: true,
            productName: true,
            specification: true,
            drawingLibraryItemId: true,
            planningUnitMilliseconds: true,
            priority: true,
            remark: true,
            drawingLibraryItem: {
              select: {
                _count: {
                  select: {
                    files: { where: { deletedAt: null, category: { code: 'drawing' } } },
                  },
                },
                productTimeProfiles: {
                  where: { status: 'published' },
                  orderBy: { version: 'desc' },
                  take: 1,
                  select: { entries: { select: { unitMilliseconds: true } } },
                },
              },
            },
          },
        },
        changes: {
          select: {
            id: true,
            action: true,
            reason: true,
            createdAt: true,
            actor: { select: { username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
        workOrder: {
          select: {
            id: true,
            code: true,
            stage: true,
            status: true,
            priority: true,
            productionOwner: true,
            remark: true,
            startedAt: true,
            completedAt: true,
            updatedAt: true,
            progressLogs: {
              select: { id: true, stage: true, remark: true, createdBy: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 8,
            },
            materialTask: {
              select: {
                status: true,
                completedAt: true,
                activities: {
                  select: {
                    id: true,
                    action: true,
                    content: true,
                    createdAt: true,
                    actor: { select: { username: true, displayName: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 8,
                },
              },
            },
            processRoute: {
              select: {
                id: true,
                status: true,
                version: true,
                templateName: true,
                templateVersion: true,
                productTimeProfileVersion: true,
                routeSource: true,
                confirmedAt: true,
                startedAt: true,
                completedAt: true,
                productTimeProfile: { select: { remark: true } },
                steps: {
                  select: {
                    id: true,
                    processName: true,
                    status: true,
                    position: true,
                    sequenceGroup: true,
                    stageGroup: true,
                    standardMillisecondsPerUnit: true,
                    startedAt: true,
                    completedAt: true,
                    remark: true,
                    productTimeEntry: { select: { remark: true } },
                    executions: {
                      where: { voidedAt: null },
                      select: { goodQty: true, endedAt: true, employee: { select: { name: true } } },
                      orderBy: { endedAt: 'desc' },
                    },
                  },
                  orderBy: { position: 'asc' },
                },
                activities: {
                  select: {
                    id: true,
                    action: true,
                    content: true,
                    createdAt: true,
                    actor: { select: { username: true, displayName: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 8,
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    }),
    prisma.workOrder.findMany({
      where: { deletedAt: null, planActive: true, productionPlanBatch: null },
      select: {
        id: true, code: true, specification: true, customerName: true, productName: true, priority: true, stage: true,
        status: true, plannedAt: true, deliveryDay: true, updatedAt: true, productionOwner: true, remark: true,
        productionTargetQty: true, weekStartDate: true, weekEndDate: true, drawingLibraryItemId: true,
        progressLogs: {
          select: { id: true, stage: true, remark: true, createdBy: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 8,
        },
        processRoute: {
          select: {
            id: true,
            status: true,
            version: true,
            templateName: true,
            templateVersion: true,
            productTimeProfileVersion: true,
            routeSource: true,
            confirmedAt: true,
            startedAt: true,
            completedAt: true,
            productTimeProfile: { select: { remark: true } },
            steps: {
              select: {
                id: true,
                processName: true,
                status: true,
                position: true,
                sequenceGroup: true,
                stageGroup: true,
                standardMillisecondsPerUnit: true,
                startedAt: true,
                completedAt: true,
                remark: true,
                productTimeEntry: { select: { remark: true } },
                executions: {
                  where: { voidedAt: null },
                  select: { goodQty: true, endedAt: true, employee: { select: { name: true } } },
                  orderBy: { endedAt: 'desc' },
                },
              },
              orderBy: { position: 'asc' },
            },
            activities: {
              select: {
                id: true,
                action: true,
                content: true,
                createdAt: true,
                actor: { select: { username: true, displayName: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 8,
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  ]);

  const issueLabels = ['待受理', '处理中', '待验证', '已关闭'];
  const changeLabels = ['草稿', '待评估', '执行中', '待验证', '已关闭'];
  const productionLabels = ['未发图', '在前端', '在后端', '已完成'];
  const items: WorkflowItemDTO[] = [];

  for (const issue of issues) {
    const status = issue.status as IssueStatus;
    const index = Math.max(0, ['pending', 'processing', 'verifying', 'closed'].indexOf(status));
    const closed = status === 'closed';
    const dueAt = issue.dueAt?.toISOString() || null;
    items.push({
      id: `issue:${issue.id}`, entityId: issue.id, entityType: 'issue', code: issueCode(issue.sequence), title: issue.title,
      subtitle: `${issueTypeLabels[issue.type as IssueType]} · ${issue.workOrder?.specification || issue.workOrder?.code || '未关联工单'}`,
      processStatus: processStatus(status, 'issue'), currentStep: issueStatusLabels[status], nextStep: nextLabel(issueLabels, index),
      priority: issue.priority as WorkflowItemDTO['priority'], owner: issue.assignee?.displayName || issue.assignee?.username || null,
      dueAt, updatedAt: issue.updatedAt.toISOString(), route: `/workspace/issues?issueId=${encodeURIComponent(issue.id)}`,
      sourceRoute: null, isOverdue: !closed && !!issue.dueAt && issue.dueAt.getTime() < now,
      steps: steps(issueLabels, index, closed),
      activities: issue.activities.map(item => activity(item.id, item.action, item.content || (item.toStatus ? `流转到${issueStatusLabels[item.toStatus as IssueStatus] || item.toStatus}` : '更新问题'), item.actor?.displayName || item.actor?.username, item.createdAt)),
    });
  }

  for (const change of changes) {
    const status = change.status as ChangeStatus;
    const index = Math.max(0, ['draft', 'assessing', 'implementing', 'verifying', 'closed'].indexOf(status));
    const closed = status === 'closed';
    const dueAt = change.dueAt?.toISOString() || null;
    items.push({
      id: `change:${change.id}`, entityId: change.id, entityType: 'change', code: changeCode(change.sequence), title: change.title,
      subtitle: `${changeTypeLabels[change.type as ChangeType]} · ${change.workOrder?.specification || change.workOrder?.code || '未关联工单'}`,
      processStatus: processStatus(status, 'change'), currentStep: changeStatusLabels[status], nextStep: nextLabel(changeLabels, index),
      priority: change.priority as WorkflowItemDTO['priority'], owner: change.owner?.displayName || change.owner?.username || null,
      dueAt, updatedAt: change.updatedAt.toISOString(), route: `/workspace/changes?changeId=${encodeURIComponent(change.id)}`,
      sourceRoute: null, isOverdue: !closed && !!change.dueAt && change.dueAt.getTime() < now,
      steps: steps(changeLabels, index, closed),
      activities: change.activities.map(item => activity(item.id, item.action, item.content || (item.toStatus ? `流转到${changeStatusLabels[item.toStatus as ChangeStatus] || item.toStatus}` : '更新变更'), item.actor?.displayName || item.actor?.username, item.createdAt)),
    });
  }

  for (const batch of productionBatches) {
    const order = batch.planOrder;
    const workOrder = batch.workOrder;
    const warehouseStatus = (workOrder?.materialTask?.status || 'not_created') as WarehouseMaterialStatus | 'not_created';
    const processRouteStatus = (workOrder?.processRoute?.status || 'not_created') as ProcessRouteStatus | 'not_created';
    const currentProcess = workOrder?.processRoute?.steps.find(step => step.status === 'current')
      || workOrder?.processRoute?.steps.find(step => step.status === 'pending')
      || [...(workOrder?.processRoute?.steps || [])].reverse().find(step => step.status === 'completed')
      || null;
    const publishedProfile = order.drawingLibraryItem?.productTimeProfiles[0] || null;
    const effectiveUnitMilliseconds = batch.unitMillisecondsSnapshot
      || (publishedProfile ? productTimeTotalMilliseconds(publishedProfile.entries) : null)
      || order.planningUnitMilliseconds;
    const facts = {
      releaseState: batch.releaseState as ProductionPlanReleaseState,
      drawingReady: (order.drawingLibraryItem?._count.files || 0) > 0,
      timeReady: Boolean(effectiveUnitMilliseconds),
      warehouseStatus,
      processStatus: processRouteStatus,
      currentProcessName: currentProcess?.processName || null,
      workOrderStartedAt: workOrder?.startedAt || null,
      workOrderCompletedAt: workOrder?.completedAt || null,
      processCompletedAt: workOrder?.processRoute?.completedAt || null,
    };
    const flow = resolvePlanningFlow(facts);
    const reportableRoute = workOrder?.processRoute?.routeSource === 'product_time_profile'
      && workOrder.processRoute.productTimeProfileVersion !== null
      ? workOrder.processRoute
      : null;
    const mappedRouteSteps = reportableRoute
      ? routeSteps(reportableRoute, batch.quantity)
      : [];
    const actualRouteState = reportableRoute && mappedRouteSteps.length > 0
      ? routeState(reportableRoute, mappedRouteSteps)
      : null;
    const flowSteps = actualRouteState
      ? mappedRouteSteps
      : planningFlowStepStates(facts).map((state, index): WorkflowStepDTO => ({
        key: String(index),
        label: PLANNING_FLOW_STEPS[index],
        state,
      }));
    const drawingRoute = order.drawingLibraryItemId
      ? `/drawing-library?itemId=${encodeURIComponent(order.drawingLibraryItemId)}`
      : `/drawing-library?create=1&customerName=${encodeURIComponent(order.customerName)}&specification=${encodeURIComponent(order.specification)}&productName=${encodeURIComponent(order.productName)}`;
    let targetRoute = `/weekly-plan-center?batchId=${encodeURIComponent(batch.id)}`;
    if (actualRouteState && workOrder?.id) {
      targetRoute = `/production?workOrderId=${encodeURIComponent(workOrder.id)}`;
    } else if (flow.status === 'missing_drawing') targetRoute = drawingRoute;
    else if (flow.status === 'missing_time' || flow.status === 'pending_process') {
      targetRoute = `/workspace/product-times${order.drawingLibraryItemId ? `?itemId=${encodeURIComponent(order.drawingLibraryItemId)}` : ''}`;
    } else if (flow.status === 'material_exception' || flow.status === 'pending_material') {
      targetRoute = `/workspace/warehouse${workOrder?.id ? `?workOrderId=${encodeURIComponent(workOrder.id)}` : ''}`;
    } else if (flow.status === 'production' || flow.status === 'pending_archive' || flow.status === 'completed') {
      targetRoute = workOrder?.id
        ? `/production?workOrderId=${encodeURIComponent(workOrder.id)}`
        : `/production?keyword=${encodeURIComponent(order.specification)}`;
    }
    const batchActivities = batch.changes.map(item => activity(
      item.id,
      item.action,
      item.reason || '更新生产计划批次',
      item.actor?.displayName || item.actor?.username,
      item.createdAt,
    ));
    const warehouseActivities = (workOrder?.materialTask?.activities || []).map(item => activity(
      item.id,
      item.action,
      item.content || '更新仓库配料状态',
      item.actor?.displayName || item.actor?.username,
      item.createdAt,
    ));
    const processActivities = (workOrder?.processRoute?.activities || []).map(item => activity(
      item.id,
      item.action,
      item.content || '更新产品工艺路线',
      item.actor?.displayName || item.actor?.username,
      item.createdAt,
    ));
    const progressActivities = (workOrder?.progressLogs || []).map(item => activity(
      item.id,
      'production_progress',
      item.remark || `生产状态更新为${stageText[normalizeWorkOrderStage(item.stage) || 'not_issued']}`,
      item.createdBy,
      item.createdAt,
    ));
    const productionActivities = dedupeProductionActivities([
      ...batchActivities,
      ...warehouseActivities,
      ...processActivities,
      ...progressActivities,
    ]).slice(0, 12);
    const closed = actualRouteState?.closed ?? flow.status === 'completed';
    items.push({
      id: `production-plan:${batch.id}`,
      entityId: batch.id,
      entityType: 'production',
      batchId: batch.id,
      workOrderId: workOrder?.id || null,
      code: order.specification,
      title: order.productName,
      subtitle: `${order.customerName} · 第 ${batch.batchNo} 批 · ${batch.quantity.toLocaleString()} 件`,
      processStatus: actualRouteState?.processStatus || flow.workflowStatus,
      currentStep: actualRouteState?.currentStep || flow.label,
      nextStep: actualRouteState?.nextStep ?? flow.nextStep,
      priority: order.priority === 'insert' || order.priority === 'urgent'
        ? 'urgent'
        : order.priority === 'high'
          ? 'high'
          : 'normal',
      owner: workOrder?.productionOwner || order.salesperson || null,
      dueAt: batch.plannedCompletionDate.toISOString(),
      updatedAt: new Date(Math.max(batch.updatedAt.getTime(), workOrder?.updatedAt.getTime() || 0)).toISOString(),
      route: targetRoute,
      sourceRoute: drawingRoute,
      isOverdue: !closed && batch.plannedCompletionDate.getTime() < now,
      quantity: batch.quantity,
      weekStartDate: batch.weekStartDate.toISOString(),
      weekEndDate: batch.weekEndDate.toISOString(),
      processRouteId: workOrder?.processRoute?.id || null,
      routeVersion: workOrder?.processRoute?.version ?? null,
      routeStatus: (workOrder?.processRoute?.status as ProcessRouteStatus | undefined) || null,
      routeSource: workOrder?.processRoute?.routeSource || null,
      productTimeProfileVersion: workOrder?.processRoute?.productTimeProfileVersion || batch.productTimeProfileVersion || null,
      productRemark: workOrder?.processRoute?.productTimeProfile?.remark || null,
      orderRemark: workOrder?.remark || order.remark || null,
      drawingLibraryItemId: order.drawingLibraryItemId,
      steps: flowSteps,
      activities: productionActivities,
    });
  }

  for (const order of standaloneProductionOrders) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const index = Math.max(0, ['not_issued', 'frontend', 'backend', 'completed'].indexOf(stage));
    const stageClosed = stage === 'completed';
    const dueAt = order.plannedAt?.toISOString() || null;
    const reportableRoute = order.processRoute?.routeSource === 'product_time_profile'
      && order.processRoute.productTimeProfileVersion !== null
      ? order.processRoute
      : null;
    const mappedRouteSteps = reportableRoute
      ? routeSteps(reportableRoute, order.productionTargetQty)
      : [];
    const actualRouteState = reportableRoute && mappedRouteSteps.length > 0
      ? routeState(reportableRoute, mappedRouteSteps)
      : null;
    const closed = actualRouteState?.closed ?? stageClosed;
    const targetRoute = order.processRoute?.routeSource === 'product_time_pending'
      ? `/workspace/product-times${order.drawingLibraryItemId ? `?itemId=${encodeURIComponent(order.drawingLibraryItemId)}` : ''}`
      : `/production?workOrderId=${encodeURIComponent(order.id)}`;
    items.push({
      id: `production:${order.id}`, entityId: order.id, entityType: 'production', workOrderId: order.id, code: order.specification || order.code,
      title: order.productName, subtitle: `${order.customerName || '客户未设置'} · 内部编号 ${order.code}`,
      processStatus: actualRouteState?.processStatus || processStatus(stage, 'production'),
      currentStep: actualRouteState?.currentStep || stageText[stage],
      nextStep: actualRouteState?.nextStep ?? nextLabel(productionLabels, index),
      priority: (order.priority === 'urgent' || order.priority === 'high' ? order.priority : 'normal'), owner: order.productionOwner,
      dueAt, updatedAt: order.updatedAt.toISOString(), route: targetRoute,
      sourceRoute: order.drawingLibraryItemId
        ? `/drawing-library?itemId=${encodeURIComponent(order.drawingLibraryItemId)}`
        : `/dashboard?workOrderId=${encodeURIComponent(order.id)}`,
      isOverdue: !closed && !!order.plannedAt && order.plannedAt.getTime() < now,
      quantity: order.productionTargetQty,
      weekStartDate: order.weekStartDate?.toISOString() || null,
      weekEndDate: order.weekEndDate?.toISOString() || null,
      processRouteId: order.processRoute?.id || null,
      routeVersion: order.processRoute?.version ?? null,
      routeStatus: (order.processRoute?.status as ProcessRouteStatus | undefined) || null,
      routeSource: order.processRoute?.routeSource || null,
      productTimeProfileVersion: order.processRoute?.productTimeProfileVersion ?? null,
      productRemark: order.processRoute?.productTimeProfile?.remark || null,
      orderRemark: order.remark || null,
      drawingLibraryItemId: order.drawingLibraryItemId,
      steps: actualRouteState
        ? mappedRouteSteps
        : steps(productionLabels, index, closed),
      activities: order.processRoute?.activities.length
        ? order.processRoute.activities.map(item => activity(
          item.id,
          item.action,
          item.content || '更新产品工序路线',
          item.actor?.displayName || item.actor?.username,
          item.createdAt,
        ))
        : order.progressLogs.map(item => activity(item.id, 'production_progress', item.remark || `进入${stageText[normalizeWorkOrderStage(item.stage) || stage]}`, item.createdBy, item.createdAt)),
    });
  }

  const allSummary = summary(items);
  const keyword = String(filters.keyword || '').trim().toLocaleLowerCase('zh-CN');
  const filtered = items.filter(item => {
    if (filters.entityType && filters.entityType !== 'all' && item.entityType !== filters.entityType) return false;
    if (filters.status && filters.status !== 'all' && item.processStatus !== filters.status) return false;
    if (filters.overdue && !item.isOverdue) return false;
    if (filters.weekScope && filters.weekScope !== 'all' && item.entityType === 'production') {
      const weekStart = item.weekStartDate ? new Date(item.weekStartDate) : null;
      const weekEnd = item.weekEndDate ? new Date(item.weekEndDate) : null;
      const inCurrentWeek = inWeekRange(weekStart, currentWeek.start, currentWeek.end)
        || inWeekRange(weekEnd, currentWeek.start, currentWeek.end);
      const inNextWeek = inWeekRange(weekStart, nextWeek.start, nextWeek.end)
        || inWeekRange(weekEnd, nextWeek.start, nextWeek.end);
      const beforeCurrentWeek = !!weekEnd && weekEnd.getTime() < currentWeek.start.getTime();
      if (filters.weekScope === 'current' && !inCurrentWeek) return false;
      if (filters.weekScope === 'next' && !inNextWeek) return false;
      if (filters.weekScope === 'carryover' && !(beforeCurrentWeek && item.processStatus !== 'closed')) return false;
      if (filters.weekScope === 'history' && !beforeCurrentWeek) return false;
    }
    if (keyword && !`${item.code} ${item.title} ${item.subtitle} ${item.owner || ''}`.toLocaleLowerCase('zh-CN').includes(keyword)) return false;
    return true;
  });
  const priorityRank = { urgent: 0, high: 1, normal: 2 } as const;
  filtered.sort((first, second) => Number(second.isOverdue) - Number(first.isOverdue)
    || Number(first.processStatus === 'closed') - Number(second.processStatus === 'closed')
    || priorityRank[first.priority] - priorityRank[second.priority]
    || new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime());
  const target = items.find(item => (
    (filters.batchId && item.batchId === filters.batchId)
    || (filters.workOrderId && item.workOrderId === filters.workOrderId)
  ));
  const result = target
    ? [target, ...filtered.filter(item => item.id !== target.id)]
    : filtered;
  return { items: result.slice(0, 300), summary: allSummary, templates: workflowTemplates };
}
