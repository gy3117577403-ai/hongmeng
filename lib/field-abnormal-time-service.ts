import { Prisma } from '@prisma/client';
import {
  ABNORMAL_TIME_CATEGORIES,
  parseAbnormalTimeDuration,
  parseEmployeeIds,
  parseOptionalPositiveInteger,
  serializeAbnormalTimeEvent,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { cleanProcessText } from '@/lib/process-time';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import {
  loadFieldReportTicket,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

const include = {
  allocations: { include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' as const } } },
  qualityConfirmedBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  workOrder: { select: { id: true, code: true, customerName: true, specification: true, productName: true } },
  processStep: { select: { id: true, processCode: true, processName: true } },
  reportedByEmployee: true,
} satisfies Prisma.AbnormalTimeEventInclude;

export class FieldAbnormalTimeError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'FIELD_ABNORMAL_TIME_INVALID',
  ) {
    super(message);
    this.name = 'FieldAbnormalTimeError';
  }
}

type FieldAbnormalTimeInput = {
  code: string;
  userId: string;
  employeeId: string | null;
  body: Record<string, unknown>;
};

function idempotencyKey(value: unknown): string {
  const key = cleanProcessText(value, 100);
  if (!/^qra-[A-Za-z0-9_-]{12,96}$/.test(key)) {
    throw new FieldAbnormalTimeError('异常登记请求已失效，请关闭窗口后重新提交');
  }
  return key;
}

function topLevelCategory(value: unknown): typeof ABNORMAL_TIME_CATEGORIES[number]['value'] {
  const category = cleanProcessText(value, 40);
  const matched = ABNORMAL_TIME_CATEGORIES.find(item => item.value === category);
  if (!matched) throw new FieldAbnormalTimeError('请选择异常问题分类');
  return matched.value;
}

export async function createFieldAbnormalTimeEvent(input: FieldAbnormalTimeInput) {
  if (!input.employeeId) {
    throw new FieldAbnormalTimeError('当前账号未绑定在职生产员工，不能登记异常工时', 403, 'FIELD_EMPLOYEE_REQUIRED');
  }
  const reporter = await prisma.employee.findFirst({
    where: { id: input.employeeId, ...productionEmployeeWhere() },
    select: { id: true },
  });
  if (!reporter) {
    throw new FieldAbnormalTimeError('当前账号未绑定在职生产员工，不能登记异常工时', 403, 'FIELD_EMPLOYEE_REQUIRED');
  }

  const ticket = await loadFieldReportTicket(input.code, { recordScan: false });
  if (!ticket.route) throw new FieldAbnormalTimeError('当前工单没有可登记异常的工艺路线', 409, 'FIELD_ROUTE_REQUIRED');
  if (ticket.access.state !== 'READY' && ticket.access.state !== 'COMPLETED') {
    throw new FieldAbnormalTimeError(ticket.access.message, 409, 'FIELD_TICKET_NOT_ACTIVE');
  }
  const stepId = cleanProcessText(input.body.stepId, 80);
  const step = ticket.route.steps.find(item => item.id === stepId);
  if (!step) throw new FieldAbnormalTimeError('所选工序已变更，请刷新二维码页面后重试', 409, 'FIELD_STEP_CHANGED');

  const key = idempotencyKey(input.body.idempotencyKey);
  const existing = await prisma.abnormalTimeEvent.findUnique({ where: { idempotencyKey: key }, include });
  if (existing) {
    if (existing.createdById !== input.userId || existing.reportedByEmployeeId !== reporter.id) {
      throw new FieldAbnormalTimeError('异常登记请求标识冲突，请重新提交', 409, 'FIELD_ABNORMAL_IDEMPOTENCY_CONFLICT');
    }
    return { created: false, event: serializeAbnormalTimeEvent(existing) };
  }

  const category = topLevelCategory(input.body.category);
  let duration: ReturnType<typeof parseAbnormalTimeDuration>;
  try {
    duration = parseAbnormalTimeDuration({
      workDate: input.body.workDate,
      durationMinutes: input.body.durationMinutes,
    });
  } catch (error) {
    throw new FieldAbnormalTimeError(error instanceof Error ? error.message : '请填写有效的异常日期和时长');
  }
  const employeeIds = parseEmployeeIds(input.body.employeeIds);
  if (!employeeIds.includes(reporter.id)) {
    throw new FieldAbnormalTimeError('受影响员工必须包含当前登录人');
  }
  if (employeeIds.length > 20) throw new FieldAbnormalTimeError('现场单条异常最多关联 20 名员工');
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, ...productionEmployeeWhere() },
    select: { id: true },
  });
  if (employees.length !== employeeIds.length) {
    throw new FieldAbnormalTimeError('受影响员工中包含已离职、未启用考勤或非生产人员');
  }

  const title = `${ABNORMAL_TIME_CATEGORIES.find(item => item.value === category)!.label} · ${step.processName}`;
  try {
    const event = await prisma.$transaction(async tx => {
      const created = await tx.abnormalTimeEvent.create({
        data: {
          workDate: duration.workDate,
          category,
          subcategory: cleanProcessText(input.body.subcategory, 100) || null,
          title,
          reason: cleanProcessText(input.body.reason, 1000) || null,
          startedAt: null,
          endedAt: null,
          durationMilliseconds: duration.durationMilliseconds,
          affectedQuantity: parseOptionalPositiveInteger(input.body.affectedQuantity, '受影响数量'),
          employeeExempt: true,
          qualityStatus: 'pending',
          responsibilityDepartment: cleanProcessText(input.body.responsibilityDepartment, 100) || null,
          responsibilityObject: cleanProcessText(input.body.responsibilityObject, 160) || null,
          resolutionStatus: 'open',
          workOrderId: ticket.workOrder.id,
          processStepId: step.id,
          source: 'FIELD_REPORT',
          idempotencyKey: key,
          reportedByEmployeeId: reporter.id,
          createdById: input.userId,
          updatedById: input.userId,
          allocations: {
            create: employeeIds.map(employeeId => ({
              employeeId,
              workDate: duration.workDate,
              durationMilliseconds: duration.durationMilliseconds,
            })),
          },
        },
        include,
      });
      await tx.operationLog.create({
        data: {
          userId: input.userId,
          action: 'field_report_create_abnormal_time',
          targetType: 'abnormal_time_event',
          targetId: created.id,
          detail: {
            sequence: created.sequence,
            workOrderId: ticket.workOrder.id,
            processStepId: step.id,
            category,
            durationMinutes: duration.durationMilliseconds / 60_000,
            employeeCount: employeeIds.length,
          },
        },
      });
      return created;
    });
    return { created: true, event: serializeAbnormalTimeEvent(event) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await prisma.abnormalTimeEvent.findUnique({ where: { idempotencyKey: key }, include });
      if (duplicate && duplicate.createdById === input.userId && duplicate.reportedByEmployeeId === reporter.id) {
        return { created: false, event: serializeAbnormalTimeEvent(duplicate) };
      }
    }
    throw error;
  }
}

export function fieldAbnormalTimeErrorResponse(error: unknown): { status: number; code: string; message: string } | null {
  if (error instanceof FieldAbnormalTimeError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof WorkOrderQrServiceError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  return null;
}
