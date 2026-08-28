import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { resolveAccessContext } from '../lib/department-access';
import {
  canTransitionIssue,
  buildIssueWorkflow,
  issueDetailInclude,
  issueCollaborationBlockers,
  issueVerificationBasis,
  issueAttachmentMutationLock,
  issueCode,
  issueFingerprint,
  issueTransitionAuthority,
  issueVerificationBlockers,
  parseIssueCollaborationInput,
  parseIssueInput,
  priorityForAlert,
  transitionIssueData,
  typeForAlert,
  validateMajorQualityInput,
} from '../lib/issues';

test('final confirmation writes only scalar closure fields and ignores stale evidence payloads', () => {
  const result = transitionIssueData({ status: 'awaiting_confirmation', solution: '最新措施', verificationResult: '最新验证结论' }, 'closed', {
    rootCause: '旧原因', solution: '旧措施', verificationResult: '', comment: '现场确认完成',
  }, new Date('2026-08-28T08:00:00Z'), 'requester');
  assert.equal(result.error, null);
  assert.equal(result.data.requesterConfirmedById, 'requester');
  assert.equal('requesterConfirmedBy' in result.data, false);
  assert.equal('solution' in result.data, false);
  assert.equal('rootCause' in result.data, false);
  assert.equal('verificationResult' in result.data, false);
  const reopened = transitionIssueData({ status: 'closed', solution: '最新措施', verificationResult: '旧验证' }, 'processing', {});
  assert.equal(reopened.data.requesterConfirmedById, null);
  assert.equal(reopened.data.verificationResult, null);
});

test('major closure uses actual final approval evidence, including historical empty general results', () => {
  const at = new Date('2026-08-28T08:00:00Z');
  const issue = { status: 'awaiting_confirmation', isMajorQuality: true, solution: '隔离整改', verificationResult: null, verifiedAt: at,
    majorApprovals: [{ id: 'approval', round: 2, status: 'APPROVED', qualityReviewedById: 'quality', finalReviewedById: 'gm',
      qualityReviewedAt: at, finalReviewedAt: at, qualityReviewNote: '抽检符合要求', finalReviewNote: '同意质量复核' }] };
  assert.equal(issueVerificationBasis(issue).kind, 'major_approval');
  assert.equal(transitionIssueData(issue, 'closed', {}, at, 'requester').error, null);
  assert.equal(issueVerificationBasis({ ...issue, verifiedAt: new Date(at.getTime() + 1) }).kind, 'missing');
  assert.equal(issueVerificationBasis({ ...issue, majorApprovals: [{ ...issue.majorApprovals[0], status: 'CANCELLED' }] }).kind, 'missing');
  assert.notEqual(transitionIssueData({ ...issue, majorApprovals: [] }, 'closed', { verificationResult: '客户端伪造通过' }, at, 'requester').error, null);
});

test('verification blockers include unfinished tasks and undecided collaboration items', () => {
  const activities = [{ id: 'task', action: 'task_create' }, { id: 'decision', action: 'decision_create' }];
  assert.deepEqual(issueCollaborationBlockers(activities), ['协同待办尚未完成', '协同决策尚无结论']);
  assert.deepEqual(issueCollaborationBlockers([...activities,
    { id: 'done', action: 'task_complete', detail: { targetActivityId: 'task' } },
    { id: 'response', action: 'decision_approve', detail: { targetActivityId: 'decision' } },
  ]), []);
});

test('issue lifecycle data persists with Prisma conditional bulk updates and checks actor permissions', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const prefix = `issue-closure-it-${randomUUID()}`;
  const user = await prisma.user.create({ data: { username: prefix, displayName: '闭环集成验收', passwordHash: 'test-only' } });
  const created = await prisma.issue.create({ data: { title: prefix, reporterId: user.id, rootCause: '原因已核实', solution: '已采取措施' } });
  try {
    async function move(target: 'processing' | 'verifying' | 'awaiting_confirmation' | 'closed', body: Record<string, unknown> = {}) {
      const current = await prisma.issue.findUniqueOrThrow({ where: { id: created.id } });
      const transition = transitionIssueData(current, target, body, new Date(), user.id);
      assert.equal(transition.error, null);
      const changed = await prisma.issue.updateMany({ where: { id: current.id, status: current.status, version: current.version }, data: transition.data });
      assert.equal(changed.count, 1);
      return prisma.issue.findUniqueOrThrow({ where: { id: created.id }, include: issueDetailInclude });
    }
    await move('processing');
    await move('verifying');
    const awaiting = await move('awaiting_confirmation', { verificationResult: '尺寸复核合格' });
    const readonlyActor = { id: user.id, laborRole: 'EMPLOYEE', access: resolveAccessContext([{ profile: 'GM_OFFICE_READER_APPROVER', grantType: 'PRIMARY', scopeKey: 'GLOBAL' }]) };
    assert.ok(readonlyActor.access.capabilities.includes('QUALITY:READ'));
    const readonlyWorkflow = buildIssueWorkflow(awaiting, readonlyActor);
    assert.equal(readonlyWorkflow.actions.some(action => action.allowed), false);
    assert.match(readonlyWorkflow.permissionReason || '', /未开通/);
    const qualityActor = { ...readonlyActor, access: resolveAccessContext([{ profile: 'QUALITY_REVIEWER', grantType: 'PRIMARY', scopeKey: 'GLOBAL' }]) };
    assert.ok(qualityActor.access.capabilities.includes('QUALITY:EXECUTE_WORKFLOW'));
    assert.equal(buildIssueWorkflow(awaiting, qualityActor).actions.find(action => action.target === 'closed')?.allowed, true);
    const closed = await move('closed', { comment: '现场确认已解决' });
    assert.equal(closed.requesterConfirmedById, user.id);
    assert.ok(closed.closedAt && closed.requesterConfirmedAt);
    const data = transitionIssueData(closed, 'processing', { comment: '复发重开' }, new Date(), user.id).data;
    const outcomes = await Promise.all([1, 2].map(() => prisma.issue.updateMany({ where: { id: closed.id, version: closed.version, status: closed.status }, data })));
    assert.deepEqual(outcomes.map(result => result.count).sort(), [0, 1]);
    const reopened = await prisma.issue.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(reopened.requesterConfirmedById, null);
    assert.equal(reopened.closedAt, null);
    await move('verifying');
    await move('processing');
    await move('verifying');
    await move('awaiting_confirmation', { verificationResult: '再次验证通过' });
    await move('processing');
    await move('verifying');
    await move('awaiting_confirmation', { verificationResult: '整改后通过' });
    await move('closed');
  } finally {
    await prisma.issue.delete({ where: { id: created.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('major approval locks attachment mutations until return or explicit reopen', () => {
  assert.equal(issueAttachmentMutationLock('processing', ['PENDING_QUALITY_REVIEW']), 'approval_pending');
  assert.equal(issueAttachmentMutationLock('verifying', ['PENDING_GM_APPROVAL']), 'approval_pending');
  assert.equal(issueAttachmentMutationLock('awaiting_confirmation', ['APPROVED']), 'final_approved');
  assert.equal(issueAttachmentMutationLock('closed', ['APPROVED']), 'final_approved');
  assert.equal(issueAttachmentMutationLock('processing', ['APPROVED']), null);
  assert.equal(issueAttachmentMutationLock('closed', []), null);
});

test('manual issue input uses safe defaults and validates title', () => {
  const valid = parseIssueInput({ title: '图纸尺寸与现场实物不一致' });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.type, 'production');
  assert.equal(valid.data.priority, 'normal');
  const invalid = parseIssueInput({ title: 'a', type: 'invalid', priority: 'unknown' });
  assert.equal(invalid.errors.length, 3);
});

test('process issues preserve HR responsibility and collaboration fields', () => {
  const parsed = parseIssueInput({
    title: '压接工艺参数需要复核',
    type: 'process',
    assigneeEmployeeId: 'employee-001',
    collaboratorEmployeeIds: ['employee-002', 'employee-002', 'employee-003'],
    processName: '压接',
    affectedQuantity: '120',
    temporaryMeasure: '暂停该批次并复核首件',
  });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.type, 'process');
  assert.equal(parsed.data.assigneeEmployeeId, 'employee-001');
  assert.deepEqual(parsed.data.collaboratorEmployeeIds, ['employee-002', 'employee-003']);
  assert.equal(parsed.data.processName, '压接');
  assert.equal(parsed.data.affectedQuantity, 120);
});

test('major quality classification is explicit and independent from priority', () => {
  const parsed = parseIssueInput({
    title: '批量端子拉力异常',
    type: 'quality',
    priority: 'normal',
    isMajorQuality: true,
    majorQualityReason: '同批次多客户产品存在失效风险',
  });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.isMajorQuality, true);
  assert.equal(validateMajorQualityInput({
    type: parsed.data.type || 'quality',
    isMajorQuality: parsed.data.isMajorQuality === true,
    majorQualityReason: parsed.data.majorQualityReason,
  }), null);
  assert.equal(validateMajorQualityInput({
    type: 'production',
    isMajorQuality: true,
    majorQualityReason: '错误类型',
  }), '只有质量问题可以标记为重大质量事项');
  assert.equal(validateMajorQualityInput({
    type: 'quality',
    isMajorQuality: true,
    majorQualityReason: '',
  }), '重大质量事项必须填写重大判定原因');
});

test('issue input rejects invalid affected quantities and collaborator payloads', () => {
  const parsed = parseIssueInput({
    title: '现场问题',
    affectedQuantity: -1,
    collaboratorEmployeeIds: 'employee-002',
  });
  assert.deepEqual(parsed.errors, ['协同人员格式不正确', '影响数量必须是非负整数']);
});

test('structured issue collaboration validates durable tasks and decisions', () => {
  const task = parseIssueCollaborationInput({
    kind: 'task',
    content: '复测 PVC 管径并上传对比照片',
    assigneeEmployeeId: 'employee-003',
    dueAt: '2026-08-22T09:00:00.000Z',
  });
  assert.deepEqual(task.errors, []);
  assert.equal(task.data?.kind, 'task');
  assert.equal(task.data?.assigneeEmployeeId, 'employee-003');

  const invalidDecision = parseIssueCollaborationInput({
    kind: 'decision_response',
    targetActivityId: 'activity-1',
  });
  assert.deepEqual(invalidDecision.errors, ['请选择通过或退回']);
});

test('verification checklist blocks incomplete closure evidence', () => {
  assert.deepEqual(issueVerificationBlockers({
    assigneeEmployeeId: null,
    verifierEmployeeId: null,
    rootCause: '',
    solution: '',
    attachmentCount: 0,
  }), ['未指定负责人', '未填写原因分析', '未填写处理方案', '未上传处理证据', '未指定验证人']);
  assert.deepEqual(issueVerificationBlockers({
    assigneeEmployeeId: 'employee-1',
    verifierEmployeeId: 'employee-2',
    rootCause: '规格引用错误',
    solution: '修订规格并复测',
    attachmentCount: 2,
  }), []);
});

test('issue codes and production fingerprints are stable', () => {
  assert.equal(issueCode(7), 'ISS-000007');
  assert.equal(issueFingerprint('work-order-1', 'MATERIAL_NOT_READY'), 'production_alert:work-order-1:MATERIAL_NOT_READY');
});

test('status transitions follow the accepted processing loop', () => {
  assert.equal(canTransitionIssue('pending', 'processing'), true);
  assert.equal(canTransitionIssue('processing', 'verifying'), true);
  assert.equal(canTransitionIssue('verifying', 'awaiting_confirmation'), true);
  assert.equal(canTransitionIssue('verifying', 'closed'), false);
  assert.equal(canTransitionIssue('verifying', 'processing'), true);
  assert.equal(canTransitionIssue('awaiting_confirmation', 'closed'), true);
  assert.equal(canTransitionIssue('awaiting_confirmation', 'processing'), true);
  assert.equal(canTransitionIssue('closed', 'processing'), true);
  assert.equal(canTransitionIssue('pending', 'closed'), false);
});

test('submitting for verification requires a solution', () => {
  const missing = transitionIssueData({ status: 'processing', solution: null, verificationResult: null }, 'verifying', {});
  assert.equal(missing.error, '提交验证前请填写处理方案');
  const valid = transitionIssueData({ status: 'processing', solution: null, verificationResult: null }, 'verifying', { solution: '更换端子并复核首件' }, new Date('2026-07-16T00:00:00.000Z'));
  assert.equal(valid.error, null);
  assert.equal(valid.data.status, 'verifying');
  assert.equal(valid.data.solution, '更换端子并复核首件');
});

test('verification passes to requester confirmation before closure and reopening clears closure timestamps', () => {
  const missing = transitionIssueData({ status: 'verifying', solution: '已处理', verificationResult: null }, 'awaiting_confirmation', {});
  assert.equal(missing.error, '提交发起人确认前请填写验证结果');
  const awaiting = transitionIssueData({ status: 'verifying', solution: '已处理', verificationResult: null }, 'awaiting_confirmation', { verificationResult: '抽检通过' });
  assert.equal(awaiting.error, null);
  assert.equal(awaiting.data.status, 'awaiting_confirmation');
  assert.ok(awaiting.data.verifiedAt instanceof Date);
  const closed = transitionIssueData({ status: 'awaiting_confirmation', solution: '已处理', verificationResult: '抽检通过' }, 'closed', { comment: '发起人复核现场正常' }, new Date('2026-08-21T08:00:00.000Z'), 'reporter-1');
  assert.equal(closed.error, null);
  assert.equal(closed.data.status, 'closed');
  assert.equal(closed.data.requesterConfirmationNote, '发起人复核现场正常');
  const reopened = transitionIssueData({ status: 'closed', solution: '已处理', verificationResult: '抽检通过' }, 'processing', {});
  assert.equal(reopened.error, null);
  assert.equal(reopened.data.closedAt, null);
  assert.equal(reopened.data.verifiedAt, null);
});

test('transition authority keeps requester confirmation separate and lets administrators act with audit override', () => {
  assert.deepEqual(issueTransitionAuthority({
    currentStatus: 'awaiting_confirmation',
    targetStatus: 'closed',
    userId: 'reporter-1',
    employeeId: 'employee-1',
    laborRole: 'EMPLOYEE',
    reporterId: 'reporter-1',
    verifierEmployeeId: 'employee-2',
    hasWorkflowAccess: false,
    hasQualityWorkflow: false,
  }), { allowed: true, adminOverride: false });
  assert.deepEqual(issueTransitionAuthority({
    currentStatus: 'awaiting_confirmation',
    targetStatus: 'closed',
    userId: 'verifier-user',
    employeeId: 'employee-2',
    laborRole: 'EMPLOYEE',
    reporterId: 'reporter-1',
    verifierEmployeeId: 'employee-2',
    hasWorkflowAccess: true,
    hasQualityWorkflow: true,
  }), { allowed: false, adminOverride: false });
  assert.deepEqual(issueTransitionAuthority({
    currentStatus: 'awaiting_confirmation',
    targetStatus: 'closed',
    userId: 'admin-1',
    employeeId: null,
    laborRole: 'ADMIN',
    reporterId: 'reporter-1',
    verifierEmployeeId: 'employee-2',
    hasWorkflowAccess: false,
    hasQualityWorkflow: false,
  }), { allowed: true, adminOverride: true });

  assert.deepEqual(issueTransitionAuthority({
    currentStatus: 'processing',
    targetStatus: 'verifying',
    userId: 'admin-user',
    employeeId: 'admin-employee',
    laborRole: 'ADMIN',
    reporterId: 'reporter-user',
    verifierEmployeeId: 'verifier-employee',
    hasWorkflowAccess: true,
    hasQualityWorkflow: true,
  }), { allowed: true, adminOverride: true });
});

test('production alert mapping preserves urgency and ownership domain', () => {
  assert.equal(priorityForAlert({ code: 'OVERDUE', label: '逾期2天', tone: 'red' }), 'urgent');
  assert.equal(priorityForAlert({ code: 'MATERIAL_NOT_READY', label: '配料未齐', tone: 'orange' }), 'high');
  assert.equal(typeForAlert('MATERIAL_NOT_READY'), 'material');
  assert.equal(typeForAlert('DRAWING_CHANGE_REQUIRED'), 'technical');
  assert.equal(typeForAlert('REWORK'), 'quality');
});
