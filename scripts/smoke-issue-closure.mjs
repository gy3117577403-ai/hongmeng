import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Only disposable, loopback-bound QA databases are accepted. All workflow
// changes go through HTTP; direct database writes create synthetic accounts only.
const base = process.env.ISSUE_QA_BASE || 'http://127.0.0.1:3492';
const target = new URL(base);
const database = new URL(process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
assert.match(database.pathname, /^\/(hongmeng_ci|production_control69_release_b|issue_closure70_(qa|release_[ab]))$/);
const prisma = new PrismaClient();
const prefix = `close70-${randomUUID().slice(0, 8)}`;
const password = 'IssueClosure70!SyntheticQA';
const evidencePath = process.env.ISSUE_QA_EVIDENCE || 'artifacts/issue-closure-v13470/runtime-qa.json';
const results = [];
const accounts = {};
const cookies = {};
const samples = {};
const evidence = { prefix, base, database: database.pathname.slice(1), startedAt: new Date().toISOString(), results, accounts, samples };

async function request(label, who, route, method = 'GET', body, expected = 200) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + route, {
    method, signal: AbortSignal.timeout(30000),
    headers: { Origin: base, ...(who ? { Cookie: cookies[who] } : {}), ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  results.push({ label, route, method, status: response.status, expected, error: data.error || null, code: data.code,
    issueId: data.issue?.id, issueStatus: data.issue?.status, version: data.issue?.version });
  assert.equal(response.status, expected, `${label}: ${JSON.stringify(data)}`);
  return { data, headers: response.headers };
}

async function read(id, who = 'reporter') { return (await request('read current state', who, `/api/issues/${id}`)).data.issue; }
async function move(id, who, status, body = {}, expected = 200) {
  const latest = await read(id, who);
  return (await request(`transition ${latest.status} -> ${status}`, who, `/api/issues/${id}/transition`, 'POST', { status, expectedVersion: latest.version, ...body }, expected)).data;
}
async function upload(id, who = 'owner') {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+A5T0AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), `${prefix}-synthetic.png`);
  form.append('category', 'processing');
  form.append('caption', '隔离验收样例，无真实生产证据');
  return (await request('upload S3 evidence', who, `/api/issues/${id}/attachments/upload`, 'POST', form)).data.issue;
}
async function create(label, { reporter = 'reporter', major = false, attachment = true } = {}) {
  const result = await request(`create ${label}`, reporter, '/api/issues', 'POST', {
    title: `${prefix} ${label}（隔离样例）`, type: major ? 'quality' : 'production', priority: 'high',
    description: '仅用于闭环接口及页面验收，不是正式生产问题。', assigneeEmployeeId: accounts[major ? reporter : 'owner'].employeeId,
    rootCause: '已核实：物料规格标识不清', solution: '已更换合规物料，完成培训与复查',
    ...(major ? { isMajorQuality: true, majorQualityReason: '隔离验收：重大事项需质量复核与终审' } : {}),
  }, 201);
  const id = result.data.issue.id;
  if (!major) await request('set independent verifier', 'owner', `/api/issues/${id}`, 'PATCH', { verifierEmployeeId: accounts.verifier.employeeId, expectedVersion: result.data.issue.version });
  if (attachment) await upload(id, major ? reporter : 'owner');
  await move(id, major ? reporter : 'owner', 'processing');
  return id;
}
async function awaiting(id) {
  await move(id, 'owner', 'verifying');
  await move(id, 'verifier', 'awaiting_confirmation', { verificationResult: '尺寸与物料抽查合格，整改措施有效。' });
}

async function run() {
  evidence.app = (await request('readiness', null, '/api/ready')).data.app;
  assert.equal(evidence.app.version, 'v1.34.70');
  const hash = await bcrypt.hash(password, 10);
  const quality = await prisma.department.findUniqueOrThrow({ where: { code: 'QUALITY' } });
  const gm = await prisma.department.findUniqueOrThrow({ where: { code: 'GM_OFFICE' } });
  for (const [key, name] of Object.entries({ reporter: '发起人', owner: '处理人', verifier: '验证人', reader: '只读发起人', gm: '终审人', admin: '管理员' })) {
    const department = key === 'gm' ? gm : quality;
    const username = `${prefix}-${key}`;
    const employee = await prisma.employee.create({ data: { employeeNo: username, name: `验收${name}`, department: department.name, departmentId: department.id, attendanceEnabled: false, attainmentEligible: false } });
    const user = await prisma.user.create({ data: { username, displayName: employee.name, passwordHash: hash, employeeId: employee.id, laborRole: key === 'admin' ? 'ADMIN' : 'EMPLOYEE',
      accessGrants: { create: { profile: key === 'admin' ? 'ADMIN_GLOBAL' : key === 'gm' ? 'GM_OFFICE_READER_APPROVER' : 'DEPARTMENT_FULL', grantType: 'PRIMARY', scopeKey: key === 'admin' ? 'GLOBAL' : `DEPARTMENT:${department.code}`, departmentId: key === 'admin' ? null : department.id } },
    } });
    accounts[key] = { username, id: user.id, employeeId: employee.id };
    const login = await request(`${key} login`, null, '/api/auth/login', 'POST', { username, password });
    cookies[key] = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookies[key]);
  }

  const normal = await create('普通问题完整闭环');
  await awaiting(normal);
  const before = await read(normal);
  assert.equal(before.workflow.currentTaskForUser, 'confirmation');
  await move(normal, 'owner', 'closed', {}, 403);
  await request('missing version rejected', 'reporter', `/api/issues/${normal}/transition`, 'POST', { status: 'closed' }, 409);
  await request('stale version rejected', 'reporter', `/api/issues/${normal}/transition`, 'POST', { status: 'closed', expectedVersion: before.version - 1 }, 409);
  const closed = (await move(normal, 'reporter', 'closed', { comment: '现场复核已解决', rootCause: '旧原因不得覆盖', solution: '旧措施不得覆盖', verificationResult: '' })).issue;
  assert.equal(closed.status, 'closed');
  assert.equal(closed.rootCause, before.rootCause);
  assert.equal(closed.solution, before.solution);
  assert.equal(closed.verificationResult, before.verificationResult);
  assert.equal(closed.requesterConfirmedBy.id, accounts.reporter.id);
  assert.ok(closed.requesterConfirmedAt && closed.closedAt);
  const audit = closed.activities.find(item => item.toStatus === 'closed');
  assert.equal(audit.actor.id, accounts.reporter.id);
  assert.equal(audit.detail.adminOverride, false);
  const persistedAudit = await prisma.issueActivity.findUniqueOrThrow({ where: { id: audit.id } });
  assert.equal(persistedAudit.detail.verificationBasis.kind, 'verification');
  await move(normal, 'reporter', 'processing', {}, 400);
  const reopened = (await move(normal, 'reporter', 'processing', { comment: '复发，重新处理' })).issue;
  assert.equal(reopened.verificationResult, null);
  assert.equal(reopened.requesterConfirmedBy, null);
  assert.equal(reopened.closedAt, null);
  await move(normal, 'owner', 'verifying');
  await move(normal, 'verifier', 'processing', { comment: '验证未通过，补充整改' });
  await awaiting(normal);
  await move(normal, 'reporter', 'processing', { comment: '发起人发现仍有问题' });
  await awaiting(normal);
  const concurrent = await read(normal);
  const race = await Promise.all([1, 2].map(() => fetch(`${base}/api/issues/${normal}/transition`, { method: 'POST', headers: { Origin: base, Cookie: cookies.reporter, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed', expectedVersion: concurrent.version, comment: '并发确认' }) })));
  const raceStatuses = race.map(response => response.status).sort();
  assert.deepEqual(raceStatuses, [200, 409]);
  results.push({ label: 'concurrent confirmation has one winner', statuses: raceStatuses });
  const dbClosed = await prisma.issue.findUniqueOrThrow({ where: { id: normal }, include: { activities: { where: { toStatus: 'closed' } } } });
  assert.equal(dbClosed.version, concurrent.version + 1);
  assert.equal(dbClosed.activities.length, 2); // one earlier close, one concurrent winner
  assert.equal(dbClosed.requesterConfirmedById, accounts.reporter.id);

  const gates = await create('提交验证门槛', { attachment: false });
  await move(gates, 'owner', 'verifying', {}, 409);
  await upload(gates);
  const task = await request('create collaboration task', 'owner', `/api/issues/${gates}/activities`, 'POST', { kind: 'task', content: '复核物料批次', assigneeEmployeeId: accounts.owner.employeeId });
  const taskId = task.data.issue.activities.find(item => item.action === 'task_create').id;
  await move(gates, 'owner', 'verifying', {}, 409);
  await request('complete collaboration task', 'owner', `/api/issues/${gates}/activities`, 'POST', { kind: 'task_complete', targetActivityId: taskId });
  const beforeDuplicate = await read(gates);
  await request('duplicate task completion rejected', 'owner', `/api/issues/${gates}/activities`, 'POST', { kind: 'task_complete', targetActivityId: taskId }, 409);
  assert.equal((await read(gates)).version, beforeDuplicate.version);
  const decision = await request('create decision', 'owner', `/api/issues/${gates}/activities`, 'POST', { kind: 'decision', content: '是否采用整改方案' });
  const decisionId = decision.data.issue.activities.find(item => item.action === 'decision_create').id;
  await move(gates, 'owner', 'verifying', {}, 409);
  await request('decide', 'verifier', `/api/issues/${gates}/activities`, 'POST', { kind: 'decision_response', targetActivityId: decisionId, decision: 'approve' });
  await move(gates, 'owner', 'verifying');
  await request('verification stage rejects new task', 'owner', `/api/issues/${gates}/activities`, 'POST', { kind: 'task', content: '禁止绕过验证修改协同门槛', assigneeEmployeeId: accounts.owner.employeeId }, 409);
  await move(gates, 'verifier', 'awaiting_confirmation', { verificationResult: '处理证据和协同事项全部复核通过' });
  await move(gates, 'admin', 'closed', {}, 400);
  const adminClosed = (await move(gates, 'admin', 'closed', { comment: '发起人不在现场，经确认后管理员代办' })).issue;
  assert.equal(adminClosed.requesterConfirmedBy.id, accounts.admin.id);
  assert.equal(adminClosed.activities.find(item => item.toStatus === 'closed').detail.adminOverride, true);

  const readonly = await create('只读权限说明', { reporter: 'reader' });
  await awaiting(readonly);
  await prisma.userAccessGrant.updateMany({ where: { userId: accounts.reader.id }, data: { profile: 'GM_OFFICE_READER_APPROVER' } });
  const readOnlyView = await read(readonly, 'reader');
  assert.equal(readOnlyView.workflow.actions.some(action => action.allowed), false);
  assert.match(readOnlyView.workflow.permissionReason, /未开通/);
  await move(readonly, 'reader', 'closed', {}, 403);
  assert.equal((await read(readonly)).status, 'awaiting_confirmation');

  const major = await create('重大审批不重复补写验证', { major: true });
  const submitted = (await move(major, 'reporter', 'verifying')).issue;
  const approvalId = submitted.majorApproval.id;
  const qualityReview = await request('quality review', 'verifier', `/api/issues/${major}/major-approval/quality-review`, 'POST', { approvalId, expectedVersion: submitted.majorApproval.version, decision: 'APPROVE', note: '独立复核整改及证据合格' });
  await request('GM final approval', 'gm', `/api/issues/${major}/major-approval/final-decision`, 'POST', { approvalId, expectedVersion: qualityReview.data.approval.version, decision: 'APPROVE', note: '同意复核结论，交发起人确认' });
  const approved = await read(major);
  assert.equal(approved.verificationResult, null);
  assert.equal(approved.workflow.verification.kind, 'major_approval');
  assert.equal(approved.workflow.verification.approvalId, approvalId);
  await request('approved major evidence stays locked', 'reporter', `/api/issues/${major}`, 'PATCH', { verificationResult: '不能伪造重复结论' }, 409);
  const majorClosed = (await move(major, 'reporter', 'closed', { comment: '已核对审批与现场结果' })).issue;
  assert.equal(majorClosed.status, 'closed');
  assert.equal(majorClosed.verificationResult, null);
  const majorAudit = await prisma.issueActivity.findUniqueOrThrow({ where: { id: majorClosed.activities.find(item => item.toStatus === 'closed').id } });
  assert.equal(majorAudit.detail.verificationBasis.approvalId, approvalId);
  samples.majorClosed = major;
  await move(major, 'reporter', 'processing', { comment: '测试重新整改及重新审批' });
  const round2 = (await move(major, 'reporter', 'verifying')).issue;
  assert.equal(round2.majorApproval.round, 2);
  await move(major, 'reporter', 'awaiting_confirmation', { verificationResult: '禁止直接替代重大审批' }, 409);
  // Only assigned verifier or quality authority may cancel a pending review.
  await move(major, 'verifier', 'processing', { comment: '撤回补充资料' });
  assert.equal((await read(major)).workflow.verification.kind, 'missing');

  samples.awaiting = await create('页面确认操作验收');
  await awaiting(samples.awaiting);
  samples.processing = await create('责任信息草稿验收');
  samples.blocked = await create('缺少处理证据验收', { attachment: false });
  samples.verifying = await create('独立验证操作验收');
  await move(samples.verifying, 'owner', 'verifying');
  samples.readonly = readonly;
  samples.closed = normal;
  evidence.passed = true;
}

try { await run(); }
catch (error) { evidence.passed = false; evidence.failure = String(error); process.exitCode = 1; }
finally {
  evidence.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
  console.log(JSON.stringify({ passed: evidence.passed, checks: results.length, evidencePath, samples, failure: evidence.failure || null }));
}
