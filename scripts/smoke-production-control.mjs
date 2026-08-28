import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';

// Mutating acceptance must never point at a formal business database.
const database = new URL(process.env.DATABASE_URL);
const base = process.env.CONTROL_QA_BASE || 'http://127.0.0.1:3489';
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
assert.ok(/^\/production_control69_(it|release_[ab])$/.test(database.pathname)
  || (process.env.CI === 'true' && database.pathname === '/hongmeng_ci'));
assert.equal(new URL(base).hostname, '127.0.0.1');
const db = new PrismaClient();
const prefix = `qa_control_${randomUUID().slice(0, 8)}`;
const cookies = {};
const users = {};
const results = [];
const evidencePath = process.env.CONTROL_QA_EVIDENCE || 'artifacts/production-control-v13469/runtime-local.json';
let order;
let employee;
async function request(path, who, body, method = 'GET', origin = base) {
  const response = await fetch(base + path, { method, headers: {
    ...(who ? { Cookie: cookies[who] } : {}), Origin: origin,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json().catch(() => ({})), headers: response.headers };
}
function expect(response, status, name) {
  assert.equal(response.status, status, `${name}: ${JSON.stringify(response.data)}`);
  results.push({ name, status });
  return response.data;
}
try {
  const password = 'ControlSmoke!2026X';
  const passwordHash = await bcrypt.hash(password, 10);
  employee = await db.employee.create({ data: { employeeNo: prefix, name: '控制验收操作员', department: '生产部' } });
  for (const [key, profile, departmentCode, scopeKey] of [
    ['admin', 'ADMIN_GLOBAL', null, 'GLOBAL'],
    ['plan', 'DEPARTMENT_FULL', 'PLANNING', 'DEPARTMENT:PLANNING'],
    ['lead', 'WORKSHOP_SUPERVISOR', 'PRODUCTION', 'WORKSHOP:PRODUCTION'],
    ['hr', 'DEPARTMENT_FULL', 'HR', 'DEPARTMENT:HR'],
    ['collaborator', 'PLANNING_COLLABORATOR', null, 'GLOBAL'],
  ]) {
    const department = departmentCode ? await db.department.upsert({ where: { code: departmentCode }, update: {}, create: { code: departmentCode, name: departmentCode } }) : null;
    users[key] = await db.user.create({ data: { username: `${prefix}_${key}`, displayName: `生产控制验收-${key}`, passwordHash, laborRole: key === 'admin' ? 'ADMIN' : 'EMPLOYEE', accessGrants: { create: { profile, departmentId: department?.id, scopeKey } } } });
    const response = await request('/api/auth/login', null, { username: users[key].username, password }, 'POST');
    expect(response, 200, `${key} login`);
    cookies[key] = response.headers.get('set-cookie').match(/hm_session=[^;]+/)[0];
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const day = new Date(`${today}T00:00:00Z`);
  order = await db.workOrder.create({ data: { code: prefix, customerName: '镜像控制验收', productName: '验收线束', specification: prefix, stage: 'frontend', status: 'processing', planActive: true, planType: 'managed_plan', productionTargetQty: 100, uncompletedQty: '100', completedQty: '0', plannedAt: day, deliveryDay: today,
    processRoute: { create: { templateName: prefix, templateVersion: 1, status: 'in_progress', confirmedAt: new Date(), confirmedById: users.admin.id, startedAt: new Date(), steps: { create: { processCode: prefix, processName: '压接', stageGroup: 'frontend', position: 1, sequenceGroup: 1, standardSource: 'qa', timeBasis: 'per_unit', unitLabel: '套', standardMillisecondsPerUnit: 1000, inputQty: 100, status: 'current' } } } },
  }, include: { processRoute: { include: { steps: true } } } });
  const endpoint = `/api/work-orders/${order.id}/production-control`;
  const get = async who => expect(await request(endpoint, who), 200, `${who} control read`).control;
  let control = await get('admin');
  const note = { action: 'note', text: '端子缺料，采购跟进', category: 'material', owner: '采购', expectedVersion: control.version, requestId: randomUUID() };
  expect(await request(endpoint, null, note, 'POST'), 401, 'anonymous control denied');
  expect(await request(endpoint, 'admin', note, 'POST', 'https://foreign.invalid'), 403, 'cross-origin control denied');
  expect(await request(endpoint, 'hr', note, 'POST'), 403, 'HR reports do not grant production mutation');
  expect(await request(endpoint, 'lead', note, 'POST'), 200, 'supervisor writes note');
  control = await get('plan');
  assert.equal(control.note.text, note.text);
  const pause = { action: 'pause', reason: '来料未到，暂停该批次', category: 'material', followUpAt: `${today}T23:00:00+08:00`, confirmImpact: true, expectedVersion: control.version, requestId: randomUUID() };
  expect(await request(endpoint, 'lead', pause, 'POST'), 200, 'supervisor pauses');
  expect(await request(endpoint, 'lead', pause, 'POST'), 200, 'same pause retries idempotently');
  control = await get('admin');
  assert.ok(control.pausedAt);
  const report = { stepId: order.processRoute.steps[0].id, processedQty: 1, defectQty: 0, workDate: today, employeeIds: [employee.id], expectedRouteVersion: 0, idempotencyKey: randomUUID() };
  const rejected = await request(`/api/process-management/routes/${order.processRoute.id}/completions`, 'admin', report, 'POST');
  expect(rejected, 409, 'HTTP report blocked during pause');
  assert.equal(rejected.data.code, 'PRODUCTION_PAUSED');
  const adjustment = { action: 'adjust_date', dateKind: 'estimated', date: '2030-09-04', reason: '重新安排交付', expectedVersion: control.version, requestId: randomUUID() };
  expect(await request(endpoint, 'lead', adjustment, 'POST'), 403, 'supervisor cannot adjust dates');
  expect(await request(endpoint, 'collaborator', adjustment, 'POST'), 403, 'planning collaborator cannot adjust dates');
  expect(await request(endpoint, 'plan', adjustment, 'POST'), 200, 'planning adjusts estimate');
  control = await get('admin');
  assert.equal(control.customerDueDate, today);
  assert.equal(control.planBaselineDate, today);
  expect(await request(`/api/work-orders/${order.id}`, 'admin', { deliveryDay: '2030-09-05' }, 'PATCH'), 409, 'generic editor cannot silently change date');
  const customer = { ...adjustment, dateKind: 'customer', date: '2030-09-05', confirmation: '客户已书面确认', confirmImpact: true, expectedVersion: control.version, requestId: randomUUID() };
  expect(await request(endpoint, 'plan', customer, 'POST'), 200, 'planning records customer confirmation');
  control = await get('admin');
  assert.equal(control.deliveryBaselineDate, today);
  const dateEvent = control.events.find(event => event.action === 'adjust_date' && event.after.customerDueDate === customer.date);
  assert.equal(dateEvent.after.impact.confirmation, customer.confirmation);
  const exportResponse = await fetch(`${base}/api/export/production-execution.csv?workOrderId=${order.id}`, { headers: { Cookie: cookies.admin } });
  assert.equal(exportResponse.status, 200);
  const csv = await exportResponse.text();
  assert.match(csv, /当前问题备注/);
  assert.match(csv, /端子缺料/);
  assert.match(csv, /2030-09-05/);
  results.push({ name: 'CSV note, pause and date columns', status: 200 });
  const workbookResponse = await fetch(`${base}/api/export/production-dispatch.xlsx?workOrderId=${order.id}`, { headers: { Cookie: cookies.admin } });
  assert.equal(workbookResponse.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await workbookResponse.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  let sequenceHeaderRow = 0;
  sheet.eachRow(row => { if (row.getCell(1).text === '序号') sequenceHeaderRow = row.number; });
  assert.ok(sequenceHeaderRow > 0);
  assert.equal(sheet.getRow(sequenceHeaderRow + 1).getCell(1).value, 1);
  results.push({ name: 'Excel sequence follows filtered result', status: 200 });
  expect(await request(endpoint, 'lead', { action: 'resume', reason: '物料已到，重新安排人员', confirmImpact: true, expectedVersion: control.version, requestId: randomUUID() }, 'POST'), 200, 'explicit resume');
  control = await get('admin');
  assert.equal(control.pausedAt, null);
  assert.equal(control.note.text, note.text);
  assert.ok(control.events.length >= 5);
  assert.equal(await db.processCompletion.count({ where: { workOrderId: order.id } }), 0);
  const unchanged = await db.workOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(unchanged.productionTargetQty, 100);
  assert.equal(unchanged.plannedAt.toISOString(), day.toISOString());
  await mkdir(dirname(evidencePath), { recursive: true });
  const proof = { ok: true, base, time: new Date().toISOString(), cases: results, immutablePlanDate: today, productionFactsUnchanged: true, historyEvents: control.events.length };
  await writeFile(evidencePath, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, evidencePath }));
} finally {
  if (order) {
    await db.productionControlEvent.deleteMany({ where: { workOrderId: order.id } });
    await db.workOrder.delete({ where: { id: order.id } });
  }
  await db.operationLog.deleteMany({ where: { userId: { in: Object.values(users).map(user => user.id) } } });
  await db.user.deleteMany({ where: { id: { in: Object.values(users).map(user => user.id) } } });
  if (employee) await db.employee.delete({ where: { id: employee.id } });
  await db.$disconnect();
}
