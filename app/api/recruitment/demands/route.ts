import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseDemandCreateInput,
  RecruitmentInputError,
  recruitmentDemandInclude,
  serializeRecruitmentDemand,
  summarizeRecruitmentDemands,
} from '@/lib/recruitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function validateEmployee(id: string | null, label: string): Promise<void> {
  if (!id) return;
  const employee = await prisma.employee.findFirst({ where: { id, isActive: true }, select: { id: true } });
  if (!employee) throw new RecruitmentInputError(`${label}不是在岗员工`);
}

export async function GET() {
  try {
    await requireUser();
    const rows = await prisma.recruitmentDemand.findMany({
      include: recruitmentDemandInclude,
      orderBy: [
        { status: 'asc' },
        { priority: 'desc' },
        { targetDate: 'asc' },
        { updatedAt: 'desc' },
      ],
      take: 500,
    });
    const demands = rows.map(serializeRecruitmentDemand);
    return NextResponse.json({
      ok: true,
      demands,
      summary: summarizeRecruitmentDemands(demands),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('recruitment demand list failed', error);
    return NextResponse.json({ ok: false, error: '招聘需求加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const input = parseDemandCreateInput(body);
    await Promise.all([
      validateEmployee(input.requesterId, '用人负责人'),
      validateEmployee(input.coordinatorId, '招聘协调人'),
    ]);
    const code = `REC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const demand = await prisma.$transaction(async tx => {
      const created = await tx.recruitmentDemand.create({
        data: {
          code,
          ...input,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await tx.recruitmentActivity.create({
        data: {
          demandId: created.id,
          action: 'create',
          toStatus: created.status,
          content: `${created.department} · ${created.position} · ${created.headcount} 人`,
          actorId: user.id,
        },
      });
      return tx.recruitmentDemand.findUniqueOrThrow({
        where: { id: created.id },
        include: recruitmentDemandInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: 'create_recruitment_demand',
      targetType: 'recruitment_demand',
      targetId: demand.id,
      detail: { code: demand.code, department: demand.department, position: demand.position, headcount: demand.headcount },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(demand) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('create recruitment demand failed', error);
    return NextResponse.json({ ok: false, error: '新建招聘需求失败' }, { status: 500 });
  }
}
