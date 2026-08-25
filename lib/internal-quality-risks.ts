import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const INTERNAL_QUALITY_RISK_STATUSES = ['DRAFT', 'REVISING', 'ARCHIVED'] as const;
export const INTERNAL_QUALITY_RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const QUALITY_ALERT_ACTIVE_STATES = ['ACTIVE', 'ACKNOWLEDGED'] as const;
export const QUALITY_RISK_PURGE_RETENTION_DAYS = 30;

export type InternalQualityRiskStatus = typeof INTERNAL_QUALITY_RISK_STATUSES[number];
export type InternalQualityRiskSeverity = typeof INTERNAL_QUALITY_RISK_SEVERITIES[number];
export type InternalQualityRiskActor = { id: string; name: string };

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
  issueIds: string[];
  workOrderIds: string[];
  productIds: string[];
  eightDReportIds: string[];
};

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
  currentRevision: true,
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
      data: input.workOrderIds.map(workOrderId => ({ reportId, workOrderId, source: existingWorkOrderSource.get(workOrderId) || 'DIRECT' })),
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
  const required: Array<[keyof InternalQualityRiskRecord, string, string]> = [
    ['defectPhenomenon', 'QUALITY_RISK_DEFECT_REQUIRED', '请完整填写不良现象'],
    ['occurrenceCause', 'QUALITY_RISK_OCCURRENCE_CAUSE_REQUIRED', '请填写发生原因'],
    ['escapeCause', 'QUALITY_RISK_ESCAPE_CAUSE_REQUIRED', '请填写流出原因'],
    ['rootCause', 'QUALITY_RISK_ROOT_CAUSE_REQUIRED', '请填写根本原因'],
    ['containmentAction', 'QUALITY_RISK_CONTAINMENT_REQUIRED', '请填写临时遏制措施'],
    ['correctiveAction', 'QUALITY_RISK_CORRECTIVE_REQUIRED', '请填写纠正措施'],
    ['verificationResult', 'QUALITY_RISK_VERIFICATION_REQUIRED', '请填写措施验证结果'],
    ['finalConclusion', 'QUALITY_RISK_CONCLUSION_REQUIRED', '请填写最终结论'],
  ];
  required.forEach(([field, code, message]) => { if (!report[field]) blockers.push({ code, message }); });
  if (!report.issues.length) blockers.push({ code: 'QUALITY_RISK_SOURCE_ISSUE_REQUIRED', message: '至少关联一个有效来源质量问题' });
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
  if ((report.severity === 'HIGH' || report.severity === 'CRITICAL')
    && !report.evidenceSummary && !report.eightDReports.length) {
    blockers.push({ code: 'QUALITY_RISK_EVIDENCE_REQUIRED', message: '高风险/重大风险归档前需填写证据摘要或关联8D档案' });
  }
  const skippedImpacts = (report.workOrders.length - activeWorkOrders.length) + (report.products.length - activeProducts.length);
  if (skippedImpacts) warnings.push({ code: 'QUALITY_RISK_DELETED_IMPACT_SKIPPED', message: `${skippedImpacts} 个已删除的工单或产品不会进入归档预警范围` });
  if (!activeWorkOrders.length) warnings.push({ code: 'QUALITY_RISK_NO_DIRECT_WORK_ORDER', message: '当前仅关联产品，归档不会直接生成工单预警' });
  if (!report.eightDReports.length) warnings.push({ code: 'QUALITY_RISK_NO_EIGHT_D', message: '尚未关联8D档案，可使用问题附件与证据摘要作为当前依据' });
  if (!report.preventiveAction) warnings.push({ code: 'QUALITY_RISK_PREVENTIVE_EMPTY', message: '建议补充预防再发措施' });
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
  return { report: serializeInternalQualityRisk(report), readiness: evaluateInternalQualityRiskReadiness(report) };
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
    issues: report.issues.map(link => ({ id: link.issue.id, code: issueCode(link.issue.sequence), title: link.issue.title, version: link.issue.version })),
    workOrders: report.workOrders.map(link => ({ id: link.workOrder.id, code: link.workOrder.code, businessCode: link.workOrder.businessCode, source: link.source })),
    products: report.products.map(link => ({ id: link.product.id, specification: link.product.specification, customerName: link.product.customerName })),
    eightDReports: report.eightDReports.map(link => ({ id: link.eightDReport.id, reportNo: link.eightDReport.reportNo, title: link.eightDReport.title })),
  } as Prisma.InputJsonValue;
}

function controlRequirement(report: Pick<InternalQualityRiskRecord, 'containmentAction' | 'correctiveAction' | 'preventiveAction'>): string | null {
  const items = [
    report.containmentAction ? `临时遏制：${report.containmentAction}` : '',
    report.correctiveAction ? `纠正措施：${report.correctiveAction}` : '',
    report.preventiveAction ? `预防再发：${report.preventiveAction}` : '',
  ].filter(Boolean);
  return items.length ? items.join('\n') : null;
}

function alertCreateData(report: InternalQualityRiskRecord, revisionId: string, workOrderId: string, source: string) {
  return {
    id: crypto.randomUUID(),
    reportId: report.id,
    revisionId,
    workOrderId,
    state: 'ACTIVE',
    source,
    severity: report.severity,
    title: report.title,
    defectPhenomenon: report.defectPhenomenon,
    rootCause: report.rootCause,
    finalConclusion: report.finalConclusion,
    controlRequirement: controlRequirement(report),
    applicableProcess: report.applicableProcess,
    effectiveFrom: report.effectiveFrom,
    effectiveUntil: report.effectiveUntil,
    archivedAt: report.archivedAt || new Date(),
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
  const revision = await tx.internalQualityRiskRevision.create({
    data: {
      reportId,
      revisionNumber: readiness.revisionNumber,
      snapshot: snapshotFor(report, readiness.revisionNumber),
      archivedById: actor.id,
      archivedAt,
    },
  });
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: {
      status: 'ARCHIVED',
      currentRevisionId: revision.id,
      archivedAt,
      archivedById: actor.id,
      updatedById: actor.id,
      version: { increment: 1 },
    },
  });
  const activeWorkOrders = report.workOrders.filter(link => !link.workOrder.deletedAt);
  if (activeWorkOrders.length) {
    await tx.workOrderQualityAlert.createMany({
      data: activeWorkOrders.map(link => ({
        ...alertCreateData({ ...report, archivedAt }, revision.id, link.workOrderId, 'DIRECT_ARCHIVE'),
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
  const deletedAt = new Date();
  await tx.workOrderQualityAlert.updateMany({
    where: { reportId, state: { in: [...QUALITY_ALERT_ACTIVE_STATES] } },
    data: { state: 'REVOKED', revokedAt: deletedAt, revokeReason: `异常汇总进入回收站：${content}` },
  });
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
  const report = await tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
  await tx.internalQualityRiskReport.update({
    where: { id: reportId },
    data: { deletedAt: null, deletedById: null, deleteReason: null, updatedById: actor.id, version: { increment: 1 } },
  });
  let reactivated = 0;
  if (report.currentRevisionId) {
    for (const link of report.workOrders.filter(item => !item.workOrder.deletedAt)) {
      const existing = await tx.workOrderQualityAlert.findUnique({
        where: { revisionId_workOrderId: { revisionId: report.currentRevisionId, workOrderId: link.workOrderId } },
      });
      if (existing) {
        await tx.workOrderQualityAlert.update({
          where: { id: existing.id },
          data: { state: 'ACTIVE', revokedAt: null, revokeReason: null },
        });
      } else {
        await tx.workOrderQualityAlert.create({
          data: alertCreateData(report, report.currentRevisionId, link.workOrderId, link.source === 'PRODUCT_CONFIRMATION' ? 'PRODUCT_SUGGESTION_CONFIRMED' : 'DIRECT_ARCHIVE'),
        });
      }
      reactivated += 1;
    }
  }
  await tx.internalQualityRiskActivity.create({
    data: activityData(reportId, actor, 'RESTORED', `从回收站恢复异常汇总${reactivated ? `，重新启用 ${reactivated} 条工单预警` : ''}`),
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
  if (status === 'DRAFT' || status === 'REVISING' || status === 'ARCHIVED') and.push({ status });
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
  const [records, draft, revising, archived, deleted, critical, activeAlerts, unlinked] = await Promise.all([
    prisma.internalQualityRiskReport.findMany({ where, include: internalQualityRiskInclude, orderBy: [{ updatedAt: 'desc' }], take: limit }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'DRAFT' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'REVISING' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, status: 'ARCHIVED' } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: { not: null } } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, severity: 'CRITICAL', status: { in: ['DRAFT', 'REVISING', 'ARCHIVED'] } } }),
    prisma.workOrderQualityAlert.count({ where: { state: { in: [...QUALITY_ALERT_ACTIVE_STATES] }, report: { deletedAt: null } } }),
    prisma.internalQualityRiskReport.count({ where: { deletedAt: null, OR: [{ issues: { none: {} } }, { AND: [{ workOrders: { none: {} } }, { products: { none: {} } }] }] } }),
  ]);
  return {
    reports: records.map(serializeInternalQualityRisk),
    summary: { total: draft + revising + archived, draft, revising, archived, deleted, critical, activeAlerts, unlinked },
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

export async function loadWorkOrderQualityAlerts(workOrderId: string) {
  const workOrder = await prisma.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null }, select: workOrderSelect });
  if (!workOrder) throw new InternalQualityRiskError('工单不存在或已删除', 404, 'QUALITY_RISK_WORK_ORDER_NOT_FOUND');
  const now = new Date();
  const [alerts, suggestions] = await Promise.all([
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
    workOrder.drawingLibraryItemId ? prisma.internalQualityRiskReport.findMany({
      where: {
        deletedAt: null,
        status: 'ARCHIVED',
        currentRevisionId: { not: null },
        products: { some: { drawingLibraryItemId: workOrder.drawingLibraryItemId } },
        workOrders: { none: { workOrderId } },
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
        ],
      },
      select: {
        id: true,
        reportNo: true,
        title: true,
        severity: true,
        defectPhenomenon: true,
        rootCause: true,
        finalConclusion: true,
        applicableProcess: true,
        effectiveUntil: true,
        version: true,
        currentRevision: { select: { revisionNumber: true, archivedAt: true } },
      },
      orderBy: [{ severity: 'desc' }, { archivedAt: 'desc' }],
      take: 20,
    }) : Promise.resolve([]),
  ]);
  return {
    workOrder: serializeWorkOrder(workOrder),
    alerts: alerts.map(serializeWorkOrderQualityAlert),
    suggestions: suggestions.map(report => ({
      id: report.id,
      reportNo: report.reportNo,
      title: report.title,
      severity: report.severity,
      defectPhenomenon: report.defectPhenomenon,
      rootCause: report.rootCause,
      finalConclusion: report.finalConclusion,
      applicableProcess: report.applicableProcess,
      effectiveUntil: report.effectiveUntil?.toISOString() || null,
      version: report.version,
      revisionNumber: report.currentRevision?.revisionNumber || null,
      archivedAt: report.currentRevision?.archivedAt.toISOString() || null,
      reason: '该工单与已归档异常关联同一产品主数据，需要质量人员确认后才同步预警',
    })),
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
  await tx.workOrderQualityAlert.update({ where: { id: alertId }, data: { state: 'ACKNOWLEDGED' } });
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
  if (base.status !== 'ARCHIVED' || !base.currentRevisionId) {
    throw new InternalQualityRiskError('只有已归档异常可同步为产品风险预警', 409, 'QUALITY_RISK_NOT_ARCHIVED');
  }
  const [workOrder, report] = await Promise.all([
    tx.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null }, select: workOrderSelect }),
    tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude }),
  ]);
  if (!workOrder) throw new InternalQualityRiskError('工单不存在或已删除', 404, 'QUALITY_RISK_WORK_ORDER_NOT_FOUND');
  if (!workOrder.drawingLibraryItemId || !report.products.some(link => link.drawingLibraryItemId === workOrder.drawingLibraryItemId)) {
    throw new InternalQualityRiskError('该工单与异常汇总没有相同的产品主数据', 409, 'QUALITY_RISK_PRODUCT_MISMATCH');
  }
  await tx.internalQualityRiskWorkOrder.upsert({
    where: { reportId_workOrderId: { reportId, workOrderId } },
    create: { reportId, workOrderId, source: 'PRODUCT_CONFIRMATION' },
    update: { source: 'PRODUCT_CONFIRMATION' },
  });
  const alertData = alertCreateData(report, report.currentRevisionId!, workOrderId, 'PRODUCT_SUGGESTION_CONFIRMED');
  await tx.workOrderQualityAlert.upsert({
    where: { revisionId_workOrderId: { revisionId: report.currentRevisionId!, workOrderId } },
    create: alertData,
    update: {
      state: 'ACTIVE',
      source: 'PRODUCT_SUGGESTION_CONFIRMED',
      severity: report.severity,
      title: report.title,
      defectPhenomenon: report.defectPhenomenon,
      rootCause: report.rootCause,
      finalConclusion: report.finalConclusion,
      controlRequirement: controlRequirement(report),
      applicableProcess: report.applicableProcess,
      effectiveFrom: report.effectiveFrom,
      effectiveUntil: report.effectiveUntil,
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
