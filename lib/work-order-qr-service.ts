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
import { isExecutableProductionWorkOrder } from '@/lib/work-orders';
import { businessWorkOrderCodeBase } from '@/lib/work-order-business-code';
import { processRouteStepChangeSnapshots } from '@/lib/process-route-change-contract';

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
    status: string;
    processedQty: number;
    executionMode?: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
    changeSource?: 'EXISTING' | 'NEW';
    changeTag?: 'ADDED' | 'TIME_CHANGED' | 'ADDED_AND_TIME_CHANGED' | 'NONE';
    changeVersion?: number | null;
    sourceChangeId?: string | null;
    previousStandardMillisecondsPerUnit?: number | null;
    supplementObligation?: {
      id: string;
      requiredQty: number;
      reportedQty: number;
      remainingQty: number;
      status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED';
      version: number;
    } | null;
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

type TravelerOrder = Prisma.WorkOrderGetPayload<{
  include: {
    processRoute: { include: { steps: true } };
    drawingLibraryItem: {
      include: {
        files: { include: { category: true } };
      };
    };
  };
}>;

type TravelerSourceFile = NonNullable<TravelerOrder['drawingLibraryItem']>['files'][number];

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
  if (mode === WorkOrderQrPrintMode.TRAVELER_SOP_SEPARATE) return WorkOrderQrPrintMode.TRAVELER_SOP_SEPARATE;
  if (mode === WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE) return WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE;
  if (mode === WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX) return WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX;
  if (mode === WorkOrderQrPrintMode.CUSTOM) return WorkOrderQrPrintMode.CUSTOM;
  return WorkOrderQrPrintMode.TRAVELER_ONLY;
}

const PRINT_MATERIAL_ORDER = [
  WorkOrderQrPrintMaterial.TRAVELER,
  WorkOrderQrPrintMaterial.SOP,
  WorkOrderQrPrintMaterial.DRAWING,
] as const;

export function resolveWorkOrderQrPrintMaterials(mode: WorkOrderQrPrintMode, values?: unknown): WorkOrderQrPrintMaterial[] {
  if (mode === WorkOrderQrPrintMode.TRAVELER_ONLY) return [WorkOrderQrPrintMaterial.TRAVELER];
  if (mode === WorkOrderQrPrintMode.TRAVELER_SOP_DUPLEX || mode === WorkOrderQrPrintMode.TRAVELER_SOP_SEPARATE) {
    return [WorkOrderQrPrintMaterial.TRAVELER, WorkOrderQrPrintMaterial.SOP];
  }
  if (mode === WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE || mode === WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX) {
    return [...PRINT_MATERIAL_ORDER];
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

function latestSourceFile(order: TravelerOrder, categoryCode: 'drawing' | 'sop'): TravelerSourceFile | null {
  const files = order.drawingLibraryItem?.files || [];
  return [...files]
    .filter(file => file.deletedAt === null && file.isCurrent && file.category.code === categoryCode)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] || null;
}

function targetQuantity(order: Pick<TravelerOrder, 'productionTargetQty' | 'uncompletedQty' | 'completedQty' | 'stage'>): number {
  const value = getProductionQuantitySummary(order).targetQty;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function createSnapshot(order: TravelerOrder): WorkOrderTravelerSnapshot {
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
        status: step.status,
        processedQty: step.processedQty,
      })),
  };
}

export async function createWorkOrderTravelerPrints(input: {
  workOrderIds: unknown;
  mode?: unknown;
  copies?: unknown;
  materials?: unknown;
  materialCopies?: unknown;
  reprintReason?: unknown;
  userId: string;
  actor: string;
}): Promise<WorkOrderTravelerPrintRecord[]> {
  const workOrderIds = cleanIds(input.workOrderIds);
  const mode = cleanPrintMode(input.mode);
  const copies = cleanCopies(input.copies ?? 1);
  const materials = resolveWorkOrderQrPrintMaterials(mode, input.materials);
  const materialCopies = cleanMaterialCopies(input.materialCopies, materials, copies);
  const requiresSop = materials.includes(WorkOrderQrPrintMaterial.SOP);
  const requiresDrawing = materials.includes(WorkOrderQrPrintMaterial.DRAWING);
  const reprintReason = String(input.reprintReason || '').trim().slice(0, 500) || null;
  if (!workOrderIds.length) {
    throw new WorkOrderQrServiceError('请至少选择一张生产工单', 400, 'QR_WORK_ORDER_REQUIRED');
  }
  if (workOrderIds.length > MAX_PRINT_BATCH) {
    throw new WorkOrderQrServiceError(`每次最多打印 ${MAX_PRINT_BATCH} 张流转单`, 400, 'QR_PRINT_BATCH_TOO_LARGE');
  }
  if ((requiresSop || requiresDrawing) && workOrderIds.length > MAX_SOP_PRINT_BATCH) {
    throw new WorkOrderQrServiceError(`含生产资料的打印任务每次最多选择 ${MAX_SOP_PRINT_BATCH} 张工单`, 400, 'QR_RESOURCE_PRINT_BATCH_TOO_LARGE');
  }
  const orders = await prisma.workOrder.findMany({
    where: { id: { in: workOrderIds }, deletedAt: null },
    include: {
      processRoute: {
        include: { steps: { where: { retiredAt: null }, orderBy: [{ position: 'asc' }] } },
      },
      drawingLibraryItem: {
        include: {
          files: {
            where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } },
            include: { category: true },
            orderBy: [{ updatedAt: 'desc' }],
          },
        },
      },
    },
  });
  if (orders.length !== workOrderIds.length) {
    throw new WorkOrderQrServiceError('所选工单中有记录不存在或已删除，请刷新后重试', 404, 'QR_WORK_ORDER_NOT_FOUND');
  }
  const orderById = new Map(orders.map(order => [order.id, order]));
  const snapshots = workOrderIds.map(id => createSnapshot(orderById.get(id)!));
  if (requiresSop) {
    const missingSop = snapshots.find(snapshot => !snapshot.sopFileId);
    if (missingSop) {
      throw new WorkOrderQrServiceError(`${missingSop.businessWorkOrderCode || missingSop.workOrderCode} 尚未上传 SOP，不能合并打印`, 409, 'QR_SOP_REQUIRED');
    }
    const nonPdfSop = snapshots.find(snapshot => snapshot.sopMimeType !== 'application/pdf' && !snapshot.sopFileName?.toLowerCase().endsWith('.pdf'));
    if (nonPdfSop) {
      throw new WorkOrderQrServiceError(`${nonPdfSop.businessWorkOrderCode || nonPdfSop.workOrderCode} 的 SOP 不是 PDF，请先转换后再合并打印`, 409, 'QR_SOP_PDF_REQUIRED');
    }
  }
  if (requiresDrawing) {
    const missingDrawing = snapshots.find(snapshot => !snapshot.drawingFileId);
    if (missingDrawing) {
      throw new WorkOrderQrServiceError(`${missingDrawing.businessWorkOrderCode || missingDrawing.workOrderCode} 尚未上传原图，不能生成原图打印任务`, 409, 'QR_DRAWING_REQUIRED');
    }
    const nonPdfDrawing = snapshots.find(snapshot => snapshot.drawingMimeType !== 'application/pdf' && !snapshot.drawingFileName?.toLowerCase().endsWith('.pdf'));
    if (nonPdfDrawing) {
      throw new WorkOrderQrServiceError(`${nonPdfDrawing.businessWorkOrderCode || nonPdfDrawing.workOrderCode} 的原图不是 PDF；为保留 A3/A4 原始纸张尺寸，请先上传 PDF`, 409, 'QR_DRAWING_PDF_REQUIRED');
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
  return printIds.map(id => {
    const print = printById.get(id)!;
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
      snapshot: print.snapshot as unknown as WorkOrderTravelerSnapshot,
    };
  });
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
        .filter((value): value is WorkOrderQrPrintMaterial => PRINT_MATERIAL_ORDER.includes(value as WorkOrderQrPrintMaterial))
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
        status: step.status,
        processedQty: step.processedQty,
        executionMode: step.executionMode,
        changeSource: step.changeSource,
        changeTag: changeSnapshot.tag,
        changeVersion: changeSnapshot.changeVersion,
        sourceChangeId: changeSnapshot.sourceChangeId,
        previousStandardMillisecondsPerUnit: changeSnapshot.previousStandardMillisecondsPerUnit,
        supplementObligation: step.supplementObligation ? {
          id: step.supplementObligation.id,
          requiredQty: step.supplementObligation.requiredQty,
          reportedQty: step.supplementObligation.reportedQty,
          remainingQty: Math.max(0, step.supplementObligation.requiredQty - step.supplementObligation.reportedQty),
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
