import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// Synthetic accounts/queue fixtures only, never a production target or real robot.
const base = process.env.WECOM_QA_BASE || 'http://127.0.0.1:3495';
const database = new URL(process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.match(database.pathname, /^\/(wecom71_(qa|release_[ab])|hongmeng_ci)$/);
const token = process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN;
assert.ok(token?.length >= 32);
const accepted = process.env.WECOM_QA_EXPECT_ACCEPTED === '1';
const prisma = new PrismaClient();
const prefix = `wecom71-${randomUUID().slice(0, 8)}`;
const password = 'WeComQuality71!IsolatedQA';
const evidencePath = process.env.WECOM_QA_EVIDENCE || 'artifacts/wecom-quality-only-v13471/runtime-qa.json';
const evidence = { prefix, base, accounts: {}, checks: [], acceptedTransport: accepted, realWeComUsed: false };
const cookies = {};
const accounts = {};
async function request(label, who, route, method = 'GET', body, status = 200) {
  const response = await fetch(base + route, { method, signal: AbortSignal.timeout(15000),
    headers: { Origin: base, ...(who ? { Cookie: cookies[who] } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(route.startsWith('/api/internal/') ? { 'x-outbox-worker-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, status, `${label}: ${JSON.stringify(data)}`);
  evidence.checks.push({ label, status });
  return { data, headers: response.headers };
}
let report;
async function stage(action, who, payload = {}) {
  report = (await request(action, who, `/api/quality/internal-risks/${report.id}/stage`, 'POST', { action, payload, expectedVersion: report.version })).data.report;
}
async function delivery(event) {
  // Reset only the isolated dispatch clock so smoke tests do not wait for rate limiting.
  await prisma.qualityRobotDispatchClock.deleteMany({ where: { id: 'quality' } });
  for (let index = 0; index < 12; index++) {
    await request(`quality worker ${event}`, null, '/api/internal/quality-risk-outbox', 'POST', {});
    const item = await prisma.qualityRiskNotification.findFirstOrThrow({ where: { reportId: report.id, eventType: event }, orderBy: { createdAt: 'desc' } });
    if (item.state === (accepted ? 'SENT' : 'WAITING_CONFIG')) {
      evidence.checks.push({ label: `quality ${event}`, state: item.state });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 450));
  }
  throw new Error(`Quality delivery did not reach expected state: ${event}`);
}
try {
  const version = `v${JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version}`;
  assert.equal((await request('readiness', null, '/api/ready')).data.app.version, version);
  await request('settings require login', null, '/api/integrations/wecom/robot', 'GET', undefined, 401);
  const hash = await bcrypt.hash(password, 10);
  for (const [index, key] of ['admin', 'owner', 'quality'].entries()) {
    const employee = await prisma.employee.create({ data: { employeeNo: `${prefix}-${key}`, name: `隔离验收${key}`, mobile: `199${String(Date.now()).slice(-7)}${index}`,
      department: key === 'owner' ? '工艺部' : '品质部', attendanceEnabled: false, attainmentEligible: false } });
    const account = await prisma.user.create({ data: { username: `${prefix}-${key}`, displayName: employee.name, employeeId: employee.id, passwordHash: hash,
      laborRole: key === 'admin' ? 'ADMIN' : 'EMPLOYEE', accessGrants: { create: { profile: key === 'admin' ? 'ADMIN_GLOBAL' : key === 'owner' ? 'PROCESS_SPECIALIST' : 'QUALITY_REVIEWER', scopeKey: 'GLOBAL' } } } });
    accounts[key] = account;
    evidence.accounts[key] = { id: account.id, username: account.username };
    const login = await request(`${key} login`, null, '/api/auth/login', 'POST', { username: account.username, password });
    cookies[key] = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  }
  const settings = (await request('read notification policy', 'admin', '/api/integrations/wecom/robot')).data;
  assert.equal(settings.policy.automaticScope, 'QUALITY_ONLY');
  assert.equal(settings.policy.manualTest, 'ADMIN_CONFIRMED_ONLY');
  await request('test requires administrator', 'owner', '/api/integrations/wecom/robot', 'POST', { confirmed: true }, 403);
  await request('test requires explicit confirmation', 'admin', '/api/integrations/wecom/robot', 'POST', {}, 400);

  const product = await prisma.drawingLibraryItem.create({ data: { libraryKey: prefix, customerName: prefix, customerCode: prefix, productName: '质量工艺问题隔离样例', specification: prefix } });
  report = (await request('create and assign quality process problem', 'admin', '/api/quality/internal-risks', 'POST', {
    title: `${prefix} 工艺质量异常`, defectPhenomenon: '隔离验收：质量管理内的工艺问题仍应通知', problemCategory: 'PROCESS',
    productIds: [product.id], ownerUserId: accounts.owner.id, responsibleUserIds: [accounts.owner.id], reviewerUserId: accounts.quality.id, submit: true,
  }, 201)).data.report;
  await delivery('ASSIGNED');
  const taskId = report.tasks[0].id;
  const result = { taskId, actionTaken: '隔离验收措施', result: '隔离验收结果' };
  const analysis = { occurrenceCause: '样例发生原因', rootCause: '样例根本原因', finalConclusion: '样例结论', correctiveAction: '样例解决方案' };
  await stage('START_TASK', 'owner', { taskId });
  await stage('COMPLETE_TASK', 'owner', result);
  await delivery('CONSOLIDATE');
  await stage('SUBMIT_REVIEW', 'owner', analysis);
  await delivery('REVIEW');
  await stage('RETURN', 'quality', { taskIds: [taskId], reason: '隔离验收：补充处理结果' });
  await delivery('RETURNED');
  await stage('COMPLETE_TASK', 'owner', result);
  await delivery('CONSOLIDATE');
  await stage('SUBMIT_REVIEW', 'owner', analysis);
  await delivery('REVIEW');
  await stage('APPROVE', 'quality', { result: '隔离验收：独立复核通过' });
  await delivery('APPROVED');
  assert.equal(report.status, 'PENDING_CLOSE');

  const order = await prisma.workOrder.create({ data: { code: prefix, productName: '检验工序隔离样例', stage: 'frontend', processRoute: { create: { templateName: '隔离通知验收路线', templateVersion: 1, version: 0, status: 'completed' } } }, include: { processRoute: true } });
  const changeRequest = await prisma.changeRequest.create({ data: { title: prefix, workOrderId: order.id, requesterId: accounts.admin.id } });
  const change = await prisma.processRouteChange.create({ data: { changeRequestId: changeRequest.id, workOrderId: order.id,
    routeId: order.processRoute.id, baseRouteVersion: 0, routeSnapshot: {}, createdById: accounts.admin.id } });
  const events = ['PROCESS_ROUTE_CHANGE_SUBMITTED', 'PROCESS_ROUTE_CHANGE_APPROVED', 'PROCESS_ROUTE_CHANGE_REJECTED',
    'PROCESS_ROUTE_CHANGE_REEVALUATED', 'PROCESS_ROUTE_CHANGE_ACTIVATED', 'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED', 'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED'];
  const rows = await Promise.all(events.map(eventType => prisma.processRouteChangeOutbox.create({ data: { changeId: change.id,
    eventType, dedupeKey: `${prefix}-${eventType}`, payload: { workOrderId: order.id } } })));
  const legacy = await prisma.processRouteChangeOutbox.create({ data: { changeId: change.id, channel: 'WECOM_ROBOT', status: 'PROCESSING',
    updatedAt: new Date(0), eventType: events[0], dedupeKey: `${prefix}-legacy`, payload: { workOrderId: order.id } } });
  await request('process worker retains in-app and recovery', null, '/api/internal/process-route-change-outbox', 'POST', {});
  for (const row of rows) {
    const current = await prisma.processRouteChangeOutbox.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(current.channel, 'IN_APP'); assert.equal(current.status, 'SENT');
  }
  assert.equal((await prisma.processRouteChangeOutbox.findUniqueOrThrow({ where: { id: legacy.id } })).status, 'CANCELLED');
  const notificationKeys = [...rows, legacy].map(row => `route-change:${row.dedupeKey}`);
  assert.equal(await prisma.systemNotification.count({ where: { dedupeKey: { in: notificationKeys } } }), 8);
  await request('process re-run does not replay messages', null, '/api/internal/process-route-change-outbox', 'POST', {});
  assert.equal(await prisma.systemNotification.count({ where: { dedupeKey: { in: notificationKeys } } }), 8);
  assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: order.processRoute.id } })).status, 'completed');
  evidence.checks.push({ label: '7 process events in-app; old queue cancelled; no duplicate; completed route unchanged', passed: true });

  const unknown = await prisma.qualityRiskNotification.create({ data: { reportId: report.id, recipientId: accounts.owner.id,
    eventType: 'UNKNOWN_FUTURE_EVENT', title: '质量检验（不应按标题放行）', summary: '隔离样例', targetRoute: '/workspace/quality-tasks', dedupeKey: `${prefix}-unknown` } });
  await prisma.qualityRobotDispatchClock.deleteMany({ where: { id: 'quality' } });
  await request('unknown event rejected by actual worker', null, '/api/internal/quality-risk-outbox', 'POST', {});
  assert.equal((await prisma.qualityRiskNotification.findUniqueOrThrow({ where: { id: unknown.id } })).state, 'SKIPPED');
  evidence.version = version;
  evidence.reportId = report.id;
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.passed, checks: evidence.checks.length, error: evidence.error, evidencePath }));
}
