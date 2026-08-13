import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { canReviewAbnormalTimeEvent } from '@/lib/abnormal-time-access';
import { segmentsFromJson, serializeAbnormalTimeEvent } from '@/lib/attendance';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  allocations: { include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' as const } } },
  qualityConfirmedBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  workOrder: { select: { id: true, code: true, customerName: true, specification: true, productName: true } },
  processStep: { select: { id: true, processCode: true, processName: true } },
  reportedByEmployee: true,
} satisfies Prisma.AbnormalTimeEventInclude;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const decision = body.decision === 'rejected' ? 'rejected' as const : body.decision === 'confirmed' ? 'confirmed' as const : null;
    if (!decision) return NextResponse.json({ ok: false, error: '请选择确认或驳回' }, { status: 400 });
    const note = cleanProcessText(body.note, 500);
    if (decision === 'rejected' && !note) {
      return NextResponse.json({ ok: false, error: '驳回时请填写原因' }, { status: 400 });
    }
    const event = await prisma.$transaction(async tx => {
      const existing = await tx.abnormalTimeEvent.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { allocations: { include: { employee: true } } },
      });
      if (!existing) throw new Error('异常工时记录不存在');
      if (!(await canReviewAbnormalTimeEvent(user, existing.allocations.map(item => item.employeeId)))) {
        throw new ForbiddenError();
      }
      const expectedVersion = body.expectedVersion === undefined ? existing.version : Number(body.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== existing.version) {
        throw new Error('异常记录已被其他人更新，请刷新后重新审核');
      }
      const approvedMinutesProvided = body.approvedDurationMinutes !== undefined
        && String(body.approvedDurationMinutes).trim() !== '';
      const approvedMinutes = approvedMinutesProvided ? Number(body.approvedDurationMinutes) : null;
      const approvedDurationMilliseconds = approvedMinutes === null
        ? existing.durationMilliseconds
        : approvedMinutes * 60_000;
      if (
        decision === 'confirmed'
        && (
          (approvedMinutes !== null && (!Number.isSafeInteger(approvedMinutes) || approvedMinutes <= 0))
          || approvedDurationMilliseconds > existing.durationMilliseconds
        )
      ) {
        throw new Error(`审核时长必须是 1 至 ${Math.floor(existing.durationMilliseconds / 60_000)} 分钟的整数，或留空按原始时长确认`);
      }
      const employeeExempt = decision === 'confirmed' && (
        body.employeeExempt === undefined ? existing.employeeExempt : body.employeeExempt === true
      );
      if (employeeExempt) {
        for (const allocation of existing.allocations) {
          const attendance = await tx.attendanceRecord.findUnique({
            where: {
              employeeId_workDate: {
                employeeId: allocation.employeeId,
                workDate: existing.workDate,
              },
            },
          });
          if (!attendance || attendance.status !== 'confirmed') {
            throw new Error(`${allocation.employee.name} 当日考勤尚未确认，不能确认免责异常`);
          }
          const insideAttendance = segmentsFromJson(attendance.segments).some(segment =>
            new Date(segment.startedAt) <= existing.startedAt && new Date(segment.endedAt) >= existing.endedAt);
          if (!insideAttendance) {
            throw new Error(`${allocation.employee.name} 的异常时段不在已确认出勤时段内`);
          }
          const overlappingExecution = await tx.processExecution.findFirst({
            where: {
              employeeId: allocation.employeeId,
              voidedAt: null,
              startedAt: { lt: existing.endedAt },
              endedAt: { gt: existing.startedAt },
            },
            select: { id: true },
          });
          if (overlappingExecution) {
            throw new Error(`${allocation.employee.name} 同一时段已有生产报工，请先校正时间`);
          }
          const overlappingAbnormal = await tx.abnormalTimeEvent.findFirst({
            where: {
              id: { not: existing.id },
              deletedAt: null,
              employeeExempt: true,
              qualityStatus: 'confirmed',
              startedAt: { lt: existing.endedAt },
              endedAt: { gt: existing.startedAt },
              allocations: { some: { employeeId: allocation.employeeId } },
            },
            select: { id: true, sequence: true },
          });
          if (overlappingAbnormal) {
            throw new Error(`${allocation.employee.name} 同一时段已存在已确认免责异常 #${overlappingAbnormal.sequence}`);
          }
        }
      }
      return tx.abnormalTimeEvent.update({
        where: { id: existing.id },
        data: {
          qualityStatus: decision,
          qualityNote: note || null,
          approvedDurationMilliseconds: decision === 'confirmed' ? approvedDurationMilliseconds : null,
          employeeExempt,
          qualityConfirmedById: user.id,
          qualityConfirmedAt: new Date(),
          updatedById: user.id,
          version: { increment: 1 },
        },
        include,
      });
    });
    await logOp({
      userId: user.id,
      action: decision === 'confirmed' ? 'supervisor_confirm_abnormal_time' : 'supervisor_reject_abnormal_time',
      targetType: 'abnormal_time_event',
      targetId: event.id,
      detail: {
        sequence: event.sequence,
        employeeExempt: event.employeeExempt,
        approvedDurationMilliseconds: event.approvedDurationMilliseconds,
      },
    });
    return NextResponse.json({ ok: true, event: serializeAbnormalTimeEvent(event) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('仅车间主管、质量部或管理员可以审核当前范围的异常工时');
    const message = error instanceof Error ? error.message : '异常工时审核失败';
    console.error('supervisor review abnormal time failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
