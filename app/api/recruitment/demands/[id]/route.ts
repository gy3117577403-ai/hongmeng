import { Prisma, RecruitmentDemandStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanRecruitmentText,
  parseDemandUpdateInput,
  prepareDemandTransition,
  RecruitmentInputError,
  recruitmentDemandInclude,
  serializeRecruitmentDemand,
} from '@/lib/recruitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function validateEmployee(id: string | null, label: string): Promise<void> {
  if (!id) return;
  const employee = await prisma.employee.findFirst({ where: { id, isActive: true }, select: { id: true } });
  if (!employee) throw new RecruitmentInputError(`${label}不是在岗员工`);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const demand = await prisma.recruitmentDemand.findUnique({
      where: { id: params.id },
      include: recruitmentDemandInclude,
    });
    if (!demand) return NextResponse.json({ ok: false, error: '招聘需求不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(demand) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('recruitment demand detail failed', error);
    return NextResponse.json({ ok: false, error: '招聘需求详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanRecruitmentText(body.action, 30) || 'update';
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 0) {
      throw new RecruitmentInputError('缺少有效的数据版本，请刷新后重试');
    }
    const current = await prisma.recruitmentDemand.findUnique({
      where: { id: params.id },
      include: { candidates: { select: { status: true } } },
    });
    if (!current) return NextResponse.json({ ok: false, error: '招聘需求不存在' }, { status: 404 });
    const hiredCount = current.candidates.filter(candidate => candidate.status === 'HIRED').length;
    const note = cleanRecruitmentText(body.note, 500);

    let updateData: Prisma.RecruitmentDemandUncheckedUpdateManyInput;
    let fromStatus: RecruitmentDemandStatus | null = null;
    let toStatus: RecruitmentDemandStatus | null = null;
    if (action === 'update') {
      const inactiveStatuses = new Set<RecruitmentDemandStatus>([
        RecruitmentDemandStatus.CLOSED,
        RecruitmentDemandStatus.CANCELLED,
      ]);
      if (inactiveStatuses.has(current.status)) {
        throw new RecruitmentInputError('已结束的招聘需求不能直接编辑，请先重新开启', 409);
      }
      const input = parseDemandUpdateInput(body, current);
      if (input.headcount < hiredCount) {
        throw new RecruitmentInputError(`招聘人数不能小于已入职人数 ${hiredCount}`, 409);
      }
      await Promise.all([
        validateEmployee(input.requesterId, '用人负责人'),
        validateEmployee(input.coordinatorId, '招聘协调人'),
      ]);
      updateData = {
        ...input,
        updatedById: user.id,
        version: { increment: 1 },
      };
    } else {
      if (['cancel', 'return_draft'].includes(action) && !note) {
        throw new RecruitmentInputError('请填写操作说明');
      }
      const transition = prepareDemandTransition(current.status, action, hiredCount, current.headcount);
      fromStatus = current.status;
      toStatus = transition.nextStatus;
      updateData = {
        status: transition.nextStatus,
        ...(transition.approvedAt !== undefined ? { approvedAt: transition.approvedAt } : {}),
        ...(transition.openedAt !== undefined ? { openedAt: transition.openedAt } : {}),
        ...(transition.closedAt !== undefined ? { closedAt: transition.closedAt } : {}),
        ...(transition.cancelledAt !== undefined ? { cancelledAt: transition.cancelledAt } : {}),
        ...(action === 'approve' ? { approvedById: user.id } : {}),
        updatedById: user.id,
        version: { increment: 1 },
      };
    }

    const demand = await prisma.$transaction(async tx => {
      const updated = await tx.recruitmentDemand.updateMany({
        where: { id: current.id, version },
        data: updateData,
      });
      if (updated.count !== 1) throw new Error('RECRUITMENT_VERSION_CONFLICT');
      await tx.recruitmentActivity.create({
        data: {
          demandId: current.id,
          action,
          fromStatus,
          toStatus,
          content: note || (action === 'update' ? '调整招聘需求信息' : null),
          actorId: user.id,
        },
      });
      return tx.recruitmentDemand.findUniqueOrThrow({
        where: { id: current.id },
        include: recruitmentDemandInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: `recruitment_demand_${action}`,
      targetType: 'recruitment_demand',
      targetId: demand.id,
      detail: { code: demand.code, fromStatus, toStatus },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(demand) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    if (error instanceof Error && error.message === 'RECRUITMENT_VERSION_CONFLICT') {
      return NextResponse.json({ ok: false, error: '招聘需求已被其他账号更新，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ ok: false, error: '招聘需求不存在' }, { status: 404 });
    }
    console.error('update recruitment demand failed', error);
    return NextResponse.json({ ok: false, error: '招聘需求更新失败' }, { status: 500 });
  }
}
