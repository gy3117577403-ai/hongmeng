import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCreateChangeForProcess,
  canCreateIssueForProcess,
  canMutateChangeForProcess,
  canMutateIssueForProcess,
} from '../lib/process-collaboration-access';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';

function access(grant: AccessGrant) {
  return resolveAccessContext([grant], { now: '2026-08-12T08:00:00.000Z' });
}

const processSubject = {
  id: 'user-process',
  employeeId: 'employee-process',
  access: access({
    profile: 'PROCESS_SPECIALIST',
    departmentCode: 'PROCESS',
    grantType: 'PRIMARY' as const,
    scopeKey: 'DEPARTMENT:PROCESS',
  }),
};

test('process specialist can create only non-major process issues and process changes', () => {
  assert.equal(canCreateIssueForProcess(processSubject, { type: 'process' }), true);
  assert.equal(canCreateIssueForProcess(processSubject, { type: 'quality' }), false);
  assert.equal(canCreateIssueForProcess(processSubject, { type: 'process', isMajorQuality: true }), false);
  assert.equal(canCreateChangeForProcess(processSubject, { type: 'process' }), true);
  assert.equal(canCreateChangeForProcess(processSubject, { type: 'drawing' }), false);
});

test('process issue collaboration is limited to process, own or explicitly assigned records', () => {
  assert.equal(canMutateIssueForProcess(processSubject, { type: 'process' }, 'UPDATE'), true);
  assert.equal(canMutateIssueForProcess(processSubject, { type: 'quality', reporterId: processSubject.id }, 'UPDATE'), true);
  assert.equal(canMutateIssueForProcess(processSubject, { type: 'production', assigneeEmployeeId: processSubject.employeeId }, 'EXECUTE_WORKFLOW'), true);
  assert.equal(canMutateIssueForProcess(processSubject, {
    type: 'material',
    collaborators: [{ employeeId: processSubject.employeeId }],
  }, 'UPDATE'), true);
  assert.equal(canMutateIssueForProcess(processSubject, { type: 'production' }, 'UPDATE'), false);
  assert.equal(canMutateIssueForProcess(processSubject, {
    type: 'process',
    isMajorQuality: true,
  }, 'EXECUTE_WORKFLOW'), false);
});

test('process change collaboration is limited to process, requester or owner records', () => {
  assert.equal(canMutateChangeForProcess(processSubject, { type: 'process' }, 'UPDATE'), true);
  assert.equal(canMutateChangeForProcess(processSubject, { type: 'drawing', requesterId: processSubject.id }, 'EXECUTE_WORKFLOW'), true);
  assert.equal(canMutateChangeForProcess(processSubject, { type: 'material', ownerId: processSubject.id }, 'UPDATE'), true);
  assert.equal(canMutateChangeForProcess(processSubject, { type: 'plan' }, 'UPDATE'), false);
});

test('workshop leaders are production issue handlers, not process specialists', () => {
  const leaderSubject = {
    id: 'user-leader',
    employeeId: 'employee-leader',
    access: access({
      profile: 'WORKSHOP_TEAM_LEADER',
      departmentCode: 'PRODUCTION',
      grantType: 'PRIMARY',
      scopeKey: 'TEAM:A',
    }),
  };
  assert.equal(canCreateIssueForProcess(leaderSubject, { type: 'production' }), true);
  assert.equal(canCreateIssueForProcess(leaderSubject, { type: 'material' }), true);
  assert.equal(canCreateIssueForProcess(leaderSubject, { type: 'production', isMajorQuality: true }), false);
  assert.equal(canMutateIssueForProcess(leaderSubject, { type: 'production' }, 'UPDATE'), true);
  assert.equal(canMutateIssueForProcess(leaderSubject, { type: 'planning', assigneeEmployeeId: 'employee-leader' }, 'EXECUTE_WORKFLOW'), true);
  assert.equal(canMutateIssueForProcess(leaderSubject, { type: 'planning' }, 'UPDATE'), false);
  assert.equal(canMutateIssueForProcess(leaderSubject, { type: 'production', isMajorQuality: true }, 'UPDATE'), false);
});

test('quality and engineering owners keep their existing issue and change authority', () => {
  const qualitySubject = {
    id: 'quality-user',
    employeeId: 'quality-employee',
    access: access({
      profile: 'DEPARTMENT_FULL',
      departmentCode: 'QUALITY',
      grantType: 'PRIMARY',
      scopeKey: 'DEPARTMENT:QUALITY',
    }),
  };
  const engineeringSubject = {
    id: 'engineering-user',
    employeeId: 'engineering-employee',
    access: access({
      profile: 'DEPARTMENT_FULL',
      departmentCode: 'ENGINEERING',
      grantType: 'PRIMARY',
      scopeKey: 'DEPARTMENT:ENGINEERING',
    }),
  };

  assert.equal(canMutateIssueForProcess(qualitySubject, { type: 'quality', isMajorQuality: true }, 'EXECUTE_WORKFLOW'), true);
  assert.equal(canMutateChangeForProcess(qualitySubject, { type: 'drawing' }, 'UPDATE'), true);
  assert.equal(canMutateChangeForProcess(engineeringSubject, { type: 'material' }, 'EXECUTE_WORKFLOW'), true);
});
