import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  FieldReportPinAuthError,
  resolveFieldReportPinPrincipal,
  resolveFieldReportTerminal,
} from '@/lib/field-report-pin-auth';
import {
  loadProcessCompletionContext,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import {
  loadFieldReportTicket,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    const terminal = await resolveFieldReportTerminal();
    const pinPrincipal = terminal
      ? await resolveFieldReportPinPrincipal(params.code, terminal)
      : null;
    if (terminal && !pinPrincipal) {
      throw new FieldReportPinAuthError(
        '请先验证员工编号和 PIN',
        401,
        'FIELD_REPORT_PIN_REQUIRED',
      );
    }
    const user = terminal ? null : await requireUser();
    const stepId = String(req.nextUrl.searchParams.get('stepId') || '').trim() || null;
    const ticket = await loadFieldReportTicket(params.code, { recordScan: !stepId });
    const currentEmployee = pinPrincipal?.employee || (user?.employeeId
      ? await prisma.employee.findFirst({
          where: { id: user.employeeId, ...productionEmployeeWhere() },
          select: {
            id: true,
            employeeNo: true,
            name: true,
            department: true,
            position: true,
            team: true,
          },
        })
      : null);
    const context = ticket.access.canReport && ticket.route
      ? await loadProcessCompletionContext(ticket.route.id, stepId, { allowAdvanceReporting: true })
      : null;
    return NextResponse.json({
      ok: true,
      data: {
        ticket,
        context,
        currentEmployee,
        identityMessage: currentEmployee
          ? `当前报工人：${currentEmployee.employeeNo} · ${currentEmployee.name}`
          : '当前账号未关联有效生产员工，只能查看工单',
        authMode: pinPrincipal ? 'FIELD_PIN' : 'ACCOUNT',
      },
    });
  } catch (error) {
    if (error instanceof FieldReportPinAuthError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('field report ticket load failed', error);
    return NextResponse.json({ ok: false, error: '现场报工页面加载失败' }, { status: 500 });
  }
}
