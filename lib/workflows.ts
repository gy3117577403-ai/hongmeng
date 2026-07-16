import { prisma } from '@/lib/prisma';
import { changeCode, changeStatusLabels, changeTypeLabels } from '@/lib/changes';
import { issueCode, issueStatusLabels, issueTypeLabels } from '@/lib/issues';
import { normalizeWorkOrderStage, stageText } from '@/lib/work-orders';
import type {
  ChangeStatus,
  ChangeType,
  IssueStatus,
  IssueType,
  WorkflowActivityDTO,
  WorkflowEntityType,
  WorkflowItemDTO,
  WorkflowProcessStatus,
  WorkflowStepDTO,
  WorkflowSummaryDTO,
  WorkflowTemplateDTO,
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
    description: '当前启用工单从图纸准备到前后端生产及完成归档。',
    steps: ['未发图', '在前端', '在后端', '已完成'],
    route: '/production',
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

export type WorkflowCenterFilters = {
  keyword?: string;
  entityType?: WorkflowEntityType | 'all';
  status?: WorkflowProcessStatus | 'all';
  overdue?: boolean;
};

export async function loadWorkflowCenter(filters: WorkflowCenterFilters = {}): Promise<{
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  templates: WorkflowTemplateDTO[];
}> {
  const now = Date.now();
  const [issues, changes, productionOrders] = await Promise.all([
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
    prisma.workOrder.findMany({
      where: { deletedAt: null, planActive: true },
      select: {
        id: true, code: true, specification: true, customerName: true, productName: true, priority: true, stage: true,
        status: true, plannedAt: true, deliveryDay: true, updatedAt: true, productionOwner: true,
        progressLogs: {
          select: { id: true, stage: true, remark: true, createdBy: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 8,
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

  for (const order of productionOrders) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const index = Math.max(0, ['not_issued', 'frontend', 'backend', 'completed'].indexOf(stage));
    const closed = stage === 'completed';
    const dueAt = order.plannedAt?.toISOString() || null;
    items.push({
      id: `production:${order.id}`, entityId: order.id, entityType: 'production', code: order.specification || order.code,
      title: order.productName, subtitle: `${order.customerName || '客户未设置'} · 内部编号 ${order.code}`,
      processStatus: processStatus(stage, 'production'), currentStep: stageText[stage], nextStep: nextLabel(productionLabels, index),
      priority: (order.priority === 'urgent' || order.priority === 'high' ? order.priority : 'normal'), owner: order.productionOwner,
      dueAt, updatedAt: order.updatedAt.toISOString(), route: `/production?keyword=${encodeURIComponent(order.specification || order.code)}`,
      sourceRoute: `/dashboard?workOrderId=${encodeURIComponent(order.id)}`, isOverdue: !closed && !!order.plannedAt && order.plannedAt.getTime() < now,
      steps: steps(productionLabels, index, closed),
      activities: order.progressLogs.map(item => activity(item.id, 'production_progress', item.remark || `进入${stageText[normalizeWorkOrderStage(item.stage) || stage]}`, item.createdBy, item.createdAt)),
    });
  }

  const allSummary = summary(items);
  const keyword = String(filters.keyword || '').trim().toLocaleLowerCase('zh-CN');
  const filtered = items.filter(item => {
    if (filters.entityType && filters.entityType !== 'all' && item.entityType !== filters.entityType) return false;
    if (filters.status && filters.status !== 'all' && item.processStatus !== filters.status) return false;
    if (filters.overdue && !item.isOverdue) return false;
    if (keyword && !`${item.code} ${item.title} ${item.subtitle} ${item.owner || ''}`.toLocaleLowerCase('zh-CN').includes(keyword)) return false;
    return true;
  });
  const priorityRank = { urgent: 0, high: 1, normal: 2 } as const;
  filtered.sort((first, second) => Number(second.isOverdue) - Number(first.isOverdue)
    || Number(first.processStatus === 'closed') - Number(second.processStatus === 'closed')
    || priorityRank[first.priority] - priorityRank[second.priority]
    || new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime());
  return { items: filtered.slice(0, 300), summary: allSummary, templates: workflowTemplates };
}
