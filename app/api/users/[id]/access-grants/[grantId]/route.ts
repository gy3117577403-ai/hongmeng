import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { createSystemNotification } from '@/lib/system-notifications';
import {
  AccessGrantInputError,
  prepareAccessGrant,
  serializeAccessGrant,
  type AccessGrantInput,
} from '@/lib/user-access-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GrantRouteContext = { params: { id: string; grantId: string } };

export async function PATCH(request: NextRequest, { params }: GrantRouteContext) {
  try {
    assertSameOriginMutationRequest(request);
    const current = await requireAdmin();
    const body = await request.json().catch(() => ({})) as AccessGrantInput & {
      isActive?: boolean;
      expectedVersion?: number;
    };
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return NextResponse.json({ ok: false, error: '授权版本不正确，请刷新后重试' }, { status: 400 });
    }
    const updated = await prisma.$transaction(async tx => {
      const [user, currentGrant] = await Promise.all([
        tx.user.findUnique({
          where: { id: params.id },
          include: { employee: { select: { id: true, departmentId: true, team: true } } },
        }),
        tx.userAccessGrant.findFirst({ where: { id: params.grantId, userId: params.id } }),
      ]);
      if (!user || !currentGrant) throw new AccessGrantInputError('授权记录不存在', 404);
      if (currentGrant.grantType === 'PRIMARY') {
        throw new AccessGrantInputError('主部门权限请通过编辑账号进行同步');
      }
      const prepared = await prepareAccessGrant(tx, {
        profileKey: body.profileKey ?? currentGrant.profile,
        departmentId: body.departmentId ?? currentGrant.departmentId,
        grantType: body.grantType ?? currentGrant.grantType,
        effectiveFrom: body.effectiveFrom ?? currentGrant.effectiveFrom,
        effectiveTo: body.effectiveTo === undefined ? currentGrant.effectiveTo : body.effectiveTo,
      }, user.employee);
      if (prepared.grantType === 'PRIMARY') {
        throw new AccessGrantInputError('兼岗或代班不能改成主部门授权');
      }
      const result = await tx.userAccessGrant.updateMany({
        where: {
          id: currentGrant.id,
          userId: user.id,
          version: Number(body.expectedVersion),
        },
        data: {
          ...prepared,
          isActive: body.isActive ?? currentGrant.isActive,
          version: { increment: 1 },
          grantedById: current.id,
        },
      });
      if (result.count !== 1) throw new AccessGrantInputError('授权已被其他操作修改，请刷新后重试', 409);
      await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      });
      const saved = await tx.userAccessGrant.findUniqueOrThrow({
        where: { id: currentGrant.id },
        include: { department: { select: { id: true, code: true, name: true } } },
      });
      await createSystemNotification(tx, {
        eventType: saved.isActive ? 'ACCOUNT_ADDITIONAL_ACCESS_UPDATED' : 'ACCOUNT_ADDITIONAL_ACCESS_REVOKED',
        dedupeKey: `account:${user.id}:grant:${saved.id}:version:${saved.version}`,
        category: 'ACCOUNT',
        priority: 'HIGH',
        title: saved.isActive ? '你的兼岗或代班权限已更新' : '你的兼岗或代班权限已停用',
        body: '请按个人账号中心显示的当前权限范围使用系统。',
        targetRoute: '/account',
        sourceType: 'user_access_grant',
        sourceId: saved.id,
        actorId: current.id,
        recipientUserIds: [user.id],
      });
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await logOp({
      userId: current.id,
      action: updated.isActive ? 'update_user_access' : 'revoke_user_access',
      targetType: 'user',
      targetId: params.id,
      detail: { grantId: updated.id, version: updated.version },
    });
    return NextResponse.json({ ok: true, grant: serializeAccessGrant(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以修改兼岗和代班');
    if (error instanceof AccessGrantInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '授权已被其他操作修改，请刷新后重试' }, { status: 409 });
    }
    console.error('update access grant failed', error);
    return NextResponse.json({ ok: false, error: '保存授权失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: GrantRouteContext) {
  try {
    assertSameOriginMutationRequest(request);
    const current = await requireAdmin();
    const body = await request.json().catch(() => ({})) as { expectedVersion?: number };
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return NextResponse.json({ ok: false, error: '授权版本不正确，请刷新后重试' }, { status: 400 });
    }
    const result = await prisma.$transaction(async tx => {
      const grant = await tx.userAccessGrant.findFirst({
        where: { id: params.grantId, userId: params.id },
      });
      if (!grant) throw new AccessGrantInputError('授权记录不存在', 404);
      if (grant.grantType === 'PRIMARY') {
        throw new AccessGrantInputError('主部门权限不能在这里撤销，请停用账号或同步主部门');
      }
      const changed = await tx.userAccessGrant.updateMany({
        where: { id: grant.id, version: Number(body.expectedVersion), isActive: true },
        data: { isActive: false, version: { increment: 1 }, grantedById: current.id },
      });
      if (changed.count !== 1) throw new AccessGrantInputError('授权已失效或被其他操作修改', 409);
      await tx.user.update({
        where: { id: params.id },
        data: { sessionVersion: { increment: 1 } },
      });
      await createSystemNotification(tx, {
        eventType: 'ACCOUNT_ADDITIONAL_ACCESS_REVOKED',
        dedupeKey: `account:${params.id}:grant:${grant.id}:revoked-version:${grant.version + 1}`,
        category: 'ACCOUNT',
        priority: 'HIGH',
        title: '你的兼岗或代班权限已撤销',
        body: '权限已立即失效，旧登录也已失效。',
        targetRoute: '/account',
        sourceType: 'user_access_grant',
        sourceId: grant.id,
        actorId: current.id,
        recipientUserIds: [params.id],
      });
      return grant;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await logOp({
      userId: current.id,
      action: 'revoke_user_access',
      targetType: 'user',
      targetId: params.id,
      detail: { grantId: result.id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以撤销兼岗和代班');
    if (error instanceof AccessGrantInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('revoke access grant failed', error);
    return NextResponse.json({ ok: false, error: '撤销授权失败' }, { status: 500 });
  }
}
