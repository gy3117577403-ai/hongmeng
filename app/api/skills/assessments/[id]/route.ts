import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  calculateAssessmentScore,
  cleanSkillText,
  parseSkillLevel,
  serializeAssessment,
  skillAssessmentInclude,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnswerInput = {
  itemId?: unknown;
  score?: unknown;
  passed?: unknown;
  comment?: unknown;
};

function addMonths(date: Date, months: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanSkillText(body.action, 30) || 'save';
    const supportedActions = new Set(['save', 'submit', 'approve', 'return', 'cancel']);
    if (!supportedActions.has(action)) throw new SkillInputError('不支持的考核操作');
    const current = await prisma.skillAssessment.findUnique({
      where: { id: params.id },
      include: skillAssessmentInclude,
    });
    if (!current) throw new SkillInputError('技能考核记录不存在', 404);
    const requestedVersion = Number(body.version);
    if (Number.isInteger(requestedVersion) && requestedVersion !== current.version) {
      throw new SkillInputError('考核记录已被其他人更新，请刷新后重试', 409);
    }
    if (['save', 'submit'].includes(action) && !['DRAFT', 'RETURNED'].includes(current.status)) {
      throw new SkillInputError('只有草稿或被退回的考核可以继续填报');
    }
    if (['approve', 'return'].includes(action) && current.status !== 'PENDING_REVIEW') {
      throw new SkillInputError('只有待审核的考核可以执行此操作');
    }
    if (action === 'cancel' && ['APPROVED', 'CANCELLED'].includes(current.status)) {
      throw new SkillInputError('当前考核状态不能取消');
    }
    const proposedLevel = parseSkillLevel(body.proposedLevel ?? current.proposedLevel, '拟认证等级');
    const reviewComment = cleanSkillText(body.reviewComment, 1000);
    if (action === 'return' && !reviewComment) throw new SkillInputError('退回时请填写修改意见');

    const itemsById = new Map(current.template.items.map(item => [item.id, item]));
    const rawAnswers = Array.isArray(body.answers) ? body.answers as AnswerInput[] : [];
    const normalizedAnswers = rawAnswers.map((answer, index) => {
      const itemId = cleanSkillText(answer.itemId, 80);
      const item = itemsById.get(itemId);
      if (!item) throw new SkillInputError(`第 ${index + 1} 个考核答案不属于当前模板`);
      const score = answer.score === '' || answer.score === null || answer.score === undefined
        ? null
        : Number(answer.score);
      if (score !== null && (!Number.isInteger(score) || score < 0 || score > item.maxScore)) {
        throw new SkillInputError(`${item.title}的得分应为 0–${item.maxScore} 的整数`);
      }
      return {
        itemId,
        score,
        passed: typeof answer.passed === 'boolean' ? answer.passed : null,
        comment: cleanSkillText(answer.comment, 500) || null,
      };
    });

    const updated = await prisma.$transaction(async tx => {
      for (const answer of normalizedAnswers) {
        await tx.skillAssessmentAnswer.update({
          where: {
            assessmentId_itemId: {
              assessmentId: current.id,
              itemId: answer.itemId,
            },
          },
          data: {
            score: answer.score,
            passed: answer.passed,
            comment: answer.comment,
          },
        });
      }
      const refreshed = await tx.skillAssessment.findUniqueOrThrow({
        where: { id: current.id },
        include: {
          template: { include: { items: true } },
          answers: true,
        },
      });
      const scoreResult = calculateAssessmentScore(
        refreshed.template.items,
        refreshed.answers,
      );
      if (action === 'submit' && !scoreResult.complete) {
        throw new SkillInputError('请填写全部必考项目后再提交审核');
      }
      const passed = scoreResult.score >= refreshed.template.passScore && !scoreResult.criticalFailed;
      if (action === 'approve' && !passed) {
        throw new SkillInputError('当前得分或红线项目未达到合格要求，不能批准认证');
      }
      const now = new Date();
      const nextStatus = action === 'submit'
        ? 'PENDING_REVIEW'
        : action === 'approve'
          ? 'APPROVED'
          : action === 'return'
            ? 'RETURNED'
            : action === 'cancel'
              ? 'CANCELLED'
              : current.status;
      const nextResult = action === 'approve'
        ? 'PASSED'
        : action === 'return'
          ? 'PENDING'
          : action === 'submit'
            ? (passed ? 'PASSED' : 'FAILED')
            : current.result;
      const validFrom = action === 'approve'
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : current.validFrom;
      const expiresAt = action === 'approve'
        ? addMonths(validFrom!, refreshed.template.validityMonths)
        : current.expiresAt;
      const updateResult = await tx.skillAssessment.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          proposedLevel,
          totalScore: scoreResult.score,
          reviewComment: action === 'return' || action === 'approve'
            ? (reviewComment || null)
            : current.reviewComment,
          status: nextStatus,
          result: nextResult,
          submittedAt: action === 'submit' ? now : current.submittedAt,
          reviewedAt: ['approve', 'return'].includes(action) ? now : current.reviewedAt,
          validFrom,
          expiresAt,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) {
        throw new SkillInputError('考核记录已被其他人更新，请刷新后重试', 409);
      }
      if (action === 'approve') {
        await tx.employeeSkillCertification.upsert({
          where: {
            employeeId_skillId: {
              employeeId: current.employeeId,
              skillId: current.skillId,
            },
          },
          create: {
            employeeId: current.employeeId,
            skillId: current.skillId,
            level: proposedLevel,
            status: 'ACTIVE',
            score: scoreResult.score,
            assessmentId: current.id,
            assessorId: current.assessorId,
            reviewerId: current.reviewerId,
            effectiveFrom: validFrom!,
            expiresAt,
            note: reviewComment || null,
          },
          update: {
            level: proposedLevel,
            status: 'ACTIVE',
            score: scoreResult.score,
            assessmentId: current.id,
            assessorId: current.assessorId,
            reviewerId: current.reviewerId,
            effectiveFrom: validFrom!,
            expiresAt,
            note: reviewComment || null,
            version: { increment: 1 },
          },
        });
      }
      await tx.skillAssessmentActivity.create({
        data: {
          assessmentId: current.id,
          action,
          fromStatus: current.status,
          toStatus: nextStatus,
          content: action === 'save'
            ? `保存填报，当前得分 ${scoreResult.score}`
            : action === 'submit'
              ? `提交审核，得分 ${scoreResult.score}，拟认证 L${proposedLevel}`
              : action === 'approve'
                ? `审核通过，认证 L${proposedLevel}，有效 ${refreshed.template.validityMonths} 个月`
                : action === 'return'
                  ? `退回修改：${reviewComment}`
                  : '取消考核',
          actorId: user.id,
        },
      });
      return tx.skillAssessment.findUniqueOrThrow({
        where: { id: current.id },
        include: skillAssessmentInclude,
      });
    });
    const personIds = [updated.employeeId, updated.assessorId, updated.reviewerId];
    const people = await prisma.employee.findMany({ where: { id: { in: personIds } } });
    await logOp({
      userId: user.id,
      action: `${action}_skill_assessment`,
      targetType: 'skill_assessment',
      targetId: updated.id,
      detail: {
        code: updated.code,
        status: updated.status,
        score: updated.totalScore,
        proposedLevel: updated.proposedLevel,
      },
    });
    return NextResponse.json({
      ok: true,
      assessment: serializeAssessment(updated, new Map(people.map(person => [person.id, person]))),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('skill assessment update failed', error);
    return NextResponse.json({ ok: false, error: '技能考核保存失败' }, { status: 500 });
  }
}
