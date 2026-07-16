import { Prisma } from '@prisma/client';
import { isInvalidSpecification } from '@/lib/drawing-library';
import { getProductionAlerts, type ProductionAlert, type ProductionAlertCode } from '@/lib/production-alerts';
import { loadProductionOrders, resolveProductionWeek, type ProductionExecutionOrderRecord } from '@/lib/production-execution';
import { normalizeWorkOrderStage } from '@/lib/work-orders';
import { prisma } from '@/lib/prisma';
import type {
  DetectedIssueDTO,
  IssueDTO,
  IssuePriority,
  IssueStatus,
  IssueSummaryDTO,
  IssueType,
} from '@/types';

export const ISSUE_STATUSES: IssueStatus[] = ['pending', 'processing', 'verifying', 'closed'];
export const ISSUE_PRIORITIES: IssuePriority[] = ['urgent', 'high', 'normal'];
export const ISSUE_TYPES: IssueType[] = ['production', 'planning', 'technical', 'quality', 'material', 'equipment', 'other'];

export const issueStatusLabels: Record<IssueStatus, string> = {
  pending: '待受理',
  processing: '处理中',
  verifying: '待验证',
  closed: '已关闭',
};

export const issuePriorityLabels: Record<IssuePriority, string> = {
  urgent: '紧急',
  high: '高',
  normal: '一般',
};

export const issueTypeLabels: Record<IssueType, string> = {
  production: '生产问题',
  planning: '计划问题',
  technical: '技术问题',
  quality: '质量问题',
  material: '物料问题',
  equipment: '设备问题',
  other: '其他',
};

const issueUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  username: true,
  displayName: true,
});

export const issueDetailInclude = Prisma.validator<Prisma.IssueInclude>()({
  reporter: { select: issueUserSelect },
  assignee: { select: issueUserSelect },
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
    include: { actor: { select: issueUserSelect } },
    orderBy: { createdAt: 'asc' },
  },
  attachments: {
    where: { deletedAt: null },
    include: { uploadedBy: { select: issueUserSelect } },
    orderBy: { createdAt: 'desc' },
  },
});

export type IssueDetailRecord = Prisma.IssueGetPayload<{ include: typeof issueDetailInclude }>;

export type IssueInput = {
  title?: string;
  type?: IssueType;
  priority?: IssuePriority;
  description?: string | null;
  workOrderId?: string | null;
  assigneeId?: string | null;
  dueAt?: Date | null;
  rootCause?: string | null;
  solution?: string | null;
  verificationResult?: string | null;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
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

export function parseIssueInput(body: Record<string, unknown>, partial = false): { data: IssueInput; errors: string[] } {
  const data: IssueInput = {};
  const errors: string[] = [];

  if (!partial || body.title !== undefined) {
    const title = text(body.title, 160);
    if (!title || title.length < 2) errors.push('问题标题至少 2 个字符');
    else data.title = title;
  }
  if (!partial || body.type !== undefined) {
    const type = enumValue(body.type ?? 'production', ISSUE_TYPES);
    if (!type) errors.push('问题类型不正确');
    else data.type = type;
  }
  if (!partial || body.priority !== undefined) {
    const priority = enumValue(body.priority ?? 'normal', ISSUE_PRIORITIES);
    if (!priority) errors.push('优先级不正确');
    else data.priority = priority;
  }
  if (body.description !== undefined) data.description = text(body.description, 4000);
  if (body.rootCause !== undefined) data.rootCause = text(body.rootCause, 4000);
  if (body.solution !== undefined) data.solution = text(body.solution, 4000);
  if (body.verificationResult !== undefined) data.verificationResult = text(body.verificationResult, 4000);
  if (body.workOrderId !== undefined) data.workOrderId = text(body.workOrderId, 80);
  if (body.assigneeId !== undefined) data.assigneeId = text(body.assigneeId, 80);
  if (body.dueAt !== undefined) {
    const dueAt = dateValue(body.dueAt);
    if (dueAt === 'invalid') errors.push('截止时间格式不正确');
    else data.dueAt = dueAt;
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

export function issueCode(sequence: number): string {
  return `ISS-${String(sequence).padStart(6, '0')}`;
}

export function serializeIssue(issue: IssueDetailRecord): IssueDTO {
  const now = Date.now();
  return {
    id: issue.id,
    sequence: issue.sequence,
    code: issueCode(issue.sequence),
    title: issue.title,
    type: issue.type as IssueType,
    priority: issue.priority as IssuePriority,
    status: issue.status as IssueStatus,
    description: issue.description,
    sourceType: issue.sourceType,
    sourceId: issue.sourceId,
    sourceCode: issue.sourceCode,
    sourceRoute: issue.sourceRoute,
    sourceAlertCode: issue.sourceAlertCode,
    workOrderId: issue.workOrderId,
    reporter: issue.reporter,
    assignee: issue.assignee,
    workOrder: issue.workOrder ? {
      ...issue.workOrder,
      plannedAt: issue.workOrder.plannedAt?.toISOString() || null,
    } : null,
    dueAt: issue.dueAt?.toISOString() || null,
    rootCause: issue.rootCause,
    solution: issue.solution,
    verificationResult: issue.verificationResult,
    resolvedAt: issue.resolvedAt?.toISOString() || null,
    verifiedAt: issue.verifiedAt?.toISOString() || null,
    closedAt: issue.closedAt?.toISOString() || null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    isOverdue: issue.status !== 'closed' && !!issue.dueAt && issue.dueAt.getTime() < now,
    activityCount: issue.activities.length,
    attachmentCount: issue.attachments.length,
    activities: issue.activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      content: activity.content,
      fromStatus: activity.fromStatus as IssueStatus | null,
      toStatus: activity.toStatus as IssueStatus | null,
      actor: activity.actor,
      detail: simpleDetail(activity.detail),
      createdAt: activity.createdAt.toISOString(),
    })),
    attachments: issue.attachments.map(attachment => ({
      id: attachment.id,
      issueId: attachment.issueId,
      originalName: attachment.originalName,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      fileType: attachment.fileType,
      size: Number(attachment.size),
      uploadedBy: attachment.uploadedBy,
      createdAt: attachment.createdAt.toISOString(),
      contentUrl: `/api/issues/attachments/${attachment.id}/content`,
      downloadUrl: `/api/issues/attachments/${attachment.id}/download`,
    })),
  };
}

export async function loadIssueById(id: string): Promise<IssueDetailRecord | null> {
  return prisma.issue.findFirst({
    where: { id, deletedAt: null },
    include: issueDetailInclude,
  });
}

const allowedTransitions: Record<IssueStatus, IssueStatus[]> = {
  pending: ['processing'],
  processing: ['verifying'],
  verifying: ['processing', 'closed'],
  closed: ['processing'],
};

export function canTransitionIssue(from: IssueStatus, to: IssueStatus): boolean {
  return allowedTransitions[from]?.includes(to) || false;
}

export function transitionIssueData(
  issue: { status: string; solution: string | null; verificationResult: string | null },
  target: IssueStatus,
  body: Record<string, unknown>,
  now = new Date(),
): { data: Prisma.IssueUpdateInput; error: string | null } {
  const current = issue.status as IssueStatus;
  if (!ISSUE_STATUSES.includes(current) || !canTransitionIssue(current, target)) {
    return { data: {}, error: `不能从“${issueStatusLabels[current] || current}”流转到“${issueStatusLabels[target]}”` };
  }
  const solution = text(body.solution, 4000) ?? issue.solution;
  const verificationResult = text(body.verificationResult, 4000) ?? issue.verificationResult;
  if (target === 'verifying' && !solution) return { data: {}, error: '提交验证前请填写处理方案' };
  if (target === 'closed' && !verificationResult) return { data: {}, error: '关闭问题前请填写验证结果' };

  const data: Prisma.IssueUpdateInput = { status: target };
  if (body.solution !== undefined) data.solution = solution;
  if (body.verificationResult !== undefined) data.verificationResult = verificationResult;
  if (body.rootCause !== undefined) data.rootCause = text(body.rootCause, 4000);
  if (target === 'verifying') data.resolvedAt = now;
  if (target === 'closed') {
    data.verifiedAt = now;
    data.closedAt = now;
  }
  if (target === 'processing') {
    data.resolvedAt = null;
    data.verifiedAt = null;
    data.closedAt = null;
  }
  return { data, error: null };
}

export async function summarizeIssues(): Promise<IssueSummaryDTO> {
  const [groups, overdue, unassigned] = await Promise.all([
    prisma.issue.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.issue.count({ where: { deletedAt: null, status: { not: 'closed' }, dueAt: { lt: new Date() } } }),
    prisma.issue.count({ where: { deletedAt: null, status: { not: 'closed' }, assigneeId: null } }),
  ]);
  const counts: IssueSummaryDTO = { total: 0, pending: 0, processing: 0, verifying: 0, closed: 0, overdue, unassigned };
  for (const group of groups) {
    const count = group._count._all;
    counts.total += count;
    if (ISSUE_STATUSES.includes(group.status as IssueStatus)) counts[group.status as IssueStatus] = count;
  }
  return counts;
}

export function issueFingerprint(workOrderId: string, alertCode: ProductionAlertCode): string {
  return `production_alert:${workOrderId}:${alertCode}`;
}

export function priorityForAlert(alert: ProductionAlert): IssuePriority {
  if (alert.tone === 'red') return 'urgent';
  if (alert.tone === 'orange' || alert.tone === 'amber') return 'high';
  return 'normal';
}

export function typeForAlert(code: ProductionAlertCode): IssueType {
  if (code === 'MATERIAL_NOT_READY') return 'material';
  if (code === 'SPECIFICATION_INVALID' || code.includes('DRAWING') || code.includes('CONFIRMATION')) return 'technical';
  if (code === 'REWORK') return 'quality';
  return 'production';
}

export function alertsForProductionOrder(order: ProductionExecutionOrderRecord, now = new Date()): ProductionAlert[] {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    specificationInvalid: !String(order.specification || '').trim() || isInvalidSpecification(order.specification || ''),
    drawingStatus: order.drawingStatus,
    materialStatus: order.materialStatus,
    latestProgressRemark: order.latestProgressRemark,
    plannedAt: order.plannedAt,
  }, now);
}

function detectedIssue(order: ProductionExecutionOrderRecord, alert: ProductionAlert): DetectedIssueDTO {
  const specification = order.specification?.trim() || order.code;
  const fingerprint = issueFingerprint(order.id, alert.code);
  const params = new URLSearchParams({ view: 'exceptions', keyword: specification });
  return {
    id: fingerprint,
    fingerprint,
    alertCode: alert.code,
    label: alert.label,
    tone: alert.tone,
    workOrderId: order.id,
    workOrderCode: order.code,
    specification: order.specification,
    customerName: order.customerName,
    productName: order.productName,
    sourceRoute: `/production?${params.toString()}`,
  };
}

export async function loadDetectedIssues(now = new Date()): Promise<DetectedIssueDTO[]> {
  const week = await resolveProductionWeek();
  const orders = await loadProductionOrders(week);
  const detected = orders.flatMap(order => alertsForProductionOrder(order, now).map(alert => detectedIssue(order, alert)));
  if (!detected.length) return [];
  const existing = await prisma.issue.findMany({
    where: { sourceFingerprint: { in: detected.map(item => item.fingerprint) }, deletedAt: null },
    select: { id: true, status: true, sourceFingerprint: true },
  });
  const existingByFingerprint = new Map(existing.map(item => [item.sourceFingerprint, item]));
  return detected.map(item => {
    const match = existingByFingerprint.get(item.fingerprint);
    return {
      ...item,
      existingIssueId: match?.id || null,
      existingIssueStatus: match?.status as IssueStatus | null || null,
    };
  });
}
