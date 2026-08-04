import crypto from 'node:crypto';
import { Prisma, WorkOrderQrTicketStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { isExecutableProductionWorkOrder } from '@/lib/work-orders';

const MAX_PRINT_BATCH = 30;
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
  }>;
};

export type WorkOrderTravelerPrintRecord = {
  printId: string;
  publicCode: string;
  shortCode: string;
  printedAt: string;
  printedBy: string;
  snapshot: WorkOrderTravelerSnapshot;
};

export type FieldReportTicketView = {
  publicCode: string;
  shortCode: string;
  ticketStatus: 'ACTIVE' | 'REVOKED';
  workOrder: {
    id: string;
    code: string;
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
  };
}>;

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
  return {
    workOrderId: order.id,
    workOrderCode: order.code,
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
  userId: string;
  actor: string;
}): Promise<WorkOrderTravelerPrintRecord[]> {
  const workOrderIds = cleanIds(input.workOrderIds);
  if (!workOrderIds.length) {
    throw new WorkOrderQrServiceError('请至少选择一张生产工单', 400, 'QR_WORK_ORDER_REQUIRED');
  }
  if (workOrderIds.length > MAX_PRINT_BATCH) {
    throw new WorkOrderQrServiceError(`每次最多打印 ${MAX_PRINT_BATCH} 张流转单`, 400, 'QR_PRINT_BATCH_TOO_LARGE');
  }
  const orders = await prisma.workOrder.findMany({
    where: { id: { in: workOrderIds }, deletedAt: null },
    include: {
      processRoute: {
        include: { steps: { orderBy: [{ position: 'asc' }] } },
      },
    },
  });
  if (orders.length !== workOrderIds.length) {
    throw new WorkOrderQrServiceError('所选工单中有记录不存在或已删除，请刷新后重试', 404, 'QR_WORK_ORDER_NOT_FOUND');
  }
  const orderById = new Map(orders.map(order => [order.id, order]));
  const snapshots = workOrderIds.map(id => createSnapshot(orderById.get(id)!));

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
      const print = await tx.workOrderQrPrint.create({
        data: {
          ticketId: ticket.id,
          routeId: snapshot.routeId,
          routeVersion: snapshot.routeVersion,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          printedById: input.userId,
        },
      });
      records.push({
        printId: print.id,
        publicCode: ticket.publicCode,
        shortCode: shortCode(ticket.publicCode),
        printedAt: print.printedAt.toISOString(),
        printedBy: input.actor,
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
      printedBy: print.printedBy?.displayName || print.printedBy?.username || '系统用户',
      snapshot: print.snapshot as unknown as WorkOrderTravelerSnapshot,
    };
  });
}

export function resolveFieldReportAccess(input: {
  ticketStatus: WorkOrderQrTicketStatus;
  workOrder: { planType: string | null; planClearedAt: Date | null; stage: string; deletedAt: Date | null };
  route: { status: string } | null;
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
  if (input.route.status === 'completed' || input.workOrder.stage === 'completed') {
    return { canReport: false, state: 'COMPLETED', message: '该工单已经完成，当前二维码仅供查询' };
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
      prints: { orderBy: [{ printedAt: 'desc' }], take: 1, select: { routeVersion: true } },
      workOrder: {
        include: {
          processRoute: {
            include: { steps: { orderBy: [{ position: 'asc' }] } },
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
      steps: route.steps.map(step => ({
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
    } : null,
    access: resolveFieldReportAccess({ ticketStatus: ticket.status, workOrder: order, route }),
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
