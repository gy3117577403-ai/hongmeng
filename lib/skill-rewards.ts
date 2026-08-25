import type {
  EmployeeDTO,
  EmployeeSkillCertificationDTO,
  SkillRewardRuleDTO,
  SkillDefinitionDTO,
} from '@/types';

export type SkillRewardEvaluation = {
  applicable: boolean;
  qualified: boolean;
  currentLevel: number;
  remainingLevels: number;
};

export type SkillSubsidyEvaluation = {
  configured: boolean;
  qualified: boolean;
  currentLevel: number;
  minimumLevel: number | null;
  remainingLevels: number;
};

/**
 * Evaluates application eligibility only. It never calculates an amount,
 * creates payroll data or grants a subsidy automatically.
 */
export function evaluateSkillSubsidy(
  skill: Pick<SkillDefinitionDTO, 'isActive' | 'isSubsidyEligible' | 'subsidyMinimumLevel'>,
  certification: Pick<EmployeeSkillCertificationDTO, 'level' | 'status' | 'expiresAt'> | null | undefined,
  now = Date.now(),
): SkillSubsidyEvaluation {
  const configured = skill.isActive
    && skill.isSubsidyEligible
    && Number.isInteger(skill.subsidyMinimumLevel)
    && (skill.subsidyMinimumLevel || 0) >= 1
    && (skill.subsidyMinimumLevel || 0) <= 4;
  const active = certification?.status === 'ACTIVE'
    && (!certification.expiresAt || new Date(certification.expiresAt).getTime() >= now);
  const currentLevel = active ? certification?.level || 0 : 0;
  const minimumLevel = configured ? skill.subsidyMinimumLevel || 1 : null;
  return {
    configured,
    qualified: configured && currentLevel >= (minimumLevel || 1),
    currentLevel,
    minimumLevel,
    remainingLevels: configured ? Math.max(0, (minimumLevel || 1) - currentLevel) : 0,
  };
}

export function skillRewardRuleMatchesEmployee(
  rule: Pick<SkillRewardRuleDTO, 'jobKeyword' | 'isActive'>,
  employee: Pick<EmployeeDTO, 'position' | 'team'>,
): boolean {
  if (!rule.isActive) return false;
  const keyword = rule.jobKeyword.trim().toLocaleLowerCase('zh-CN');
  if (!keyword) return false;
  return `${employee.position || ''} ${employee.team || ''}`
    .toLocaleLowerCase('zh-CN')
    .includes(keyword);
}

export function evaluateSkillReward(
  rule: Pick<SkillRewardRuleDTO, 'jobKeyword' | 'minimumLevel' | 'isActive'>,
  employee: Pick<EmployeeDTO, 'position' | 'team'>,
  certification: Pick<EmployeeSkillCertificationDTO, 'level' | 'status' | 'expiresAt'> | null | undefined,
  now = Date.now(),
): SkillRewardEvaluation {
  const applicable = skillRewardRuleMatchesEmployee(rule, employee);
  const active = certification?.status === 'ACTIVE'
    && (!certification.expiresAt || new Date(certification.expiresAt).getTime() >= now);
  const currentLevel = active ? certification?.level || 0 : 0;
  return {
    applicable,
    qualified: applicable && currentLevel >= rule.minimumLevel,
    currentLevel,
    remainingLevels: applicable ? Math.max(0, rule.minimumLevel - currentLevel) : 0,
  };
}
