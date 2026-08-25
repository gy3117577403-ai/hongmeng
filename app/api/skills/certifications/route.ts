import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import {
  cleanSkillText,
  parseSkillLevel,
  serializeCertification,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const evidenceTypes = new Set([
  'LONG_TERM_PRACTICE',
  'SUPERVISOR_CONFIRMATION',
  'HISTORICAL_CERTIFICATE',
  'TRAINING_RECORD',
  'OTHER',
]);

type LegacyCertificationInput = {
  skillId?: unknown;
  level?: unknown;
  evidenceType?: unknown;
  effectiveFrom?: unknown;
  expiresAt?: unknown;
  reviewerId?: unknown;
  note?: unknown;
  requiresReassessment?: unknown;
};

function parseDate(value: unknown, label: string, required: boolean): Date | null {
  const text = cleanSkillText(value, 10);
  if (!text) {
    if (required) throw new SkillInputError(`请填写${label}`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new SkillInputError(`${label}格式不正确`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new SkillInputError(`${label}不是有效日期`);
  }
  return date;
}

function currentShanghaiDate(): Date {
  const dateText = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${dateText}T00:00:00.000Z`);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeId = cleanSkillText(body.employeeId, 80);
    const rawEntries = Array.isArray(body.entries) ? body.entries as LegacyCertificationInput[] : [];
    if (!employeeId) throw new SkillInputError('请选择要录入历史技能的员工');
    if (!rawEntries.length) throw new SkillInputError('请至少选择一项历史技能');
    if (rawEntries.length > 50) throw new SkillInputError('一次最多录入 50 项历史技能');

    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        ...productionEmployeeWhere({ requireAttendance: false }),
      },
    });
    if (!employee) throw new SkillInputError('所选员工不是在岗生产员工', 404);

    const seenSkillIds = new Set<string>();
    const entries = rawEntries.map((entry, index) => {
      const skillId = cleanSkillText(entry.skillId, 80);
      if (!skillId) throw new SkillInputError(`第 ${index + 1} 项未选择技能`);
      if (seenSkillIds.has(skillId)) throw new SkillInputError('同一技能不能重复录入');
      seenSkillIds.add(skillId);
      const evidenceType = cleanSkillText(entry.evidenceType, 40);
      if (!evidenceTypes.has(evidenceType)) {
        throw new SkillInputError(`第 ${index + 1} 项请选择有效的历史依据`);
      }
      const effectiveFrom = parseDate(entry.effectiveFrom, '掌握日期', true)!;
      if (effectiveFrom.getTime() > currentShanghaiDate().getTime()) {
        throw new SkillInputError('掌握日期不能晚于今天');
      }
      const expiresAt = parseDate(entry.expiresAt, '有效期', false);
      if (expiresAt && expiresAt.getTime() < effectiveFrom.getTime()) {
        throw new SkillInputError('有效期不能早于掌握日期');
      }
      return {
        skillId,
        level: parseSkillLevel(entry.level, '历史技能等级'),
        evidenceType,
        effectiveFrom,
        expiresAt,
        reviewerId: cleanSkillText(entry.reviewerId, 80) || null,
        note: cleanSkillText(entry.note, 500) || null,
        requiresReassessment: Boolean(entry.requiresReassessment),
      };
    });

    const [skills, reviewers, existing] = await Promise.all([
      prisma.skillDefinition.findMany({
        where: { id: { in: entries.map(entry => entry.skillId) }, isActive: true },
      }),
      prisma.employee.findMany({
        where: {
          id: { in: entries.map(entry => entry.reviewerId).filter((id): id is string => Boolean(id)) },
          isActive: true,
        },
      }),
      prisma.employeeSkillCertification.findMany({
        where: {
          employeeId,
          skillId: { in: entries.map(entry => entry.skillId) },
        },
      }),
    ]);
    if (skills.length !== entries.length) {
      throw new SkillInputError('部分技能不存在或已停用，请刷新后重试');
    }
    const reviewerIds = new Set(reviewers.map(reviewer => reviewer.id));
    if (entries.some(entry => entry.reviewerId && !reviewerIds.has(entry.reviewerId))) {
      throw new SkillInputError('部分确认人不存在或已离职，请重新选择');
    }
    const existingBySkill = new Map(existing.map(certification => [certification.skillId, certification]));
    const formalConflict = entries.find(entry => existingBySkill.get(entry.skillId)?.source === 'ASSESSMENT');
    if (formalConflict) {
      const skill = skills.find(item => item.id === formalConflict.skillId);
      throw new SkillInputError(`${skill?.name || '所选技能'}已有正式认证，历史录入不能覆盖正式结果`, 409);
    }

    const certifications = await prisma.$transaction(async tx => {
      const saved = [];
      for (const entry of entries) {
        const current = await tx.employeeSkillCertification.findUnique({
          where: {
            employeeId_skillId: {
              employeeId,
              skillId: entry.skillId,
            },
          },
        });
        if (current?.source === 'ASSESSMENT') {
          const skill = skills.find(item => item.id === entry.skillId);
          throw new SkillInputError(`${skill?.name || '所选技能'}已有正式认证，历史录入不能覆盖正式结果`, 409);
        }
        const certification = await tx.employeeSkillCertification.upsert({
          where: {
            employeeId_skillId: {
              employeeId,
              skillId: entry.skillId,
            },
          },
          create: {
            employeeId,
            skillId: entry.skillId,
            level: entry.level,
            status: 'ACTIVE',
            source: 'LEGACY_ENTRY',
            evidenceType: entry.evidenceType,
            score: null,
            assessmentId: null,
            assessorId: null,
            reviewerId: entry.reviewerId,
            effectiveFrom: entry.effectiveFrom,
            expiresAt: entry.expiresAt,
            requiresReassessment: entry.requiresReassessment,
            note: entry.note,
          },
          update: {
            level: entry.level,
            status: 'ACTIVE',
            source: 'LEGACY_ENTRY',
            evidenceType: entry.evidenceType,
            score: null,
            assessmentId: null,
            assessorId: null,
            reviewerId: entry.reviewerId,
            effectiveFrom: entry.effectiveFrom,
            expiresAt: entry.expiresAt,
            requiresReassessment: entry.requiresReassessment,
            note: entry.note,
            version: { increment: 1 },
          },
        });
        saved.push(certification);
      }
      return saved;
    }, { isolationLevel: 'Serializable' });

    await logOp({
      userId: user.id,
      action: 'record_legacy_skill_profile',
      targetType: 'employee_skill_profile',
      targetId: employeeId,
      detail: {
        employeeNo: employee.employeeNo,
        employeeName: employee.name,
        entries: certifications.map(certification => {
          const prior = existingBySkill.get(certification.skillId);
          return {
            certificationId: certification.id,
            skillId: certification.skillId,
            level: certification.level,
            evidenceType: certification.evidenceType,
            effectiveFrom: certification.effectiveFrom.toISOString().slice(0, 10),
            reviewerId: certification.reviewerId,
            requiresReassessment: certification.requiresReassessment,
            previousLevel: prior?.level ?? null,
            previousSource: prior?.source ?? null,
          };
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      certifications: certifications.map(serializeCertification),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('legacy skill profile create failed', error);
    return NextResponse.json({ ok: false, error: '历史技能档案保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const certificationId = cleanSkillText(body.certificationId, 80);
    const version = Number(body.version);
    if (!certificationId) throw new SkillInputError('请选择要删除的历史技能');
    if (!Number.isInteger(version) || version < 0) throw new SkillInputError('历史技能版本无效，请刷新后重试');

    const certification = await prisma.employeeSkillCertification.findUnique({
      where: { id: certificationId },
      include: {
        employee: { select: { employeeNo: true, name: true } },
        skill: { select: { name: true } },
      },
    });
    if (!certification) throw new SkillInputError('历史技能已删除或不存在', 404);
    if (certification.source !== 'LEGACY_ENTRY') {
      throw new SkillInputError('正式考核形成的技能认证不能在此删除，请通过复评或认证流程处理', 409);
    }

    const deleted = await prisma.employeeSkillCertification.deleteMany({
      where: {
        id: certification.id,
        version,
        source: 'LEGACY_ENTRY',
      },
    });
    if (deleted.count !== 1) {
      throw new SkillInputError('历史技能已被其他人更新，请刷新后重试', 409);
    }

    await logOp({
      userId: user.id,
      action: 'delete_legacy_skill_profile',
      targetType: 'employee_skill_certification',
      targetId: certification.id,
      detail: {
        employeeNo: certification.employee.employeeNo,
        employeeName: certification.employee.name,
        skill: certification.skill.name,
        level: certification.level,
        evidenceType: certification.evidenceType,
        effectiveFrom: certification.effectiveFrom.toISOString().slice(0, 10),
        expiresAt: certification.expiresAt?.toISOString().slice(0, 10) || null,
        reviewerId: certification.reviewerId,
        note: certification.note,
      },
    });

    return NextResponse.json({ ok: true, removed: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('legacy skill profile delete failed', error);
    return NextResponse.json({ ok: false, error: '历史技能删除失败' }, { status: 500 });
  }
}
