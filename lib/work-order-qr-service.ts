import crypto from 'node:crypto';
import {
  Prisma,
  WorkOrderQrPrintMaterial,
  WorkOrderQrPrintMode,
  WorkOrderQrPrintStatus,
  WorkOrderQrTicketStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { printableSourceFormat, type ImagePrintPaperSize } from '@/lib/printable-document';
import { isExecutableProductionWorkOrder } from '@/lib/work-orders';
import { businessWorkOrderCodeBase } from '@/lib/work-order-business-code';
import { processRouteStepChangeSnapshots } from '@/lib/process-route-change-contract';
import { materializeProductQualityWarningsForWorkOrders } from '@/lib/internal-quality-risks';
import { qualityWarningEmployeePath } from '@/lib/quality-warning-employee';
import { resolveQualityPrintImages } from '@/lib/quality-print-image-source';
import { qualityPrintHeaderExtraMm } from '@/lib/quality-warning-print-layout';
import {
  processSupplementActualRequiredQty,
  processSupplementRemainingQty,
} from '@/lib/process-supplement-coverage';

const MAX_PRINT_BATCH = 30;
const MAX_SOP_PRINT_BATCH = 10;
const MAX_PRINT_COPIES = 10;
const REPORT_CODE_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;

export class WorkOrderQrServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'WorkOrderQrServiceError';
    this.status = status;
    this.code = code;
  }
}

export type WorkOrderTravelerSnapshot = {
  documentOrientations?: Record<string, { revision: number; pageRotations: Record<string, number> }>;
  workOrderId: string;
  workOrderCode: string;
  businessWorkOrderCode?: string;
  customerName: string | null;
  productName: string;
  specification: string | null;
  sourceOrderNo: string | null;
  targetQty: number;
  unitLabel: string;
  deliveryDay: string | null;
  priority: string;
  routeId: string;
  routeVersion: number;
  routeStatus: string;
  routeName: string;
  drawingFileId: string | null;
  drawingFileVersion: string | null;
  drawingFileName: string | null;
  drawingMimeType: string | null;
  sopFileId: string | null;
  sopFileVersion: string | null;
  sopFileName: string | null;
  sopMimeType: string | null;
  printRendering?: {
    version: 'IMAGE_PRINT_V1';
    drawingImagePaperSize: ImagePrintPaperSize;
    imageFit: 'contain';
  };
  qualityWarnings: WorkOrderQualityWarningSnapshot[];
  steps: Array<{
    id: string;
    position: number;
    sequenceGroup: number;
    processCode: string;
    processName: string;
    stageGroup: string;
    timeBasis: string | null;
    unitLabel: string | null;
    standardMillisecondsPerUnit: number | null;
    setupMilliseconds: number;
    unitsPerProduct: number;
    reportQuantityBasis: 'product' | 'action';
    reportUnitLabel: string;
    status: string;
    processedQty: number;
    executionMode?: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
    isCritical?: boolean;
    changeSource?: 'EXISTING' | 'NEW';
    changeTag?: 'ADDED' | 'TIME_CHANGED' | 'ADDED_AND_TIME_CHANGED' | 'NONE';
    changeVersion?: number | null;
    sourceChangeId?: string | null;
    previousStandardMillisecondsPerUnit?: number | null;
    supplementObligation?: {
      id: string;
      requiredQty: number;
      systemCoveredQty: number;
      actualRequiredQty: number;
      reportedQty: number;
      reportedUnitQty: number;
      reportedGoodUnitQty: number;
      reportedDefectUnitQty: number;
      reportQuantityBasis: 'product' | 'action';
      reportUnitLabel: string;
      remainingQty: number;
      fulfillmentMode: 'ACTUAL' | 'MIXED' | 'SYSTEM_COVERED' | 'FUTURE_ONLY' | 'RECALL_REQUIRED';
      releasePolicy: string;
      isCritical: boolean;
      status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED';
      version: number;
    } | null;
  }>;
};

export type WorkOrderQualityWarningSnapshot = {
  correctiveAction?: string | null;
  controlRequirement?: string | null;
  finalConclusion?: string | null;
  employeePath?: string | null;
  printPhotoLayout?: 'SINGLE' | 'PAIR';
  printLayoutVersion?: 'ASPECT_V1';
  printHeaderExtraMm?: number;
  alertId: string;
  reportId: string;
  reportNo: string;
  revisionId: string;
  revisionNumber: number;
  severity: string;
  title: string;
  warningSummary: string | null;
  defectPhenomenon: string | null;
  rootCause: string | null;
  requiredAction: string | null;
  inspectionMethod: string | null;
  inspectionFrequency: string | null;
  acceptanceCriteria: string | null;
  stopConditions: string | null;
  escalationContact: string | null;
  applicableProcess: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  printPolicy: 'REQUIRED' | 'OPTIONAL' | 'SYSTEM_ONLY';
  archivedAt: string;
  attachments: Array<{
    printIncluded?: boolean;
    printGroup?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    imageOrientation?: number | null;
    id: string;
    displayName: string;
    mimeType: string;
    caption: string | null;
    category: string;
    contentUrl: string;
  }>;
};

export type WorkOrderTravelerPrintRecord = {
  printId: string;
  publicCode: string;
  shortCode: string;
  printedAt: string;
  generatedAt: string;
  status: WorkOrderQrPrintStatus;
  mode: WorkOrderQrPrintMode;
  copies: number;
  confirmedAt: string | null;
  reprintReason: string | null;
  printedBy: string;
  items: Array<{
    id: string;
    material: WorkOrderQrPrintMaterial;
    status: WorkOrderQrPrintStatus;
    copies: number;
    fileId: string | null;
    fileVersion: string | null;
    fileName: string | null;
    mimeType: string | null;
    confirmedAt: string | null;
  }>;
  snapshot: WorkOrderTravelerSnapshot;
};

export type FieldReportTicketView = {
  publicCode: string;
  shortCode: string;
  ticketStatus: 'ACTIVE' | 'REVOKED';
  workOrder: {
    id: string;
    code: string;
    businessCode: string;
    customerName: string | null;
    productName: string;
    specification: string | null;
    sourceOrderNo: string | null;
    targetQty: number;
    completedQty: number;
    unitLabel: string;
    deliveryDay: string | null;
    priority: string;
    stage: string;
    parentWorkOrderId: string | null;
  };
  route: {
    id: string;
    version: number;
    printedVersion: number | null;
    paperOutdated: boolean;
    status: string;
    name: string;
    steps: WorkOrderTravelerSnapshot['steps'];
  } | null;
  access: {
    canReport: boolean;
    state: 'READY' | 'WAITING_START' | 'COMPLETED' | 'REVOKED' | 'BLOCKED';
    message: string;
  };
};

const travelerOrderInclude = Prisma.validator<Prisma.WorkOrderInclude>()({
  processRoute: {
    include: {
      steps: {
        where: { retiredAt: null },
        orderBy: [{ position: 'asc' }],
      },
    },
  },
  drawingLibraryItem: {
    include: {
      files: {
        where: { category: { code: { in: ['drawing', 'sop'] } } },
        include: { category: true },
        orderBy: [{ updatedAt: 'desc' }],
      },
      sopDocument: {
        include: {
          versions: {
            select: { id: true, status: true, deletedAt: true },
            orderBy: [{ version: 'desc' }],
          },
        },
      },
    },
  },
});

type TravelerOrder = Prisma.WorkOrderGetPayload<{ include: typeof travelerOrderInclude }>;

type TravelerSourceFile = NonNullable<TravelerOrder['drawingLibraryItem']>['files'][number];

export type TravelerPrintReadinessCheck = {
  ready: boolean;
  code: string;
  message: string;
  fileId: string | null;
  fileName: string | null;
  fileVersion: string | null;
  mimeType: string | null;
};

export type WorkOrderTravelerPrintReadinessRecord = {
  workOrderId: string;
  workOrderCode: string;
  businessWorkOrderCode: string;
  productName: string;
  specification: string | null;
  traveler: TravelerPrintReadinessCheck;
  sop: TravelerPrintReadinessCheck;
  drawing: TravelerPrintReadinessCheck;
  qualityWarning: TravelerPrintReadinessCheck & { count: number; requiredCount: number };
};

export type TravelerPrintSourceFileInput = {
  id: string;
  categoryCode: 'drawing' | 'sop';
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  version?: string | null;
  sourceSopVersionId?: string | null;
  isCurrent: boolean;
  deletedAt?: Date | string | null;
  updatedAt: Date | string;
};

export type TravelerPrintResourceContext = {
  label: string;
  hasLibraryItem: boolean;
  files: TravelerPrintSourceFileInput[];
  sopDocument?: {
    deletedAt?: Date | string | null;
    currentPublishedVersionId?: string | null;
    versions: Array<{
      id: string;
      status: string;
      deletedAt?: Date | string | null;
    }>;
  } | null;
};

function cleanIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function publicCode(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function shortCode(code: string): string {
  return code.slice(0, 8).toUpperCase();
}

function cleanPrintMode(value: unknown): WorkOrderQrPrintMode {
  const mode = String(value || '').trim().toUpperCase();
  if (mode === WorkOrderQrPrintMode.TRAVELER_SOP_DUPLEX) return WorkOrderQrPrintMode.TRAVELER_SOP_DUPLEX;
  if (mode === WorkOrderQrPrintMode.TRAVELER_QUALITY_WARNING) return WorkOrderQrPrintMode.TRAVELER_QUALITY_WARNING;
  if (mode === WorkOrderQrPrintMode.TRAVELER_SOP_SEPARATE) return WorkOrderQrPrintMode.TRAVELER_SOP_SEPARATE;
  if (mode === WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE) return WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE;
  if (mode === WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX) return WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX;
  if (mode === WorkOrderQrPrintMode.CUSTOM) return WorkOrderQrPrintMode.CUSTOM;
  return WorkOrderQrPrintMode.TRAVELER_ONLY;
}

const PRINT_MATERIAL_ORDER = [
  WorkOrderQrPrintMaterial.TRAVELER,
  WorkOrderQrPrintMaterial.QUALITY_WARNING,
  WorkOrderQrPrintMaterial.SOP,
  WorkOrderQrPrintMaterial.DRAWING,
] as const;

export function resolveWorkOrderQrPrintMaterials(mode: WorkOrderQrPrintMode, values?: unknown): WorkOrderQrPrintMaterial[] {
  if (mode === WorkOrderQrPrintMode.TRAVELER_ONLY) return [WorkOrderQrPrintMaterial.TRAVELER];
  if (mode === WorkOrderQrPrintMode.TRAVELER_QUALITY_WARNING) return [WorkOrderQrPrintMaterial.TRAVELER, WorkOrderQrPrintMaterial.QUALITY_WARNING];
  if (mode === WorkOrderQrPrintMode.TRAVELER_SOP_DUPLEX || mode === WorkOrderQrPrintMode.TRAVELER_SOP_SEPARATE) {
    return [WorkOrderQrPrintMaterial.TRAVELER, WorkOrderQrPrintMaterial.SOP];
  }
  if (mode === WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE || mode === WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX) {
    return [WorkOrderQrPrintMaterial.TRAVELER, WorkOrderQrPrintMaterial.SOP, WorkOrderQrPrintMaterial.DRAWING];
  }
  const requested = Array.isArray(values)
    ? new Set(values.map(value => String(value || '').trim().toUpperCase()))
    : new Set<string>();
  const materials = PRINT_MATERIAL_ORDER.filter(material => requested.has(material));
  if (!materials.length) {
    throw new WorkOrderQrServiceError('自定义补打请至少选择一种资料', 400, 'QR_PRINT_MATERIAL_REQUIRED');
  }
  return materials;
}

function cleanMaterialCopies(value: unknown, materials: readonly WorkOrderQrPrintMaterial[], fallback: number) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(materials.map(material => [material, cleanCopies(source[material] ?? fallback)])) as Record<WorkOrderQrPrintMaterial, number>;
}

function cleanCopies(value: unknown): number {
  const copies = Number(value);
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_PRINT_COPIES) {
    throw new WorkOrderQrServiceError(`打印份数必须为 1-${MAX_PRINT_COPIES} 份`, 400, 'QR_PRINT_COPIES_INVALID');
  }
  return copies;
}

function fileTimestamp(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function cleanDrawingImagePaperSize(value: unknown): ImagePrintPaperSize {
  return String(value || '').trim().toUpperCase() === 'A3' ? 'A3' : 'A4';
}

export function drawingImagePaperSizeFromSnapshot(value: unknown): ImagePrintPaperSize {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'A4';
  const rendering = (value as { printRendering?: unknown }).printRendering;
  if (!rendering || typeof rendering !== 'object' || Array.isArray(rendering)) return 'A4';
  return cleanDrawingImagePaperSize((rendering as { drawingImagePaperSize?: unknown }).drawingImagePaperSize);
}

function isActiveFile(file: TravelerPrintSourceFileInput): boolean {
  return file.deletedAt == null && file.isCurrent;
}

function isPrintableFile(file: TravelerPrintSourceFileInput): boolean {
  const name = file.displayName || file.originalName;
  return Boolean(printableSourceFormat(name, file.mimeType));
}

function resourceFileResult(
  label: string,
  material: 'drawing' | 'sop',
  file: TravelerPrintSourceFileInput,
): TravelerPrintReadinessCheck {
  const materialLabel = material === 'sop' ? 'SOP' : '原图';
  const fileName = file.displayName || file.originalName;
  const format = printableSourceFormat(fileName, file.mimeType);
  if (!isPrintableFile(file) || !format) {
    return {
      ready: false,
      code: material === 'sop' ? 'QR_SOP_FORMAT_UNSUPPORTED' : 'QR_DRAWING_FORMAT_UNSUPPORTED',
      message: material === 'sop'
        ? `${label} 的当前 SOP 格式不支持打印；仅支持 PDF、JPG、JPEG、PNG、WebP`
        : `${label} 的原图格式不支持打印；仅支持 PDF、JPG、JPEG、PNG、WebP`,
      fileId: file.id,
      fileName,
      fileVersion: file.version || null,
      mimeType: file.mimeType,
    };
  }
  return {
    ready: true,
    code: 'READY',
    message: `${label} 的${materialLabel}可打印（${format.toUpperCase()}）`,
    fileId: file.id,
    fileName,
    fileVersion: file.version || null,
    mimeType: file.mimeType,
  };
}

function missingResourceResult(code: string, message: string): TravelerPrintReadinessCheck {
  return {
    ready: false,
    code,
    message,
    fileId: null,
    fileName: null,
    fileVersion: null,
    mimeType: null,
  };
}

export function resolveTravelerPrintMaterialReadiness(
  input: TravelerPrintResourceContext,
  material: 'drawing' | 'sop',
): TravelerPrintReadinessCheck {
  if (!input.hasLibraryItem) {
    return missingResourceResult(
      material === 'sop' ? 'QR_SOP_PRODUCT_LINK_REQUIRED' : 'QR_DRAWING_PRODUCT_LINK_REQUIRED',
      material === 'sop'
        ? `${input.label} 尚未关联产品资料，无法读取 SOP；请先关联对应产品`
        : `${input.label} 尚未关联产品资料，无法读取原图；请先关联对应产品`,
    );
  }

  const categoryFiles = input.files.filter(file => file.categoryCode === material);
  const activeFiles = categoryFiles
    .filter(isActiveFile)
    .sort((left, right) => fileTimestamp(right.updatedAt) - fileTimestamp(left.updatedAt));

  if (material === 'drawing') {
    const drawing = activeFiles[0];
    return drawing
      ? resourceFileResult(input.label, material, drawing)
      : missingResourceResult('QR_DRAWING_REQUIRED', `${input.label} 尚未上传有效原图，不能生成原图打印任务`);
  }

  const sopDocument = input.sopDocument && input.sopDocument.deletedAt == null
    ? input.sopDocument
    : null;
  const publishedVersionId = sopDocument?.currentPublishedVersionId || null;
  if (publishedVersionId) {
    const publishedVersion = sopDocument?.versions.find(version => version.id === publishedVersionId);
    if (!publishedVersion || publishedVersion.deletedAt != null || publishedVersion.status !== 'published') {
      return missingResourceResult(
        'QR_SOP_PUBLISH_POINTER_INVALID',
        `${input.label} 的 SOP 发布状态异常，请重新发布后再打印`,
      );
    }
    const publishedFile = categoryFiles.find(file => file.sourceSopVersionId === publishedVersionId);
    if (!publishedFile || !isActiveFile(publishedFile)) {
      return missingResourceResult(
        'QR_SOP_PUBLISHED_FILE_MISSING',
        `${input.label} 的已发布 SOP 文件已删除或失效，请重新发布 SOP`,
      );
    }
    return resourceFileResult(input.label, material, publishedFile);
  }

  // Legacy/manual SOP uploads remain printable when no online version has been published.
  // Generated files without a current document pointer are deliberately excluded to avoid printing an orphaned version.
  const manualSop = activeFiles.find(file => !file.sourceSopVersionId);
  if (manualSop) return resourceFileResult(input.label, material, manualSop);

  if (sopDocument?.versions.some(version => version.deletedAt == null)) {
    return missingResourceResult(
      'QR_SOP_NOT_PUBLISHED',
      `${input.label} 的 SOP 目前只有草稿，请先发布后再打印`,
    );
  }
  return missingResourceResult(
    'QR_SOP_REQUIRED',
    `${input.label} 尚未上传或发布可打印 SOP，不能合并打印`,
  );
}

function resourceContext(order: TravelerOrder): TravelerPrintResourceContext {
  const item = order.drawingLibraryItem;
  return {
    label: order.businessCode || businessWorkOrderCodeBase(order) || order.code,
    hasLibraryItem: Boolean(item),
    files: (item?.files || []).map(file => ({
      id: file.id,
      categoryCode: file.category.code === 'drawing' ? 'drawing' : 'sop',
      originalName: file.originalName,
      displayName: file.displayName,
      mimeType: file.mimeType,
      version: file.version,
      sourceSopVersionId: file.sourceSopVersionId,
      isCurrent: file.isCurrent,
      deletedAt: file.deletedAt,
      updatedAt: file.updatedAt,
    })),
    sopDocument: item?.sopDocument ? {
      deletedAt: item.sopDocument.deletedAt,
      currentPublishedVersionId: item.sopDocument.currentPublishedVersionId,
      versions: item.sopDocument.versions,
    } : null,
  };
}

function materialReadiness(order: TravelerOrder, categoryCode: 'drawing' | 'sop') {
  return resolveTravelerPrintMaterialReadiness(resourceContext(order), categoryCode);
}

function latestSourceFile(order: TravelerOrder, categoryCode: 'drawing' | 'sop'): TravelerSourceFile | null {
  const fileId = materialReadiness(order, categoryCode).fileId;
  return order.drawingLibraryItem?.files.find(file => file.id === fileId) || null;
}

function targetQuantity(order: Pick<TravelerOrder, 'productionTargetQty' | 'uncompletedQty' | 'completedQty' | 'stage'>): number {
  const value = getProductionQuantitySummary(order).targetQty;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function createSnapshot(order: TravelerOrder, qualityWarnings: WorkOrderQualityWarningSnapshot[] = []): WorkOrderTravelerSnapshot {
  const route = order.processRoute;
  if (!route) {
    throw new WorkOrderQrServiceError('该工单尚未建立工艺路线，不能打印流转单', 409, 'QR_ROUTE_REQUIRED');
  }
  if (route.status === 'draft') {
    throw new WorkOrderQrServiceError('该工单工艺路线尚未确认，确认后才能打印流转单', 409, 'QR_ROUTE_NOT_CONFIRMED');
  }
  if (!route.steps.length) {
    throw new WorkOrderQrServiceError('该工单没有可打印的工序', 409, 'QR_ROUTE_STEPS_REQUIRED');
  }
  const quantity = targetQuantity(order);
  if (quantity <= 0) {
    throw new WorkOrderQrServiceError('该工单生产数量未确认，不能打印流转单', 409, 'QR_TARGET_QTY_REQUIRED');
  }
  const firstUnit = route.steps.find(step => step.unitLabel)?.unitLabel || '件';
  const drawingFile = latestSourceFile(order, 'drawing');
  const sopFile = latestSourceFile(order, 'sop');
  return {
    workOrderId: order.id,
    workOrderCode: order.code,
    businessWorkOrderCode: order.businessCode || businessWorkOrderCodeBase(order),
    customerName: order.customerName,
    productName: order.productName,
    specification: order.specification,
    sourceOrderNo: order.sourceOrderNo,
    targetQty: quantity,
    unitLabel: firstUnit,
    deliveryDay: order.deliveryDay,
    priority: order.priority,
    routeId: route.id,
    routeVersion: route.version,
    routeStatus: route.status,
    routeName: route.templateName,
    drawingFileId: drawingFile?.id || null,
    drawingFileVersion: drawingFile?.version || null,
    drawingFileName: drawingFile?.displayName || drawingFile?.originalName || null,
    drawingMimeType: drawingFile?.mimeType || null,
    sopFileId: sopFile?.id || null,
    sopFileVersion: sopFile?.version || null,
    sopFileName: sopFile?.displayName || sopFile?.originalName || null,
    sopMimeType: sopFile?.mimeType || null,
    qualityWarnings,
    steps: [...route.steps]
      .sort((left, right) => left.position - right.position)
      .map(step => ({
        id: step.id,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        processCode: step.processCode,
        processName: step.processName,
        stageGroup: step.stageGroup,
        timeBasis: step.timeBasis,
        unitLabel: step.unitLabel,
        standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
        setupMilliseconds: step.setupMilliseconds,
        unitsPerProduct: step.unitsPerProduct,
        reportQuantityBasis: step.reportQuantityBasis === 'action' ? 'action' : 'product',
        reportUnitLabel: step.reportUnitLabel || step.unitLabel || '件',
        status: step.status,
        processedQty: step.processedQty,
      })),
  };
}

async function findTravelerOrders(workOrderIds: string[]): Promise<TravelerOrder[]> {
  return prisma.workOrder.findMany({
    where: { id: { in: workOrderIds }, deletedAt: null },
    include: travelerOrderInclude,
  });
}

async function loadQualityWarningSnapshots(workOrderIds: string[]): Promise<Map<string, WorkOrderQualityWarningSnapshot[]>> {
  await materializeProductQualityWarningsForWorkOrders(workOrderIds);
  const now = new Date();
  const alerts = await prisma.workOrderQualityAlert.findMany({
    where: {
      workOrderId: { in: workOrderIds },
      state: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
      report: { deletedAt: null, warningState: 'ACTIVE' },
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
      ],
    },
    include: {
      report: {
        select: {
          reportNo: true,
        },
      },
      revision: {
        select: {
          revisionNumber: true,
          snapshot: true,
          attachments: {
            where: { attachment: { mimeType: { startsWith: 'image/' } } },
            orderBy: { sortOrder: 'asc' },
            select: {
              attachment: { select: { id: true, displayName: true, mimeType: true, caption: true, category: true, printIncluded: true, imageWidth: true, imageHeight: true, imageOrientation: true } },
            },
          },
        },
      },
    },
    orderBy: [{ archivedAt: 'desc' }],
  });
  const severityRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const result = new Map<string, WorkOrderQualityWarningSnapshot[]>();
  for (const alert of alerts) {
    const frozen = (alert.revision.snapshot || {}) as Record<string, unknown>;
    const frozenAttachments = Array.isArray(frozen.attachments) ? frozen.attachments as Array<Record<string, unknown>> : [];
    const warning: WorkOrderQualityWarningSnapshot = {
      correctiveAction: typeof frozen.correctiveAction === 'string' ? frozen.correctiveAction : null,
      finalConclusion: alert.finalConclusion,
      controlRequirement: alert.controlRequirement,
      employeePath: await qualityWarningEmployeePath(alert.revisionId, alert.workOrderId),
      printPhotoLayout: frozen.printPhotoLayout === 'SINGLE' ? 'SINGLE' : 'PAIR',
      alertId: alert.id,
      reportId: alert.reportId,
      reportNo: alert.report.reportNo,
      revisionId: alert.revisionId,
      revisionNumber: alert.revision.revisionNumber,
      severity: alert.severity,
      title: alert.title,
      warningSummary: alert.warningSummary,
      defectPhenomenon: alert.defectPhenomenon,
      rootCause: alert.rootCause,
      requiredAction: alert.requiredAction,
      inspectionMethod: alert.inspectionMethod,
      inspectionFrequency: alert.inspectionFrequency,
      acceptanceCriteria: alert.acceptanceCriteria,
      stopConditions: alert.stopConditions,
      escalationContact: alert.escalationContact,
      applicableProcess: alert.applicableProcess,
      effectiveFrom: alert.effectiveFrom?.toISOString() || null,
      effectiveUntil: alert.effectiveUntil?.toISOString() || null,
      printPolicy: (['REQUIRED', 'SYSTEM_ONLY'].includes(alert.printPolicy) ? alert.printPolicy : 'OPTIONAL') as WorkOrderQualityWarningSnapshot['printPolicy'],
      archivedAt: alert.archivedAt.toISOString(),
      attachments: alert.revision.attachments.map(({ attachment }) => ({
        ...attachment,
        caption: String(frozenAttachments.find(item => item.id === attachment.id) ? frozenAttachments.find(item => item.id === attachment.id)?.caption || '' : attachment.caption || ''),
        printIncluded: frozenAttachments.find(item => item.id === attachment.id)?.printIncluded !== false,
        printGroup: String(frozenAttachments.find(item => item.id === attachment.id)?.printGroup || '') || null,
        contentUrl: `/api/quality/internal-risk-attachments/${attachment.id}/content`,
      })),
    };
    const current = result.get(alert.workOrderId) || [];
    current.push(warning);
    current.sort((left, right) => (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0));
    result.set(alert.workOrderId, current);
  }
  return result;
}

function readyCheck(message: string): TravelerPrintReadinessCheck {
  return {
    ready: true,
    code: 'READY',
    message,
    fileId: null,
    fileName: null,
    fileVersion: null,
    mimeType: null,
  };
}

function buildTravelerPrintReadiness(order: TravelerOrder, qualityWarnings: WorkOrderQualityWarningSnapshot[] = []): WorkOrderTravelerPrintReadinessRecord {
  const businessCode = order.businessCode || businessWorkOrderCodeBase(order) || order.code;
  let traveler: TravelerPrintReadinessCheck;
  try {
    createSnapshot(order);
    traveler = readyCheck(`${businessCode} 的流转单可打印`);
  } catch (error) {
    if (!(error instanceof WorkOrderQrServiceError)) throw error;
    traveler = missingResourceResult(error.code, `${businessCode}：${error.message}`);
  }
  return {
    workOrderId: order.id,
    workOrderCode: order.code,
    businessWorkOrderCode: businessCode,
    productName: order.productName,
    specification: order.specification,
    traveler,
    sop: materialReadiness(order, 'sop'),
    drawing: materialReadiness(order, 'drawing'),
    qualityWarning: {
      ...(qualityWarnings.length
        ? readyCheck(`${businessCode} 有 ${qualityWarnings.length} 项生效异常警示可附页打印`)
        : missingResourceResult('QR_QUALITY_WARNING_EMPTY', `${businessCode} 当前没有生效异常警示`)),
      count: qualityWarnings.length,
      requiredCount: qualityWarnings.filter(warning => warning.printPolicy === 'REQUIRED').length,
    },
  };
}

export async function loadWorkOrderTravelerPrintReadiness(input: {
  workOrderIds: unknown;
}): Promise<WorkOrderTravelerPrintReadinessRecord[]> {
  const workOrderIds = cleanIds(input.workOrderIds);
  if (!workOrderIds.length) {
    throw new WorkOrderQrServiceError('请至少选择一张生产工单', 400, 'QR_WORK_ORDER_REQUIRED');
  }
  if (workOrderIds.length > MAX_PRINT_BATCH) {
    throw new WorkOrderQrServiceError(`每次最多校验 ${MAX_PRINT_BATCH} 张流转单`, 400, 'QR_PRINT_BATCH_TOO_LARGE');
  }
  const orders = await findTravelerOrders(workOrderIds);
  if (orders.length !== workOrderIds.length) {
    throw new WorkOrderQrServiceError('所选工单中有记录不存在或已删除，请刷新后重试', 404, 'QR_WORK_ORDER_NOT_FOUND');
  }
  const warningsByWorkOrder = await loadQualityWarningSnapshots(workOrderIds);
  const orderById = new Map(orders.map(order => [order.id, order]));
  return workOrderIds.map(id => buildTravelerPrintReadiness(orderById.get(id)!, warningsByWorkOrder.get(id) || []));
}

export async function createWorkOrderTravelerPrints(input: {
  workOrderIds: unknown;
  mode?: unknown;
  copies?: unknown;
  materials?: unknown;
  materialCopies?: unknown;
  drawingImagePaperSize?: unknown;
  reprintReason?: unknown;
  userId: string;
  actor: string;
}): Promise<WorkOrderTravelerPrintRecord[]> {
  const workOrderIds = cleanIds(input.workOrderIds);
  const mode = cleanPrintMode(input.mode);
  const copies = cleanCopies(input.copies ?? 1);
  let materials = resolveWorkOrderQrPrintMaterials(mode, input.materials);
  const drawingImagePaperSize = cleanDrawingImagePaperSize(input.drawingImagePaperSize);
  const reprintReason = String(input.reprintReason || '').trim().slice(0, 500) || null;
  if (!workOrderIds.length) {
    throw new WorkOrderQrServiceError('请至少选择一张生产工单', 400, 'QR_WORK_ORDER_REQUIRED');
  }
  if (workOrderIds.length > MAX_PRINT_BATCH) {
    throw new WorkOrderQrServiceError(`每次最多打印 ${MAX_PRINT_BATCH} 张流转单`, 400, 'QR_PRINT_BATCH_TOO_LARGE');
  }
  const orders = await findTravelerOrders(workOrderIds);
  if (orders.length !== workOrderIds.length) {
    throw new WorkOrderQrServiceError('所选工单中有记录不存在或已删除，请刷新后重试', 404, 'QR_WORK_ORDER_NOT_FOUND');
  }
  const orderById = new Map(orders.map(order => [order.id, order]));
  const orderedOrders = workOrderIds.map(id => orderById.get(id)!);
  const warningsByWorkOrder = await loadQualityWarningSnapshots(workOrderIds);
  const hasRequiredWarnings = workOrderIds.some(id => (warningsByWorkOrder.get(id) || []).some(warning => warning.printPolicy === 'REQUIRED'));
  if (hasRequiredWarnings && !materials.includes(WorkOrderQrPrintMaterial.QUALITY_WARNING)) {
    materials = [...materials, WorkOrderQrPrintMaterial.QUALITY_WARNING].sort((left, right) => PRINT_MATERIAL_ORDER.indexOf(left) - PRINT_MATERIAL_ORDER.indexOf(right));
  }
  const materialCopies = cleanMaterialCopies(input.materialCopies, materials, copies);
  const requiresSop = materials.includes(WorkOrderQrPrintMaterial.SOP);
  const requiresDrawing = materials.includes(WorkOrderQrPrintMaterial.DRAWING);
  const requiresQualityWarning = materials.includes(WorkOrderQrPrintMaterial.QUALITY_WARNING);
  if ((requiresSop || requiresDrawing || requiresQualityWarning) && workOrderIds.length > MAX_SOP_PRINT_BATCH) {
    throw new WorkOrderQrServiceError(`含生产资料的打印任务每次最多选择 ${MAX_SOP_PRINT_BATCH} 张工单`, 400, 'QR_RESOURCE_PRINT_BATCH_TOO_LARGE');
  }
  if (requiresQualityWarning) {
    const withoutWarnings = orderedOrders.find(order => !(warningsByWorkOrder.get(order.id) || []).length);
    if (withoutWarnings) throw new WorkOrderQrServiceError(`${withoutWarnings.businessCode || withoutWarnings.code} 当前没有可打印的异常警示`, 409, 'QR_QUALITY_WARNING_EMPTY');
  }
  // Resolve dimensions before opening the print transaction. Issued snapshots are never upgraded on read.
  if (requiresQualityWarning) for (const order of orderedOrders) for (const warning of warningsByWorkOrder.get(order.id) || []) {
    warning.attachments = await resolveQualityPrintImages(warning.attachments);
    warning.printLayoutVersion = 'ASPECT_V1';
    warning.printHeaderExtraMm = qualityPrintHeaderExtraMm({ productName: order.productName, specification: order.specification, workOrderCode: order.code, businessWorkOrderCode: order.businessCode });
  }
  const snapshots = orderedOrders.map(order => ({
    ...createSnapshot(order, warningsByWorkOrder.get(order.id) || []),
    printRendering: {
      version: 'IMAGE_PRINT_V1' as const,
      drawingImagePaperSize,
      imageFit: 'contain' as const,
    },
    documentOrientations: {} as Record<string, { revision: number; pageRotations: Record<string, number> }>,
  }));
  const sourceFilesForOrientation = orderedOrders.flatMap(order => order.drawingLibraryItem?.files || []);
  const displaySettings = await prisma.documentDisplaySetting.findMany({ where: { objectKey: { in: [...new Set(sourceFilesForOrientation.map(file => file.objectKey))] } } });
  const displayByObject = new Map(displaySettings.map(setting => [setting.objectKey, setting]));
  for (const snapshot of snapshots) {
    for (const fileId of [snapshot.sopFileId, snapshot.drawingFileId]) {
      if (!fileId) continue;
      const file = sourceFilesForOrientation.find(candidate => candidate.id === fileId);
      const setting = file ? displayByObject.get(file.objectKey) : null;
      snapshot.documentOrientations[fileId] = { revision: setting?.revision || 0, pageRotations: (setting?.pageRotations || {}) as Record<string, number> };
    }
  }
  if (requiresSop) {
    const invalidSop = orderedOrders
      .map(order => materialReadiness(order, 'sop'))
      .find(readiness => !readiness.ready);
    if (invalidSop) {
      throw new WorkOrderQrServiceError(invalidSop.message, 409, invalidSop.code);
    }
  }
  if (requiresDrawing) {
    const invalidDrawing = orderedOrders
      .map(order => materialReadiness(order, 'drawing'))
      .find(readiness => !readiness.ready);
    if (invalidDrawing) {
      throw new WorkOrderQrServiceError(invalidDrawing.message, 409, invalidDrawing.code);
    }
  }

  return prisma.$transaction(async tx => {
    const records: WorkOrderTravelerPrintRecord[] = [];
    for (const snapshot of snapshots) {
      const ticket = await tx.workOrderQrTicket.upsert({
        where: { workOrderId: snapshot.workOrderId },
        update: {
          status: WorkOrderQrTicketStatus.ACTIVE,
          revokedAt: null,
        },
        create: {
          workOrderId: snapshot.workOrderId,
          publicCode: publicCode(),
          createdById: input.userId,
        },
      });
      const itemData = materials.map(material => ({
        material,
        copies: materialCopies[material],
        fileId: material === WorkOrderQrPrintMaterial.DRAWING
          ? snapshot.drawingFileId
          : material === WorkOrderQrPrintMaterial.SOP
            ? snapshot.sopFileId
            : null,
        fileVersion: material === WorkOrderQrPrintMaterial.DRAWING
          ? snapshot.drawingFileVersion
          : material === WorkOrderQrPrintMaterial.SOP
            ? snapshot.sopFileVersion
            : null,
        fileName: material === WorkOrderQrPrintMaterial.DRAWING
          ? snapshot.drawingFileName
          : material === WorkOrderQrPrintMaterial.SOP
            ? snapshot.sopFileName
            : null,
        mimeType: material === WorkOrderQrPrintMaterial.DRAWING
          ? snapshot.drawingMimeType
          : material === WorkOrderQrPrintMaterial.SOP
            ? snapshot.sopMimeType
            : null,
      }));
      const print = await tx.workOrderQrPrint.create({
        data: {
          ticketId: ticket.id,
          routeId: snapshot.routeId,
          routeVersion: snapshot.routeVersion,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          status: WorkOrderQrPrintStatus.GENERATED,
          mode,
          copies,
          drawingFileId: snapshot.drawingFileId,
          drawingFileVersion: snapshot.drawingFileVersion,
          sopFileId: snapshot.sopFileId,
          sopFileVersion: snapshot.sopFileVersion,
          packetHash: crypto.createHash('sha256').update(JSON.stringify({
            routeId: snapshot.routeId,
            routeVersion: snapshot.routeVersion,
            targetQty: snapshot.targetQty,
            drawingFileId: snapshot.drawingFileId,
            drawingFileVersion: snapshot.drawingFileVersion,
            sopFileId: snapshot.sopFileId,
            sopFileVersion: snapshot.sopFileVersion,
            qualityWarnings: snapshot.qualityWarnings.map(warning => ({
              alertId: warning.alertId,
              revisionId: warning.revisionId,
              revisionNumber: warning.revisionNumber,
              printPolicy: warning.printPolicy,
              printLayoutVersion: warning.printLayoutVersion,
              printHeaderExtraMm: warning.printHeaderExtraMm,
              printPhotoLayout: warning.printPhotoLayout,
              attachments: warning.attachments.map(photo => ({ id: photo.id, width: photo.imageWidth, height: photo.imageHeight, orientation: photo.imageOrientation, group: photo.printGroup, printIncluded: photo.printIncluded })),
            })),
            printRendering: snapshot.printRendering,
            documentOrientations: snapshot.documentOrientations,
          })).digest('hex'),
          reprintReason,
          printedById: input.userId,
          items: { create: itemData },
        },
        include: { items: true },
      });
      records.push({
        printId: print.id,
        publicCode: ticket.publicCode,
        shortCode: shortCode(ticket.publicCode),
        printedAt: print.printedAt.toISOString(),
        generatedAt: print.printedAt.toISOString(),
        status: print.status,
        mode: print.mode,
        copies: print.copies,
        confirmedAt: print.confirmedAt?.toISOString() || null,
        reprintReason: print.reprintReason,
        printedBy: input.actor,
        items: print.items.map(item => ({
          id: item.id,
          material: item.material,
          status: item.status,
          copies: item.copies,
          fileId: item.fileId,
          fileVersion: item.fileVersion,
          fileName: item.fileName,
          mimeType: item.mimeType,
          confirmedAt: item.confirmedAt?.toISOString() || null,
        })),
        snapshot,
      });
    }
    return records;
  });
}

export async function loadWorkOrderTravelerPrints(printIdsInput: unknown): Promise<WorkOrderTravelerPrintRecord[]> {
  const printIds = cleanIds(printIdsInput);
  if (!printIds.length || printIds.length > MAX_PRINT_BATCH) {
    throw new WorkOrderQrServiceError('打印任务无效或已经过期', 400, 'QR_PRINT_IDS_INVALID');
  }
  const prints = await prisma.workOrderQrPrint.findMany({
    where: { id: { in: printIds } },
    include: {
      ticket: { select: { publicCode: true } },
      printedBy: { select: { displayName: true, username: true } },
      confirmedBy: { select: { displayName: true, username: true } },
      items: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (prints.length !== printIds.length) {
    throw new WorkOrderQrServiceError('部分流转单打印记录不存在，请重新生成', 404, 'QR_PRINT_NOT_FOUND');
  }
  const printById = new Map(prints.map(print => [print.id, print]));
  return Promise.all(printIds.map(async id => {
    const print = printById.get(id)!;
    const snapshot = print.snapshot as unknown as WorkOrderTravelerSnapshot;
    snapshot.qualityWarnings = await Promise.all((snapshot.qualityWarnings || []).map(async warning => {
      if (warning.employeePath !== undefined && warning.correctiveAction !== undefined) return warning;
      const revision = await prisma.internalQualityRiskRevision.findUnique({ where: { id: warning.revisionId }, select: { snapshot: true } });
      const frozen = (revision?.snapshot || {}) as Record<string, unknown>;
      return { ...warning, employeePath: warning.employeePath || await qualityWarningEmployeePath(warning.revisionId, snapshot.workOrderId),
        correctiveAction: warning.correctiveAction ?? (typeof frozen.correctiveAction === 'string' ? frozen.correctiveAction : null),
        finalConclusion: warning.finalConclusion ?? (typeof frozen.finalConclusion === 'string' ? frozen.finalConclusion : null),
      };
    }));
    return {
      printId: print.id,
      publicCode: print.ticket.publicCode,
      shortCode: shortCode(print.ticket.publicCode),
      printedAt: print.printedAt.toISOString(),
      generatedAt: print.printedAt.toISOString(),
      status: print.status,
      mode: print.mode,
      copies: print.copies,
      confirmedAt: print.confirmedAt?.toISOString() || null,
      reprintReason: print.reprintReason,
      printedBy: print.printedBy?.displayName || print.printedBy?.username || '系统用户',
      items: print.items.map(item => ({
        id: item.id,
        material: item.material,
        status: item.status,
        copies: item.copies,
        fileId: item.fileId,
        fileVersion: item.fileVersion,
        fileName: item.fileName,
        mimeType: item.mimeType,
        confirmedAt: item.confirmedAt?.toISOString() || null,
      })),
      snapshot,
    };
  }));
}

export async function confirmWorkOrderTravelerPrints(input: {
  printIds: unknown;
  materials?: unknown;
  userId: string;
  actor: string;
}): Promise<{ confirmedCount: number; alreadyConfirmedCount: number }> {
  const printIds = cleanIds(input.printIds);
  if (!printIds.length || printIds.length > MAX_PRINT_BATCH) {
    throw new WorkOrderQrServiceError('请选择需要确认的打印任务', 400, 'QR_PRINT_IDS_INVALID');
  }
  const requestedMaterials = Array.isArray(input.materials)
    ? [...new Set(input.materials.map(value => String(value || '').trim().toUpperCase()))]
        .filter((value): value is WorkOrderQrPrintMaterial => (PRINT_MATERIAL_ORDER as readonly WorkOrderQrPrintMaterial[]).includes(value as WorkOrderQrPrintMaterial))
    : [];
  return prisma.$transaction(async tx => {
    const prints = await tx.workOrderQrPrint.findMany({
      where: { id: { in: printIds } },
      select: { id: true },
    });
    if (prints.length !== printIds.length) {
      throw new WorkOrderQrServiceError('部分打印记录不存在，请重新生成', 404, 'QR_PRINT_NOT_FOUND');
    }
    const items = await tx.workOrderQrPrintItem.findMany({
      where: {
        printId: { in: printIds },
        ...(requestedMaterials.length ? { material: { in: requestedMaterials } } : {}),
      },
      select: { id: true, printId: true, material: true, status: true },
    });
    if (!items.length) {
      throw new WorkOrderQrServiceError('所选打印任务不包含需要确认的资料', 400, 'QR_PRINT_MATERIAL_NOT_FOUND');
    }
    const generatedIds = items.filter(item => item.status === WorkOrderQrPrintStatus.GENERATED).map(item => item.id);
    const confirmedAt = new Date();
    if (generatedIds.length) {
      await tx.workOrderQrPrintItem.updateMany({
        where: { id: { in: generatedIds }, status: WorkOrderQrPrintStatus.GENERATED },
        data: {
          status: WorkOrderQrPrintStatus.CONFIRMED,
          confirmedAt,
          confirmedById: input.userId,
        },
      });
    }
    for (const printId of printIds) {
      const currentItems = await tx.workOrderQrPrintItem.findMany({
        where: { printId },
        select: { status: true },
      });
      const fullyConfirmed = currentItems.length > 0 && currentItems.every(item => item.status === WorkOrderQrPrintStatus.CONFIRMED);
      await tx.workOrderQrPrint.update({
        where: { id: printId },
        data: fullyConfirmed
          ? { status: WorkOrderQrPrintStatus.CONFIRMED, confirmedAt, confirmedById: input.userId }
          : { status: WorkOrderQrPrintStatus.GENERATED, confirmedAt: null, confirmedById: null },
      });
    }
    if (generatedIds.length) {
      await tx.operationLog.create({
        data: {
          userId: input.userId,
          action: 'confirm_work_order_print_material',
          targetType: 'work_order_qr_print_item',
          targetId: generatedIds[0],
          detail: {
            itemIds: generatedIds,
            printIds,
            materials: requestedMaterials.length ? requestedMaterials : 'ALL',
            confirmedCount: generatedIds.length,
            actor: input.actor,
          },
        },
      });
    }
    return {
      confirmedCount: generatedIds.length,
      alreadyConfirmedCount: items.length - generatedIds.length,
    };
  });
}

export function resolveFieldReportAccess(input: {
  ticketStatus: WorkOrderQrTicketStatus;
  workOrder: { planType: string | null; planClearedAt: Date | null; stage: string; deletedAt: Date | null };
  route: { status: string; hasActiveSupplement?: boolean } | null;
}): FieldReportTicketView['access'] {
  if (input.ticketStatus === WorkOrderQrTicketStatus.REVOKED) {
    return { canReport: false, state: 'REVOKED', message: '该二维码已停用，请使用重新打印的流转单' };
  }
  if (input.workOrder.deletedAt || !isExecutableProductionWorkOrder(input.workOrder)) {
    return { canReport: false, state: 'BLOCKED', message: '该工单已清除或归档，仅可查看历史信息' };
  }
  if (!input.route || input.route.status === 'draft') {
    return { canReport: false, state: 'BLOCKED', message: '工艺路线尚未确认，请联系生产主管' };
  }
  if (
    (input.route.status === 'completed' || input.workOrder.stage === 'completed')
    && !input.route.hasActiveSupplement
  ) {
    return { canReport: false, state: 'COMPLETED', message: '该工单已经完成，当前二维码仅供查询' };
  }
  if (
    input.route.hasActiveSupplement
    && (input.route.status === 'completed' || input.workOrder.stage === 'completed')
  ) {
    return { canReport: true, state: 'READY', message: '原生产流程已完成，但仍有启用中的补充工序，可继续使用原二维码报工' };
  }
  if (input.route.status !== 'in_progress') {
    return { canReport: false, state: 'WAITING_START', message: '该工单尚未开始生产，请由主管先启动工艺路线' };
  }
  return { canReport: true, state: 'READY', message: '工单生产中，可选择任意未完成工序报工' };
}

export async function loadFieldReportTicket(
  publicCodeInput: unknown,
  options: { recordScan?: boolean } = {},
): Promise<FieldReportTicketView> {
  const code = String(publicCodeInput || '').trim();
  if (!REPORT_CODE_PATTERN.test(code)) {
    throw new WorkOrderQrServiceError('二维码无效，请重新扫描流转单', 404, 'QR_TICKET_NOT_FOUND');
  }
  const ticket = await prisma.workOrderQrTicket.findUnique({
    where: { publicCode: code },
    include: {
      prints: {
        where: {
          items: {
            some: {
              material: WorkOrderQrPrintMaterial.TRAVELER,
              status: WorkOrderQrPrintStatus.CONFIRMED,
            },
          },
        },
        // A production ticket becomes usable as soon as its traveler sheet is
        // physically confirmed, even when SOP or drawing confirmation remains
        // pending. Parent confirmedAt is intentionally null in that partial
        // state, so printedAt is the stable newest-confirmed-traveler order.
        orderBy: { printedAt: 'desc' },
        take: 1,
        select: { routeVersion: true },
      },
      workOrder: {
        include: {
          processRoute: {
            include: {
              steps: {
                where: { retiredAt: null },
                orderBy: [{ position: 'asc' }],
                include: {
                  supplementObligation: true,
                  productTimeDeploymentRoute: {
                    select: {
                      id: true,
                      status: true,
                      routeVersionAfter: true,
                      result: true,
                      deployment: { select: { id: true, status: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!ticket || ticket.workOrder.deletedAt) {
    throw new WorkOrderQrServiceError('二维码对应的工单不存在', 404, 'QR_TICKET_NOT_FOUND');
  }
  if (options.recordScan) {
    await prisma.workOrderQrTicket.update({
      where: { id: ticket.id },
      data: { lastScannedAt: new Date(), scanCount: { increment: 1 } },
    });
  }
  const order = ticket.workOrder;
  const route = order.processRoute;
  const activeTimeChanges = route
    ? await prisma.processRouteChange.findMany({
        where: {
          routeId: route.id,
          status: 'ACTIVE',
          activatedRouteVersion: { not: null },
          diffs: { some: { kind: 'UPDATE_TIME' } },
        },
        orderBy: [{ activatedRouteVersion: 'desc' }, { activatedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          activatedRouteVersion: true,
          diffs: {
            where: { kind: 'UPDATE_TIME' },
            orderBy: { position: 'asc' },
            select: { kind: true, targetStepId: true, beforeData: true },
          },
        },
      })
    : [];
  const changeSnapshots = processRouteStepChangeSnapshots(route?.steps || [], activeTimeChanges);
  const quantity = getProductionQuantitySummary(order);
  const completedQty = Number.isFinite(quantity.completedQty) ? Number(quantity.completedQty) : 0;
  const targetQty = Number.isFinite(quantity.targetQty) ? Number(quantity.targetQty) : 0;
  const unitLabel = route?.steps.find(step => step.unitLabel)?.unitLabel || '件';
  const printedVersion = ticket.prints[0]?.routeVersion ?? null;
  return {
    publicCode: ticket.publicCode,
    shortCode: shortCode(ticket.publicCode),
    ticketStatus: ticket.status,
    workOrder: {
      id: order.id,
      code: order.code,
      businessCode: order.businessCode || businessWorkOrderCodeBase(order),
      customerName: order.customerName,
      productName: order.productName,
      specification: order.specification,
      sourceOrderNo: order.sourceOrderNo,
      targetQty,
      completedQty,
      unitLabel,
      deliveryDay: order.deliveryDay,
      priority: order.priority,
      stage: order.stage,
      parentWorkOrderId: order.parentWorkOrderId,
    },
    route: route ? {
      id: route.id,
      version: route.version,
      printedVersion,
      paperOutdated: printedVersion !== null && printedVersion !== route.version,
      status: route.status,
      name: route.templateName,
      steps: route.steps.map(step => {
        const changeSnapshot = changeSnapshots.get(step.id)!;
        return {
        id: step.id,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        processCode: step.processCode,
        processName: step.processName,
        stageGroup: step.stageGroup,
        timeBasis: step.timeBasis,
        unitLabel: step.unitLabel,
        standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
        setupMilliseconds: step.setupMilliseconds,
        unitsPerProduct: step.unitsPerProduct,
        reportQuantityBasis: step.reportQuantityBasis === 'action' ? 'action' : 'product',
        reportUnitLabel: step.reportUnitLabel || step.unitLabel || '件',
        status: step.status,
        processedQty: step.processedQty,
        executionMode: step.executionMode,
        isCritical: step.isCritical,
        changeSource: step.changeSource,
        changeTag: changeSnapshot.tag,
        changeVersion: changeSnapshot.changeVersion,
        sourceChangeId: changeSnapshot.sourceChangeId,
        previousStandardMillisecondsPerUnit: changeSnapshot.previousStandardMillisecondsPerUnit,
        supplementObligation: step.supplementObligation ? {
          id: step.supplementObligation.id,
          requiredQty: step.supplementObligation.requiredQty,
          systemCoveredQty: step.supplementObligation.systemCoveredQty,
          actualRequiredQty: processSupplementActualRequiredQty(step.supplementObligation),
          reportedQty: step.supplementObligation.reportedQty,
          reportedUnitQty: step.supplementObligation.reportedUnitQty,
          reportedGoodUnitQty: step.supplementObligation.reportedGoodUnitQty,
          reportedDefectUnitQty: step.supplementObligation.reportedDefectUnitQty,
          reportQuantityBasis: step.supplementObligation.reportQuantityBasis === 'action' ? 'action' : 'product',
          reportUnitLabel: step.supplementObligation.reportUnitLabel,
          remainingQty: processSupplementRemainingQty(step.supplementObligation),
          fulfillmentMode: step.supplementObligation.fulfillmentMode,
          releasePolicy: step.supplementObligation.releasePolicy,
          isCritical: step.supplementObligation.isCritical,
          status: step.supplementObligation.status,
          version: step.supplementObligation.version,
        } : null,
      };
      }),
    } : null,
    access: resolveFieldReportAccess({
      ticketStatus: ticket.status,
      workOrder: order,
      route: route ? {
        status: route.status,
        hasActiveSupplement: route.steps.some(step => (
          step.executionMode === 'SUPPLEMENTAL_OBLIGATION'
          && step.supplementObligation?.status === 'ACTIVE'
        )),
      } : null,
    }),
  };
}

export function fieldReportCodeIsValid(value: unknown): boolean {
  return REPORT_CODE_PATTERN.test(String(value || '').trim());
}

export function ensureFieldReportParticipants(currentEmployeeId: string, requestedEmployeeIds: unknown): string[] {
  const currentId = String(currentEmployeeId || '').trim();
  if (!currentId) return [];
  const requested = cleanIds(requestedEmployeeIds);
  return [...new Set([currentId, ...requested.filter(id => id !== currentId)])].slice(0, 30);
}
