import { Prisma } from '@prisma/client';
import { isInvalidSpecification } from '@/lib/drawing-library';
import { getProductionAlerts, type ProductionAlert, type ProductionAlertCode } from '@/lib/production-alerts';
import {
  hasRequiredProductionDocuments,
  loadProductionOrders,
  resolveProductionWeek,
  type ProductionExecutionOrderRecord,
} from '@/lib/production-execution';
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
export const ISSUE_TYPES: IssueType[] = ['production', 'planning', 'technical', 'process', 'quality', 'material', 'equipment', 'other'];

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
  process: '工艺问题',
  quality: '质量问题',
  material: '物料问题',
  equipment: '设备问题',
  other: '其他',
};

export function issueAttachmentMutationLock(
  status: string,
  approvalStatuses: readonly string[],
): 'approval_pending' | 'final_approved' | null {
  if (approvalStatuses.some(approvalStatus =>
    approvalStatus === 'PENDING_QUALITY_REVIEW' || approvalStatus === 'PENDING_GM_APPROVAL')) {
    return 'approval_pending';
  }
  if (status === 'closed' && approvalStatuses.includes('APPROVED')) return 'final_approved';
  return null;
}

const issueUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  username: true,
  displayName: true,
});

const issueEmployeeSelect = Prisma.validator<Prisma.EmployeeSelect>()({
  id: true,
  employeeNo: true,
  name: true,
  department: true,
  position: true,
  team: true,
  isActive: true,
});

const issueLegacyAssigneeSelect = Prisma.validator<Prisma.UserSelect>()({
  ...issueUserSelect,
  isActive: true,
  employee: { select: issueEmployeeSelect },
});

export const issueDetailInclude = Prisma.validator<Prisma.IssueInclude>()({
  reporter: { select: issueUserSelect },
  assignee: { select: issueLegacyAssigneeSelect },
  assigneeEmployee: { select: issueEmployeeSelect },
  verifierEmployee: { select: issueEmployeeSelect },
  collaborators: {
    include: { employee: { select: issueEmployeeSelect } },
    orderBy: { createdAt: 'asc' },
  },
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
  majorApprovals: {
    include: {
      submittedBy: { select: issueUserSelect },
      qualityReviewedBy: { select: issueUserSelect },
      finalReviewedBy: { select: issueUserSelect },
    },
    orderBy: { round: 'desc' },
    take: 1,
  },
});

export type IssueDetailRecord = Prisma.IssueGetPayload<{ include: typeof issueDetailInclude }>;

export type IssueInput = {
  title?: string;
  type?: IssueType;
  priority?: IssuePriority;
  description?: string | null;
  workOrderId?: string | null;
  assigneeEmployeeId?: string | null;
  verifierEmployeeId?: string | null;
  collaboratorEmployeeIds?: string[];
  dueAt?: Date | null;
  processName?: string | null;
  affectedQuantity?: number | null;
  temporaryMeasure?: string | null;
  rootCause?: string | null;
  solution?: string | null;
  verificationResult?: string | null;
  isMajorQuality?: boolean;
  majorQualityReason?: string | null;
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

function nonNegativeInteger(value: unknown): number | null | 'invalid' {
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000_000 ? parsed : 'invalid';
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
  if (body.isMajorQuality !== undefined) {
    if (typeof body.isMajorQuality !== 'boolean') errors.push('重大质量标记格式不正确');
    else data.isMajorQuality = body.isMajorQuality;
  }
  if (body.majorQualityReason !== undefined) data.majorQualityReason = text(body.majorQualityReason, 1000);
  if (body.workOrderId !== undefined) data.workOrderId = text(body.workOrderId, 80);
  const assigneeEmployeeId = body.assigneeEmployeeId !== undefined ? body.assigneeEmployeeId : body.assigneeId;
  if (assigneeEmployeeId !== undefined) data.assigneeEmployeeId = text(assigneeEmployeeId, 80);
  if (body.verifierEmployeeId !== undefined) data.verifierEmployeeId = text(body.verifierEmployeeId, 80);
  if (body.collaboratorEmployeeIds !== undefined) {
    if (!Array.isArray(body.collaboratorEmployeeIds)) errors.push('协同人员格式不正确');
    else {
      const ids = Array.from(new Set(body.collaboratorEmployeeIds
        .map(value => text(value, 80))
        .filter((value): value is string => !!value)));
      if (ids.length > 20) errors.push('协同人员最多选择 20 人');
      else data.collaboratorEmployeeIds = ids;
    }
  }
  if (body.processName !== undefined) data.processName = text(body.processName, 120);
  if (body.temporaryMeasure !== undefined) data.temporaryMeasure = text(body.temporaryMeasure, 2000);
  if (body.affectedQuantity !== undefined) {
    const affectedQuantity = nonNegativeInteger(body.affectedQuantity);
    if (affectedQuantity === 'invalid') errors.push('影响数量必须是非负整数');
    else data.affectedQuantity = affectedQuantity;
  }
  if (body.dueAt !== undefined) {
    const dueAt = dateValue(body.dueAt);
    if (dueAt === 'invalid') errors.push('截止时间格式不正确');
    else data.dueAt = dueAt;
  }

  return { data, errors };
}

export function validateMajorQualityInput(input: {
  type: string;
  isMajorQuality: boolean;
  majorQualityReason?: string | null;
}): string | null {
  if (!input.isMajorQuality) return null;
  if (input.type !== 'quality') return '只有质量问题可以标记为重大质量事项';
  if (!String(input.majorQualityReason || '').trim()) return '重大质量事项必须填写重大判定原因';
  return null;
}

export const ISSUE_COLLABORATION_KINDS = [
  'comment',
  'task',
  'task_complete',
  'decision',
  'decision_response',
] as const;

export type IssueCollaborationKind = typeof ISSUE_COLLABORATION_KINDS[number];

export type IssueCollaborationInput = {
  kind: IssueCollaborationKind;
  content?: string | null;
  assigneeEmployeeId?: string | null;
  dueAt?: Date | null;
  targetActivityId?: string | null;
  decision?: 'approve' | 'return' | null;
};

export function parseIssueCollaborationInput(body: Record<string, unknown>): {
  data: IssueCollaborationInput | null;
  errors: string[];
} {
  const errors: string[] = [];
  const kind = enumValue(body.kind ?? 'comment', ISSUE_COLLABORATION_KINDS);
  if (!kind) return { data: null, errors: ['协同记录类型不正确'] };

  const content = text(body.content, 2000);
  const assigneeEmployeeId = text(body.assigneeEmployeeId, 80);
  const targetActivityId = text(body.targetActivityId, 80);
  const decision = enumValue(body.decision, ['approve', 'return'] as const);
  let dueAt: Date | null = null;
  if (body.dueAt !== undefined) {
    const parsed = dateValue(body.dueAt);
    if (parsed === 'invalid') errors.push('截止时间格式不正确');
    else dueAt = parsed;
  }

  if (kind === 'comment' && !content) errors.push('协同回复不能为空');
  if (kind === 'task') {
    if (!content) errors.push('待办内容不能为空');
    if (!assigneeEmployeeId) errors.push('请选择待办负责人');
  }
  if (kind === 'decision' && !content) errors.push('决策事项不能为空');
  if ((kind === 'task_complete' || kind === 'decision_response') && !targetActivityId) {
    errors.push('目标协同记录不存在');
  }
  if (kind === 'decision_response' && !decision) errors.push('请选择通过或退回');

  return {
    data: errors.length ? null : {
      kind,
      content,
      assigneeEmployeeId,
      dueAt,
      targetActivityId,
      decision,
    },
    errors,
  };
}

export function issueVerificationBlockers(input: {
  assigneeEmployeeId?: string | null;
  verifierEmployeeId?: string | null;
  rootCause?: string | null;
  solution?: string | null;
  attachmentCount: number;
  isMajorQuality?: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!input.assigneeEmployeeId) blockers.push('未指定负责人');
  if (!String(input.rootCause || '').trim()) blockers.push('未填写原因分析');
  if (!String(input.solution || '').trim()) blockers.push('未填写处理方案');
  if (input.attachmentCount < 1) blockers.push('未上传处理证据');
  if (!input.isMajorQuality && !input.verifierEmployeeId) blockers.push('未指定验证人');
  return blockers;
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
  const majorApproval = issue.majorApprovals[0] || null;
  const assigneeEmployee = issue.assigneeEmployee || issue.assignee?.employee || null;
  const assignee = assigneeEmployee
    ? {
        id: assigneeEmployee.id,
        employeeNo: assigneeEmployee.employeeNo,
        name: assigneeEmployee.name,
        displayName: assigneeEmployee.name,
        username: assigneeEmployee.employeeNo,
        department: assigneeEmployee.department,
        position: assigneeEmployee.position,
        team: assigneeEmployee.team,
        isActive: assigneeEmployee.isActive,
      }
    : issue.assignee
      ? {
          id: issue.assignee.id,
          employeeNo: issue.assignee.username,
          name: issue.assignee.displayName,
          displayName: issue.assignee.displayName,
          username: issue.assignee.username,
          department: null,
          position: null,
          team: null,
          isActive: issue.assignee.isActive,
        }
      : null;
  const verifier = issue.verifierEmployee
    ? {
        id: issue.verifierEmployee.id,
        employeeNo: issue.verifierEmployee.employeeNo,
        name: issue.verifierEmployee.name,
        displayName: issue.verifierEmployee.name,
        username: issue.verifierEmployee.employeeNo,
        department: issue.verifierEmployee.department,
        position: issue.verifierEmployee.position,
        team: issue.verifierEmployee.team,
        isActive: issue.verifierEmployee.isActive,
      }
    : null;
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
    assignee,
    verifier,
    collaborators: issue.collaborators.map(({ employee }) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: employee.name,
      displayName: employee.name,
      username: employee.employeeNo,
      department: employee.department,
      position: employee.position,
      team: employee.team,
      isActive: employee.isActive,
    })),
    workOrder: issue.workOrder ? {
      ...issue.workOrder,
      plannedAt: issue.workOrder.plannedAt?.toISOString() || null,
    } : null,
    dueAt: issue.dueAt?.toISOString() || null,
    processName: issue.processName,
    affectedQuantity: issue.affectedQuantity,
    temporaryMeasure: issue.temporaryMeasure,
    rootCause: issue.rootCause,
    solution: issue.solution,
    verificationResult: issue.verificationResult,
    isMajorQuality: issue.isMajorQuality,
    majorQualityReason: issue.majorQualityReason,
    version: issue.version,
    majorApproval: majorApproval ? {
      id: majorApproval.id,
      round: majorApproval.round,
      status: majorApproval.status,
      version: majorApproval.version,
      submittedByName: majorApproval.submittedBy?.displayName || majorApproval.submittedBy?.username || null,
      submittedAt: majorApproval.submittedAt.toISOString(),
      qualityReviewedByName: majorApproval.qualityReviewedBy?.displayName || majorApproval.qualityReviewedBy?.username || null,
      qualityReviewedAt: majorApproval.qualityReviewedAt?.toISOString() || null,
      finalReviewedByName: majorApproval.finalReviewedBy?.displayName || majorApproval.finalReviewedBy?.username || null,
      finalReviewedAt: majorApproval.finalReviewedAt?.toISOString() || null,
    } : null,
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
  data.version = { increment: 1 };
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
    prisma.issue.count({ where: { deletedAt: null, status: { not: 'closed' }, assigneeId: null, assigneeEmployeeId: null } }),
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
    hasOriginalDrawing: hasRequiredProductionDocuments(order),
    materialStatus: order.materialStatus,
    warehouseMaterialStatus: order.materialTask?.status,
    warehouseExceptionType: order.materialTask?.exceptionType,
    warehouseExceptionNote: order.materialTask?.exceptionNote,
    warehouseExpectedAt: order.materialTask?.expectedAt,
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
