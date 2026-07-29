import { RecruitmentCandidateStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  assertCandidateTransition,
  cleanRecruitmentText,
  demandStatusForCandidate,
  parseRecruitmentDateTime,
  RecruitmentInputError,
  recruitmentDemandInclude,
  serializeRecruitmentDemand,
} from '@/lib/recruitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const current = await prisma.recruitmentCandidate.findUnique({
      where: { id: params.id },
      include: { demand: true },
    });
    if (!current) throw new RecruitmentInputError('候选人不存在', 404);
    if (current.status === RecruitmentCandidateStatus.HIRED) {
      throw new RecruitmentInputError('已入职候选人请在员工档案中维护', 409);
    }
    const requestedStatus = cleanRecruitmentText(body.status, 30);
    const nextStatus = requestedStatus
      ? requestedStatus as RecruitmentCandidateStatus
      : current.status;
    if (!Object.values(RecruitmentCandidateStatus).includes(nextStatus)) {
      throw new RecruitmentInputError('候选人状态不正确');
    }
    if (nextStatus === RecruitmentCandidateStatus.HIRED) {
      throw new RecruitmentInputError('请使用“录用入职”建立员工档案', 409);
    }
    assertCandidateTransition(current.status, nextStatus);
    const rejectionReason = body.rejectionReason === undefined
      ? current.rejectionReason
      : cleanRecruitmentText(body.rejectionReason, 500) || null;
    if (nextStatus === RecruitmentCandidateStatus.REJECTED && !rejectionReason) {
      throw new RecruitmentInputError('请填写未通过原因');
    }
    const demandStatus = demandStatusForCandidate(current.demand.status, nextStatus);
    const result = await prisma.$transaction(async tx => {
      await tx.recruitmentCandidate.update({
        where: { id: current.id },
        data: {
          name: body.name === undefined ? current.name : cleanRecruitmentText(body.name, 80),
          phone: body.phone === undefined ? current.phone : cleanRecruitmentText(body.phone, 40) || null,
          source: body.source === undefined ? current.source : cleanRecruitmentText(body.source, 80),
          notes: body.notes === undefined ? current.notes : cleanRecruitmentText(body.notes, 1_000) || null,
          nextActionAt: body.nextActionAt === undefined
            ? current.nextActionAt
            : parseRecruitmentDateTime(body.nextActionAt, '下一步时间'),
          status: nextStatus,
          rejectionReason,
          updatedById: user.id,
        },
      });
      if (demandStatus !== current.demand.status) {
        await tx.recruitmentDemand.update({
          where: { id: current.demandId },
          data: { status: demandStatus, updatedById: user.id, version: { increment: 1 } },
        });
      }
      await tx.recruitmentActivity.create({
        data: {
          demandId: current.demandId,
          action: 'update_candidate',
          content: `${current.name}：${current.status} → ${nextStatus}`,
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
      action: 'update_recruitment_candidate',
      targetType: 'recruitment_candidate',
      targetId: current.id,
      detail: { fromStatus: current.status, toStatus: nextStatus },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(result) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('update recruitment candidate failed', error);
    return NextResponse.json({ ok: false, error: '候选人更新失败' }, { status: 500 });
  }
}
