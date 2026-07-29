import { Prisma, RecruitmentCandidateStatus, RecruitmentDemandStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanRecruitmentText,
  RecruitmentInputError,
  recruitmentDemandInclude,
  serializeRecruitmentDemand,
} from '@/lib/recruitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeNo = cleanRecruitmentText(body.employeeNo, 40);
    if (!employeeNo) throw new RecruitmentInputError('请填写员工编号');
    const current = await prisma.recruitmentCandidate.findUnique({
      where: { id: params.id },
      include: { demand: { include: { candidates: { select: { id: true, status: true } } } } },
    });
    if (!current) throw new RecruitmentInputError('候选人不存在', 404);
    if (current.status !== RecruitmentCandidateStatus.OFFER) {
      throw new RecruitmentInputError('候选人进入待录用阶段后才能办理入职', 409);
    }
    const result = await prisma.$transaction(async tx => {
      const employee = await tx.employee.create({
        data: {
          employeeNo,
          name: current.name,
          department: cleanRecruitmentText(body.department, 80) || current.demand.department,
          position: cleanRecruitmentText(body.position, 80) || current.demand.position,
          team: cleanRecruitmentText(body.team, 80) || current.demand.team,
          attendanceEnabled: body.attendanceEnabled !== false,
        },
      });
      await tx.recruitmentCandidate.update({
        where: { id: current.id },
        data: {
          status: RecruitmentCandidateStatus.HIRED,
          employeeId: employee.id,
          hiredAt: new Date(),
          updatedById: user.id,
        },
      });
      const priorHiredCount = current.demand.candidates.filter(candidate => candidate.status === RecruitmentCandidateStatus.HIRED).length;
      const hiredCount = priorHiredCount + 1;
      const otherOfferCount = current.demand.candidates.filter(candidate => (
        candidate.id !== current.id && candidate.status === RecruitmentCandidateStatus.OFFER
      )).length;
      const nextDemandStatus = hiredCount >= current.demand.headcount
        ? RecruitmentDemandStatus.CLOSED
        : otherOfferCount > 0
          ? RecruitmentDemandStatus.OFFER
          : RecruitmentDemandStatus.RECRUITING;
      await tx.recruitmentDemand.update({
        where: { id: current.demandId },
        data: {
          status: nextDemandStatus,
          ...(nextDemandStatus === RecruitmentDemandStatus.CLOSED ? { closedAt: new Date() } : {}),
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      await tx.recruitmentActivity.create({
        data: {
          demandId: current.demandId,
          action: 'hire_candidate',
          fromStatus: current.demand.status,
          toStatus: nextDemandStatus,
          content: `${current.name} 已录用，员工编号 ${employee.employeeNo}`,
          actorId: user.id,
        },
      });
      return tx.recruitmentDemand.findUniqueOrThrow({
        where: { id: current.demandId },
        include: recruitmentDemandInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: 'hire_recruitment_candidate',
      targetType: 'recruitment_candidate',
      targetId: current.id,
      detail: { employeeNo, demandId: current.demandId },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(result) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ ok: false, error: '员工编号已经存在' }, { status: 409 });
    }
    console.error('hire recruitment candidate failed', error);
    return NextResponse.json({ ok: false, error: '录用入职办理失败' }, { status: 500 });
  }
}
