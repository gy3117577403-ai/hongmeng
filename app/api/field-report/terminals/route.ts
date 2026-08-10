import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/constants';
import {
  assertFieldReportJsonMutation,
  clearFieldReportPinSessionCookie,
  FieldReportPinAuthError,
  resolveFieldReportTerminal,
  setFieldReportTerminalCookie,
} from '@/lib/field-report-pin-auth';
import { generateFieldReportTerminalSecret } from '@/lib/field-report-pin-security';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const [terminals, currentTerminal] = await Promise.all([
      prisma.fieldReportTerminal.findMany({
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          name: true,
          location: true,
          version: true,
          isActive: true,
          failedAttempts: true,
          lockedUntil: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { displayName: true } },
          _count: { select: { pinSessions: true, processCompletions: true } },
        },
      }),
      resolveFieldReportTerminal(),
    ]);
    return NextResponse.json({
      ok: true,
      data: terminals.map(terminal => ({
        ...terminal,
        isCurrentDevice: terminal.id === currentTerminal?.id,
        createdByName: terminal.createdBy?.displayName || null,
        createdBy: undefined,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    console.error('field report terminal list failed', error);
    return NextResponse.json({ ok: false, error: '共享终端列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    assertFieldReportJsonMutation(req);
    const admin = await requireAdmin();
    const body = await req.json().catch(() => null) as {
      name?: unknown;
      location?: unknown;
    } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new FieldReportPinAuthError('请求格式错误', 400, 'FIELD_REPORT_BODY_INVALID');
    }
    const name = String(body.name ?? '').trim().slice(0, 80);
    const location = String(body.location ?? '').trim().slice(0, 120) || null;
    if (name.length < 2) {
      throw new FieldReportPinAuthError('请输入至少 2 个字的终端名称', 400, 'FIELD_REPORT_TERMINAL_NAME_REQUIRED');
    }

    const generatedSecret = generateFieldReportTerminalSecret();
    const terminal = await prisma.fieldReportTerminal.create({
      data: {
        name,
        location,
        secretHash: generatedSecret.secretHash,
        createdById: admin.id,
        updatedById: admin.id,
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        location: true,
        version: true,
        isActive: true,
        createdAt: true,
      },
    });
    const response = NextResponse.json({
      ok: true,
      data: terminal,
      redirectTo: '/field-terminal',
    }, { status: 201 });
    setFieldReportTerminalCookie(response, generatedSecret.secret);
    clearFieldReportPinSessionCookie(response);
    response.cookies.delete(SESSION_COOKIE);
    await logOp({
      userId: admin.id,
      action: 'enroll_field_report_terminal',
      targetType: 'field_report_terminal',
      targetId: terminal.id,
      detail: { name: terminal.name, location: terminal.location },
    });
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof FieldReportPinAuthError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('field report terminal enrollment failed', error);
    return NextResponse.json({ ok: false, error: '共享终端注册失败' }, { status: 500 });
  }
}
