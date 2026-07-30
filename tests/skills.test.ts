import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAssessmentScore,
  skillScopeKey,
  summarizeSkillWorkbench,
} from '../lib/skills';
import type {
  EmployeeDTO,
  EmployeeSkillCertificationDTO,
  PositionSkillRequirementDTO,
  SkillDefinitionDTO,
} from '../types';

const now = new Date().toISOString();

const employee: EmployeeDTO = {
  id: 'employee-1',
  employeeNo: '0001',
  name: '林波',
  department: '生产部',
  position: '生产主管',
  team: '主管',
  isActive: true,
  attendanceEnabled: true,
  createdAt: now,
  updatedAt: now,
};

const skill: SkillDefinitionDTO = {
  id: 'skill-1',
  code: 'SK-PROCESS-001',
  name: '生产排程',
  category: 'PROCESS',
  description: null,
  sourceProcessDefinitionId: null,
  isCritical: true,
  defaultValidityMonths: 12,
  isActive: true,
  sortOrder: 1,
  createdAt: now,
  updatedAt: now,
};

const requirement: PositionSkillRequirementDTO = {
  id: 'requirement-1',
  scopeKey: '生产部::生产主管::主管',
  department: '生产部',
  position: '生产主管',
  team: '主管',
  skillId: skill.id,
  targetLevel: 3,
  isRequired: true,
  version: 0,
  createdAt: now,
  updatedAt: now,
};

test('assessment score uses weights and detects failed red-line items', () => {
  const result = calculateAssessmentScore(
    [
      { id: 'theory', weight: 40, maxScore: 20, isRequired: true, isCritical: false },
      { id: 'practice', weight: 60, maxScore: 60, isRequired: true, isCritical: true },
    ],
    [
      { itemId: 'theory', score: 18, passed: true },
      { itemId: 'practice', score: 48, passed: false },
    ],
  );

  assert.deepEqual(result, {
    score: 84,
    complete: true,
    criticalFailed: true,
  });
});

test('assessment score marks required unanswered items incomplete', () => {
  const result = calculateAssessmentScore(
    [{ id: 'practice', weight: 100, maxScore: 100, isRequired: true, isCritical: true }],
    [{ itemId: 'practice', score: null, passed: null }],
  );
  assert.equal(result.complete, false);
  assert.equal(result.score, 0);
  assert.equal(result.criticalFailed, false);
});

test('skill scope keys are stable across case and surrounding spaces', () => {
  assert.equal(
    skillScopeKey(' 生产部 ', 'Production LEAD', ' 主管 '),
    '生产部::production lead::主管',
  );
});

test('workbench coverage only counts active, sufficient and unexpired certifications', () => {
  const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const certification: EmployeeSkillCertificationDTO = {
    id: 'certification-1',
    employeeId: employee.id,
    skillId: skill.id,
    level: 3,
    status: 'ACTIVE',
    source: 'ASSESSMENT',
    evidenceType: null,
    score: 92,
    assessmentId: 'assessment-1',
    assessorId: 'employee-2',
    reviewerId: 'employee-3',
    effectiveFrom: now,
    expiresAt,
    requiresReassessment: false,
    note: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };

  const result = summarizeSkillWorkbench({
    employees: [employee],
    skills: [skill],
    requirements: [requirement],
    certifications: [certification],
    pendingReviewCount: 2,
  });

  assert.equal(result.skillCount, 1);
  assert.equal(result.requiredPositionCount, 1);
  assert.equal(result.certifiedEmployeeCount, 1);
  assert.equal(result.formalCertifiedEmployeeCount, 1);
  assert.equal(result.legacyProfileEmployeeCount, 0);
  assert.equal(result.pendingReviewCount, 2);
  assert.equal(result.expiringCertificationCount, 1);
  assert.equal(result.coverageBasisPoints, 10_000);
});

test('legacy skill profiles count toward coverage without creating formal certification metrics', () => {
  const certification: EmployeeSkillCertificationDTO = {
    id: 'legacy-certification-1',
    employeeId: employee.id,
    skillId: skill.id,
    level: 3,
    status: 'ACTIVE',
    source: 'LEGACY_ENTRY',
    evidenceType: 'LONG_TERM_PRACTICE',
    score: null,
    assessmentId: null,
    assessorId: null,
    reviewerId: 'employee-2',
    effectiveFrom: now,
    expiresAt: null,
    requiresReassessment: true,
    note: '已独立操作五年',
    version: 0,
    createdAt: now,
    updatedAt: now,
  };

  const result = summarizeSkillWorkbench({
    employees: [employee],
    skills: [skill],
    requirements: [requirement],
    certifications: [certification],
    pendingReviewCount: 0,
  });

  assert.equal(result.certifiedEmployeeCount, 1);
  assert.equal(result.formalCertifiedEmployeeCount, 0);
  assert.equal(result.legacyProfileEmployeeCount, 1);
  assert.equal(result.pendingReviewCount, 0);
  assert.equal(result.coverageBasisPoints, 10_000);
});
