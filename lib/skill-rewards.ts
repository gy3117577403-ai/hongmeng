import type {
  EmployeeDTO,
  EmployeeSkillCertificationDTO,
  SkillRewardRuleDTO,
} from '@/types';

export type SkillRewardEvaluation = {
  applicable: boolean;
  qualified: boolean;
  currentLevel: number;
  remainingLevels: number;
};

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
