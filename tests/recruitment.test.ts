import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCandidateTransition,
  parseDemandCreateInput,
  prepareDemandTransition,
  statusAfterInterviewResult,
  summarizeRecruitmentDemands,
} from '../lib/recruitment';

test('recruitment demand validates required fields and headcount', () => {
  assert.throws(() => parseDemandCreateInput({
    department: '生产部',
    position: '',
    headcount: 1,
    reason: '补充产能',
  }), /请填写招聘岗位/);
  assert.throws(() => parseDemandCreateInput({
    department: '生产部',
    position: '装配员工',
    headcount: 0,
    reason: '补充产能',
  }), /1–999/);
});

test('recruitment approval follows the configured state machine', () => {
  const submitted = prepareDemandTransition('DRAFT', 'submit', 0, 2);
  assert.equal(submitted.nextStatus, 'PENDING_APPROVAL');
  const approved = prepareDemandTransition('PENDING_APPROVAL', 'approve', 0, 2);
  assert.equal(approved.nextStatus, 'RECRUITING');
  assert.ok(approved.approvedAt);
});

test('recruitment cannot close before planned headcount is hired', () => {
  assert.throws(
    () => prepareDemandTransition('OFFER', 'close', 1, 2),
    /尚缺 1 人/,
  );
  assert.equal(prepareDemandTransition('OFFER', 'close', 2, 2).nextStatus, 'CLOSED');
});

test('candidate transitions reject invalid jumps', () => {
  assert.doesNotThrow(() => assertCandidateTransition('SCREENING', 'INTERVIEW'));
  assert.throws(() => assertCandidateTransition('SCREENING', 'OFFER'), /不能执行/);
  assert.throws(() => assertCandidateTransition('HIRED', 'SCREENING'), /不能执行/);
});

test('interview results map to real candidate outcomes', () => {
  assert.equal(statusAfterInterviewResult('pass'), 'OFFER');
  assert.equal(statusAfterInterviewResult('reject'), 'REJECTED');
  assert.equal(statusAfterInterviewResult('no_show'), 'WITHDRAWN');
  assert.equal(statusAfterInterviewResult('hold'), 'INTERVIEW');
});

test('recruitment summary is derived from persisted demand rows', () => {
  const summary = summarizeRecruitmentDemands([
    {
      id: '1',
      code: 'REC-1',
      department: '生产部',
      position: '操作员',
      headcount: 2,
      employmentType: 'full_time',
      employmentTypeText: '正式员工',
      priority: 'HIGH',
      priorityText: '优先',
      reason: '扩充产能',
      status: 'RECRUITING',
      statusText: '招聘中',
      candidateCount: 3,
      activeCandidateCount: 2,
      interviewCount: 1,
      hiredCount: 1,
      remainingHeadcount: 1,
      overdue: true,
      version: 0,
      candidates: [],
      activities: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(summary.activeDemandCount, 1);
  assert.equal(summary.plannedHeadcount, 2);
  assert.equal(summary.remainingHeadcount, 1);
  assert.equal(summary.overdueCount, 1);
});
