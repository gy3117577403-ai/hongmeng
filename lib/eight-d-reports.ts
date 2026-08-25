import type { Prisma } from '@prisma/client';
import { issueCode } from '@/lib/issues';
import { prisma } from '@/lib/prisma';
import type {
  EightDReportDTO,
  EightDReportIssueDTO,
  EightDReportOptionsDTO,
  EightDReportProductDTO,
  EightDReportStatus,
  EightDReportSummaryDTO,
  EightDReportVersionDTO,
  IssueWorkOrderDTO,
} from '@/types';

export const EIGHT_D_REPORT_STATUSES = ['active', 'archived'] as const;
export const EIGHT_D_MAX_RELATIONS = 200;

export class EightDReportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'EIGHT_D_REPORT_INVALID',
  ) {
    super(message);
    this.name = 'EightDReportError';
  }
}

export type EightDActor = { id: string; name: string };

export type EightDReportMetadataInput = {
  reportNo: string;
  title: string;
  reportDate: Date | null;
  responsibleDepartment: string | null;
  keywords: string | null;
  status: EightDReportStatus;
  productIds: string[];
  issueIds: string[];
};

export type EightDStoredPdfInput = {
  id: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  size: number;
  sha256: string;
  objectKey: string;
  pageCount?: number | null;
  note?: string | null;
};

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function parseDate(value: unknown): Date | null {
  const text = cleanText(value, 40);
  if (!text) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000+08:00`)
    : new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new EightDReportError('报告日期格式不正确');
  return parsed;
}

export function normalizeEightDRelationIds(value: unknown, max = EIGHT_D_MAX_RELATIONS): string[] {
  let source: unknown[] = [];
  if (Array.isArray(value)) source = value;
  else if (typeof value === 'string' && value.trim()) {
    try {
      const decoded = JSON.parse(value);
      source = Array.isArray(decoded) ? decoded : value.split(',');
    } catch {
      source = value.split(',');
    }
  }
  const ids = [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))];
  if (ids.length > max) throw new EightDReportError(`单次最多关联 ${max} 条记录`);
  return ids;
}

export function parseEightDReportMetadata(input: Record<string, unknown>): EightDReportMetadataInput {
  const reportNo = cleanText(input.reportNo, 80);
  const title = cleanText(input.title, 180);
  if (!reportNo) throw new EightDReportError('报告编号不能为空');
  if (!title) throw new EightDReportError('报告标题不能为空');
  const rawStatus = cleanText(input.status, 20) || 'active';
  if (!EIGHT_D_REPORT_STATUSES.includes(rawStatus as EightDReportStatus)) {
    throw new EightDReportError('8D档案状态不正确');
  }
  return {
    reportNo,
    title,
    reportDate: parseDate(input.reportDate),
    responsibleDepartment: cleanText(input.responsibleDepartment, 120),
    keywords: cleanText(input.keywords, 500),
    status: rawStatus as EightDReportStatus,
    productIds: normalizeEightDRelationIds(input.productIds),
    issueIds: normalizeEightDRelationIds(input.issueIds),
  };
}

export function expectedEightDVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new EightDReportError('缺少有效的档案版本，请刷新后重试', 409, 'EIGHT_D_VERSION_REQUIRED');
  }
  return parsed;
}

export const eightDReportInclude = {
  currentVersion: { include: { uploadedBy: { select: { displayName: true, username: true } } } },
  versions: {
    include: { uploadedBy: { select: { displayName: true, username: true } } },
    orderBy: { versionNumber: 'desc' as const },
  },
  products: {
    include: {
      product: {
        select: {
          id: true,
          customerName: true,
          customerCode: true,
          productName: true,
          specification: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  issues: {
    include: {
      issue: {
        include: {
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
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  activities: { orderBy: { createdAt: 'desc' as const }, take: 40 },
  createdBy: { select: { displayName: true, username: true } },
  updatedBy: { select: { displayName: true, username: true } },
} satisfies Prisma.EightDReportInclude;

export type EightDReportRecord = Prisma.EightDReportGetPayload<{ include: typeof eightDReportInclude }>;

function userLabel(user?: { displayName: string; username: string } | null): string | null {
  return user?.displayName || user?.username || null;
}

function serializeProduct(product: EightDReportRecord['products'][number]['product']): EightDReportProductDTO {
  return {
    id: product.id,
    customerName: product.customerName,
    customerCode: product.customerCode,
    productName: product.productName,
    specification: product.specification,
  };
}

function serializeIssueWorkOrder(workOrder: {
  id: string;
  code: string;
  specification: string | null;
  customerName: string | null;
  productName: string;
  stage: string;
  drawingStatus: string | null;
  materialStatus: string | null;
  plannedAt: Date | null;
} | null): IssueWorkOrderDTO | null {
  return workOrder ? { ...workOrder, plannedAt: workOrder.plannedAt?.toISOString() || null } : null;
}

function serializeIssue(issue: EightDReportRecord['issues'][number]['issue']): EightDReportIssueDTO {
  return {
    id: issue.id,
    sequence: issue.sequence,
    code: issueCode(issue.sequence),
    title: issue.title,
    status: issue.status as EightDReportIssueDTO['status'],
    priority: issue.priority as EightDReportIssueDTO['priority'],
    type: issue.type as EightDReportIssueDTO['type'],
    affectedQuantity: issue.affectedQuantity,
    workOrder: serializeIssueWorkOrder(issue.workOrder),
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

export function serializeEightDVersion(version: EightDReportRecord['versions'][number]): EightDReportVersionDTO {
  return {
    id: version.id,
    reportId: version.reportId,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    originalName: version.originalName,
    displayName: version.displayName,
    mimeType: version.mimeType,
    size: Number(version.size),
    sha256: version.sha256,
    pageCount: version.pageCount,
    note: version.note,
    uploadedBy: userLabel(version.uploadedBy),
    deletedAt: version.deletedAt?.toISOString() || null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    contentUrl: `/api/quality/8d/${version.reportId}/versions/${version.id}/content`,
    downloadUrl: `/api/quality/8d/${version.reportId}/versions/${version.id}/download`,
  };
}

export function serializeEightDReport(report: EightDReportRecord): EightDReportDTO {
  const versions = report.versions.map(serializeEightDVersion);
  return {
    id: report.id,
    sequence: report.sequence,
    reportNo: report.reportNo,
    title: report.title,
    reportDate: report.reportDate?.toISOString() || null,
    responsibleDepartment: report.responsibleDepartment,
    keywords: report.keywords,
    status: report.status as EightDReportStatus,
    version: report.version,
    currentVersionId: report.currentVersionId,
    deletedAt: report.deletedAt?.toISOString() || null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    createdBy: userLabel(report.createdBy),
    updatedBy: userLabel(report.updatedBy),
    products: report.products.map(link => serializeProduct(link.product)),
    issues: report.issues.map(link => serializeIssue(link.issue)),
    versions,
    currentVersion: versions.find(item => item.id === report.currentVersionId) || null,
    activities: report.activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      content: activity.content,
      actorName: activity.actorName,
      detail: activity.detail && typeof activity.detail === 'object' && !Array.isArray(activity.detail)
        ? activity.detail as Record<string, unknown>
        : null,
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}

export async function assertEightDRelations(
  tx: Prisma.TransactionClient,
  productIds: string[],
  issueIds: string[],
): Promise<void> {
  const [productCount, issueCount] = await Promise.all([
    productIds.length ? tx.drawingLibraryItem.count({ where: { id: { in: productIds }, deletedAt: null } }) : 0,
    issueIds.length ? tx.issue.count({ where: { id: { in: issueIds }, deletedAt: null } }) : 0,
  ]);
  if (productCount !== productIds.length) throw new EightDReportError('部分产品不存在或已停用', 409, 'EIGHT_D_PRODUCT_INVALID');
  if (issueCount !== issueIds.length) throw new EightDReportError('部分质量问题不存在或已删除', 409, 'EIGHT_D_ISSUE_INVALID');
}

function activityData(reportId: string, actor: EightDActor, action: string, content: string, detail?: Prisma.InputJsonValue) {
  return { reportId, action, content, actorId: actor.id, actorName: actor.name, detail };
}

export async function createEightDReportRecord(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    metadata: EightDReportMetadataInput;
    file: EightDStoredPdfInput;
    actor: EightDActor;
  },
): Promise<EightDReportRecord> {
  await assertEightDRelations(tx, input.metadata.productIds, input.metadata.issueIds);
  const report = await tx.eightDReport.create({
    data: {
      id: input.id,
      reportNo: input.metadata.reportNo,
      title: input.metadata.title,
      reportDate: input.metadata.reportDate,
      responsibleDepartment: input.metadata.responsibleDepartment,
      keywords: input.metadata.keywords,
      status: input.metadata.status,
      createdById: input.actor.id,
      updatedById: input.actor.id,
      products: { create: input.metadata.productIds.map(drawingLibraryItemId => ({ drawingLibraryItemId })) },
      issues: { create: input.metadata.issueIds.map(issueId => ({ issueId })) },
    },
  });
  const version = await tx.eightDReportVersion.create({
    data: {
      id: input.file.id,
      reportId: report.id,
      versionNumber: 1,
      originalName: input.file.originalName,
      displayName: input.file.displayName,
      mimeType: input.file.mimeType,
      size: BigInt(input.file.size),
      sha256: input.file.sha256,
      objectKey: input.file.objectKey,
      pageCount: input.file.pageCount,
      note: input.file.note,
      uploadedById: input.actor.id,
    },
  });
  await tx.eightDReport.update({ where: { id: report.id }, data: { currentVersionId: version.id } });
  await tx.eightDReportActivity.create({
    data: activityData(report.id, input.actor, 'created', '创建8D PDF档案并上传V1', {
      versionId: version.id,
      productCount: input.metadata.productIds.length,
      issueCount: input.metadata.issueIds.length,
      sha256: input.file.sha256,
    }),
  });
  return tx.eightDReport.findUniqueOrThrow({ where: { id: report.id }, include: eightDReportInclude });
}

async function lockReport(tx: Prisma.TransactionClient, reportId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eight-d-report:${reportId}`}))`;
}

async function activeReportForMutation(tx: Prisma.TransactionClient, reportId: string) {
  const report = await tx.eightDReport.findFirst({ where: { id: reportId, deletedAt: null } });
  if (!report) throw new EightDReportError('8D档案不存在或已移入回收站', 404, 'EIGHT_D_REPORT_NOT_FOUND');
  return report;
}

function assertExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new EightDReportError('档案已被其他人更新，请刷新后重试', 409, 'EIGHT_D_VERSION_CONFLICT');
}

export async function updateEightDReportRecord(
  tx: Prisma.TransactionClient,
  reportId: string,
  metadata: EightDReportMetadataInput,
  expectedVersion: number,
  actor: EightDActor,
): Promise<EightDReportRecord> {
  await lockReport(tx, reportId);
  const report = await activeReportForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  await assertEightDRelations(tx, metadata.productIds, metadata.issueIds);
  await tx.eightDReportProduct.deleteMany({ where: { reportId } });
  await tx.eightDReportIssue.deleteMany({ where: { reportId } });
  if (metadata.productIds.length) {
    await tx.eightDReportProduct.createMany({ data: metadata.productIds.map(drawingLibraryItemId => ({ reportId, drawingLibraryItemId })) });
  }
  if (metadata.issueIds.length) {
    await tx.eightDReportIssue.createMany({ data: metadata.issueIds.map(issueId => ({ reportId, issueId })) });
  }
  await tx.eightDReport.update({
    where: { id: reportId },
    data: {
      reportNo: metadata.reportNo,
      title: metadata.title,
      reportDate: metadata.reportDate,
      responsibleDepartment: metadata.responsibleDepartment,
      keywords: metadata.keywords,
      status: metadata.status,
      updatedById: actor.id,
      version: { increment: 1 },
    },
  });
  await tx.eightDReportActivity.create({
    data: activityData(reportId, actor, 'updated', '更新档案信息与多对多关联', {
      productCount: metadata.productIds.length,
      issueCount: metadata.issueIds.length,
      previousVersion: report.version,
    }),
  });
  return tx.eightDReport.findUniqueOrThrow({ where: { id: reportId }, include: eightDReportInclude });
}

export async function addEightDReportVersionRecord(
  tx: Prisma.TransactionClient,
  reportId: string,
  file: EightDStoredPdfInput,
  expectedVersion: number,
  actor: EightDActor,
): Promise<EightDReportRecord> {
  await lockReport(tx, reportId);
  const report = await activeReportForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const duplicate = await tx.eightDReportVersion.findFirst({ where: { reportId, sha256: file.sha256 } });
  if (duplicate) throw new EightDReportError(`该PDF内容已作为V${duplicate.versionNumber}上传`, 409, 'EIGHT_D_DUPLICATE_PDF');
  const latest = await tx.eightDReportVersion.aggregate({ where: { reportId }, _max: { versionNumber: true } });
  const versionNumber = (latest._max.versionNumber || 0) + 1;
  const version = await tx.eightDReportVersion.create({
    data: {
      id: file.id,
      reportId,
      versionNumber,
      originalName: file.originalName,
      displayName: file.displayName,
      mimeType: file.mimeType,
      size: BigInt(file.size),
      sha256: file.sha256,
      objectKey: file.objectKey,
      pageCount: file.pageCount,
      note: file.note,
      uploadedById: actor.id,
    },
  });
  await tx.eightDReport.update({
    where: { id: reportId },
    data: { currentVersionId: version.id, updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.eightDReportActivity.create({
    data: activityData(reportId, actor, 'version_uploaded', `上传V${versionNumber}并设为当前版本`, {
      versionId: version.id,
      versionNumber,
      sha256: file.sha256,
    }),
  });
  return tx.eightDReport.findUniqueOrThrow({ where: { id: reportId }, include: eightDReportInclude });
}

export async function setCurrentEightDReportVersion(
  tx: Prisma.TransactionClient,
  reportId: string,
  versionId: string,
  expectedVersion: number,
  actor: EightDActor,
): Promise<EightDReportRecord> {
  await lockReport(tx, reportId);
  const report = await activeReportForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const version = await tx.eightDReportVersion.findFirst({ where: { id: versionId, reportId, deletedAt: null } });
  if (!version) throw new EightDReportError('目标PDF版本不存在或已删除', 404, 'EIGHT_D_PDF_VERSION_NOT_FOUND');
  if (report.currentVersionId !== version.id) {
    await tx.eightDReport.update({
      where: { id: reportId },
      data: { currentVersionId: version.id, updatedById: actor.id, version: { increment: 1 } },
    });
    await tx.eightDReportActivity.create({
      data: activityData(reportId, actor, 'current_version_changed', `将V${version.versionNumber}设为当前版本`, {
        versionId: version.id,
        versionNumber: version.versionNumber,
      }),
    });
  }
  return tx.eightDReport.findUniqueOrThrow({ where: { id: reportId }, include: eightDReportInclude });
}

export function nextCurrentEightDVersion<T extends { id: string; versionNumber: number; deletedAt?: Date | string | null }>(
  versions: T[],
  deletingVersionId: string,
): T | null {
  return versions
    .filter(item => item.id !== deletingVersionId && !item.deletedAt)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0] || null;
}

export async function softDeleteEightDReportVersion(
  tx: Prisma.TransactionClient,
  reportId: string,
  versionId: string,
  expectedVersion: number,
  actor: EightDActor,
): Promise<EightDReportRecord> {
  await lockReport(tx, reportId);
  const report = await activeReportForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const versions = await tx.eightDReportVersion.findMany({ where: { reportId, deletedAt: null }, orderBy: { versionNumber: 'desc' } });
  const target = versions.find(item => item.id === versionId);
  if (!target) throw new EightDReportError('目标PDF版本不存在或已删除', 404, 'EIGHT_D_PDF_VERSION_NOT_FOUND');
  const replacement = nextCurrentEightDVersion(versions, versionId);
  if (!replacement) throw new EightDReportError('至少需要保留一个有效PDF版本', 409, 'EIGHT_D_LAST_PDF_VERSION');
  await tx.eightDReportVersion.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
  await tx.eightDReport.update({
    where: { id: reportId },
    data: {
      currentVersionId: report.currentVersionId === target.id ? replacement.id : report.currentVersionId,
      updatedById: actor.id,
      version: { increment: 1 },
    },
  });
  await tx.eightDReportActivity.create({
    data: activityData(reportId, actor, 'version_deleted', `将V${target.versionNumber}移入回收站`, {
      versionId: target.id,
      replacementVersionId: report.currentVersionId === target.id ? replacement.id : null,
    }),
  });
  return tx.eightDReport.findUniqueOrThrow({ where: { id: reportId }, include: eightDReportInclude });
}

export async function restoreEightDReportVersion(
  tx: Prisma.TransactionClient,
  reportId: string,
  versionId: string,
  expectedVersion: number,
  actor: EightDActor,
): Promise<EightDReportRecord> {
  await lockReport(tx, reportId);
  const report = await activeReportForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const version = await tx.eightDReportVersion.findFirst({
    where: { id: versionId, reportId, deletedAt: { not: null } },
  });
  if (!version) throw new EightDReportError('回收站中未找到该PDF版本', 404, 'EIGHT_D_PDF_VERSION_NOT_FOUND');
  await tx.eightDReportVersion.update({ where: { id: version.id }, data: { deletedAt: null } });
  await tx.eightDReport.update({
    where: { id: reportId },
    data: { updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.eightDReportActivity.create({
    data: activityData(reportId, actor, 'version_restored', `从回收站恢复V${version.versionNumber}`, {
      versionId: version.id,
      versionNumber: version.versionNumber,
    }),
  });
  return tx.eightDReport.findUniqueOrThrow({ where: { id: reportId }, include: eightDReportInclude });
}

export async function softDeleteEightDReport(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  reason: string,
  actor: EightDActor,
): Promise<void> {
  await lockReport(tx, reportId);
  const report = await activeReportForMutation(tx, reportId);
  assertExpectedVersion(report.version, expectedVersion);
  const content = cleanText(reason, 300);
  if (!content) throw new EightDReportError('移入回收站必须填写原因');
  await tx.eightDReportActivity.create({
    data: activityData(reportId, actor, 'deleted', content, { previousVersion: report.version }),
  });
  await tx.eightDReport.update({
    where: { id: reportId },
    data: { deletedAt: new Date(), updatedById: actor.id, version: { increment: 1 } },
  });
}

export async function restoreEightDReport(
  tx: Prisma.TransactionClient,
  reportId: string,
  expectedVersion: number,
  actor: EightDActor,
): Promise<EightDReportRecord> {
  await lockReport(tx, reportId);
  const report = await tx.eightDReport.findFirst({ where: { id: reportId, deletedAt: { not: null } } });
  if (!report) throw new EightDReportError('回收站中未找到该8D档案', 404, 'EIGHT_D_REPORT_NOT_FOUND');
  assertExpectedVersion(report.version, expectedVersion);
  await tx.eightDReport.update({
    where: { id: reportId },
    data: { deletedAt: null, updatedById: actor.id, version: { increment: 1 } },
  });
  await tx.eightDReportActivity.create({ data: activityData(reportId, actor, 'restored', '从回收站恢复8D档案') });
  return tx.eightDReport.findUniqueOrThrow({ where: { id: reportId }, include: eightDReportInclude });
}

export async function loadEightDReports(input: {
  keyword?: string;
  status?: string;
  productId?: string;
  issueId?: string;
  limit?: number;
} = {}): Promise<{ reports: EightDReportDTO[]; summary: EightDReportSummaryDTO }> {
  const keyword = cleanText(input.keyword, 160) || '';
  const status = input.status || 'all';
  const deletedMode = status === 'deleted';
  const where: Prisma.EightDReportWhereInput = {
    deletedAt: deletedMode ? { not: null } : null,
    ...(status === 'active' || status === 'archived' ? { status } : {}),
    ...(input.productId ? { products: { some: { drawingLibraryItemId: input.productId } } } : {}),
    ...(input.issueId ? { issues: { some: { issueId: input.issueId } } } : {}),
  };
  if (status === 'unlinked') {
    where.OR = [{ products: { none: {} } }, { issues: { none: {} } }];
  }
  if (keyword) {
    const sequence = Number(keyword.replace(/^8D-/i, ''));
    where.OR = [
      { reportNo: { contains: keyword, mode: 'insensitive' } },
      { title: { contains: keyword, mode: 'insensitive' } },
      { responsibleDepartment: { contains: keyword, mode: 'insensitive' } },
      { keywords: { contains: keyword, mode: 'insensitive' } },
      { versions: { some: { deletedAt: null, originalName: { contains: keyword, mode: 'insensitive' } } } },
      { products: { some: { product: { OR: [
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { productName: { contains: keyword, mode: 'insensitive' } },
        { specification: { contains: keyword, mode: 'insensitive' } },
      ] } } } },
      { issues: { some: { issue: { OR: [
        { title: { contains: keyword, mode: 'insensitive' } },
        { sourceCode: { contains: keyword, mode: 'insensitive' } },
      ] } } } },
      ...(Number.isInteger(sequence) && sequence > 0 ? [{ sequence }] : []),
    ];
  }
  const limit = Math.min(Math.max(Number(input.limit) || 300, 1), 600);
  const [records, active, archived, deleted, productLinks, issueLinks, unlinked] = await Promise.all([
    prisma.eightDReport.findMany({ where, include: eightDReportInclude, orderBy: [{ updatedAt: 'desc' }], take: limit }),
    prisma.eightDReport.count({ where: { deletedAt: null, status: 'active' } }),
    prisma.eightDReport.count({ where: { deletedAt: null, status: 'archived' } }),
    prisma.eightDReport.count({ where: { deletedAt: { not: null } } }),
    prisma.eightDReportProduct.findMany({ where: { report: { deletedAt: null } }, distinct: ['drawingLibraryItemId'], select: { drawingLibraryItemId: true } }),
    prisma.eightDReportIssue.findMany({ where: { report: { deletedAt: null } }, distinct: ['issueId'], select: { issueId: true } }),
    prisma.eightDReport.count({
      where: {
        deletedAt: null,
        OR: [{ products: { none: {} } }, { issues: { none: {} } }],
      },
    }),
  ]);
  return {
    reports: records.map(serializeEightDReport),
    summary: {
      total: active + archived,
      active,
      archived,
      deleted,
      productCount: productLinks.length,
      issueCount: issueLinks.length,
      unlinked,
    },
  };
}

export async function loadEightDReport(reportId: string, includeDeleted = false): Promise<EightDReportDTO> {
  const record = await prisma.eightDReport.findFirst({
    where: { id: reportId, ...(includeDeleted ? {} : { deletedAt: null }) },
    include: eightDReportInclude,
  });
  if (!record) throw new EightDReportError('8D档案不存在', 404, 'EIGHT_D_REPORT_NOT_FOUND');
  return serializeEightDReport(record);
}

export async function loadEightDReportOptions(): Promise<EightDReportOptionsDTO> {
  const [products, issues] = await Promise.all([
    prisma.drawingLibraryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, customerName: true, customerCode: true, productName: true, specification: true },
      orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
      take: 1200,
    }),
    prisma.issue.findMany({
      where: { deletedAt: null },
      include: {
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
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 1200,
    }),
  ]);
  return {
    products,
    issues: issues.map(issue => ({
      id: issue.id,
      sequence: issue.sequence,
      code: issueCode(issue.sequence),
      title: issue.title,
      status: issue.status as EightDReportIssueDTO['status'],
      priority: issue.priority as EightDReportIssueDTO['priority'],
      type: issue.type as EightDReportIssueDTO['type'],
      affectedQuantity: issue.affectedQuantity,
      workOrder: serializeIssueWorkOrder(issue.workOrder),
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    })),
  };
}
