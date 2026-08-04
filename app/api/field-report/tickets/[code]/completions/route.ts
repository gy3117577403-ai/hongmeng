import { ProcessCompletionSource } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  completeProcessStep,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import {
  ensureFieldReportParticipants,
  loadFieldReportTicket,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    const user = await requireUser({ write: 'labor' });
    const currentEmployee = user.employeeId
      ? await prisma.employee.findFirst({
          where: { id: user.employeeId, ...productionEmployeeWhere() },
          select: { id: true, employeeNo: true, name: true },
        })
      : null;
    if (!currentEmployee) {
      return NextResponse.json(
        { ok: false, error: '当前账号未关联有效生产员工，不能提交现场报工', code: 'FIELD_REPORT_EMPLOYEE_REQUIRED' },
        { status: 403 },
      );
    }
    const ticket = await loadFieldReportTicket(params.code);
    if (!ticket.access.canReport || !ticket.route) {
      return NextResponse.json(
        { ok: false, error: ticket.access.message, code: 'FIELD_REPORT_READ_ONLY' },
        { status: 409 },
      );
    }
    const body = await req.json().catch(() => ({})) as {
      stepId?: unknown;
      processedQty?: unknown;
      defectQty?: unknown;
      defectDisposition?: unknown;
      workDate?: unknown;
      employeeIds?: unknown;
      team?: unknown;
      workstation?: unknown;
      remark?: unknown;
      idempotencyKey?: unknown;
      expectedRouteVersion?: unknown;
    };
    const employeeIds = ensureFieldReportParticipants(currentEmployee.id, body.employeeIds);
    const data = await completeProcessStep({
      routeId: ticket.route.id,
      stepId: body.stepId,
      processedQty: body.processedQty,
      defectQty: body.defectQty,
      defectDisposition: body.defectDisposition,
      workDate: body.workDate,
      employeeIds,
      team: body.team,
      workstation: body.workstation,
      remark: body.remark,
      requireParticipants: true,
      allowAdvanceReporting: true,
      autoAssignLabor: true,
      reportSource: ProcessCompletionSource.QR_MOBILE,
      idempotencyKey: body.idempotencyKey,
      expectedRouteVersion: body.expectedRouteVersion,
      userId: user.id,
      actor: `${currentEmployee.employeeNo} · ${currentEmployee.name}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('field report completion failed', error);
    return NextResponse.json({ ok: false, error: '现场报工保存失败，请刷新后重试' }, { status: 500 });
  }
}
