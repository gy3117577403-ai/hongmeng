import {
  RecruitmentCandidateStatus,
  RecruitmentDemandStatus,
  RecruitmentInterviewStatus,
} from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanRecruitmentText,
  isValidInterviewResult,
  RecruitmentInputError,
  recruitmentDemandInclude,
  serializeRecruitmentDemand,
  statusAfterInterviewResult,
} from '@/lib/recruitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanRecruitmentText(body.action, 30);
    const current = await prisma.recruitmentInterview.findUnique({
      where: { id: params.id },
      include: { candidate: { include: { demand: true } } },
    });
    if (!current) throw new RecruitmentInputError('面试记录不存在', 404);
    if (current.status !== RecruitmentInterviewStatus.SCHEDULED) {
      throw new RecruitmentInputError('该面试已经处理', 409);
    }
    if (!['complete', 'cancel'].includes(action)) throw new RecruitmentInputError('面试操作不正确');
    const resultValue = action === 'complete' ? cleanRecruitmentText(body.result, 30) : 'pending';
    if (action === 'complete' && !isValidInterviewResult(resultValue)) {
      throw new RecruitmentInputError('请选择有效的面试结果');
    }
    const feedback = cleanRecruitmentText(body.feedback, 1_000) || null;
    if (action === 'complete' && !feedback) throw new RecruitmentInputError('请填写面试评价');
    const nextCandidateStatus = action === 'complete'
      ? statusAfterInterviewResult(resultValue)
      : RecruitmentCandidateStatus.INTERVIEW;
    const nextDemandStatus = nextCandidateStatus === RecruitmentCandidateStatus.OFFER
      ? RecruitmentDemandStatus.OFFER
      : RecruitmentDemandStatus.INTERVIEWING;
    const result = await prisma.$transaction(async tx => {
      await tx.recruitmentInterview.update({
        where: { id: current.id },
        data: {
          status: action === 'complete' ? RecruitmentInterviewStatus.COMPLETED : RecruitmentInterviewStatus.CANCELLED,
          result: resultValue,
          feedback,
          completedAt: action === 'complete' ? new Date() : null,
          updatedById: user.id,
        },
      });
      await tx.recruitmentCandidate.update({
        where: { id: current.candidateId },
        data: {
          status: nextCandidateStatus,
          nextActionAt: null,
          rejectionReason: nextCandidateStatus === RecruitmentCandidateStatus.REJECTED ? feedback : null,
          updatedById: user.id,
        },
      });
      const inactiveDemandStatuses = new Set<RecruitmentDemandStatus>([
        RecruitmentDemandStatus.CLOSED,
        RecruitmentDemandStatus.CANCELLED,
      ]);
      if (!inactiveDemandStatuses.has(current.candidate.demand.status)) {
        await tx.recruitmentDemand.update({
          where: { id: current.candidate.demandId },
          data: {
            status: nextDemandStatus,
            updatedById: user.id,
            version: { increment: 1 },
          },
        });
      }
      await tx.recruitmentActivity.create({
        data: {
          demandId: current.candidate.demandId,
          action: action === 'complete' ? 'complete_interview' : 'cancel_interview',
          content: `${current.candidate.name} · 第 ${current.round} 轮${action === 'complete' ? ` · ${resultValue}` : ''}`,
          actorId: user.id,
        },
      });
      return tx.recruitmentDemand.findUniqueOrThrow({
        where: { id: current.candidate.demandId },
        include: recruitmentDemandInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: action === 'complete' ? 'complete_recruitment_interview' : 'cancel_recruitment_interview',
      targetType: 'recruitment_interview',
      targetId: current.id,
      detail: { result: resultValue },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(result) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('update recruitment interview failed', error);
    return NextResponse.json({ ok: false, error: '面试记录更新失败' }, { status: 500 });
  }
}
