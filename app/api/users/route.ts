import bcrypt from 'bcryptjs';
import { LaborAccessRole } from '@prisma/client';
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

function parseLaborRole(value: unknown): LaborAccessRole | null {
  return value === LaborAccessRole.ADMIN
    || value === LaborAccessRole.TEAM_LEAD
    || value === LaborAccessRole.EMPLOYEE
    ? value
    : null;
}

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      include: { employee: { select: employeeSelect } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ ok: true, users: users.map(serializeUser) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return forbidden('只有管理员可以查看账号');
    return NextResponse.json({ ok: false, error: '账号列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const current = await requireAdmin();
    const body = await req.json().catch(() => ({})) as {
      username?: string;
      displayName?: string;
      password?: string;
      laborRole?: unknown;
      employeeId?: unknown;
    };
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim() || username;
    const password = String(body.password || '');
    const laborRole = parseLaborRole(body.laborRole) || LaborAccessRole.EMPLOYEE;
    const employeeId = String(body.employeeId || '').trim() || null;

    if (!username) return NextResponse.json({ ok: false, error: '账号不能为空' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ ok: false, error: '初始密码至少 6 位' }, { status: 400 });
    if (laborRole !== LaborAccessRole.ADMIN && !employeeId) {
      return NextResponse.json({ ok: false, error: '班组长或员工账号必须绑定员工档案' }, { status: 400 });
    }
    const employee = employeeId
      ? await prisma.employee.findFirst({ where: { id: employeeId, isActive: true } })
      : null;
    if (employeeId && !employee) {
      return NextResponse.json({ ok: false, error: '请选择有效的在职员工档案' }, { status: 400 });
    }
    if (laborRole === LaborAccessRole.TEAM_LEAD && !String(employee?.team || '').trim()) {
      return NextResponse.json({ ok: false, error: '班组长绑定的员工档案必须设置班组' }, { status: 400 });
    }

    const user = await prisma.user.create({
      data: {
        username,
        displayName: displayName.slice(0, 80),
        passwordHash: await bcrypt.hash(password, 10),
        isActive: true,
        laborRole,
        employeeId: laborRole === LaborAccessRole.ADMIN ? null : employeeId,
      },
      include: { employee: { select: employeeSelect } },
    });
    await logOp({
      userId: current.id,
      action: 'create_user',
      targetType: 'user',
      targetId: user.id,
      detail: { username, laborRole, employeeId: user.employeeId },
    });
    return NextResponse.json({ ok: true, user: serializeUser(user) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return forbidden('只有管理员可以新增账号');
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '账号已存在，或该员工已绑定其他账号' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: '新增账号失败' }, { status: 500 });
  }
}
