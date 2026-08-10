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
import {
  AccessGrantInputError,
  prepareAccessGrant,
  serializeAccessGrant,
  type AccessGrantInput,
} from '@/lib/user-access-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireAdmin();
    const body = await request.json().catch(() => ({})) as AccessGrantInput;
    const grant = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({
        where: { id: params.id },
        include: {
          employee: {
            select: { id: true, departmentId: true, team: true },
          },
        },
      });
      if (!user) throw new AccessGrantInputError('账号不存在', 404);
      if (!user.isActive || user.accountStatus !== 'ACTIVE') {
        throw new AccessGrantInputError('账号已停用，不能新增兼岗或代班授权', 409);
      }
      const prepared = await prepareAccessGrant(tx, body, user.employee);
      if (prepared.grantType === 'PRIMARY') {
        throw new AccessGrantInputError('主部门权限请通过编辑账号进行同步');
      }
      const created = await tx.userAccessGrant.create({
        data: {
          userId: user.id,
          ...prepared,
          grantedById: current.id,
        },
        include: { department: { select: { id: true, code: true, name: true } } },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await logOp({
      userId: current.id,
      action: 'grant_user_access',
      targetType: 'user',
      targetId: params.id,
      detail: {
        grantId: grant.id,
        profileKey: grant.profile,
        departmentId: grant.departmentId,
        grantType: grant.grantType,
        effectiveFrom: grant.effectiveFrom.toISOString(),
        effectiveTo: grant.effectiveTo?.toISOString() || null,
      },
    });
    return NextResponse.json({ ok: true, grant: serializeAccessGrant(grant) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以配置兼岗和代班');
    if (error instanceof AccessGrantInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '相同授权已经存在' }, { status: 409 });
    }
    console.error('create access grant failed', error);
    return NextResponse.json({ ok: false, error: '新增授权失败' }, { status: 500 });
  }
}
