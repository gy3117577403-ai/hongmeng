import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  ChangeImpactArea,
  ChangePriority,
  ChangeRequestDTO,
  ChangeStatus,
  ChangeSummaryDTO,
  ChangeType,
  IssueStatus,
} from '@/types';

export const CHANGE_STATUSES: ChangeStatus[] = ['draft', 'assessing', 'implementing', 'verifying', 'closed'];
export const CHANGE_PRIORITIES: ChangePriority[] = ['urgent', 'high', 'normal'];
export const CHANGE_TYPES: ChangeType[] = ['drawing', 'process', 'plan', 'material', 'document', 'other'];
export const CHANGE_IMPACT_AREAS: ChangeImpactArea[] = ['drawing', 'process', 'plan', 'material', 'document', 'production'];

export const changeStatusLabels: Record<ChangeStatus, string> = {
  draft: '草稿', assessing: '待评估', implementing: '执行中', verifying: '待验证', closed: '已关闭',
};

export const changePriorityLabels: Record<ChangePriority, string> = {
  urgent: '紧急', high: '高', normal: '一般',
};

export const changeTypeLabels: Record<ChangeType, string> = {
  drawing: '图纸变更', process: '工艺变更', plan: '计划变更', material: '物料变更', document: '资料变更', other: '其他变更',
};

export const changeImpactAreaLabels: Record<ChangeImpactArea, string> = {
  drawing: '图纸', process: '工艺', plan: '计划', material: '物料', document: '资料', production: '生产',
};

const changeUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  username: true,
  displayName: true,
});

export const changeDetailInclude = Prisma.validator<Prisma.ChangeRequestInclude>()({
  requester: { select: changeUserSelect },
  owner: { select: changeUserSelect },
  sourceIssue: { select: { id: true, sequence: true, title: true, status: true } },
  workOrder: {
    select: {
      id: true,
      code: true,
      specification: true,
      customerName: true,
      productName: true,
      stage: true,
      drawingStatus: true,
      materialStatus: true,
      plannedAt: true,
    },
  },
  activities: {
    include: { actor: { select: changeUserSelect } },
    orderBy: { createdAt: 'asc' },
  },
  attachments: {
    where: { deletedAt: null },
    include: { uploadedBy: { select: changeUserSelect } },
    orderBy: { createdAt: 'desc' },
  },
});

export type ChangeDetailRecord = Prisma.ChangeRequestGetPayload<{ include: typeof changeDetailInclude }>;

export type ChangeInput = {
  title?: string;
  type?: ChangeType;
  priority?: ChangePriority;
  reason?: string | null;
  description?: string | null;
  impactAreas?: ChangeImpactArea[];
  impactScope?: string | null;
  implementationPlan?: string | null;
  implementationResult?: string | null;
  validationResult?: string | null;
  rollbackPlan?: string | null;
  sourceIssueId?: string | null;
  workOrderId?: string | null;
  ownerId?: string | null;
  dueAt?: Date | null;
  effectiveAt?: Date | null;
};

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\r\n/g, '\n');
  return normalized ? normalized.slice(0, max) : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

function dateValue(value: unknown): Date | null | 'invalid' {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

export function parseChangeInput(body: Record<string, unknown>, partial = false): { data: ChangeInput; errors: string[] } {
  const data: ChangeInput = {};
  const errors: string[] = [];

  if (!partial || body.title !== undefined) {
    const title = text(body.title, 160);
    if (!title || title.length < 2) errors.push('变更标题至少 2 个字符');
    else data.title = title;
  }
  if (!partial || body.type !== undefined) {
    const type = enumValue(body.type ?? 'drawing', CHANGE_TYPES);
    if (!type) errors.push('变更类型不正确');
    else data.type = type;
  }
  if (!partial || body.priority !== undefined) {
    const priority = enumValue(body.priority ?? 'normal', CHANGE_PRIORITIES);
    if (!priority) errors.push('优先级不正确');
    else data.priority = priority;
  }
  if (body.reason !== undefined) data.reason = text(body.reason, 4000);
  if (body.description !== undefined) data.description = text(body.description, 4000);
  if (body.impactScope !== undefined) data.impactScope = text(body.impactScope, 4000);
  if (body.implementationPlan !== undefined) data.implementationPlan = text(body.implementationPlan, 6000);
  if (body.implementationResult !== undefined) data.implementationResult = text(body.implementationResult, 6000);
  if (body.validationResult !== undefined) data.validationResult = text(body.validationResult, 6000);
  if (body.rollbackPlan !== undefined) data.rollbackPlan = text(body.rollbackPlan, 4000);
  if (body.sourceIssueId !== undefined) data.sourceIssueId = text(body.sourceIssueId, 80);
  if (body.workOrderId !== undefined) data.workOrderId = text(body.workOrderId, 80);
  if (body.ownerId !== undefined) data.ownerId = text(body.ownerId, 80);
  if (body.impactAreas !== undefined) {
    if (!Array.isArray(body.impactAreas)) errors.push('影响区域格式不正确');
    else {
      const areas = [...new Set(body.impactAreas.filter(item => typeof item === 'string'))]
        .filter(item => CHANGE_IMPACT_AREAS.includes(item as ChangeImpactArea)) as ChangeImpactArea[];
      if (areas.length !== body.impactAreas.length) errors.push('影响区域包含不支持的值');
      else data.impactAreas = areas;
    }
  }
  if (body.dueAt !== undefined) {
    const dueAt = dateValue(body.dueAt);
    if (dueAt === 'invalid') errors.push('截止时间格式不正确');
    else data.dueAt = dueAt;
  }
  if (body.effectiveAt !== undefined) {
    const effectiveAt = dateValue(body.effectiveAt);
    if (effectiveAt === 'invalid') errors.push('计划生效时间格式不正确');
    else data.effectiveAt = effectiveAt;
  }
  return { data, errors };
}

function simpleDetail(value: Prisma.JsonValue | null): Record<string, string | number | boolean | null> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') output[key] = item;
  }
  return Object.keys(output).length ? output : null;
}

export function changeCode(sequence: number): string {
  return `CHG-${String(sequence).padStart(6, '0')}`;
}

export function serializeChange(change: ChangeDetailRecord): ChangeRequestDTO {
  const now = Date.now();
  return {
    id: change.id,
    sequence: change.sequence,
    code: changeCode(change.sequence),
    title: change.title,
    type: change.type as ChangeType,
    priority: change.priority as ChangePriority,
    status: change.status as ChangeStatus,
    reason: change.reason,
    description: change.description,
    impactAreas: change.impactAreas as ChangeImpactArea[],
    impactScope: change.impactScope,
    implementationPlan: change.implementationPlan,
    implementationResult: change.implementationResult,
    validationResult: change.validationResult,
    rollbackPlan: change.rollbackPlan,
    sourceIssueId: change.sourceIssueId,
    sourceIssue: change.sourceIssue ? {
      id: change.sourceIssue.id,
      code: `ISS-${String(change.sourceIssue.sequence).padStart(6, '0')}`,
      title: change.sourceIssue.title,
      status: change.sourceIssue.status as IssueStatus,
    } : null,
    workOrderId: change.workOrderId,
    workOrder: change.workOrder ? {
      ...change.workOrder,
      plannedAt: change.workOrder.plannedAt?.toISOString() || null,
    } : null,
    requester: change.requester,
    owner: change.owner,
    dueAt: change.dueAt?.toISOString() || null,
    effectiveAt: change.effectiveAt?.toISOString() || null,
    version: change.version,
    closedAt: change.closedAt?.toISOString() || null,
    createdAt: change.createdAt.toISOString(),
    updatedAt: change.updatedAt.toISOString(),
    isOverdue: change.status !== 'closed' && !!change.dueAt && change.dueAt.getTime() < now,
    activityCount: change.activities.length,
    attachmentCount: change.attachments.length,
    activities: change.activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      content: activity.content,
      fromStatus: activity.fromStatus as ChangeStatus | null,
      toStatus: activity.toStatus as ChangeStatus | null,
      actor: activity.actor,
      detail: simpleDetail(activity.detail),
      createdAt: activity.createdAt.toISOString(),
    })),
    attachments: change.attachments.map(attachment => ({
      id: attachment.id,
      changeRequestId: attachment.changeRequestId,
      originalName: attachment.originalName,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      fileType: attachment.fileType,
      size: Number(attachment.size),
      uploadedBy: attachment.uploadedBy,
      createdAt: attachment.createdAt.toISOString(),
      contentUrl: `/api/changes/attachments/${attachment.id}/content`,
      downloadUrl: `/api/changes/attachments/${attachment.id}/download`,
    })),
  };
}

export async function loadChangeById(id: string): Promise<ChangeDetailRecord | null> {
  return prisma.changeRequest.findFirst({ where: { id, deletedAt: null }, include: changeDetailInclude });
}

const allowedTransitions: Record<ChangeStatus, ChangeStatus[]> = {
  draft: ['assessing'],
  assessing: ['draft', 'implementing'],
  implementing: ['verifying'],
  verifying: ['implementing', 'closed'],
  closed: ['assessing'],
};

export function canTransitionChange(from: ChangeStatus, to: ChangeStatus): boolean {
  return allowedTransitions[from]?.includes(to) || false;
}

export function transitionChangeData(
  change: {
    status: string;
    reason: string | null;
    impactAreas: string[];
    impactScope: string | null;
    implementationPlan: string | null;
    implementationResult: string | null;
    validationResult: string | null;
  },
  target: ChangeStatus,
  body: Record<string, unknown>,
  now = new Date(),
): { data: Prisma.ChangeRequestUncheckedUpdateInput; error: string | null } {
  const current = change.status as ChangeStatus;
  if (!CHANGE_STATUSES.includes(current) || !canTransitionChange(current, target)) {
    return { data: {}, error: `不能从${changeStatusLabels[current] || current}流转到${changeStatusLabels[target]}` };
  }
  const reason = text(body.reason, 4000) ?? change.reason;
  const impactScope = text(body.impactScope, 4000) ?? change.impactScope;
  const requestedAreas = Array.isArray(body.impactAreas)
    ? [...new Set(body.impactAreas.filter(item => typeof item === 'string'))]
      .filter(item => CHANGE_IMPACT_AREAS.includes(item as ChangeImpactArea)) as ChangeImpactArea[]
    : null;
  const impactAreas = requestedAreas ?? change.impactAreas;
  const implementationPlan = text(body.implementationPlan, 6000) ?? change.implementationPlan;
  const implementationResult = text(body.implementationResult, 6000) ?? change.implementationResult;
  const validationResult = text(body.validationResult, 6000) ?? change.validationResult;
  if (target === 'assessing' && (!reason || !impactScope || !impactAreas.length)) {
    return { data: {}, error: '提交评估前必须填写变更原因、影响区域和影响范围' };
  }
  if (target === 'implementing' && !implementationPlan) {
    return { data: {}, error: '进入执行前必须填写实施方案' };
  }
  if (target === 'verifying' && !implementationResult) {
    return { data: {}, error: '提交验证前必须填写实施结果' };
  }
  if (target === 'closed' && !validationResult) {
    return { data: {}, error: '关闭变更前必须填写验证结果' };
  }
  return {
    data: {
      status: target,
      reason,
      ...(requestedAreas ? { impactAreas: requestedAreas } : {}),
      impactScope,
      implementationPlan,
      implementationResult,
      validationResult,
      closedAt: target === 'closed' ? now : null,
      version: { increment: 1 },
    },
    error: null,
  };
}

export function changeSnapshot(change: {
  title: string;
  type: string;
  priority: string;
  status: string;
  reason: string | null;
  impactAreas: string[];
  impactScope: string | null;
  implementationPlan: string | null;
  implementationResult: string | null;
  validationResult: string | null;
  rollbackPlan: string | null;
  sourceIssueId: string | null;
  workOrderId: string | null;
  ownerId: string | null;
  dueAt: Date | null;
  effectiveAt: Date | null;
  version: number;
}): Prisma.InputJsonObject {
  return {
    title: change.title,
    type: change.type,
    priority: change.priority,
    status: change.status,
    reason: change.reason,
    impactAreas: change.impactAreas,
    impactScope: change.impactScope,
    implementationPlan: change.implementationPlan,
    implementationResult: change.implementationResult,
    validationResult: change.validationResult,
    rollbackPlan: change.rollbackPlan,
    sourceIssueId: change.sourceIssueId,
    workOrderId: change.workOrderId,
    ownerId: change.ownerId,
    dueAt: change.dueAt?.toISOString() || null,
    effectiveAt: change.effectiveAt?.toISOString() || null,
    version: change.version,
  };
}

export async function summarizeChanges(): Promise<ChangeSummaryDTO> {
  const where: Prisma.ChangeRequestWhereInput = { deletedAt: null };
  const [total, grouped, overdue, unassigned] = await Promise.all([
    prisma.changeRequest.count({ where }),
    prisma.changeRequest.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.changeRequest.count({ where: { ...where, status: { not: 'closed' }, dueAt: { lt: new Date() } } }),
    prisma.changeRequest.count({ where: { ...where, status: { not: 'closed' }, ownerId: null } }),
  ]);
  const counts: Record<ChangeStatus, number> = { draft: 0, assessing: 0, implementing: 0, verifying: 0, closed: 0 };
  for (const group of grouped) {
    if (CHANGE_STATUSES.includes(group.status as ChangeStatus)) counts[group.status as ChangeStatus] = group._count._all;
  }
  return { total, ...counts, overdue, unassigned };
}
