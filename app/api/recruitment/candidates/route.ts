import { RecruitmentDemandStatus } from '@prisma/client';
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
    const demandId = cleanRecruitmentText(body.demandId, 80);
    const name = cleanRecruitmentText(body.name, 80);
    const source = cleanRecruitmentText(body.source, 80);
    if (!demandId) throw new RecruitmentInputError('请选择招聘需求');
    if (!name) throw new RecruitmentInputError('请填写候选人姓名');
    if (!source) throw new RecruitmentInputError('请填写候选人来源');
    const experienceYears = body.experienceYears === '' || body.experienceYears === null || body.experienceYears === undefined
      ? null
      : Number(body.experienceYears);
    if (experienceYears !== null && (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 80)) {
      throw new RecruitmentInputError('工作年限应为 0–80 的整数');
    }
    const demand = await prisma.recruitmentDemand.findUnique({ where: { id: demandId } });
    if (!demand) throw new RecruitmentInputError('招聘需求不存在', 404);
    const candidateEntryStatuses = new Set<RecruitmentDemandStatus>([
      RecruitmentDemandStatus.RECRUITING,
      RecruitmentDemandStatus.INTERVIEWING,
      RecruitmentDemandStatus.OFFER,
    ]);
    if (!candidateEntryStatuses.has(demand.status)) {
      throw new RecruitmentInputError('招聘需求审批通过后才能录入候选人', 409);
    }
    const result = await prisma.$transaction(async tx => {
      const candidate = await tx.recruitmentCandidate.create({
        data: {
          demandId,
          name,
          phone: cleanRecruitmentText(body.phone, 40) || null,
          source,
          currentCompany: cleanRecruitmentText(body.currentCompany, 120) || null,
          currentPosition: cleanRecruitmentText(body.currentPosition, 120) || null,
          experienceYears,
          expectedSalary: cleanRecruitmentText(body.expectedSalary, 80) || null,
          notes: cleanRecruitmentText(body.notes, 1_000) || null,
          nextActionAt: parseRecruitmentDateTime(body.nextActionAt, '下一步时间'),
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await tx.recruitmentActivity.create({
        data: {
          demandId,
          action: 'add_candidate',
          content: `${candidate.name} · ${candidate.source}`,
          actorId: user.id,
        },
      });
      return tx.recruitmentDemand.findUniqueOrThrow({
        where: { id: demandId },
        include: recruitmentDemandInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: 'add_recruitment_candidate',
      targetType: 'recruitment_demand',
      targetId: demandId,
      detail: { candidateName: name, source },
    });
    return NextResponse.json({ ok: true, demand: serializeRecruitmentDemand(result) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof RecruitmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('add recruitment candidate failed', error);
    return NextResponse.json({ ok: false, error: '候选人录入失败' }, { status: 500 });
  }
}
