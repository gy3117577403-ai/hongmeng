import { LaborAccessRole, Prisma } from '@prisma/client';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const employeeSelect = {
  id: true,
  employeeNo: true,
  name: true,
  team: true,
  isActive: true,
} as const;

function serializeUser(user: {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  laborRole: LaborAccessRole;
  employeeId: string | null;
  employee: {
    id: string;
    employeeNo: string;
    name: string;
    team: string | null;
    isActive: boolean;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    laborRole: user.laborRole,
    employeeId: user.employeeId,
    employee: user.employee,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireAdmin();
    const body = await req.json().catch(() => ({})) as {
      displayName?: string;
      isActive?: boolean;
      laborRole?: unknown;
      employeeId?: unknown;
    };
    let changedFields: string[] = [];
    let disabledByRequest = false;
    const user = await prisma.$transaction(async tx => {
      const old = await tx.user.findUnique({ where: { id: params.id } });
      if (!old) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });

      const data: {
        displayName?: string;
        isActive?: boolean;
        laborRole?: LaborAccessRole;
        employeeId?: string | null;
      } = {};
      if (body.displayName !== undefined) {
        data.displayName = String(body.displayName || '').trim().slice(0, 80) || old.username;
      }
      if (body.isActive !== undefined) data.isActive = !!body.isActive;
      if (body.laborRole !== undefined) {
        if (
          body.laborRole !== LaborAccessRole.ADMIN
          && body.laborRole !== LaborAccessRole.TEAM_LEAD
          && body.laborRole !== LaborAccessRole.EMPLOYEE
        ) {
          return NextResponse.json({ ok: false, error: '账号角色不正确' }, { status: 400 });
        }
        data.laborRole = body.laborRole;
      }
      if (body.employeeId !== undefined) {
        data.employeeId = String(body.employeeId || '').trim() || null;
      }
      const nextRole = data.laborRole || old.laborRole;
      const nextEmployeeId = nextRole === LaborAccessRole.ADMIN
        ? null
        : data.employeeId === undefined
          ? old.employeeId
          : data.employeeId;
      if (nextRole !== LaborAccessRole.ADMIN && !nextEmployeeId) {
        return NextResponse.json({ ok: false, error: '班组长或员工账号必须绑定员工档案' }, { status: 400 });
      }
      const employee = nextEmployeeId
        ? await tx.employee.findFirst({ where: { id: nextEmployeeId, isActive: true } })
        : null;
      if (nextEmployeeId && !employee) {
        return NextResponse.json({ ok: false, error: '请选择有效的在职员工档案' }, { status: 400 });
      }
      if (nextRole === LaborAccessRole.TEAM_LEAD && !String(employee?.team || '').trim()) {
        return NextResponse.json({ ok: false, error: '班组长绑定的员工档案必须设置班组' }, { status: 400 });
      }
      data.employeeId = nextEmployeeId;

      const removesActiveAdmin = old.isActive
        && old.laborRole === LaborAccessRole.ADMIN
        && (data.isActive === false || nextRole !== LaborAccessRole.ADMIN);
      if (removesActiveAdmin) {
        const activeAdminCount = await tx.user.count({
          where: {
            isActive: true,
            laborRole: LaborAccessRole.ADMIN,
            id: { not: old.id },
          },
        });
        if (activeAdminCount <= 0) {
          return NextResponse.json({ ok: false, error: '不能禁用或降级最后一个启用的管理员账号' }, { status: 400 });
        }
      }

      changedFields = Object.keys(data);
      disabledByRequest = data.isActive === false;
      return tx.user.update({
        where: { id: params.id },
        data,
        include: { employee: { select: employeeSelect } },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (user instanceof NextResponse) return user;
    await logOp({
      userId: current.id,
      action: disabledByRequest ? 'disable_user' : 'update_user',
      targetType: 'user',
      targetId: user.id,
      detail: {
        username: user.username,
        laborRole: user.laborRole,
        employeeId: user.employeeId,
        fields: changedFields,
      },
    });
    return NextResponse.json({ ok: true, user: serializeUser(user) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return forbidden('只有管理员可以编辑账号');
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '该员工已绑定其他账号' }, { status: 409 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '账号权限已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: '保存账号失败' }, { status: 500 });
  }
}
