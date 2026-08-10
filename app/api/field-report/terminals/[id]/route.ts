import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  assertFieldReportBrowserMutation,
  clearFieldReportTerminalCookies,
  resolveFieldReportTerminal,
} from '@/lib/field-report-pin-auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    assertFieldReportBrowserMutation(req);
    const admin = await requireAdmin();
    const id = String(params.id || '').trim();
    const currentTerminal = await resolveFieldReportTerminal();
    const now = new Date();
    const terminal = await prisma.$transaction(async tx => {
      const existing = await tx.fieldReportTerminal.findUnique({
        where: { id },
        select: { id: true, name: true, isActive: true },
      });
      if (!existing) return null;
      const updated = await tx.fieldReportTerminal.update({
        where: { id },
        data: {
          isActive: false,
          version: { increment: 1 },
          failedAttempts: 0,
          lockedUntil: null,
          updatedById: admin.id,
        },
        select: { id: true, name: true, isActive: true, version: true },
      });
      await tx.fieldReportPinSession.updateMany({
        where: { terminalId: id, consumedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      return updated;
    });
    if (!terminal) {
      return NextResponse.json(
        { ok: false, error: '共享终端不存在', code: 'FIELD_REPORT_TERMINAL_NOT_FOUND' },
        { status: 404 },
      );
    }
    const response = NextResponse.json({ ok: true, data: terminal });
    if (currentTerminal?.id === terminal.id) clearFieldReportTerminalCookies(response);
    await logOp({
      userId: admin.id,
      action: 'revoke_field_report_terminal',
      targetType: 'field_report_terminal',
      targetId: terminal.id,
      detail: { name: terminal.name },
    });
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    console.error('field report terminal revoke failed', error);
    return NextResponse.json({ ok: false, error: '共享终端停用失败' }, { status: 500 });
  }
}
