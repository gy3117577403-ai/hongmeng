import { AccessProfileKey, AccountStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  FieldReportPinConfigurationError,
  FieldReportPinPolicyError,
  hashFieldReportPin,
} from '@/lib/field-report-pin-security';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  adminUserInclude,
  serializeAdminUser,
  type AdminUserRecord,
} from '@/lib/user-access-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasEffectiveFieldReporterGrant(user: AdminUserRecord, now: Date): boolean {
  if (!user.employee) return false;
  return user.accessGrants.some(grant => (
    grant.profile === AccessProfileKey.FIELD_REPORTER
    && grant.scopeKey === `EMPLOYEE:${user.employee!.id}`
    && grant.isActive
    && grant.effectiveFrom <= now
    && (!grant.effectiveTo || grant.effectiveTo > now)
  ));
}

async function loadEligibleUser(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<AdminUserRecord> {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
      employee: { is: productionEmployeeWhere() },
    },
    include: adminUserInclude,
  });
  if (!user?.employee || !hasEffectiveFieldReporterGrant(user, now)) {
    throw new FieldReportPinPolicyError('仅能为已开通扫码报工权限的在职生产员工设置 PIN');
  }
  return user;
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const current = await requireAdmin();
    const body = await request.json().catch(() => ({})) as {
      pin?: unknown;
      confirmPin?: unknown;
    };
    const pin = String(body.pin ?? '');
    if (pin !== String(body.confirmPin ?? '')) {
      return NextResponse.json({ ok: false, error: '两次输入的 PIN 不一致' }, { status: 400 });
    }

    const now = new Date();
    const initial = await prisma.user.findUnique({
      where: { id: params.id },
      include: adminUserInclude,
    });
    if (!initial) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });
    if (!initial.employee) {
      return NextResponse.json({ ok: false, error: '该账号未绑定员工档案' }, { status: 409 });
    }
    const pinHash = await hashFieldReportPin({
      pin,
      employeeId: initial.employee.id,
      employeeNo: initial.employee.employeeNo,
      mobile: initial.employee.mobile,
    });

    const user = await prisma.$transaction(async tx => {
      const eligible = await loadEligibleUser(tx, params.id, now);
      if (
        eligible.employee!.id !== initial.employee!.id
        || eligible.employee!.employeeNo !== initial.employee!.employeeNo
        || eligible.employee!.mobile !== initial.employee!.mobile
      ) {
        throw new FieldReportPinPolicyError('员工编号、手机号或账号绑定已变化，请刷新后重试');
      }
      const credential = await tx.employeeFieldReportPinCredential.upsert({
        where: { employeeId: eligible.employee!.id },
        create: {
          employeeId: eligible.employee!.id,
          pinHash,
          resetById: current.id,
        },
        update: {
          pinHash,
          credentialVersion: { increment: 1 },
          isActive: true,
          failedAttempts: 0,
          lockedUntil: null,
          resetAt: now,
          resetById: current.id,
        },
        select: { id: true },
      });
      await tx.fieldReportPinSession.updateMany({
        where: { credentialId: credential.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.user.findUniqueOrThrow({ where: { id: eligible.id }, include: adminUserInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await logOp({
      userId: current.id,
      action: 'set_field_report_pin',
      targetType: 'employee',
      targetId: user.employee!.id,
      detail: { userId: user.id, employeeNo: user.employee!.employeeNo },
    });
    return NextResponse.json({ ok: true, user: serializeAdminUser(user) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以设置共享终端 PIN');
    if (error instanceof FieldReportPinPolicyError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof FieldReportPinConfigurationError) {
      console.error('field report PIN configuration unavailable', error.message);
      return NextResponse.json({ ok: false, error: '共享终端 PIN 服务尚未完成安全配置' }, { status: 503 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '账号或 PIN 已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    console.error('set field report PIN failed', error);
    return NextResponse.json({ ok: false, error: '共享终端 PIN 保存失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const current = await requireAdmin();
    const now = new Date();
    const result = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: params.id }, include: adminUserInclude });
      if (!user) return null;
      if (!user.employee) throw new FieldReportPinPolicyError('该账号未绑定员工档案');
      const credential = await tx.employeeFieldReportPinCredential.findUnique({
        where: { employeeId: user.employee.id },
        select: { id: true },
      });
      if (credential) {
        await tx.employeeFieldReportPinCredential.update({
          where: { id: credential.id },
          data: {
            isActive: false,
            credentialVersion: { increment: 1 },
            failedAttempts: 0,
            lockedUntil: null,
            resetById: current.id,
            resetAt: now,
          },
        });
        await tx.fieldReportPinSession.updateMany({
          where: { credentialId: credential.id, consumedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: adminUserInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });

    await logOp({
      userId: current.id,
      action: 'disable_field_report_pin',
      targetType: 'employee',
      targetId: result.employee!.id,
      detail: { userId: result.id, employeeNo: result.employee!.employeeNo },
    });
    return NextResponse.json({ ok: true, user: serializeAdminUser(result) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以停用共享终端 PIN');
    if (error instanceof FieldReportPinPolicyError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '账号或 PIN 已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    console.error('disable field report PIN failed', error);
    return NextResponse.json({ ok: false, error: '共享终端 PIN 停用失败' }, { status: 500 });
  }
}
