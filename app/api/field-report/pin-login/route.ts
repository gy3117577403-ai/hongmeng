import { AccessProfileKey, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, forbidden } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/constants';
import {
  assertFieldReportJsonMutation,
  fieldReportLockUntil,
  FIELD_REPORT_PIN_MAX_FAILED_ATTEMPTS,
  FIELD_REPORT_PIN_SESSION_TTL_SECONDS,
  FIELD_REPORT_TERMINAL_MAX_FAILED_ATTEMPTS,
  FieldReportPinAuthError,
  hasLiveFieldReporterGrant,
  isFieldReportLocked,
  isFieldReportPinFormat,
  resolveFieldReportTerminal,
  setFieldReportPinSessionCookie,
} from '@/lib/field-report-pin-auth';
import {
  generateFieldReportSessionToken,
  verifyFieldReportPin,
} from '@/lib/field-report-pin-security';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { isProductionWorkforceEmployee, productionEmployeeWhere } from '@/lib/production-workforce';
import { loadFieldReportTicket } from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIRTUAL_EMPLOYEE_ID = '__unknown_field_report_employee__';
// Valid bcrypt cost-12 hash for an unrelated constant. Unknown employees still
// execute the same HMAC + bcrypt verification path without a cold-request hash.
const VIRTUAL_PIN_HASH = '$2a$12$iQe.WBcxCURSWVsaD1d4xe5H9L70f0C/W1j5gAbujBWEeleF2iQZy';
const AUTH_ERROR = '员工编号或 PIN 错误，或当前账号不可报工';
const PIN_SESSION_TRANSACTION_MAX_ATTEMPTS = 3;

function authFailure(status = 401, retryAfter = false) {
  return NextResponse.json(
    { ok: false, error: AUTH_ERROR, code: 'FIELD_REPORT_PIN_AUTH_FAILED' },
    {
      status,
      ...(retryAfter ? { headers: { 'Retry-After': '900' } } : {}),
    },
  );
}

async function recordFailedAttempt(input: {
  terminalId: string;
  credential?: {
    id: string;
    credentialVersion: number;
  } | null;
  now: Date;
}): Promise<{ terminalLocked: boolean }> {
  return prisma.$transaction(async tx => {
    await tx.fieldReportTerminal.updateMany({
      where: { id: input.terminalId, isActive: true, lockedUntil: { lte: input.now } },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const terminalUpdate = await tx.fieldReportTerminal.updateMany({
      where: {
        id: input.terminalId,
        isActive: true,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: input.now } }],
      },
      data: { failedAttempts: { increment: 1 }, lastSeenAt: input.now },
    });
    const terminal = await tx.fieldReportTerminal.findUnique({
      where: { id: input.terminalId },
      select: { failedAttempts: true, lockedUntil: true },
    });
    const terminalLock = terminal && terminalUpdate.count
      ? fieldReportLockUntil(
          terminal.failedAttempts,
          FIELD_REPORT_TERMINAL_MAX_FAILED_ATTEMPTS,
          input.now,
        )
      : null;
    if (terminalLock) {
      await tx.fieldReportTerminal.updateMany({
        where: { id: input.terminalId, isActive: true },
        data: { lockedUntil: terminalLock },
      });
    }

    if (input.credential) {
      // A PIN reset reuses the credential row but increments credentialVersion.
      // Every mutation is therefore a compare-and-set against the generation
      // that was actually verified above. A slow failure from the old PIN can
      // never increment or lock the newly issued credential.
      const credentialScope = {
        id: input.credential.id,
        credentialVersion: input.credential.credentialVersion,
        isActive: true,
      } as const;
      await tx.employeeFieldReportPinCredential.updateMany({
        where: { ...credentialScope, lockedUntil: { lte: input.now } },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      const credentialUpdate = await tx.employeeFieldReportPinCredential.updateMany({
        where: {
          ...credentialScope,
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: input.now } }],
        },
        data: { failedAttempts: { increment: 1 } },
      });
      const credential = await tx.employeeFieldReportPinCredential.findUnique({
        where: { id: input.credential.id },
        select: { credentialVersion: true, failedAttempts: true },
      });
      const credentialLock = credential
        && credential.credentialVersion === input.credential.credentialVersion
        && credentialUpdate.count
        ? fieldReportLockUntil(
            credential.failedAttempts,
            FIELD_REPORT_PIN_MAX_FAILED_ATTEMPTS,
            input.now,
          )
        : null;
      if (credentialLock) {
        await tx.employeeFieldReportPinCredential.updateMany({
          where: credentialScope,
          data: { lockedUntil: credentialLock },
        });
      }
    }
    return { terminalLocked: Boolean(terminalLock || isFieldReportLocked(terminal?.lockedUntil, input.now)) };
  });
}

function isRetryablePinSessionTransactionError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2034',
  );
}

async function runPinSessionTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < PIN_SESSION_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (isRetryablePinSessionTransactionError(error)) {
        if (attempt + 1 < PIN_SESSION_TRANSACTION_MAX_ATTEMPTS) continue;
        // Keep the public response unified and fail closed instead of turning
        // a serialization/deadlock retry exhaustion into an internal-error 500.
        throw new FieldReportPinAuthError();
      }
      throw error;
    }
  }
  throw new FieldReportPinAuthError();
}

export async function POST(req: NextRequest) {
  try {
    assertFieldReportJsonMutation(req);
    const body = await req.json().catch(() => null) as {
      code?: unknown;
      employeeNo?: unknown;
      pin?: unknown;
    } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return authFailure();
    const code = String(body.code ?? '').trim().slice(0, 180);
    const employeeNo = String(body.employeeNo ?? '').trim().slice(0, 80);
    const pin = String(body.pin ?? '').slice(0, 80);
    const now = new Date();
    const terminal = await resolveFieldReportTerminal();
    if (!terminal) return authFailure();
    if (isFieldReportLocked(terminal.lockedUntil, now)) return authFailure(429, true);

    const employee = employeeNo
      ? await prisma.employee.findUnique({
          where: { employeeNo },
          select: {
            id: true,
            employeeNo: true,
            name: true,
            department: true,
            isActive: true,
            attendanceEnabled: true,
            fieldReportPinCredential: true,
            user: {
              select: {
                id: true,
                isActive: true,
                accountStatus: true,
                employeeId: true,
                accessGrants: {
                  where: { profile: AccessProfileKey.FIELD_REPORTER },
                  select: {
                    profile: true,
                    scopeKey: true,
                    isActive: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                  },
                },
              },
            },
          },
        })
      : null;
    const credential = employee?.fieldReportPinCredential || null;
    const pinMatches = await verifyFieldReportPin({
      pin,
      employeeId: employee?.id || VIRTUAL_EMPLOYEE_ID,
      pinHash: credential?.pinHash || VIRTUAL_PIN_HASH,
    });
    const credentialLocked = isFieldReportLocked(credential?.lockedUntil, now);
    const accountEligible = Boolean(
      employee
      && isProductionWorkforceEmployee(employee)
      && credential?.isActive
      && !credentialLocked
      && hasLiveFieldReporterGrant(employee.user, employee.id, now),
    );

    let ticketView: Awaited<ReturnType<typeof loadFieldReportTicket>> | null = null;
    let ticketRecord: { id: string; publicCode: string } | null = null;
    if (pinMatches && isFieldReportPinFormat(pin) && accountEligible && code) {
      try {
        [ticketView, ticketRecord] = await Promise.all([
          loadFieldReportTicket(code, { recordScan: false }),
          prisma.workOrderQrTicket.findUnique({
            where: { publicCode: code },
            select: { id: true, publicCode: true },
          }),
        ]);
      } catch {
        ticketView = null;
        ticketRecord = null;
      }
    }
    if (
      !pinMatches
      || !isFieldReportPinFormat(pin)
      || !accountEligible
      || !ticketView?.access.canReport
      || !ticketRecord
    ) {
      const lock = await recordFailedAttempt({
        terminalId: terminal.id,
        credential: credential && !credentialLocked && !pinMatches
          ? { id: credential.id, credentialVersion: credential.credentialVersion }
          : null,
        now,
      });
      return authFailure(lock.terminalLocked ? 429 : 401, lock.terminalLocked);
    }
    if (!employee || !credential || !employee.user || !ticketView || !ticketRecord) {
      throw new FieldReportPinAuthError();
    }

    const generatedSession = generateFieldReportSessionToken();
    const expiresAt = new Date(now.getTime() + FIELD_REPORT_PIN_SESSION_TTL_SECONDS * 1000);
    const session = await runPinSessionTransaction(async tx => {
      // Serialize session replacement on the terminal row. Without this row
      // lock, two valid requests can both revoke the old set and then each
      // insert a live token. The second request now waits for the first commit,
      // revokes its token, and leaves exactly one live terminal session.
      const lockedTerminal = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "field_report_terminals"
        WHERE "id" = ${terminal.id}
        FOR UPDATE
      `;
      if (lockedTerminal.length !== 1) throw new FieldReportPinAuthError();

      const [liveTerminal, liveCredential, liveEmployee, liveUser, liveTicket] = await Promise.all([
        tx.fieldReportTerminal.findUnique({
          where: { id: terminal.id },
          select: { id: true, version: true, isActive: true, lockedUntil: true },
        }),
        tx.employeeFieldReportPinCredential.findUnique({
          where: { id: credential!.id },
          select: {
            id: true,
            employeeId: true,
            credentialVersion: true,
            isActive: true,
            lockedUntil: true,
          },
        }),
        tx.employee.findFirst({
          where: { id: employee!.id, ...productionEmployeeWhere() },
          select: { id: true },
        }),
        tx.user.findUnique({
          where: { id: employee!.user!.id },
          select: {
            id: true,
            isActive: true,
            accountStatus: true,
            employeeId: true,
            accessGrants: {
              where: { profile: AccessProfileKey.FIELD_REPORTER },
              select: {
                profile: true,
                scopeKey: true,
                isActive: true,
                effectiveFrom: true,
                effectiveTo: true,
              },
            },
          },
        }),
        tx.workOrderQrTicket.findUnique({
          where: { id: ticketRecord!.id },
          select: { id: true, publicCode: true, status: true },
        }),
      ]);
      if (
        !liveTerminal?.isActive
        || liveTerminal.version !== terminal.version
        || isFieldReportLocked(liveTerminal.lockedUntil, now)
        || !liveCredential?.isActive
        || liveCredential.employeeId !== employee!.id
        || liveCredential.credentialVersion !== credential!.credentialVersion
        || isFieldReportLocked(liveCredential.lockedUntil, now)
        || !liveEmployee
        || !hasLiveFieldReporterGrant(liveUser, employee!.id, now)
        || liveTicket?.publicCode !== code
        || liveTicket.status !== 'ACTIVE'
      ) {
        throw new FieldReportPinAuthError();
      }
      await tx.fieldReportPinSession.updateMany({
        where: {
          terminalId: terminal.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await Promise.all([
        tx.fieldReportTerminal.update({
          where: { id: terminal.id },
          data: { failedAttempts: 0, lockedUntil: null, lastSeenAt: now },
        }),
        tx.employeeFieldReportPinCredential.update({
          where: { id: liveCredential.id },
          data: { failedAttempts: 0, lockedUntil: null, lastUsedAt: now },
        }),
      ]);
      return tx.fieldReportPinSession.create({
        data: {
          terminalId: terminal.id,
          credentialId: liveCredential.id,
          employeeId: employee!.id,
          userId: liveUser.id,
          ticketId: liveTicket.id,
          tokenHash: generatedSession.secretHash,
          credentialVersion: liveCredential.credentialVersion,
          terminalVersion: liveTerminal.version,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });
    });

    const response = NextResponse.json({
      ok: true,
      data: {
        employeeNo: employee.employeeNo,
        employeeName: employee.name,
        workOrderCode: ticketView.workOrder.businessCode,
        expiresAt: session.expiresAt.toISOString(),
      },
    });
    response.cookies.delete(SESSION_COOKIE);
    setFieldReportPinSessionCookie(response, generatedSession.secret);
    await logOp({
      userId: employee.user!.id,
      action: 'login',
      targetType: 'field_report_pin_session',
      targetId: session.id,
      detail: {
        loginMethod: 'shared_terminal_pin',
        terminalId: terminal.id,
        ticketId: ticketRecord.id,
        employeeId: employee.id,
      },
    });
    return response;
  } catch (error) {
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof FieldReportPinAuthError) {
      if (error.code === 'FIELD_REPORT_JSON_REQUIRED') {
        return NextResponse.json(
          { ok: false, error: error.message, code: error.code },
          { status: error.status },
        );
      }
      return authFailure(error.status === 429 ? 429 : 401, error.status === 429);
    }
    console.error('field report pin login failed', error);
    return NextResponse.json({ ok: false, error: '共享终端身份验证暂不可用' }, { status: 500 });
  }
}
