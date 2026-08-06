import type { Employee, Prisma } from '@prisma/client';
import type {
  EmployeeDTO,
  EmployeeSkillCertificationDTO,
  PositionSkillRequirementDTO,
  SkillAssessmentDTO,
  SkillAssessmentTemplateDTO,
  SkillDefinitionDTO,
  SkillRewardRuleDTO,
  SkillWorkbenchSummaryDTO,
} from '@/types';

export const skillTemplateInclude = {
  items: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.SkillAssessmentTemplateInclude;

export type SkillAssessmentTemplateRecord = Prisma.SkillAssessmentTemplateGetPayload<{
  include: typeof skillTemplateInclude;
}>;

export const skillAssessmentInclude = {
  employee: true,
  skill: true,
  template: {
    include: skillTemplateInclude,
  },
  answers: {
    include: { item: true },
    orderBy: { createdAt: 'asc' as const },
  },
  activities: {
    orderBy: { createdAt: 'desc' as const },
    take: 30,
  },
} satisfies Prisma.SkillAssessmentInclude;

export type SkillAssessmentRecord = Prisma.SkillAssessmentGetPayload<{
  include: typeof skillAssessmentInclude;
}>;

export class SkillInputError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'SkillInputError';
    this.statusCode = statusCode;
  }
}

export function cleanSkillText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function parseSkillLevel(value: unknown, fieldName = '技能等级', allowZero = false): number {
  const level = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(level) || level < minimum || level > 4) {
    throw new SkillInputError(`${fieldName}应为 L${minimum}–L4`);
  }
  return level;
}

export function parseBoundedInteger(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new SkillInputError(`${fieldName}应为 ${minimum}–${maximum} 的整数`);
  }
  return number;
}

export function skillScopeKey(department: string, position: string, team = ''): string {
  return [department, position, team].map(value => value.trim().toLocaleLowerCase('zh-CN')).join('::');
}

export function serializeEmployee(employee: Employee): EmployeeDTO {
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department,
    position: employee.position,
    team: employee.team,
    hireDate: employee.hireDate ? employee.hireDate.toISOString().slice(0, 10) : null,
    mobile: employee.mobile,
    wecomUserId: employee.wecomUserId,
    notificationEnabled: employee.notificationEnabled,
    isActive: employee.isActive,
    attendanceEnabled: employee.attendanceEnabled,
    resignedAt: employee.resignedAt ? employee.resignedAt.toISOString().slice(0, 10) : null,
    resignationReason: employee.resignationReason,
    resignationNote: employee.resignationNote,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

export function serializeSkill(skill: {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
  sourceProcessDefinitionId: string | null;
  isCritical: boolean;
  defaultValidityMonths: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): SkillDefinitionDTO {
  return {
    ...skill,
    category: skill.category as SkillDefinitionDTO['category'],
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

export function serializeRequirement(requirement: {
  id: string;
  scopeKey: string;
  department: string;
  position: string;
  team: string;
  skillId: string;
  targetLevel: number;
  isRequired: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): PositionSkillRequirementDTO {
  return {
    ...requirement,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString(),
  };
}

export function serializeCertification(certification: {
  id: string;
  employeeId: string;
  skillId: string;
  level: number;
  status: string;
  source: string;
  evidenceType: string | null;
  score: number | null;
  assessmentId: string | null;
  assessorId: string | null;
  reviewerId: string | null;
  effectiveFrom: Date;
  expiresAt: Date | null;
  requiresReassessment: boolean;
  note: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): EmployeeSkillCertificationDTO {
  return {
    ...certification,
    source: certification.source as EmployeeSkillCertificationDTO['source'],
    evidenceType: certification.evidenceType as EmployeeSkillCertificationDTO['evidenceType'],
    effectiveFrom: certification.effectiveFrom.toISOString(),
    expiresAt: certification.expiresAt?.toISOString() || null,
    createdAt: certification.createdAt.toISOString(),
    updatedAt: certification.updatedAt.toISOString(),
  };
}

export function serializeRewardRule(rule: {
  id: string;
  code: string;
  jobName: string;
  jobKeyword: string;
  skillId: string;
  minimumLevel: number;
  rewardName: string;
  rewardDescription: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): SkillRewardRuleDTO {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

export function serializeTemplate(
  template: SkillAssessmentTemplateRecord,
): SkillAssessmentTemplateDTO {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    department: template.department,
    position: template.position,
    team: template.team,
    skillId: template.skillId,
    version: template.version,
    status: template.status,
    passScore: template.passScore,
    targetLevel: template.targetLevel,
    validityMonths: template.validityMonths,
    instructions: template.instructions,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    items: template.items.map(item => ({
      id: item.id,
      templateId: item.templateId,
      code: item.code,
      section: item.section,
      title: item.title,
      description: item.description,
      weight: item.weight,
      maxScore: item.maxScore,
      isRequired: item.isRequired,
      isCritical: item.isCritical,
      sortOrder: item.sortOrder,
    })),
  };
}

export function serializeAssessment(
  assessment: SkillAssessmentRecord,
  employeesById: Map<string, Employee>,
): SkillAssessmentDTO {
  return {
    id: assessment.id,
    code: assessment.code,
    employeeId: assessment.employeeId,
    skillId: assessment.skillId,
    templateId: assessment.templateId,
    templateVersion: assessment.templateVersion,
    assessorId: assessment.assessorId,
    reviewerId: assessment.reviewerId,
    status: assessment.status as SkillAssessmentDTO['status'],
    result: assessment.result as SkillAssessmentDTO['result'],
    totalScore: assessment.totalScore,
    proposedLevel: assessment.proposedLevel,
    reviewComment: assessment.reviewComment,
    submittedAt: assessment.submittedAt?.toISOString() || null,
    reviewedAt: assessment.reviewedAt?.toISOString() || null,
    validFrom: assessment.validFrom?.toISOString() || null,
    expiresAt: assessment.expiresAt?.toISOString() || null,
    version: assessment.version,
    createdAt: assessment.createdAt.toISOString(),
    updatedAt: assessment.updatedAt.toISOString(),
    employee: serializeEmployee(assessment.employee),
    skill: serializeSkill(assessment.skill),
    template: serializeTemplate(assessment.template),
    assessor: employeesById.has(assessment.assessorId)
      ? serializeEmployee(employeesById.get(assessment.assessorId)!)
      : null,
    reviewer: employeesById.has(assessment.reviewerId)
      ? serializeEmployee(employeesById.get(assessment.reviewerId)!)
      : null,
    answers: assessment.answers.map(answer => ({
      id: answer.id,
      assessmentId: answer.assessmentId,
      itemId: answer.itemId,
      score: answer.score,
      passed: answer.passed,
      comment: answer.comment,
    })),
    activities: assessment.activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      fromStatus: activity.fromStatus,
      toStatus: activity.toStatus,
      content: activity.content,
      actorId: activity.actorId,
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}

export type AssessmentScoreInput = {
  itemId: string;
  score: number | null;
  passed?: boolean | null;
};

export function calculateAssessmentScore(
  items: Array<{ id: string; weight: number; maxScore: number; isRequired: boolean; isCritical: boolean }>,
  answers: AssessmentScoreInput[],
): { score: number; complete: boolean; criticalFailed: boolean } {
  const answersByItem = new Map(answers.map(answer => [answer.itemId, answer]));
  let weightedEarned = 0;
  let weightedMaximum = 0;
  let complete = true;
  let criticalFailed = false;

  for (const item of items) {
    const answer = answersByItem.get(item.id);
    const rawScore = answer?.score;
    if (item.isRequired && (rawScore === null || rawScore === undefined)) complete = false;
    if (rawScore === null || rawScore === undefined) continue;
    const safeScore = Math.max(0, Math.min(item.maxScore, rawScore));
    weightedEarned += (safeScore / item.maxScore) * item.weight;
    weightedMaximum += item.weight;
    const passed = answer?.passed ?? safeScore >= item.maxScore * 0.8;
    if (item.isCritical && !passed) criticalFailed = true;
  }

  return {
    score: weightedMaximum ? Math.round((weightedEarned / weightedMaximum) * 100) : 0,
    complete,
    criticalFailed,
  };
}

function requirementMatchesEmployee(
  requirement: PositionSkillRequirementDTO,
  employee: EmployeeDTO,
): boolean {
  return requirement.department === (employee.department || '')
    && requirement.position === (employee.position || '')
    && (!requirement.team || requirement.team === (employee.team || ''));
}

export function summarizeSkillWorkbench(input: {
  employees: EmployeeDTO[];
  skills: SkillDefinitionDTO[];
  requirements: PositionSkillRequirementDTO[];
  certifications: EmployeeSkillCertificationDTO[];
  pendingReviewCount: number;
}): SkillWorkbenchSummaryDTO {
  const activeEmployees = input.employees.filter(employee => employee.isActive);
  const now = Date.now();
  const expiringLimit = now + 30 * 24 * 60 * 60 * 1000;
  const certificationsByPair = new Map(
    input.certifications.map(certification => [`${certification.employeeId}:${certification.skillId}`, certification]),
  );
  const requiredPairs = input.requirements.flatMap(requirement => (
    activeEmployees
      .filter(employee => requirementMatchesEmployee(requirement, employee))
      .map(employee => ({ employee, requirement }))
  ));
  const coveredPairs = requiredPairs.filter(({ employee, requirement }) => {
    const certification = certificationsByPair.get(`${employee.id}:${requirement.skillId}`);
    if (!certification || certification.status !== 'ACTIVE' || certification.level < requirement.targetLevel) return false;
    return !certification.expiresAt || new Date(certification.expiresAt).getTime() >= now;
  });
  const certifiedEmployeeIds = new Set(
    input.certifications
      .filter(certification => certification.status === 'ACTIVE'
        && (!certification.expiresAt || new Date(certification.expiresAt).getTime() >= now))
      .map(certification => certification.employeeId),
  );
  const formalCertifiedEmployeeIds = new Set(
    input.certifications
      .filter(certification => certification.status === 'ACTIVE'
        && certification.source === 'ASSESSMENT'
        && (!certification.expiresAt || new Date(certification.expiresAt).getTime() >= now))
      .map(certification => certification.employeeId),
  );
  const legacyProfileEmployeeIds = new Set(
    input.certifications
      .filter(certification => certification.status === 'ACTIVE'
        && certification.source === 'LEGACY_ENTRY'
        && (!certification.expiresAt || new Date(certification.expiresAt).getTime() >= now))
      .map(certification => certification.employeeId),
  );
  return {
    skillCount: input.skills.filter(skill => skill.isActive).length,
    requiredPositionCount: new Set(input.requirements.map(requirement => requirement.scopeKey)).size,
    certifiedEmployeeCount: certifiedEmployeeIds.size,
    formalCertifiedEmployeeCount: formalCertifiedEmployeeIds.size,
    legacyProfileEmployeeCount: legacyProfileEmployeeIds.size,
    pendingReviewCount: input.pendingReviewCount,
    expiringCertificationCount: input.certifications.filter(certification => (
      certification.status === 'ACTIVE'
      && certification.expiresAt
      && new Date(certification.expiresAt).getTime() >= now
      && new Date(certification.expiresAt).getTime() <= expiringLimit
    )).length,
    coverageBasisPoints: requiredPairs.length
      ? Math.round((coveredPairs.length / requiredPairs.length) * 10_000)
      : null,
  };
}
