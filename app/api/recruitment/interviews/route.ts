import { RecruitmentCandidateStatus, RecruitmentDemandStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanRecruitmentText,
  parseRecruitmentDateTime,
  RecruitmentInputError,
  recruitmentDemandInclude,
  serializeRecruitmentDemand,
} from '@/lib/recruitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const candidateId = cleanRecruitmentText(body.candidateId, 80);
    const scheduledAt = parseRecruitmentDateTime(body.scheduledAt, '面试时间');
    if (!candidateId) throw new RecruitmentInputError('请选择候选人');
    if (!scheduledAt) throw new RecruitmentInputError('请选择面试时间');
    const durationMinutes = Number(body.durationMinutes || 60);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      throw new RecruitmentInputError('面试时长应为 15–480 分钟');
    }
    const interviewerId = cleanRecruitmentText(body.interviewerId, 80) || null;
    if (interviewerId) {
      const interviewer = await prisma.employee.findFirst({ where: { id: interviewerId, isActive: true }, select: { id: true } });
      if (!interviewer) throw new RecruitmentInputError('面试官不是在岗员工');
    }
    const candidate = await prisma.recruitmentCandidate.findUnique({
      where: { id: candidateId },
      include: { demand: true, interviews: { select: { round: true } } },
    });
    if (!candidate) throw new RecruitmentInputError('候选人不存在', 404);
    const interviewableStatuses = new Set<RecruitmentCandidateStatus>([
      RecruitmentCandidateStatus.SCREENING,
      RecruitmentCandidateStatus.INTERVIEW,
    ]);
    if (!interviewableStatuses.has(candidate.status)) {
      throw new RecruitmentInputError('候选人当前状态不能安排面试', 409);
    }
    const round = Math.max(0, ...candidate.interviews.map(interview => interview.round)) + 1;
    const result = await prisma.$transaction(async tx => {
      await tx.recruitmentInterview.create({
        data: {
          candidateId,
          round,
          scheduledAt,
          durationMinutes,
          interviewerId,
          method: cleanRecruitmentText(body.method, 30) || 'onsite',
          location: cleanRecruitmentText(body.location, 160) || null,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await tx.recruitmentCandidate.update({
        where: { id: candidateId },
        data: {
          status: RecruitmentCandidateStatus.INTERVIEW,
          nextActionAt: scheduledAt,
          updatedById: user.id,
        },
      });
      await tx.recruitmentDemand.update({
        where: { id: candidate.demandId },
        data: {
          status: RecruitmentDemandStatus.INTERVIEWING,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      await tx.recruitmentActivity.create({
        data: {
          demandId: candidate.demandId,
          action: 'schedule_interview',
          content: `${candidate.name} · 第 ${round} 轮 · ${scheduledAt.toISOString()}`,
          actorId: user.id,
        },
      });
      return tx.recruitmentDemand.findUniqueOrThrow({
        where: { id: candidate.demandId },
        include: recruitmentDemandInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: 'schedule_recruitment_interview',
      targetType: 'recruitment_candidate',
      targetId: candidate.id,
      detail: { round, scheduledAt: scheduledAt.toISOString(), interviewerId },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(result) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('schedule recruitment interview failed', error);
    return NextResponse.json({ ok: false, error: '面试安排失败' }, { status: 500 });
  }
}
