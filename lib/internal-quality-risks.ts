import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const INTERNAL_QUALITY_RISK_STATUSES = ['DRAFT', 'SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'VERIFYING', 'PENDING_CLOSE', 'REVISING', 'ARCHIVED'] as const;
export const INTERNAL_QUALITY_RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const QUALITY_ALERT_ACTIVE_STATES = ['ACTIVE', 'ACKNOWLEDGED'] as const;
export const INTERNAL_QUALITY_RISK_TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'] as const;
export const INTERNAL_QUALITY_RISK_TASK_TYPES = ['CONTAINMENT', 'CAUSE', 'ACTION', 'VERIFICATION', 'COLLABORATION'] as const;
export const INTERNAL_QUALITY_RISK_PRINT_POLICIES = ['REQUIRED', 'OPTIONAL', 'SYSTEM_ONLY'] as const;
export const INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENT_MODES = ['REQUIRED', 'OPTIONAL', 'NOT_APPLICABLE'] as const;
export const INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENT_KEYS = [
  'defectPhenomenon',
  'occurrenceCause',
  'escapeCause',
  'rootCause',
  'containmentAction',
  'correctiveAction',
  'verificationResult',
  'warningSummary',
  'requiredAction',
  'inspectionMethod',
  'inspectionFrequency',
  'acceptanceCriteria',
  'stopConditions',
  'sourceIssue',
  'evidence',
] as const;
export const QUALITY_RISK_PURGE_RETENTION_DAYS = 30;

export type InternalQualityRiskStatus = typeof INTERNAL_QUALITY_RISK_STATUSES[number];
export type InternalQualityRiskSeverity = typeof INTERNAL_QUALITY_RISK_SEVERITIES[number];
export type InternalQualityRiskActor = { id: string; name: string };
export type InternalQualityRiskArchiveRequirementMode = typeof INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENT_MODES[number];
export type InternalQualityRiskArchiveRequirementKey = typeof INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENT_KEYS[number];
export type InternalQualityRiskArchiveRequirements = Record<InternalQualityRiskArchiveRequirementKey, InternalQualityRiskArchiveRequirementMode>;

export const DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS: InternalQualityRiskArchiveRequirements = {
  defectPhenomenon: 'REQUIRED',
  occurrenceCause: 'OPTIONAL',
  escapeCause: 'OPTIONAL',
  rootCause: 'OPTIONAL',
  containmentAction: 'OPTIONAL',
  correctiveAction: 'OPTIONAL',
  verificationResult: 'OPTIONAL',
  warningSummary: 'REQUIRED',
  requiredAction: 'REQUIRED',
  inspectionMethod: 'OPTIONAL',
  inspectionFrequency: 'OPTIONAL',
  acceptanceCriteria: 'OPTIONAL',
  stopConditions: 'OPTIONAL',
  sourceIssue: 'OPTIONAL',
  evidence: 'OPTIONAL',
};

export class InternalQualityRiskError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'QUALITY_RISK_INVALID',
  ) {
    super(message);
  }
}

export type InternalQualityRiskInput = {
  reportNo: string;
  title: string;
  severity: InternalQualityRiskSeverity;
  occurrenceDate: Date | null;
  workshopArea: string | null;
  processName: string | null;
  responsibleDepartment: string | null;
  defectPhenomenon: string | null;
  occurrenceCause: string | null;
  escapeCause: string | null;
  systemCause: string | null;
  rootCause: string | null;
  secondaryCause: string | null;
  containmentAction: string | null;
  disposition: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  verificationResult: string | null;
  finalConclusion: string | null;
  evidenceSummary: string | null;
  riskScope: string | null;
  applicableProcess: string | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  warningSummary: string | null;
  requiredAction: string | null;
  inspectionMethod: string | null;
  inspectionFrequency: string | null;
  acceptanceCriteria: string | null;
  stopConditions: string | null;
  escalationContact: string | null;
  printPolicy: typeof INTERNAL_QUALITY_RISK_PRINT_POLICIES[number];
  archiveRequirements: InternalQualityRiskArchiveRequirements;
  issueIds: string[];
  workOrderIds: string[];
  productIds: string[];
  eightDReportIds: string[];
};

export function normalizeInternalQualityRiskArchiveRequirements(value: unknown): InternalQualityRiskArchiveRequirements {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENT_KEYS.map(key => {
    const rawMode = String(input[key] || DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS[key]).toUpperCase();
    const mode = INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENT_MODES.includes(rawMode as InternalQualityRiskArchiveRequirementMode)
      ? rawMode as InternalQualityRiskArchiveRequirementMode
      : DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS[key];
    return [key, mode];
  })) as InternalQualityRiskArchiveRequirements;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function longText(value: unknown, max = 8_000): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').trim();
  return text ? text.slice(0, max) : null;
}

function parseDate(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000+08:00`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) throw new InternalQualityRiskError(`${label}格式不正确`);
  return date;
}

export function normalizeQualityRiskRelationIds(value: unknown, max = 300): string[] {
  let input: unknown[] = [];
  if (Array.isArray(value)) input = value;
  else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      input = Array.isArray(parsed) ? parsed : value.split(',');
    } catch {
      input = value.split(',');
    }
  }
  const ids = [...new Set(input.map(item => String(item || '').trim()).filter(Boolean))];
  if (ids.length > max) throw new InternalQualityRiskError(`单类关联对象最多 ${max} 个`);
  return ids;
}

export function parseInternalQualityRiskInput(input: Record<string, unknown>): InternalQualityRiskInput {
  const reportNo = cleanText(input.reportNo, 80);
  const title = cleanText(input.title, 180);
  if (!reportNo) throw new InternalQualityRiskError('异常汇总编号不能为空');
  if (!title) throw new InternalQualityRiskError('异常汇总标题不能为空');
  const severity = String(input.severity || 'HIGH').toUpperCase();
  if (!INTERNAL_QUALITY_RISK_SEVERITIES.includes(severity as InternalQualityRiskSeverity)) {
    throw new InternalQualityRiskError('风险等级不正确');
  }
  const effectiveFrom = parseDate(input.effectiveFrom, '生效日期');
  const effectiveUntil = parseDate(input.effectiveUntil, '失效日期');
  if (effectiveFrom && effectiveUntil && effectiveUntil < effectiveFrom) {
    throw new InternalQualityRiskError('失效日期不能早于生效日期');
  }
  const printPolicy = String(input.printPolicy || 'OPTIONAL').trim().toUpperCase();
  if (!INTERNAL_QUALITY_RISK_PRINT_POLICIES.includes(printPolicy as typeof INTERNAL_QUALITY_RISK_PRINT_POLICIES[number])) {
    throw new InternalQualityRiskError('工单打印策略不正确');
  }
  return {
    reportNo,
    title,
    severity: severity as InternalQualityRiskSeverity,
    occurrenceDate: parseDate(input.occurrenceDate, '发生日期'),
    workshopArea: cleanText(input.workshopArea, 160),
    processName: cleanText(input.processName, 160),
    responsibleDepartment: cleanText(input.responsibleDepartment, 160),
    defectPhenomenon: longText(input.defectPhenomenon),
    occurrenceCause: longText(input.occurrenceCause),
    escapeCause: longText(input.escapeCause),
    systemCause: longText(input.systemCause),
    rootCause: longText(input.rootCause),
    secondaryCause: longText(input.secondaryCause),
    containmentAction: longText(input.containmentAction),
    disposition: longText(input.disposition),
    correctiveAction: longText(input.correctiveAction),
    preventiveAction: longText(input.preventiveAction),
    verificationResult: longText(input.verificationResult),
    finalConclusion: longText(input.finalConclusion),
    evidenceSummary: longText(input.evidenceSummary),
    riskScope: longText(input.riskScope, 2_000),
    applicableProcess: cleanText(input.applicableProcess, 500),
    effectiveFrom,
    effectiveUntil,
    warningSummary: longText(input.warningSummary, 2_000),
    requiredAction: longText(input.requiredAction, 4_000),
    inspectionMethod: longText(input.inspectionMethod, 2_000),
    inspectionFrequency: cleanText(input.inspectionFrequency, 500),
    acceptanceCriteria: longText(input.acceptanceCriteria, 2_000),
    stopConditions: longText(input.stopConditions, 2_000),
    escalationContact: cleanText(input.escalationContact, 500),
    printPolicy: printPolicy as typeof INTERNAL_QUALITY_RISK_PRINT_POLICIES[number],
    archiveRequirements: normalizeInternalQualityRiskArchiveRequirements(input.archiveRequirements),
    issueIds: normalizeQualityRiskRelationIds(input.issueIds),
    workOrderIds: normalizeQualityRiskRelationIds(input.workOrderIds),
    productIds: normalizeQualityRiskRelationIds(input.productIds),
    eightDReportIds: normalizeQualityRiskRelationIds(input.eightDReportIds),
  };
}

export function expectedInternalQualityRiskVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InternalQualityRiskError('缺少有效的并发版本，请刷新后重试', 409, 'QUALITY_RISK_VERSION_REQUIRED');
  }
  return parsed;
}

const userSelect = { id: true, displayName: true, username: true } as const;
const workOrderSelect = {
  id: true,
  code: true,
  businessCode: true,
  customerName: true,
  productName: true,
  specification: true,
  stage: true,
  drawingLibraryItemId: true,
  planActive: true,
  deletedAt: true,
} as const;

export const internalQualityRiskInclude = Prisma.validator<Prisma.InternalQualityRiskReportInclude>()({
  currentRevision: {
    include: {
      products: { select: { drawingLibraryItemId: true } },
      attachments: { orderBy: { sortOrder: 'asc' }, select: { attachmentId: true, sortOrder: true } },
    },
  },
  revisions: { orderBy: { revisionNumber: 'desc' } },
  issues: {
    orderBy: { createdAt: 'asc' },
    include: {
      issue: {
        include: {
          workOrder: { select: workOrderSelect },
          majorApprovals: {
            orderBy: { round: 'desc' },
            take: 1,
            select: { id: true, round: true, status: true, completedAt: true },
          },
        },
      },
    },
  },
  workOrders: { orderBy: { createdAt: 'asc' }, include: { workOrder: { select: workOrderSelect } } },
  products: {
    orderBy: { createdAt: 'asc' },
    include: {
      product: {
        select: { id: true, customerName: true, customerCode: true, productName: true, specification: true, deletedAt: true },
      },
    },
  },
  eightDReports: {
    orderBy: { createdAt: 'asc' },
    include: { eightDReport: { select: { id: true, reportNo: true, title: true, status: true, deletedAt: true } } },
  },
  activities: { orderBy: { createdAt: 'desc' }, take: 120, include: { actor: { select: userSelect } } },
  tasks: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { attachments: { where: { deletedAt: null }, select: { id: true } } },
  },
  attachments: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { uploadedBy: { select: userSelect } },
  },
  alerts: {
    orderBy: { createdAt: 'desc' },
    include: {
      workOrder: { select: workOrderSelect },
      revision: { select: { id: true, revisionNumber: true, archivedAt: true } },
      acknowledgements: {
        orderBy: { acknowledgedAt: 'desc' },
        include: { acknowledgedBy: { select: userSelect } },
      },
    },
  },
  createdBy: { select: userSelect },
  updatedBy: { select: userSelect },
  archivedBy: { select: userSelect },
  deletedBy: { select: userSelect },
});

export const workOrderQualityAlertInclude = Prisma.validator<Prisma.WorkOrderQualityAlertInclude>()({
  report: { select: { id: true, reportNo: true, title: true, status: true, deletedAt: true, version: true } },
  revision: { select: { id: true, revisionNumber: true, archivedAt: true } },
  workOrder: { select: workOrderSelect },
  acknowledgements: {
    orderBy: { acknowledgedAt: 'desc' },
    include: { acknowledgedBy: { select: userSelect } },
  },
});

export type InternalQualityRiskRecord = Prisma.InternalQualityRiskReportGetPayload<{
  include: typeof internalQualityRiskInclude;
}>;
export type WorkOrderQualityAlertRecord = Prisma.WorkOrderQualityAlertGetPayload<{
  include: typeof workOrderQualityAlertInclude;
}>;

function actorLabel(user?: { displayName: string; username: string } | null): string | null {
  return user ? user.displayName || user.username : null;
}

function issueCode(sequence: number): string {
  return `ISS-${String(sequence).padStart(6, '0')}`;
}

function serializeWorkOrder(workOrder: InternalQualityRiskRecord['workOrders'][number]['workOrder']) {
  return {
    id: workOrder.id,
    code: workOrder.code,
    businessCode: workOrder.businessCode,
    displayCode: workOrder.businessCode || workOrder.specification || workOrder.code,
    customerName: workOrder.customerName,
    productName: workOrder.productName,
    specification: workOrder.specification,
    stage: workOrder.stage,
    drawingLibraryItemId: workOrder.drawingLibraryItemId,
    planActive: workOrder.planActive,
    deletedAt: workOrder.deletedAt?.toISOString() || null,
  };
}

function isExpired(effectiveUntil: Date | null, now = new Date()): boolean {
  return Boolean(effectiveUntil && effectiveUntil.getTime() < now.getTime());
}

export function serializeWorkOrderQualityAlert(alert: WorkOrderQualityAlertRecord) {
  const expired = isExpired(alert.effectiveUntil);
  return {
    id: alert.id,
    reportId: alert.reportId,
    reportNo: alert.report.reportNo,
    reportTitle: alert.report.title,
    reportVersion: alert.report.version,
    revisionId: alert.revisionId,
    revisionNumber: alert.revision.revisionNumber,
    workOrderId: alert.workOrderId,
    state: expired && QUALITY_ALERT_ACTIVE_STATES.includes(alert.state as typeof QUALITY_ALERT_ACTIVE_STATES[number])
      ? 'EXPIRED'
      : alert.state,
    persistedState: alert.state,
    source: alert.source,
    severity: alert.severity,
    title: alert.title,
    defectPhenomenon: alert.defectPhenomenon,
    rootCause: alert.rootCause,
    finalConclusion: alert.finalConclusion,
    controlRequirement: alert.controlRequirement,
    warningSummary: alert.warningSummary,
    requiredAction: alert.requiredAction,
    inspectionMethod: alert.inspectionMethod,
    inspectionFrequency: alert.inspectionFrequency,
    acceptanceCriteria: alert.acceptanceCriteria,
    stopConditions: alert.stopConditions,
    escalationContact: alert.escalationContact,
    printPolicy: alert.printPolicy,
    applicableProcess: alert.applicableProcess,
    effectiveFrom: alert.effectiveFrom?.toISOString() || null,
    effectiveUntil: alert.effectiveUntil?.toISOString() || null,
    archivedAt: alert.archivedAt.toISOString(),
    supersededAt: alert.supersededAt?.toISOString() || null,
    revokedAt: alert.revokedAt?.toISOString() || null,
    revokeReason: alert.revokeReason,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    workOrder: serializeWorkOrder(alert.workOrder),
    acknowledgements: alert.acknowledgements.map(item => ({
      id: item.id,
      note: item.note,
      acknowledgedAt: item.acknowledgedAt.toISOString(),
      acknowledgedBy: actorLabel(item.acknowledgedBy),
      acknowledgedById: item.acknowledgedById,
    })),
  };
}

export function qualityRiskPurgeEligibleAt(deletedAt: Date | null): Date | null {
  if (!deletedAt) return null;
  return new Date(deletedAt.getTime() + QUALITY_RISK_PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}

export function serializeInternalQualityRisk(report: InternalQualityRiskRecord) {
  const purgeEligibleAt = qualityRiskPurgeEligibleAt(report.deletedAt);
  return {
    id: report.id,
    sequence: report.sequence,
    reportNo: report.reportNo,
    title: report.title,
    severity: report.severity,
    status: report.status,
    occurrenceDate: report.occurrenceDate?.toISOString() || null,
    workshopArea: report.workshopArea,
    processName: report.processName,
    responsibleDepartment: report.responsibleDepartment,
    defectPhenomenon: report.defectPhenomenon,
    occurrenceCause: report.occurrenceCause,
    escapeCause: report.escapeCause,
    systemCause: report.systemCause,
    rootCause: report.rootCause,
    secondaryCause: report.secondaryCause,
    containmentAction: report.containmentAction,
    disposition: report.disposition,
    correctiveAction: report.correctiveAction,
    preventiveAction: report.preventiveAction,
    verificationResult: report.verificationResult,
    finalConclusion: report.finalConclusion,
    evidenceSummary: report.evidenceSummary,
    riskScope: report.riskScope,
    applicableProcess: report.applicableProcess,
    effectiveFrom: report.effectiveFrom?.toISOString() || null,
    effectiveUntil: report.effectiveUntil?.toISOString() || null,
    warningState: isExpired(report.effectiveUntil) && report.warningState === 'ACTIVE' ? 'EXPIRED' : report.warningState,
    warningSummary: report.warningSummary,
    requiredAction: report.requiredAction,
    inspectionMethod: report.inspectionMethod,
    inspectionFrequency: report.inspectionFrequency,
    acceptanceCriteria: report.acceptanceCriteria,
    stopConditions: report.stopConditions,
    escalationContact: report.escalationContact,
    printPolicy: report.printPolicy,
    archiveRequirements: normalizeInternalQualityRiskArchiveRequirements(report.archiveRequirements),
    warningPublishedAt: report.warningPublishedAt?.toISOString() || null,
    warningRevokedAt: report.warningRevokedAt?.toISOString() || null,
    warningRevokeReason: report.warningRevokeReason,
    version: report.version,
    currentRevisionId: report.currentRevisionId,
    currentRevisionNumber: report.currentRevision?.revisionNumber || null,
    archivedAt: report.archivedAt?.toISOString() || null,
    deletedAt: report.deletedAt?.toISOString() || null,
    deleteReason: report.deleteReason,
    purgeEligibleAt: purgeEligibleAt?.toISOString() || null,
    canPurge: Boolean(purgeEligibleAt && purgeEligibleAt <= new Date()
      && report.alerts.every(alert => !QUALITY_ALERT_ACTIVE_STATES.includes(alert.state as typeof QUALITY_ALERT_ACTIVE_STATES[number]))),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    createdBy: actorLabel(report.createdBy),
    updatedBy: actorLabel(report.updatedBy),
    archivedBy: actorLabel(report.archivedBy),
    deletedBy: actorLabel(report.deletedBy),
    products: report.products.map(link => ({
      id: link.product.id,
      customerName: link.product.customerName,
      customerCode: link.product.customerCode,
      productName: link.product.productName,
      specification: link.product.specification,
      deletedAt: link.product.deletedAt?.toISOString() || null,
    })),
    issues: report.issues.map(link => ({
      id: link.issue.id,
      sequence: link.issue.sequence,
      code: issueCode(link.issue.sequence),
      title: link.issue.title,
      type: link.issue.type,
      priority: link.issue.priority,
      status: link.issue.status,
      isMajorQuality: link.issue.isMajorQuality,
      majorApproval: link.issue.majorApprovals[0] ? {
        id: link.issue.majorApprovals[0].id,
        round: link.issue.majorApprovals[0].round,
        status: link.issue.majorApprovals[0].status,
        completedAt: link.issue.majorApprovals[0].completedAt?.toISOString() || null,
      } : null,
      workOrder: link.issue.workOrder ? serializeWorkOrder(link.issue.workOrder) : null,
      deletedAt: link.issue.deletedAt?.toISOString() || null,
    })),
    workOrders: report.workOrders.map(link => ({ ...serializeWorkOrder(link.workOrder), source: link.source })),
    eightDReports: report.eightDReports.map(link => ({
      id: link.eightDReport.id,
      reportNo: link.eightDReport.reportNo,
      title: link.eightDReport.title,
      status: link.eightDReport.status,
      deletedAt: link.eightDReport.deletedAt?.toISOString() || null,
    })),
    revisions: report.revisions.map(revision => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      archivedAt: revision.archivedAt.toISOString(),
      archivedById: revision.archivedById,
    })),
    alerts: report.alerts.map(alert => ({
      id: alert.id,
      revisionId: alert.revisionId,
      revisionNumber: alert.revision.revisionNumber,
      workOrder: serializeWorkOrder(alert.workOrder),
      state: isExpired(alert.effectiveUntil) && QUALITY_ALERT_ACTIVE_STATES.includes(alert.state as typeof QUALITY_ALERT_ACTIVE_STATES[number])
        ? 'EXPIRED'
        : alert.state,
      source: alert.source,
      severity: alert.severity,
      acknowledgementCount: alert.acknowledgements.length,
      archivedAt: alert.archivedAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    })),
    tasks: report.tasks.map(task => ({
      id: task.id,
      taskType: task.taskType,
      title: task.title,
      department: task.department,
      ownerName: task.ownerName,
      requirement: task.requirement,
      result: task.result,
      status: task.status,
      dueAt: task.dueAt?.toISOString() || null,
      completedAt: task.completedAt?.toISOString() || null,
      verifiedAt: task.verifiedAt?.toISOString() || null,
      sortOrder: task.sortOrder,
      attachmentCount: task.attachments.length,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    })),
    attachments: report.attachments.map(attachment => ({
      id: attachment.id,
      taskId: attachment.taskId,
      category: attachment.category,
      originalName: attachment.originalName,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      sha256: attachment.sha256,
      caption: attachment.caption,
      sortOrder: attachment.sortOrder,
      uploadedBy: actorLabel(attachment.uploadedBy),
      createdAt: attachment.createdAt.toISOString(),
      deletedAt: attachment.deletedAt?.toISOString() || null,
      contentUrl: `/api/quality/internal-risk-attachments/${attachment.id}/content`,
    })),
    activities: report.activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      content: activity.content,
      actorName: actorLabel(activity.actor) || activity.actorName,
      detail: activity.detail && typeof activity.detail === 'object' && !Array.isArray(activity.detail)
        ? activity.detail as Record<string, unknown>
        : null,
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}

function activityData(reportId: string, actor: InternalQualityRiskActor, action: string, content: string, detail?: Prisma.InputJsonValue) {
  return { reportId, action, content, actorId: actor.id, actorName: actor.name, detail };
}

async function lockRiskReport(tx: Prisma.TransactionClient, reportId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-quality-risk:${reportId}`}))`;
}

function assertExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new InternalQualityRiskError('异常汇总已被其他人更新，请刷新后重试', 409, 'QUALITY_RISK_VERSION_CONFLICT');
  }
}

async function activeRiskForMutation(tx: Prisma.TransactionClient, reportId: string) {
  const report = await tx.internalQualityRiskReport.findFirst({ where: { id: reportId, deletedAt: null } });
  if (!report) throw new InternalQualityRiskError('内部重大异常不存在或已进入回收站', 404, 'QUALITY_RISK_NOT_FOUND');
  return report;
}

async function assertQualityRiskRelations(tx: Prisma.TransactionClient, input: InternalQualityRiskInput): Promise<void> {
  const [issueCount, workOrderCount, productCount, eightDCount] = await Promise.all([
    input.issueIds.length ? tx.issue.count({ where: { id: { in: input.issueIds }, deletedAt: null } }) : 0,
    input.workOrderIds.length ? tx.workOrder.count({ where: { id: { in: input.workOrderIds }, deletedAt: null } }) : 0,
    input.productIds.length ? tx.drawingLibraryItem.count({ where: { id: { in: input.productIds }, deletedAt: null } }) : 0,
    input.eightDReportIds.length ? tx.eightDReport.count({ where: { id: { in: input.eightDReportIds }, deletedAt: null } }) : 0,
  ]);
  if (issueCount !== input.issueIds.length) throw new InternalQualityRiskError('部分来源质量问题不存在或已删除', 409, 'QUALITY_RISK_ISSUE_INVALID');
  if (workOrderCount !== input.workOrderIds.length) throw new InternalQualityRiskError('部分关联工单不存在或已删除', 409, 'QUALITY_RISK_WORK_ORDER_INVALID');
  if (productCount !== input.productIds.length) throw new InternalQualityRiskError('部分关联产品不存在或已停用', 409, 'QUALITY_RISK_PRODUCT_INVALID');
  if (eightDCount !== input.eightDReportIds.length) throw new InternalQualityRiskError('部分关联8D档案不存在或已进入回收站', 409, 'QUALITY_RISK_EIGHT_D_INVALID');
}

function reportData(input: InternalQualityRiskInput) {
  return {
    reportNo: input.reportNo,
    title: input.title,
    severity: input.severity,
    occurrenceDate: input.occurrenceDate,
    workshopArea: input.workshopArea,
    processName: input.processName,
    responsibleDepartment: input.responsibleDepartment,
    defectPhenomenon: input.defectPhenomenon,
    occurrenceCause: input.occurrenceCause,
    escapeCause: input.escapeCause,
    systemCause: input.systemCause,
    rootCause: input.rootCause,
    secondaryCause: input.secondaryCause,
    containmentAction: input.containmentAction,
    disposition: input.disposition,
    correctiveAction: input.correctiveAction,
    preventiveAction: input.preventiveAction,
    verificationResult: input.verificationResult,
    finalConclusion: input.finalConclusion,
    evidenceSummary: input.evidenceSummary,
    riskScope: input.riskScope,
    applicableProcess: input.applicableProcess,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    warningSummary: input.warningSummary,
    requiredAction: input.requiredAction,
    inspectionMethod: input.inspectionMethod,
    inspectionFrequency: input.inspectionFrequency,
    acceptanceCriteria: input.acceptanceCriteria,
    stopConditions: input.stopConditions,
    escalationContact: input.escalationContact,
    printPolicy: input.printPolicy,
    archiveRequirements: input.archiveRequirements as unknown as Prisma.InputJsonValue,
  };
}

async function replaceRelations(tx: Prisma.TransactionClient, reportId: string, input: InternalQualityRiskInput): Promise<void> {
  const existingWorkOrderLinks = await tx.internalQualityRiskWorkOrder.findMany({
    where: { reportId },
    select: { workOrderId: true, source: true },
  });
  const existingWorkOrderSource = new Map(existingWorkOrderLinks.map(link => [link.workOrderId, link.source]));
  await Promise.all([
    tx.internalQualityRiskIssue.deleteMany({ where: { reportId } }),
    tx.internalQualityRiskWorkOrder.deleteMany({ where: { reportId } }),
    tx.internalQualityRiskProduct.deleteMany({ where: { reportId } }),
    tx.internalQualityRiskEightDReport.deleteMany({ where: { reportId } }),
  ]);
  await Promise.all([
    input.issueIds.length ? tx.internalQualityRiskIssue.createMany({ data: input.issueIds.map(issueId => ({ reportId, issueId })) }) : null,
    input.workOrderIds.length ? tx.internalQualityRiskWorkOrder.createMany({
      data: input.workOrderIds.map(workOrderId => ({
        reportId,
        workOrderId,
        source: existingWorkOrderSource.get(workOrderId) === 'PRODUCT_CONFIRMATION' ? 'PRODUCT_CONFIRMATION' : 'DIRECT',
      })),
    }) : null,
    input.productIds.length ? tx.internalQualityRiskProduct.createMany({ data: input.productIds.map(drawingLibraryItemId => ({ reportId, drawingLibraryItemId })) }) : null,
    input.eightDReportIds.length ? tx.internalQualityRiskEightDReport.createMany({ data: input.eightDReportIds.map(eightDReportId => ({ reportId, eightDReportId })) }) : null,
  ]);
}

export async function createInternalQualityRiskRecord(
  tx: Prisma.TransactionClient,
  input: InternalQualityRiskInput,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await assertQualityRiskRelations(tx, input);
  const report = await tx.internalQualityRiskReport.create({
    data: {
      ...reportData(input),
      status: 'DRAFT',
      createdById: actor.id,
      updatedById: actor.id,
      issues: { create: input.issueIds.map(issueId => ({ issueId })) },
      workOrders: { create: input.workOrderIds.map(workOrderId => ({ workOrderId, source: 'DIRECT' })) },
      products: { create: input.productIds.map(drawingLibraryItemId => ({ drawingLibraryItemId })) },
      eightDReports: { create: input.eightDReportIds.map(eightDReportId => ({ eightDReportId })) },
    },
  });
  await tx.internalQualityRiskActivity.create({
    data: activityData(report.id, actor, 'CREATED', '建立内部重大异常汇总草稿', {
      issueCount: input.issueIds.length,
      workOrderCount: input.workOrderIds.length,
      productCount: input.productIds.length,
      eightDCount: input.eightDReportIds.length,
    }),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: report.id }, include: internalQualityRiskInclude });
}

export async function updateInternalQualityRiskRecord(
  tx: Prisma.TransactionClient,
  reportId: string,
  input: InternalQualityRiskInput,
  expectedVersion: number,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  if (report.status === 'ARCHIVED') {
    throw new InternalQualityRiskError('已归档版本不可直接覆盖，请先启动修订', 409, 'QUALITY_RISK_ARCHIVED_IMMUTABLE');
  }
  await assertQualityRiskRelations(tx, input);
  await replaceRelations(tx, reportId, input);
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: { ...reportData(input), updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'UPDATED', report.status === 'REVISING' ? '更新修订稿内容与关联' : '更新异常汇总草稿与关联', {
      previousVersion: report.version,
      issueCount: input.issueIds.length,
      workOrderCount: input.workOrderIds.length,
      productCount: input.productIds.length,
      eightDCount: input.eightDReportIds.length,
    }),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

export type QualityRiskReadiness = {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  revisionNumber: number;
  workOrderCount: number;
  productCount: number;
  issueCount: number;
  alertCount: number;
};

export function evaluateInternalQualityRiskReadiness(report: InternalQualityRiskRecord): QualityRiskReadiness {
  const blockers: QualityRiskReadiness['blockers'] = [];
  const warnings: QualityRiskReadiness['warnings'] = [];
  const activeWorkOrders = report.workOrders.filter(link => !link.workOrder.deletedAt);
  const activeProducts = report.products.filter(link => !link.product.deletedAt);
  const archiveRequirements = normalizeInternalQualityRiskArchiveRequirements(report.archiveRequirements);
  const configurableFields: Array<[Exclude<InternalQualityRiskArchiveRequirementKey, 'sourceIssue' | 'evidence'>, string, string]> = [
    ['defectPhenomenon', 'QUALITY_RISK_DEFECT_REQUIRED', '请完整填写不良现象'],
    ['occurrenceCause', 'QUALITY_RISK_OCCURRENCE_CAUSE_REQUIRED', '请填写发生原因'],
    ['escapeCause', 'QUALITY_RISK_ESCAPE_CAUSE_REQUIRED', '请填写流出原因'],
    ['rootCause', 'QUALITY_RISK_ROOT_CAUSE_REQUIRED', '请填写根本原因'],
    ['containmentAction', 'QUALITY_RISK_CONTAINMENT_REQUIRED', '请填写临时遏制措施'],
    ['correctiveAction', 'QUALITY_RISK_CORRECTIVE_REQUIRED', '请填写纠正措施'],
    ['verificationResult', 'QUALITY_RISK_VERIFICATION_REQUIRED', '请填写措施验证结果'],
    ['warningSummary', 'QUALITY_RISK_WARNING_SUMMARY_REQUIRED', '请填写给现场人员看的异常警示摘要'],
    ['requiredAction', 'QUALITY_RISK_REQUIRED_ACTION_REQUIRED', '请填写本批工单必须执行的处理要求'],
    ['inspectionMethod', 'QUALITY_RISK_INSPECTION_METHOD_REQUIRED', '请填写检查方法'],
    ['inspectionFrequency', 'QUALITY_RISK_INSPECTION_FREQUENCY_REQUIRED', '请填写检查频次'],
    ['acceptanceCriteria', 'QUALITY_RISK_ACCEPTANCE_CRITERIA_REQUIRED', '请填写合格判定标准'],
    ['stopConditions', 'QUALITY_RISK_STOP_CONDITIONS_REQUIRED', '请填写停线与升级条件'],
  ];
  configurableFields.forEach(([field, code, message]) => {
    if (archiveRequirements[field] === 'REQUIRED' && !report[field]) blockers.push({ code, message });
  });
  if (!report.finalConclusion) blockers.push({ code: 'QUALITY_RISK_CONCLUSION_REQUIRED', message: '请填写最终结论（闭环固定必填）' });
  if (archiveRequirements.sourceIssue === 'REQUIRED' && !report.issues.length) {
    blockers.push({ code: 'QUALITY_RISK_SOURCE_ISSUE_REQUIRED', message: '来源问题已设为必填，请至少关联一个有效质量问题' });
  }
  if (!activeWorkOrders.length && !activeProducts.length) {
    blockers.push({ code: 'QUALITY_RISK_IMPACT_REQUIRED', message: '至少关联一个未删除的工单或产品' });
  }
  const invalidIssues = report.issues.filter(link => link.issue.deletedAt);
  if (invalidIssues.length) blockers.push({ code: 'QUALITY_RISK_SOURCE_ISSUE_DELETED', message: `${invalidIssues.length} 个来源质量问题已删除，请先解除关联` });
  const unapprovedMajor = report.issues.filter(link => (
    link.issue.isMajorQuality && link.issue.majorApprovals[0]?.status !== 'APPROVED'
  ));
  if (unapprovedMajor.length) {
    blockers.push({ code: 'QUALITY_RISK_MAJOR_APPROVAL_REQUIRED', message: `${unapprovedMajor.length} 个重大质量问题尚未完成质量复核与总经理终审` });
  }
  const hasEvidence = Boolean(report.evidenceSummary || report.eightDReports.length || report.attachments.length);
  if (archiveRequirements.evidence === 'REQUIRED' && !hasEvidence) {
    blockers.push({ code: 'QUALITY_RISK_EVIDENCE_REQUIRED', message: '证据已设为必填，请填写摘要、上传附件或关联8D档案' });
  } else if (archiveRequirements.evidence === 'OPTIONAL'
    && (report.severity === 'HIGH' || report.severity === 'CRITICAL') && !hasEvidence) {
    warnings.push({ code: 'QUALITY_RISK_EVIDENCE_RECOMMENDED', message: '高/重大风险尚无证据，当前策略允许归档，但建议补充附件、摘要或8D档案' });
  }
  const skippedImpacts = (report.workOrders.length - activeWorkOrders.length) + (report.products.length - activeProducts.length);
  if (skippedImpacts) warnings.push({ code: 'QUALITY_RISK_DELETED_IMPACT_SKIPPED', message: `${skippedImpacts} 个已删除的工单或产品不会进入归档预警范围` });
  if (!activeWorkOrders.length && activeProducts.length) warnings.push({ code: 'QUALITY_RISK_PRODUCT_AUTO_SCOPE', message: '当前仅关联产品；归档时将自动匹配已有工单，并持续应用到未来同产品工单' });
  if (!report.eightDReports.length) warnings.push({ code: 'QUALITY_RISK_NO_EIGHT_D', message: '尚未关联8D档案，可使用问题附件与证据摘要作为当前依据' });
  if (!report.preventiveAction) warnings.push({ code: 'QUALITY_RISK_PREVENTIVE_EMPTY', message: '建议补充预防再发措施' });
  const incompleteTasks = report.tasks.filter(task => !['VERIFIED', 'CANCELLED'].includes(task.status));
  if (incompleteTasks.length) blockers.push({ code: 'QUALITY_RISK_TASKS_INCOMPLETE', message: `${incompleteTasks.length} 项部门协同任务尚未验证关闭` });
  if (!report.tasks.length) warnings.push({ code: 'QUALITY_RISK_NO_TASKS', message: '当前异常没有建立部门协同任务，请确认确实无需分派' });
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    revisionNumber: (report.revisions[0]?.revisionNumber || 0) + 1,
    workOrderCount: activeWorkOrders.length,
    productCount: activeProducts.length,
    issueCount: report.issues.filter(link => !link.issue.deletedAt).length,
    alertCount: activeWorkOrders.length,
  };
}

export async function previewInternalQualityRiskArchive(reportId: string): Promise<{
  report: ReturnType<typeof serializeInternalQualityRisk>;
  readiness: QualityRiskReadiness;
}> {
  const report = await prisma.internalQualityRiskReport.findFirst({
    where: { id: reportId, deletedAt: null },
    include: internalQualityRiskInclude,
  });
  if (!report) throw new InternalQualityRiskError('内部重大异常不存在', 404, 'QUALITY_RISK_NOT_FOUND');
  if (report.status === 'ARCHIVED') throw new InternalQualityRiskError('该异常汇总已经归档', 409, 'QUALITY_RISK_ALREADY_ARCHIVED');
  const readiness = evaluateInternalQualityRiskReadiness(report);
  const productIds = report.products.filter(link => !link.product.deletedAt).map(link => link.drawingLibraryItemId);
  if (productIds.length) {
    const productWorkOrders = await prisma.workOrder.findMany({
      where: { drawingLibraryItemId: { in: productIds }, deletedAt: null },
      select: { id: true },
    });
    readiness.alertCount = new Set([
      ...report.workOrders.filter(link => !link.workOrder.deletedAt).map(link => link.workOrderId),
      ...productWorkOrders.map(order => order.id),
    ]).size;
    readiness.workOrderCount = readiness.alertCount;
  }
  return { report: serializeInternalQualityRisk(report), readiness };
}

function snapshotFor(report: InternalQualityRiskRecord, revisionNumber: number): Prisma.InputJsonValue {
  return {
    schemaVersion: 1,
    revisionNumber,
    reportNo: report.reportNo,
    title: report.title,
    severity: report.severity,
    occurrenceDate: report.occurrenceDate?.toISOString() || null,
    workshopArea: report.workshopArea,
    processName: report.processName,
    responsibleDepartment: report.responsibleDepartment,
    defectPhenomenon: report.defectPhenomenon,
    occurrenceCause: report.occurrenceCause,
    escapeCause: report.escapeCause,
    systemCause: report.systemCause,
    rootCause: report.rootCause,
    secondaryCause: report.secondaryCause,
    containmentAction: report.containmentAction,
    disposition: report.disposition,
    correctiveAction: report.correctiveAction,
    preventiveAction: report.preventiveAction,
    verificationResult: report.verificationResult,
    finalConclusion: report.finalConclusion,
    evidenceSummary: report.evidenceSummary,
    riskScope: report.riskScope,
    applicableProcess: report.applicableProcess,
    effectiveFrom: report.effectiveFrom?.toISOString() || null,
    effectiveUntil: report.effectiveUntil?.toISOString() || null,
    warningSummary: report.warningSummary,
    requiredAction: report.requiredAction,
    inspectionMethod: report.inspectionMethod,
    inspectionFrequency: report.inspectionFrequency,
    acceptanceCriteria: report.acceptanceCriteria,
    stopConditions: report.stopConditions,
    escalationContact: report.escalationContact,
    printPolicy: report.printPolicy,
    archiveRequirements: normalizeInternalQualityRiskArchiveRequirements(report.archiveRequirements),
    issues: report.issues.map(link => ({ id: link.issue.id, code: issueCode(link.issue.sequence), title: link.issue.title, version: link.issue.version })),
    workOrders: report.workOrders.map(link => ({ id: link.workOrder.id, code: link.workOrder.code, businessCode: link.workOrder.businessCode, source: link.source })),
    products: report.products.map(link => ({ id: link.product.id, specification: link.product.specification, customerName: link.product.customerName })),
    eightDReports: report.eightDReports.map(link => ({ id: link.eightDReport.id, reportNo: link.eightDReport.reportNo, title: link.eightDReport.title })),
    tasks: report.tasks.map(task => ({
      id: task.id,
      taskType: task.taskType,
      title: task.title,
      department: task.department,
      ownerName: task.ownerName,
      requirement: task.requirement,
      result: task.result,
      status: task.status,
      dueAt: task.dueAt?.toISOString() || null,
      completedAt: task.completedAt?.toISOString() || null,
      verifiedAt: task.verifiedAt?.toISOString() || null,
    })),
    attachments: report.attachments.map(attachment => ({
      id: attachment.id,
      taskId: attachment.taskId,
      category: attachment.category,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      sha256: attachment.sha256,
      caption: attachment.caption,
    })),
  } as Prisma.InputJsonValue;
}

type ArchivedWarningSource = Pick<InternalQualityRiskRecord,
  | 'title'
  | 'severity'
  | 'defectPhenomenon'
  | 'rootCause'
  | 'finalConclusion'
  | 'containmentAction'
  | 'correctiveAction'
  | 'preventiveAction'
  | 'warningSummary'
  | 'requiredAction'
  | 'inspectionMethod'
  | 'inspectionFrequency'
  | 'acceptanceCriteria'
  | 'stopConditions'
  | 'escalationContact'
  | 'printPolicy'
  | 'applicableProcess'
  | 'effectiveFrom'
  | 'effectiveUntil'
>;

export type ArchivedQualityWarningProjection = {
  title: string;
  severity: InternalQualityRiskSeverity;
  defectPhenomenon: string | null;
  rootCause: string | null;
  finalConclusion: string | null;
  controlRequirement: string | null;
  warningSummary: string | null;
  requiredAction: string | null;
  inspectionMethod: string | null;
  inspectionFrequency: string | null;
  acceptanceCriteria: string | null;
  stopConditions: string | null;
  escalationContact: string | null;
  printPolicy: typeof INTERNAL_QUALITY_RISK_PRINT_POLICIES[number];
  applicableProcess: string | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
};

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function archivedSnapshotText(snapshot: Record<string, unknown> | null, key: string, fallback: string | null): string | null {
  if (!snapshot || !Object.prototype.hasOwnProperty.call(snapshot, key)) return fallback;
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function archivedSnapshotDate(snapshot: Record<string, unknown> | null, key: string, fallback: Date | null): Date | null {
  if (!snapshot || !Object.prototype.hasOwnProperty.call(snapshot, key)) return fallback;
  if (snapshot[key] === null || snapshot[key] === '') return null;
  const date = new Date(String(snapshot[key]));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/**
 * Resolves worker-facing warning content from an immutable archive snapshot.
 * Passing no snapshot is reserved for the archive transaction itself, where
 * the current editable report is being frozen for the first time.
 */
export function resolveArchivedQualityWarning(
  report: ArchivedWarningSource,
  revisionSnapshot?: unknown,
): ArchivedQualityWarningProjection {
  const snapshot = jsonObject(revisionSnapshot);
  const severityValue = archivedSnapshotText(snapshot, 'severity', report.severity) || report.severity;
  const severity = INTERNAL_QUALITY_RISK_SEVERITIES.includes(severityValue as InternalQualityRiskSeverity)
    ? severityValue as InternalQualityRiskSeverity
    : 'HIGH';
  const printPolicyValue = archivedSnapshotText(snapshot, 'printPolicy', report.printPolicy) || report.printPolicy;
  const printPolicy = INTERNAL_QUALITY_RISK_PRINT_POLICIES.includes(printPolicyValue as typeof INTERNAL_QUALITY_RISK_PRINT_POLICIES[number])
    ? printPolicyValue as typeof INTERNAL_QUALITY_RISK_PRINT_POLICIES[number]
    : 'OPTIONAL';
  const containmentAction = archivedSnapshotText(snapshot, 'containmentAction', report.containmentAction);
  const correctiveAction = archivedSnapshotText(snapshot, 'correctiveAction', report.correctiveAction);
  const preventiveAction = archivedSnapshotText(snapshot, 'preventiveAction', report.preventiveAction);
  const controlItems = [
    containmentAction ? `临时遏制：${containmentAction}` : '',
    correctiveAction ? `纠正措施：${correctiveAction}` : '',
    preventiveAction ? `预防再发：${preventiveAction}` : '',
  ].filter(Boolean);
  return {
    title: archivedSnapshotText(snapshot, 'title', report.title) || report.title,
    severity,
    defectPhenomenon: archivedSnapshotText(snapshot, 'defectPhenomenon', report.defectPhenomenon),
    rootCause: archivedSnapshotText(snapshot, 'rootCause', report.rootCause),
    finalConclusion: archivedSnapshotText(snapshot, 'finalConclusion', report.finalConclusion),
    controlRequirement: controlItems.length ? controlItems.join('\n') : null,
    warningSummary: archivedSnapshotText(snapshot, 'warningSummary', report.warningSummary),
    requiredAction: archivedSnapshotText(snapshot, 'requiredAction', report.requiredAction),
    inspectionMethod: archivedSnapshotText(snapshot, 'inspectionMethod', report.inspectionMethod),
    inspectionFrequency: archivedSnapshotText(snapshot, 'inspectionFrequency', report.inspectionFrequency),
    acceptanceCriteria: archivedSnapshotText(snapshot, 'acceptanceCriteria', report.acceptanceCriteria),
    stopConditions: archivedSnapshotText(snapshot, 'stopConditions', report.stopConditions),
    escalationContact: archivedSnapshotText(snapshot, 'escalationContact', report.escalationContact),
    printPolicy,
    applicableProcess: archivedSnapshotText(snapshot, 'applicableProcess', report.applicableProcess),
    effectiveFrom: archivedSnapshotDate(snapshot, 'effectiveFrom', report.effectiveFrom),
    effectiveUntil: archivedSnapshotDate(snapshot, 'effectiveUntil', report.effectiveUntil),
  };
}

export function archivedQualityWarningAttachmentIds(revisionSnapshot: unknown): string[] {
  const attachments = jsonObject(revisionSnapshot)?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map(item => jsonObject(item)?.id)
    .filter((id): id is string => typeof id === 'string' && Boolean(id));
}

export async function loadInternalQualityRiskPrintPreview(reportId: string, requestedWorkOrderId = '') {
  const report = await prisma.internalQualityRiskReport.findFirst({
    where: { id: reportId, deletedAt: null },
    include: internalQualityRiskInclude,
  });
  if (!report) throw new InternalQualityRiskError('内部重大异常不存在', 404, 'QUALITY_RISK_NOT_FOUND');

  const activeProductIds = report.products.filter(link => !link.product.deletedAt).map(link => link.drawingLibraryItemId);
  const directOrders = report.workOrders.filter(link => !link.workOrder.deletedAt).map(link => link.workOrder);
  const productOrders = activeProductIds.length ? await prisma.workOrder.findMany({
    where: { drawingLibraryItemId: { in: activeProductIds }, deletedAt: null },
    select: workOrderSelect,
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  }) : [];
  const orderCandidates = [...directOrders, ...productOrders].filter((order, index, all) => all.findIndex(item => item.id === order.id) === index);
  const selectedOrder = orderCandidates.find(order => order.id === requestedWorkOrderId) || orderCandidates[0] || null;
  const selectedProduct = report.products.find(link => !link.product.deletedAt && link.drawingLibraryItemId === selectedOrder?.drawingLibraryItemId)?.product
    || report.products.find(link => !link.product.deletedAt)?.product
    || null;
  const useArchiveSnapshot = report.status === 'ARCHIVED' ? report.currentRevision?.snapshot : undefined;
  const warning = resolveArchivedQualityWarning(report, useArchiveSnapshot);
  const revisionNumber = report.status === 'ARCHIVED'
    ? report.currentRevision?.revisionNumber || report.revisions[0]?.revisionNumber || 1
    : (report.revisions[0]?.revisionNumber || 0) + 1;
  const archivedAttachmentIds = report.status === 'ARCHIVED' && report.currentRevision
    ? new Set(report.currentRevision.attachments.map(item => item.attachmentId))
    : null;
  const attachments = report.attachments
    .filter(attachment => !archivedAttachmentIds || archivedAttachmentIds.has(attachment.id))
    .map(attachment => ({
      id: attachment.id,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      caption: attachment.caption,
      category: attachment.category,
      contentUrl: `/api/quality/internal-risk-attachments/${attachment.id}/content`,
    }));
  return {
    generatedAt: new Date().toISOString(),
    previewState: report.status === 'ARCHIVED' ? 'ARCHIVED' as const : 'DRAFT' as const,
    readiness: evaluateInternalQualityRiskReadiness(report),
    orders: orderCandidates.map(order => ({
      id: order.id,
      label: order.businessCode || order.specification || order.code,
      productLabel: `${order.specification || order.productName} · ${order.customerName || '客户未填'}`,
    })),
    order: {
      id: selectedOrder?.id || null,
      workOrderCode: selectedOrder?.code || '归档后按产品匹配',
      businessWorkOrderCode: selectedOrder?.businessCode || null,
      productName: selectedOrder?.productName || selectedProduct?.productName || '关联产品待选择',
      specification: selectedOrder?.specification || selectedProduct?.specification || null,
      customerName: selectedOrder?.customerName || selectedProduct?.customerName || null,
    },
    warning: {
      alertId: `preview-${report.id}-${revisionNumber}`,
      reportId: report.id,
      reportNo: report.reportNo,
      revisionId: report.status === 'ARCHIVED' ? report.currentRevisionId || `R${revisionNumber}` : `preview-R${revisionNumber}`,
      revisionNumber,
      severity: warning.severity,
      title: warning.title,
      warningSummary: warning.warningSummary,
      defectPhenomenon: warning.defectPhenomenon,
      rootCause: warning.rootCause,
      requiredAction: warning.requiredAction,
      inspectionMethod: warning.inspectionMethod,
      inspectionFrequency: warning.inspectionFrequency,
      acceptanceCriteria: warning.acceptanceCriteria,
      stopConditions: warning.stopConditions,
      escalationContact: warning.escalationContact,
      applicableProcess: warning.applicableProcess,
      effectiveFrom: warning.effectiveFrom?.toISOString() || null,
      effectiveUntil: warning.effectiveUntil?.toISOString() || null,
      printPolicy: warning.printPolicy,
      archivedAt: report.status === 'ARCHIVED' && report.archivedAt ? report.archivedAt.toISOString() : new Date().toISOString(),
      attachments,
    },
  };
}

function alertCreateData(
  report: InternalQualityRiskRecord,
  revisionId: string,
  workOrderId: string,
  source: string,
  revisionSnapshot?: unknown,
  archivedAtOverride?: Date,
) {
  const warning = resolveArchivedQualityWarning(report, revisionSnapshot);
  return {
    id: crypto.randomUUID(),
    reportId: report.id,
    revisionId,
    workOrderId,
    state: 'ACTIVE',
    source,
    ...warning,
    archivedAt: archivedAtOverride || report.archivedAt || new Date(),
  };
}

export async function archiveInternalQualityRisk(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const base = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(base.version, expectedVersion);
  if (base.status === 'ARCHIVED') throw new InternalQualityRiskError('该异常汇总已经归档', 409, 'QUALITY_RISK_ALREADY_ARCHIVED');
  if (!['PENDING_CLOSE', 'REVISING'].includes(base.status)) {
    throw new InternalQualityRiskError('异常必须完成部门协同与质量验证，进入待关闭状态后才能归档', 409, 'QUALITY_RISK_WORKFLOW_NOT_READY');
  }
  const report = await tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
  const readiness = evaluateInternalQualityRiskReadiness(report);
  if (!readiness.ready) {
    throw new InternalQualityRiskError(readiness.blockers.map(item => item.message).join('；'), 409, 'QUALITY_RISK_ARCHIVE_BLOCKED');
  }
  const archivedAt = new Date();
  await tx.workOrderQualityAlert.updateMany({
    where: { reportId, state: { in: [...QUALITY_ALERT_ACTIVE_STATES] } },
    data: { state: 'SUPERSEDED', supersededAt: archivedAt },
  });
  const revisionSnapshot = snapshotFor(report, readiness.revisionNumber);
  const revision = await tx.internalQualityRiskRevision.create({
    data: {
      reportId,
      revisionNumber: readiness.revisionNumber,
      snapshot: revisionSnapshot,
      archivedById: actor.id,
      archivedAt,
    },
  });
  const productIds = report.products.filter(link => !link.product.deletedAt).map(link => link.drawingLibraryItemId);
  if (productIds.length) {
    await tx.internalQualityRiskRevisionProduct.createMany({
      data: productIds.map(drawingLibraryItemId => ({ revisionId: revision.id, drawingLibraryItemId })),
      skipDuplicates: true,
    });
  }
  if (report.attachments.length) {
    await tx.internalQualityRiskRevisionAttachment.createMany({
      data: report.attachments.map((attachment, sortOrder) => ({ revisionId: revision.id, attachmentId: attachment.id, sortOrder })),
      skipDuplicates: true,
    });
  }
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: {
      status: 'ARCHIVED',
      currentRevisionId: revision.id,
      archivedAt,
      archivedById: actor.id,
      updatedById: actor.id,
      warningState: 'ACTIVE',
      warningPublishedAt: archivedAt,
      warningRevokedAt: null,
      warningRevokeReason: null,
      version: { increment: 1 },
    },
  });
  const productWorkOrders = productIds.length ? await tx.workOrder.findMany({
    where: { drawingLibraryItemId: { in: productIds }, deletedAt: null },
    select: { id: true },
  }) : [];
  const directSource = new Map(report.workOrders
    .filter(link => !link.workOrder.deletedAt && link.source !== 'PRODUCT_AUTO')
    .map(link => [link.workOrderId, link.source]));
  const workOrderSources = new Map<string, string>();
  directSource.forEach((source, id) => workOrderSources.set(id, source));
  productWorkOrders.forEach(order => { if (!workOrderSources.has(order.id)) workOrderSources.set(order.id, 'PRODUCT_AUTO'); });
  const activeWorkOrders = [...workOrderSources.entries()].map(([workOrderId, source]) => ({ workOrderId, source }));
  const autoLinks = activeWorkOrders.filter(link => link.source === 'PRODUCT_AUTO');
  if (autoLinks.length) {
    await tx.internalQualityRiskWorkOrder.createMany({
      data: autoLinks.map(link => ({ reportId, workOrderId: link.workOrderId, source: 'PRODUCT_AUTO' })),
      skipDuplicates: true,
    });
  }
  if (activeWorkOrders.length) {
    await tx.workOrderQualityAlert.createMany({
      data: activeWorkOrders.map(link => ({
        ...alertCreateData(report, revision.id, link.workOrderId, link.source === 'PRODUCT_AUTO' ? 'PRODUCT_AUTO_ARCHIVE' : 'DIRECT_ARCHIVE', revisionSnapshot, archivedAt),
        archivedAt,
      })),
    });
  }
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'ARCHIVED', `确认归档 R${readiness.revisionNumber} 并同步 ${activeWorkOrders.length} 条工单质量预警`, {
      revisionId: revision.id,
      revisionNumber: readiness.revisionNumber,
      workOrderIds: activeWorkOrders.map(link => link.workOrderId),
      warningCodes: readiness.warnings.map(item => item.code),
    }),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

export async function startInternalQualityRiskRevision(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  if (report.status !== 'ARCHIVED') throw new InternalQualityRiskError('只有已归档异常才能启动修订', 409, 'QUALITY_RISK_REVISION_INVALID');
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: { status: 'REVISING', updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'REVISION_STARTED', '启动新修订；上一归档版本的工单预警继续有效，直至新版本归档'),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

const WORKFLOW_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['CONTAINMENT', 'COLLABORATING'],
  CONTAINMENT: ['COLLABORATING'],
  COLLABORATING: ['VERIFYING'],
  VERIFYING: ['COLLABORATING', 'PENDING_CLOSE'],
  PENDING_CLOSE: ['COLLABORATING'],
  REVISING: ['COLLABORATING', 'VERIFYING', 'PENDING_CLOSE'],
};

export async function transitionInternalQualityRiskWorkflow(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  targetStatus: string,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const target = String(targetStatus || '').trim().toUpperCase();
  if (!INTERNAL_QUALITY_RISK_STATUSES.includes(target as InternalQualityRiskStatus) || target === 'ARCHIVED') {
    throw new InternalQualityRiskError('目标流程状态无效', 400, 'QUALITY_RISK_WORKFLOW_STATUS_INVALID');
  }
  if (!WORKFLOW_TRANSITIONS[report.status]?.includes(target)) {
    throw new InternalQualityRiskError(`当前状态不能流转到 ${target}`, 409, 'QUALITY_RISK_WORKFLOW_TRANSITION_INVALID');
  }
  if (target === 'VERIFYING' || target === 'PENDING_CLOSE') {
    const tasks = await tx.internalQualityRiskTask.findMany({ where: { reportId } });
    const incomplete = tasks.filter(task => target === 'VERIFYING'
      ? ['TODO', 'IN_PROGRESS'].includes(task.status)
      : !['VERIFIED', 'CANCELLED'].includes(task.status));
    if (incomplete.length) {
      throw new InternalQualityRiskError(`${incomplete.length} 项协同任务尚未满足当前流转条件`, 409, 'QUALITY_RISK_TASKS_INCOMPLETE');
    }
  }
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: { status: target, updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'WORKFLOW_TRANSITIONED', `${report.status} → ${target}`, { from: report.status, to: target }),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

type QualityRiskTaskInput = {
  taskType?: unknown;
  title?: unknown;
  department?: unknown;
  ownerName?: unknown;
  requirement?: unknown;
  dueAt?: unknown;
  sortOrder?: unknown;
};

export async function createInternalQualityRiskTask(
  tx: Prisma.TransactionClient,
  reportId: string,
  input: QualityRiskTaskInput,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  if (report.status === 'ARCHIVED') throw new InternalQualityRiskError('已归档异常不能新增协同任务，请先启动修订', 409, 'QUALITY_RISK_ARCHIVED_IMMUTABLE');
  const title = cleanText(input.title, 180);
  const department = cleanText(input.department, 120);
  if (!title || !department) throw new InternalQualityRiskError('任务标题和责任部门不能为空');
  const taskType = String(input.taskType || 'COLLABORATION').trim().toUpperCase();
  if (!INTERNAL_QUALITY_RISK_TASK_TYPES.includes(taskType as typeof INTERNAL_QUALITY_RISK_TASK_TYPES[number])) {
    throw new InternalQualityRiskError('协同任务类型无效');
  }
  const dueAt = parseDate(input.dueAt, '任务截止日期');
  const task = await tx.internalQualityRiskTask.create({ data: {
    reportId,
    taskType,
    title,
    department,
    ownerName: cleanText(input.ownerName, 120),
    requirement: longText(input.requirement, 4_000),
    dueAt,
    sortOrder: Math.max(0, Math.min(Number(input.sortOrder) || 0, 10_000)),
  } });
  const nextStatus = ['SUBMITTED', 'CONTAINMENT'].includes(report.status) ? 'COLLABORATING' : report.status;
  await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { status: nextStatus, updatedById: actor.id, version: { increment: 1 } } });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'TASK_CREATED', `建立${department}协同任务：${title}`, { taskId: task.id, taskType, dueAt: dueAt?.toISOString() || null }),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

export async function updateInternalQualityRiskTask(
  tx: Prisma.TransactionClient,
  reportId: string,
  taskId: string,
  input: Record<string, unknown>,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  if (report.status === 'ARCHIVED') throw new InternalQualityRiskError('已归档异常不能修改协同任务，请先启动修订', 409, 'QUALITY_RISK_ARCHIVED_IMMUTABLE');
  const task = await tx.internalQualityRiskTask.findFirst({ where: { id: taskId, reportId } });
  if (!task) throw new InternalQualityRiskError('协同任务不存在', 404, 'QUALITY_RISK_TASK_NOT_FOUND');
  const status = String(input.status || task.status).trim().toUpperCase();
  if (!INTERNAL_QUALITY_RISK_TASK_STATUSES.includes(status as typeof INTERNAL_QUALITY_RISK_TASK_STATUSES[number])) {
    throw new InternalQualityRiskError('任务状态无效');
  }
  const result = input.result === undefined ? task.result : longText(input.result, 8_000);
  if ((status === 'COMPLETED' || status === 'VERIFIED') && !result) {
    throw new InternalQualityRiskError('任务完成或验证时必须填写处理结果');
  }
  const now = new Date();
  await tx.internalQualityRiskTask.update({ where: { id: taskId }, data: {
    status,
    result,
    ownerName: input.ownerName === undefined ? task.ownerName : cleanText(input.ownerName, 120),
    requirement: input.requirement === undefined ? task.requirement : longText(input.requirement, 4_000),
    dueAt: input.dueAt === undefined ? task.dueAt : parseDate(input.dueAt, '任务截止日期'),
    completedAt: ['COMPLETED', 'VERIFIED'].includes(status) ? task.completedAt || now : null,
    verifiedAt: status === 'VERIFIED' ? now : null,
  } });
  await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { updatedById: actor.id, version: { increment: 1 } } });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'TASK_UPDATED', `${task.department}任务“${task.title}”更新为 ${status}`, { taskId, from: task.status, to: status }),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

export async function revokeInternalQualityRiskWarning(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  reason: string,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  if (report.warningState !== 'ACTIVE') throw new InternalQualityRiskError('当前没有正在生效的产品警示', 409, 'QUALITY_RISK_WARNING_NOT_ACTIVE');
  const content = cleanText(reason, 500);
  if (!content) throw new InternalQualityRiskError('撤销产品警示必须填写原因');
  const revokedAt = new Date();
  await tx.workOrderQualityAlert.updateMany({
    where: { reportId, state: { in: [...QUALITY_ALERT_ACTIVE_STATES] } },
    data: { state: 'REVOKED', revokedAt, revokeReason: content },
  });
  await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: {
    warningState: 'REVOKED', warningRevokedAt: revokedAt, warningRevokeReason: content, updatedById: actor.id, version: { increment: 1 },
  } });
  await tx.internalQualityRiskActivity.create({ data: activityData(reportId, actor, 'WARNING_REVOKED', content) });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

export async function softDeleteInternalQualityRisk(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  reason: string,
  actor: InternalQualityRiskActor,
): Promise<void> {
  await lockRiskReport(tx, reportId);
  const report = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const content = cleanText(reason, 500);
  if (!content) throw new InternalQualityRiskError('移入回收站必须填写删除原因');
  if (report.warningState === 'ACTIVE') {
    throw new InternalQualityRiskError('该异常仍在发布产品警示；请先单独撤销警示并填写撤销原因，再移入回收站', 409, 'QUALITY_RISK_WARNING_WITHDRAW_REQUIRED');
  }
  const deletedAt = new Date();
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'DELETED', content, { previousStatus: report.status, previousVersion: report.version }),
  });
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: {
      deletedAt,
      deletedById: actor.id,
      deleteReason: content,
      updatedById: actor.id,
      version: { increment: 1 },
    },
  });
}

export async function restoreInternalQualityRisk(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  actor: InternalQualityRiskActor,
): Promise<InternalQualityRiskRecord> {
  await lockRiskReport(tx, reportId);
  const base = await tx.internalQualityRiskReport.findFirst({ where: { id: reportId, deletedAt: { not: null } } });
  if (!base) throw new InternalQualityRiskError('回收站中未找到该异常汇总', 404, 'QUALITY_RISK_NOT_FOUND');
  assertExpectedVersion(base.version, expectedVersion);
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: { deletedAt: null, deletedById: null, deleteReason: null, updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'RESTORED', '从回收站恢复异常汇总；已撤销的产品警示不会自动重新发布'),
  });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}

export async function permanentlyDeleteInternalQualityRisk(
  tx: Prisma.TransactionClient,
  reportId: string,
  confirmation: string,
): Promise<{ reportNo: string }> {
  await lockRiskReport(tx, reportId);
  const report = await tx.internalQualityRiskReport.findFirst({
    where: { id: reportId, deletedAt: { not: null } },
    include: { alerts: { select: { state: true } } },
  });
  if (!report) throw new InternalQualityRiskError('回收站中未找到该异常汇总', 404, 'QUALITY_RISK_NOT_FOUND');
  if (confirmation.trim() !== report.reportNo) throw new InternalQualityRiskError('请输入完整异常汇总编号确认彻底删除');
  const eligibleAt = qualityRiskPurgeEligibleAt(report.deletedAt)!;
  if (eligibleAt > new Date()) {
    throw new InternalQualityRiskError(`进入回收站满 ${QUALITY_RISK_PURGE_RETENTION_DAYS} 天后才可彻底删除`, 409, 'QUALITY_RISK_PURGE_RETENTION');
  }
  if (report.alerts.some(alert => QUALITY_ALERT_ACTIVE_STATES.includes(alert.state as typeof QUALITY_ALERT_ACTIVE_STATES[number]))) {
    throw new InternalQualityRiskError('仍存在活动工单预警，不能彻底删除', 409, 'QUALITY_RISK_ACTIVE_ALERTS');
  }
  await tx.internalQualityRiskReport.delete({ where: { id: reportId } });
  return { reportNo: report.reportNo };
}

export async function loadInternalQualityRisks(input: {
  keyword?: string;
  status?: string;
  severity?: string;
  productId?: string;
  issueId?: string;
  workOrderId?: string;
  limit?: number;
} = {}) {
  const keyword = cleanText(input.keyword, 180) || '';
  const status = String(input.status || 'all');
  const deletedMode = status === 'DELETED';
  const and: Prisma.InternalQualityRiskReportWhereInput[] = [];
  if (status === 'SUBMITTED') and.push({ status: { in: ['SUBMITTED', 'CONTAINMENT'] } });
  else if (INTERNAL_QUALITY_RISK_STATUSES.includes(status as InternalQualityRiskStatus)) and.push({ status });
  if (status === 'UNLINKED') and.push({ OR: [{ issues: { none: {} } }, { AND: [{ workOrders: { none: {} } }, { products: { none: {} } }] }] });
  if (input.severity && INTERNAL_QUALITY_RISK_SEVERITIES.includes(input.severity as InternalQualityRiskSeverity)) and.push({ severity: input.severity });
  if (input.productId) and.push({ products: { some: { drawingLibraryItemId: input.productId } } });
  if (input.issueId) and.push({ issues: { some: { issueId: input.issueId } } });
  if (input.workOrderId) and.push({ workOrders: { some: { workOrderId: input.workOrderId } } });
  if (keyword) {
    const sequence = Number(keyword.replace(/^(?:IQ|IQR)-/i, ''));
    and.push({ OR: [
      { reportNo: { contains: keyword, mode: 'insensitive' } },
      { title: { contains: keyword, mode: 'insensitive' } },
      { defectPhenomenon: { contains: keyword, mode: 'insensitive' } },
      { rootCause: { contains: keyword, mode: 'insensitive' } },
      { finalConclusion: { contains: keyword, mode: 'insensitive' } },
      { workOrders: { some: { workOrder: { OR: [
        { code: { contains: keyword, mode: 'insensitive' } },
        { businessCode: { contains: keyword, mode: 'insensitive' } },
        { specification: { contains: keyword, mode: 'insensitive' } },
      ] } } } },
      { products: { some: { product: { OR: [
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { productName: { contains: keyword, mode: 'insensitive' } },
        { specification: { contains: keyword, mode: 'insensitive' } },
      ] } } } },
      { issues: { some: { issue: { title: { contains: keyword, mode: 'insensitive' } } } } },
      ...(Number.isInteger(sequence) && sequence > 0 ? [{ sequence }] : []),
    ] });
  }
  const where: Prisma.InternalQualityRiskReportWhereInput = {
    deletedAt: deletedMode ? { not: null } : null,
    ...(and.length ? { AND: and } : {}),
  };
  const limit = Math.min(Math.max(Number(input.limit) || 300, 1), 600);
  const [records, total, draft, submitted, collaborating, verifying, pendingClose, revising, archived, deleted, critical, activeAlerts, unlinked, overdueTasks] = await Promise.all([
    prisma.internalQualityRiskReport.findMany({ where, include: internalQualityRiskInclude, orderBy: [{ updatedAt: 'desc' }], take: limit }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'DRAFT' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: { in: ['SUBMITTED', 'CONTAINMENT'] } } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'COLLABORATING' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'VERIFYING' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'PENDING_CLOSE' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'REVISING' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'ARCHIVED' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: { not: null } } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, severity: 'CRITICAL' } }),
    prisma.workOrderQualityAlert.count({ where: { state: { in: [...QUALITY_ALERT_ACTIVE_STATES] }, report: { deletedAt: null } } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, OR: [{ issues: { none: {} } }, { AND: [{ workOrders: { none: {} } }, { products: { none: {} } }] }] } }),
    prisma.internalQualityRiskTask.count({ where: { report: { deletedAt: null }, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } } }),
  ]);
  return {
    reports: records.map(serializeInternalQualityRisk),
    summary: { total, draft, submitted, collaborating, verifying, pendingClose, revising, archived, deleted, critical, activeAlerts, unlinked, overdueTasks },
  };
}

export async function loadInternalQualityRisk(reportId: string, includeDeleted = false) {
  const report = await prisma.internalQualityRiskReport.findFirst({
    where: { id: reportId, ...(includeDeleted ? {} : { deletedAt: null }) },
    include: internalQualityRiskInclude,
  });
  if (!report) throw new InternalQualityRiskError('内部重大异常不存在', 404, 'QUALITY_RISK_NOT_FOUND');
  return serializeInternalQualityRisk(report);
}

export async function loadInternalQualityRiskOptions() {
  const [products, issues, workOrders, eightDReports] = await Promise.all([
    prisma.drawingLibraryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, customerName: true, customerCode: true, productName: true, specification: true },
      orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
      take: 1_500,
    }),
    prisma.issue.findMany({
      where: { deletedAt: null },
      include: { workOrder: { select: workOrderSelect }, majorApprovals: { orderBy: { round: 'desc' }, take: 1, select: { status: true, round: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 1_500,
    }),
    prisma.workOrder.findMany({
      where: { deletedAt: null },
      select: workOrderSelect,
      orderBy: [{ updatedAt: 'desc' }],
      take: 2_500,
    }),
    prisma.eightDReport.findMany({
      where: { deletedAt: null },
      select: { id: true, reportNo: true, title: true, status: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 1_000,
    }),
  ]);
  return {
    products,
    issues: issues.map(issue => ({
      id: issue.id,
      sequence: issue.sequence,
      code: issueCode(issue.sequence),
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      type: issue.type,
      isMajorQuality: issue.isMajorQuality,
      majorApprovalStatus: issue.majorApprovals[0]?.status || null,
      workOrder: issue.workOrder ? serializeWorkOrder(issue.workOrder) : null,
      updatedAt: issue.updatedAt.toISOString(),
    })),
    workOrders: workOrders.map(serializeWorkOrder),
    eightDReports: eightDReports.map(report => ({ ...report, updatedAt: report.updatedAt.toISOString() })),
  };
}

export async function materializeProductQualityWarningsForWorkOrders(workOrderIdsInput: readonly string[]): Promise<number> {
  const workOrderIds = [...new Set(workOrderIdsInput.filter(Boolean))];
  if (!workOrderIds.length) return 0;
  const workOrders = await prisma.workOrder.findMany({
    where: { id: { in: workOrderIds }, deletedAt: null, drawingLibraryItemId: { not: null } },
    select: { id: true, drawingLibraryItemId: true },
  });
  if (!workOrders.length) return 0;
  const productIds = [...new Set(workOrders.map(order => order.drawingLibraryItemId).filter((id): id is string => Boolean(id)))];
  const now = new Date();
  const reports = await prisma.internalQualityRiskReport.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ARCHIVED', 'REVISING'] },
      warningState: 'ACTIVE',
      currentRevisionId: { not: null },
      currentRevision: { is: { products: { some: { drawingLibraryItemId: { in: productIds } } } } },
      AND: [
        { OR: [{ warningRevokedAt: null }, { warningRevokedAt: { gt: now } }] },
      ],
    },
    include: internalQualityRiskInclude,
  });
  if (!reports.length) return 0;
  let created = 0;
  await prisma.$transaction(async tx => {
    for (const report of reports) {
      if (!report.currentRevision) continue;
      const warning = resolveArchivedQualityWarning(report, report.currentRevision.snapshot);
      if ((warning.effectiveFrom && warning.effectiveFrom > now) || (warning.effectiveUntil && warning.effectiveUntil < now)) continue;
      const reportProductIds = new Set(report.currentRevision.products.map(link => link.drawingLibraryItemId));
      for (const workOrder of workOrders.filter(order => order.drawingLibraryItemId && reportProductIds.has(order.drawingLibraryItemId))) {
        await tx.internalQualityRiskWorkOrder.upsert({
          where: { reportId_workOrderId: { reportId: report.id, workOrderId: workOrder.id } },
          create: { reportId: report.id, workOrderId: workOrder.id, source: 'PRODUCT_AUTO' },
          update: {},
        });
        const existing = await tx.workOrderQualityAlert.findUnique({
          where: { revisionId_workOrderId: { revisionId: report.currentRevisionId!, workOrderId: workOrder.id } },
          select: { id: true },
        });
        if (!existing) created += 1;
        await tx.workOrderQualityAlert.upsert({
          where: { revisionId_workOrderId: { revisionId: report.currentRevisionId!, workOrderId: workOrder.id } },
          create: alertCreateData(
            report,
            report.currentRevisionId!,
            workOrder.id,
            'PRODUCT_AUTO_ARCHIVE',
            report.currentRevision.snapshot,
            report.currentRevision.archivedAt,
          ),
          update: {},
        });
      }
    }
  });
  return created;
}

export async function loadWorkOrderQualityAlerts(workOrderId: string) {
  const workOrder = await prisma.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null }, select: workOrderSelect });
  if (!workOrder) throw new InternalQualityRiskError('工单不存在或已删除', 404, 'QUALITY_RISK_WORK_ORDER_NOT_FOUND');
  await materializeProductQualityWarningsForWorkOrders([workOrderId]);
  const now = new Date();
  const [alerts] = await Promise.all([
    prisma.workOrderQualityAlert.findMany({
      where: {
        workOrderId,
        state: { in: [...QUALITY_ALERT_ACTIVE_STATES] },
        report: { deletedAt: null },
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
        ],
      },
      include: workOrderQualityAlertInclude,
      orderBy: [{ severity: 'desc' }, { archivedAt: 'desc' }],
    }),
  ]);
  return {
    workOrder: serializeWorkOrder(workOrder),
    alerts: alerts.map(serializeWorkOrderQualityAlert),
    suggestions: [],
  };
}

export async function acknowledgeWorkOrderQualityAlert(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  alertId: string,
  note: string,
  actor: InternalQualityRiskActor,
): Promise<WorkOrderQualityAlertRecord> {
  const alert = await tx.workOrderQualityAlert.findFirst({
    where: { id: alertId, workOrderId, state: { in: [...QUALITY_ALERT_ACTIVE_STATES] }, report: { deletedAt: null } },
  });
  if (!alert) throw new InternalQualityRiskError('质量预警不存在或已经失效', 404, 'QUALITY_ALERT_NOT_FOUND');
  const content = cleanText(note, 500);
  await tx.workOrderQualityAlertAcknowledgement.upsert({
    where: { alertId_acknowledgedById: { alertId, acknowledgedById: actor.id } },
    create: { alertId, acknowledgedById: actor.id, note: content },
    update: { note: content, acknowledgedAt: new Date() },
  });
  await tx.internalQualityRiskActivity.create({
    data: activityData(alert.reportId, actor, 'ALERT_ACKNOWLEDGED', `已知悉工单质量预警${content ? `：${content}` : ''}`, { alertId, workOrderId }),
  });
  return tx.workOrderQualityAlert.findUniqueOrThrow({ where: { id: alertId }, include: workOrderQualityAlertInclude });
}

export async function confirmProductRiskForWorkOrder(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  reportId: string,
  expectedVersion: number,
  actor: InternalQualityRiskActor,
): Promise<void> {
  await lockRiskReport(tx, reportId);
  const base = await activeRiskForMutation(tx, reportId);
  assertExpectedVersion(base.version, expectedVersion);
  if (!['ARCHIVED', 'REVISING'].includes(base.status) || !base.currentRevisionId) {
    throw new InternalQualityRiskError('只有已归档异常可同步为产品风险预警', 409, 'QUALITY_RISK_NOT_ARCHIVED');
  }
  const [workOrder, report] = await Promise.all([
    tx.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null }, select: workOrderSelect }),
    tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude }),
  ]);
  if (!workOrder) throw new InternalQualityRiskError('工单不存在或已删除', 404, 'QUALITY_RISK_WORK_ORDER_NOT_FOUND');
  if (!workOrder.drawingLibraryItemId || !report.currentRevision?.products.some(link => link.drawingLibraryItemId === workOrder.drawingLibraryItemId)) {
    throw new InternalQualityRiskError('该工单与异常汇总没有相同的产品主数据', 409, 'QUALITY_RISK_PRODUCT_MISMATCH');
  }
  await tx.internalQualityRiskWorkOrder.upsert({
    where: { reportId_workOrderId: { reportId, workOrderId } },
    create: { reportId, workOrderId, source: 'PRODUCT_CONFIRMATION' },
    update: { source: 'PRODUCT_CONFIRMATION' },
  });
  const alertData = alertCreateData(
    report,
    report.currentRevisionId!,
    workOrderId,
    'PRODUCT_SUGGESTION_CONFIRMED',
    report.currentRevision.snapshot,
    report.currentRevision.archivedAt,
  );
  await tx.workOrderQualityAlert.upsert({
    where: { revisionId_workOrderId: { revisionId: report.currentRevisionId!, workOrderId } },
    create: alertData,
    update: {
      state: 'ACTIVE',
      source: 'PRODUCT_SUGGESTION_CONFIRMED',
      severity: alertData.severity,
      title: alertData.title,
      defectPhenomenon: alertData.defectPhenomenon,
      rootCause: alertData.rootCause,
      finalConclusion: alertData.finalConclusion,
      controlRequirement: alertData.controlRequirement,
      warningSummary: alertData.warningSummary,
      requiredAction: alertData.requiredAction,
      inspectionMethod: alertData.inspectionMethod,
      inspectionFrequency: alertData.inspectionFrequency,
      acceptanceCriteria: alertData.acceptanceCriteria,
      stopConditions: alertData.stopConditions,
      escalationContact: alertData.escalationContact,
      printPolicy: alertData.printPolicy,
      applicableProcess: alertData.applicableProcess,
      effectiveFrom: alertData.effectiveFrom,
      effectiveUntil: alertData.effectiveUntil,
      revokedAt: null,
      revokeReason: null,
    },
  });
  await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { updatedById: actor.id, version: { increment: 1 } } });
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'PRODUCT_RISK_CONFIRMED', `确认同产品历史风险并同步到工单 ${workOrder.businessCode || workOrder.code}`, {
      workOrderId,
      drawingLibraryItemId: workOrder.drawingLibraryItemId,
      revisionId: report.currentRevisionId,
    }),
  });
}
