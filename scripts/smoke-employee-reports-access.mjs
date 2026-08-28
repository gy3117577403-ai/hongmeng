import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// This creates synthetic fixtures. Refuse every non-local or business database.
const database = new URL(process.env.DATABASE_URL);
const base = process.env.REPORT_QA_BASE || 'http://127.0.0.1:3480';
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
assert.ok(/^\/employee_access_(it\d*|release_[ab])$/.test(database.pathname)
  || (process.env.CI === 'true' && database.pathname === '/hongmeng_ci'));
assert.equal(new URL(base).hostname, '127.0.0.1');
const db = new PrismaClient();
const password = 'AccessVerify!2026x';
const resetPassword = 'AccessReset!2026K';
const changedPassword = 'AccessChanged!2026Q';
const cookies = {};
const users = {};
const results = [];
const hour = 3_600_000;
const workDate = new Date('2026-08-04T00:00:00Z');
const evidencePath = process.env.REPORT_QA_EVIDENCE_PATH || 'artifacts/employee-reports-access-v13466/runtime-local.json';

async function request(path, who, body, method = 'GET', origin = base) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: {
    ...(who ? { Cookie: cookies[who] } : {}), Origin: origin,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}

async function login(key, credential = password) {
  const response = await request('/api/auth/login', null, { username: users[key].username, password: credential }, 'POST');
  assert.equal(response.status, 200, `${key} login: ${JSON.stringify(response.data)}`);
  cookies[key] = response.headers.get('set-cookie').match(/hm_session=[^;]+/)[0];
  return response.data;
}

try {
  assert.equal(await db.user.count({ where: { username: { startsWith: 'qa_access_' } } }), 0, 'Use a fresh isolated QA database');
  const production = await db.department.upsert({ where: { code: 'PRODUCTION' }, update: {}, create: { code: 'PRODUCTION', name: '生产部' } });
  const hr = await db.department.upsert({ where: { code: 'HR' }, update: {}, create: { code: 'HR', name: '人事部' } });
  const engineering = await db.department.upsert({ where: { code: 'ENGINEERING' }, update: {}, create: { code: 'ENGINEERING', name: '工程部' } });
  async function employee(no, name, department, team = null, extra = {}) {
    return db.employee.create({ data: { employeeNo: no, name, departmentId: department.id, department: department.name, team,
      hireDate: new Date('2026-08-01T00:00:00Z'), attendanceEnabled: department.code === 'PRODUCTION', ...extra } });
  }
  async function account(key, employee, profile, extra = {}) {
    users[key] = await db.user.create({ data: {
      username: `qa_access_${key}`, displayName: employee?.name || '隔离验收管理员', employeeId: employee?.id || null,
      passwordHash: await bcrypt.hash(password, 10), laborRole: profile === 'ADMIN_GLOBAL' ? 'ADMIN' : 'EMPLOYEE',
      accessGrants: { create: { profile, departmentId: employee?.departmentId || null,
        scopeKey: profile === 'FIELD_REPORTER' ? `EMPLOYEE:${employee.id}` : profile === 'WORKSHOP_TEAM_LEADER' ? 'TEAM:qa-team-a' : 'GLOBAL',
        effectiveFrom: new Date('2026-01-01T00:00:00Z') } }, ...extra,
    } });
    return users[key];
  }
  const workerA = await employee('QA-1001', '验收员工甲', production, '一组');
  const workerB = await employee('QA-1002', '验收员工乙', production, '二组');
  const leader = await employee('QA-1003', '验收组长', production, '一组', { attainmentEligible: false, attainmentFactorBasisPoints: 0, attainmentStream: 'excluded', position: '组长' });
  const supervisor = await employee('QA-1004', '验收主管', production, '主管', { attainmentEligible: false, attainmentFactorBasisPoints: 0, attainmentStream: 'excluded', position: '主管' });
  const hrEmployee = await employee('QA-1005', '验收人事', hr);
  const hrOnlyEmployee = await employee('QA-1008', '仅人事主权限验收', hr);
  const trainee = await employee('QA-1006', '朱艳军', production, '储备生', { attainmentEligible: false, attainmentFactorBasisPoints: 0, attainmentStream: 'excluded', position: '储备生' });
  const otherTrainee = await employee('QA-1007', '其他储备生验收', production, '储备生', { attainmentEligible: false, attainmentFactorBasisPoints: 0, attainmentStream: 'excluded' });
  await account('admin', null, 'ADMIN_GLOBAL');
  await account('hr', hrEmployee, 'DEPARTMENT_FULL');
  await db.userAccessGrant.create({ data: { userId: users.hr.id, profile: 'REPORT_PEOPLE_READER', grantType: 'CONCURRENT', departmentId: hr.id, scopeKey: 'GLOBAL:REPORT_PEOPLE' } });
  await account('hrOnly', hrOnlyEmployee, 'DEPARTMENT_FULL');
  await account('peopleReader', null, 'REPORT_PEOPLE_READER');
  await account('supervisor', supervisor, 'WORKSHOP_SUPERVISOR');
  await account('leader', leader, 'WORKSHOP_TEAM_LEADER', { laborRole: 'TEAM_LEAD' });
  await account('worker', workerA, 'FIELD_REPORTER');
  await account('trainee', trainee, 'FIELD_REPORTER', { fieldPasswordOnly: true, passwordHash: await bcrypt.hash('123456', 10) });
  await account('other', otherTrainee, 'FIELD_REPORTER');
  for (const key of ['admin', 'hr', 'hrOnly', 'peopleReader', 'supervisor', 'leader', 'worker', 'other']) await login(key);

  for (const employee of [workerA, workerB, supervisor]) await db.attendanceRecord.create({ data: {
    employeeId: employee.id, departmentSnapshot: '生产部', teamSnapshot: employee.team, workDate, status: 'confirmed',
    plannedMilliseconds: 8 * hour, actualMilliseconds: 8 * hour, segments: [],
    attainmentEligibleSnapshot: employee.attainmentEligible, attainmentFactorBasisPointsSnapshot: employee.attainmentFactorBasisPoints,
    attainmentStreamSnapshot: employee.attainmentStream, confirmedById: users.admin.id, confirmedAt: new Date(),
  } });
  const workOrder = await db.workOrder.create({ data: { code: 'QA-WO-MODEL-A', productName: '验收线束组件', specification: 'HX-2026-A', customerName: '隔离验收客户', stage: '前工序', productionTargetQty: 1000,
    processRoute: { create: { templateName: '验收产品工序', templateVersion: 1, status: 'in_progress', steps: { create: [
      { processCode: 'QA-P01', processName: '全自动压接', stageGroup: '前工序', position: 1, unitLabel: '套', standardMillisecondsPerUnit: 18000 },
      { processCode: 'QA-P02', processName: '成品检验', stageGroup: '后工序', position: 2, unitLabel: '套', standardMillisecondsPerUnit: 72000 },
    ] } } },
  }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  const route = workOrder.processRoute;
  for (let index = 0; index < 8; index++) {
    const start = new Date(Date.parse('2026-08-04T00:00:00Z') + index * hour / 2);
    const end = new Date(start.getTime() + hour / 2);
    const completion = await db.processCompletion.create({ data: {
      workOrderId: workOrder.id, routeId: route.id, stepId: route.steps[0].id, workDate,
      completedAt: end, workStartedAt: start, workEndedAt: end, processedQty: 100, goodQty: 100, defectQty: 0,
      reportedUnitQty: 100, reportedGoodUnitQty: 100, coveredQty: 100, coveredGoodQty: 100,
      routeVersion: 0, idempotencyKey: `QA-COMPLETION-${index}`, standardSource: 'product_time', unitLabel: '套',
      standardMillisecondsPerUnit: 18000, participants: { create: { employeeId: workerA.id } },
    } });
    await db.processLaborPool.create({ data: {
      completionId: completion.id, workOrderId: workOrder.id, stepId: route.steps[0].id, workDate,
      eligibleQty: 100, claimedQty: 100, remainingQty: 0, status: 'EXHAUSTED',
      standardMillisecondsPerUnit: 18000, totalStandardLaborMilliseconds: BigInt(hour / 2),
      claimedStandardLaborMilliseconds: BigInt(hour / 2), remainingStandardLaborMilliseconds: 0n, standardSource: 'product_time',
      claims: { create: { employeeId: workerA.id, quantity: 100, standardLaborMilliseconds: BigInt(hour / 2), workDate, idempotencyKey: `QA-CLAIM-${index}`, claimedById: users.admin.id } },
    } });
  }
  for (const [employee, standardHours] of [[workerA, 2], [workerB, 5.1]]) await db.processExecution.create({ data: {
    stepId: route.steps[1].id, employeeId: employee.id, startedAt: new Date('2026-08-04T05:00:00Z'), endedAt: new Date('2026-08-04T07:00:00Z'),
    goodQty: 100, unitLabel: '套', standardMillisecondsPerUnit: Math.round(standardHours * hour / 100),
    standardLaborMilliseconds: Math.round(standardHours * hour), actualLaborMilliseconds: 2 * hour, attainmentBasisPoints: Math.round(standardHours / 2 * 10000),
  } });
  const reportPath = '/api/reports/employee-attainment?period=month&date=2026-08-04';
  const adminReport = await request(reportPath, 'admin');
  assert.equal(adminReport.status, 200, JSON.stringify(adminReport.data));
  const projection = report => report.rows.map(row => [row.employee.id, row.standardLaborMilliseconds, row.attainmentBasisPoints]).sort();
  for (const key of ['supervisor', 'leader', 'hr', 'hrOnly']) {
    const response = await request(reportPath, key);
    assert.equal(response.status, 200, `${key}: ${JSON.stringify(response.data)}`);
    assert.deepEqual(projection(response.data.report), projection(adminReport.data.report), `${key} must see the shared production dataset`);
    assert.equal((await request(reportPath + '&employeeId=' + workerB.id, key)).status, 200, 'cross-team employee detail');
  }
  for (const key of ['supervisor', 'leader']) {
    const page = await fetch(base + '/workspace/reports/people/employee-attainment', {
      headers: { Cookie: cookies[key] }, redirect: 'manual',
    });
    assert.equal(page.status, 200, `${key} daily-attainment page must not redirect to another report`);
    assert.match(await page.text(), /员工每日达成/);
  }
  assert.equal((await request(reportPath, 'worker')).status, 403);
  assert.equal((await request(reportPath, null)).status, 401);
  const workerRow = adminReport.data.report.rows.find(row => row.employee.id === workerA.id);
  assert.equal(workerRow.claimDetails.length, 8);
  assert.equal(workerRow.details.length, 1);
  assert.equal(workerRow.standardLaborMilliseconds, 6 * hour);
  assert.equal(workerRow.claimDetails[0].specification, 'HX-2026-A');
  assert.equal(workerRow.claimDetails[0].processCode, 'QA-P01');
  assert.equal(workerRow.details[0].processName, '成品检验');
  results.push('Supervisor with legacy EMPLOYEE role, team leader and HR receive the same per-employee data as administrator, including another team; field and anonymous accounts denied');
  results.push('Eight claims plus one direct report preserve exact product/model/process/quantity and six standard hours without truncation');

  // Exercise every real report page and data source with and without the old
  // personnel-reader grant. Merely showing a navigation tab is insufficient.
  const reportBranches = {
    production: ['weekly-plan-attainment', 'process-bottlenecks'],
    people: ['attendance-attainment', 'employee-attainment', 'employee-matrix', 'labor-ledger', 'unmatched-labor'],
    quality: ['affected-labor', 'cause-distribution', 'open-events', 'event-ledger'],
    governance: ['completeness', 'missing-route', 'missing-standard', 'missing-drawing', 'missing-material'],
    sample: ['sample-tasks', 'sample-attainment', 'pending-review', 'published-materials', 'review-attainment'],
  };
  const event = await db.abnormalTimeEvent.create({ data: {
    workDate, category: 'process', title: '跨班组异常报表验收', durationMilliseconds: hour / 2,
    workOrderId: workOrder.id, processStepId: route.steps[0].id, createdById: users.admin.id,
    allocations: { create: [workerA, workerB].map(employee => ({ employeeId: employee.id, workDate, durationMilliseconds: hour / 2 })) },
  } });
  const factsBeforeRead = {
    event: await db.abnormalTimeEvent.findUniqueOrThrow({ where: { id: event.id } }),
    pools: await db.processLaborPool.findMany({ orderBy: { id: 'asc' } }),
    workOrder: await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } }),
  };
  const reportApiPaths = ['overview', 'operations', 'abnormal-time', 'completed-batches'];
  const reportRange = 'period=custom&date=2026-08-04&startDate=2026-08-01&endDate=2026-08-04';
  const reportData = ({ generatedAt: _generatedAt, ...data }) => data;
  const adminData = {};
  for (const name of reportApiPaths) {
    const response = await request(`/api/reports/${name}?${reportRange}`, 'admin');
    assert.equal(response.status, 200, `administrator baseline: ${name}`);
    assert.ok(response.data.report, name);
    adminData[name] = reportData(response.data.report);
  }
  const poolPath = '/api/process-labor-pools?workDate=2026-08-04&includeExhausted=true';
  const adminPools = await request(poolPath, 'admin');
  assert.equal(adminPools.status, 200);
  assert.equal(adminPools.data.pools.length, 8);
  for (const key of ['hr', 'hrOnly']) {
    for (const [domain, branches] of Object.entries(reportBranches)) {
      for (const branch of branches) {
        const path = `/workspace/reports/${domain}/${branch}?period=month&date=2026-08-04`;
        const page = await fetch(base + path, { headers: { Cookie: cookies[key] }, redirect: 'manual' });
        assert.equal(page.status, 200, `${key}: ${path} must not redirect`);
        const html = await page.text();
        assert.match(html, /导出 Excel/, `${key}: export on ${path}`);
        for (const label of ['生产结果', '人员工时', '质量异常', '数据治理', '样品资料']) assert.ok(html.includes(label), `${key}: missing domain ${label}`);
      }
    }
    for (const name of reportApiPaths) {
      const response = await request(`/api/reports/${name}?${reportRange}`, key);
      assert.equal(response.status, 200, `${key}: ${name}`);
      assert.deepEqual(reportData(response.data.report), adminData[name], `${key}: shared ${name} dataset`);
    }
    const quality = await request('/api/reports/abnormal-time?period=month&date=2026-08-04', key);
    assert.equal(quality.data.report.summary.eventCount, 1);
    assert.equal(quality.data.report.summary.affectedPersonMilliseconds, hour);
    const pools = await request(poolPath, key);
    assert.equal(pools.status, 200);
    assert.deepEqual(pools.data.pools, adminPools.data.pools, `${key}: all employee labor claims`);
    const poolId = pools.data.pools[0].id;
    for (const [path, method, body] of [
      [`/api/process-labor-pools/${poolId}/claims`, 'POST', { employeeId: workerA.id, quantity: 1 }],
      [`/api/work-orders/${workOrder.id}`, 'PATCH', { productName: 'FORBIDDEN' }],
      [`/api/abnormal-time-events/${event.id}/quality`, 'POST', { decision: 'confirmed', employeeExempt: true }],
      [`/api/users/${users.worker.id}/access-grants`, 'POST', { profileKey: 'ADMIN_GLOBAL' }],
    ]) assert.equal((await request(path, key, body, method)).status, 403, `${key} must not gain ${method} ${path}`);
  }
  assert.deepEqual(await db.abnormalTimeEvent.findUniqueOrThrow({ where: { id: event.id } }), factsBeforeRead.event);
  assert.deepEqual(await db.processLaborPool.findMany({ orderBy: { id: 'asc' } }), factsBeforeRead.pools);
  assert.deepEqual(await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } }), factsBeforeRead.workOrder);
  for (const name of reportApiPaths) {
    assert.equal((await request(`/api/reports/${name}`, 'peopleReader')).status, 403, `personnel-only reader remains restricted: ${name}`);
    assert.equal((await request(`/api/reports/${name}`, 'worker')).status, 403, `field worker remains restricted: ${name}`);
    assert.equal((await request(`/api/reports/${name}`, null)).status, 401, `anonymous remains restricted: ${name}`);
  }
  const readerPage = await fetch(base + '/workspace/reports/people/employee-attainment', { headers: { Cookie: cookies.peopleReader }, redirect: 'manual' });
  assert.equal(readerPage.status, 307);
  assert.match(readerPage.headers.get('location'), /\/workspace\/reports\/people\/unmatched-labor$/);
  results.push('Both HR-only and HR plus legacy reader accounts open all 21 report pages with export; all report APIs match administrator datasets, including cross-team abnormal time and labor claims');
  results.push('HR report reads leave work orders, abnormal events and labor pools unchanged; production edits, quality review, labor claims and access grants remain denied; non-HR reader, field and anonymous boundaries preserved');

  const hrAccounts = await request('/api/users', 'hr');
  assert.equal(hrAccounts.status, 200);
  const hrAccountPage = await fetch(base + '/workspace/employees/accounts', {
    headers: { Cookie: cookies.hr }, redirect: 'manual',
  });
  assert.equal(hrAccountPage.status, 200, 'HR employee-account page must be accessible');
  assert.match(await hrAccountPage.text(), /员工账号管理/);
  assert.ok(!hrAccounts.data.users.some(user => user.id === users.admin.id || user.id === users.hr.id));
  for (const path of [`/api/users/${users.admin.id}/reset-password`, `/api/users/${users.hr.id}/reset-password`, `/api/users/${users.supervisor.id}/access-grants`]) {
    assert.equal((await request(path, 'hr', { password: resetPassword, profileKey: 'ADMIN_GLOBAL' }, 'POST')).status, 403);
  }
  assert.equal((await request(`/api/users/${users.admin.id}`, 'hr', { isActive: false }, 'PATCH')).status, 403);
  assert.equal((await request(`/api/users/${users.supervisor.id}`, 'hr', { laborRole: 'ADMIN' }, 'PATCH')).status, 403);
  assert.equal((await request('/api/users', 'worker')).status, 403);
  assert.equal((await request(`/api/users/${users.supervisor.id}/reset-password`, 'hr', { password: resetPassword }, 'POST', 'https://invalid.example')).status, 403);
  const existingGrants = await db.userAccessGrant.findMany({ where: { userId: users.supervisor.id }, orderBy: { id: 'asc' } });
  assert.equal((await request(`/api/users/${users.supervisor.id}`, 'hr', { displayName: '验收主管', accountStatus: 'DISABLED' }, 'PATCH')).status, 200);
  assert.equal((await request(reportPath, 'supervisor')).status, 403, 'disabled account session revoked');
  assert.equal((await request(`/api/users/${users.supervisor.id}`, 'hr', { accountStatus: 'ACTIVE' }, 'PATCH')).status, 200);
  assert.deepEqual(await db.userAccessGrant.findMany({ where: { userId: users.supervisor.id }, orderBy: { id: 'asc' } }), existingGrants);
  await login('supervisor');
  assert.equal((await request(`/api/users/${users.supervisor.id}/reset-password`, 'hr', { password: resetPassword }, 'POST')).status, 200);
  assert.equal((await request(reportPath, 'supervisor')).status, 403, 'reset revokes the old session');
  assert.equal((await login('supervisor', resetPassword)).mustChangePassword, true);
  assert.equal((await request(reportPath, 'supervisor')).status, 403, 'mandatory password change gates reports');
  assert.equal((await request('/api/auth/change-password', 'supervisor', { currentPassword: resetPassword, newPassword: changedPassword, confirmPassword: changedPassword }, 'POST')).status, 200);
  await login('supervisor', changedPassword);
  assert.equal((await request(reportPath, 'supervisor')).status, 200);
  results.push('HR lists ordinary accounts, enables/disables with session revocation, preserves all grants, resets a password, and forces a real password change; administrator/self/grant/cross-origin bypasses denied');

  const freshEmployee = await employee('QA-1010', '待开通工程员工', engineering);
  const created = await request('/api/users', 'hr', { username: 'qa_access_created', employeeId: freshEmployee.id, displayName: freshEmployee.name, password, mustChangePassword: false }, 'POST');
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.user.mustChangePassword, true);
  assert.equal(created.data.user.accessGrants[0].profileKey, 'DEPARTMENT_FULL');
  const nextEmployee = await employee('QA-1011', '防越权验收员工', production);
  assert.equal((await request('/api/users', 'hr', { username: 'qa_access_escalation', employeeId: nextEmployee.id, profileKey: 'ADMIN_GLOBAL', password }, 'POST')).status, 403);
  results.push('HR opens the employee department base account, cannot suppress first-login password change, and cannot create an administrator');

  const initialTrainee = await db.user.findUniqueOrThrow({ where: { id: users.trainee.id } });
  const migration = await readFile(new URL('../prisma/migrations/202608280003_zhuyanjun_technical_read_access/migration.sql', import.meta.url), 'utf8');
  await db.$executeRawUnsafe(migration);
  const promoted = await db.user.findUniqueOrThrow({ where: { id: users.trainee.id }, include: { accessGrants: true } });
  assert.equal(promoted.passwordHash, initialTrainee.passwordHash);
  assert.equal(promoted.fieldPasswordOnly, true);
  assert.deepEqual(promoted.accessGrants.map(grant => grant.profile).sort(), ['DRAWING_LIBRARY_READER', 'FIELD_REPORTER', 'PRODUCT_TIME_READER']);
  const blocked = await request('/api/auth/login', null, { username: users.trainee.username, password: '123456' }, 'POST');
  assert.equal(blocked.status, 401, 'weak field credential cannot authenticate after workbench promotion');
  assert.equal((await request(`/api/users/${users.trainee.id}/reset-password`, 'hr', { password: resetPassword }, 'POST')).status, 200);
  assert.equal((await login('trainee', resetPassword)).mustChangePassword, true);
  assert.equal((await request('/api/auth/change-password', 'trainee', { currentPassword: resetPassword, newPassword: changedPassword, confirmPassword: changedPassword }, 'POST')).status, 200);
  await login('trainee', changedPassword);

  const item = await db.drawingLibraryItem.create({ data: { customerName: '隔离验收客户', specification: 'HX-2026-A', productName: '验收线束组件', libraryKey: 'qa-access-technical-item' } });
  const definition = await db.processDefinition.create({ data: { code: 'QA-TECH-P01', name: '全自动压接', stageGroup: '前工序' } });
  await db.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: 1, status: 'published', publishedAt: new Date(), entries: { create: { processDefinitionId: definition.id, position: 1, unitMilliseconds: 18000, unitLabel: '套' } } } });
  for (const path of ['/api/drawing-library', `/api/drawing-library/${item.id}`, '/api/product-time-profiles', `/api/product-time-profiles/${item.id}`]) {
    assert.equal((await request(path, 'trainee')).status, 200, path);
    assert.equal((await request(path, 'other')).status, 403, `other trainee must remain denied: ${path}`);
  }
  assert.equal((await request(`/api/product-time-profiles/${item.id}`, 'trainee', {}, 'PUT')).status, 403);
  assert.equal((await request(`/api/product-time-profiles/${item.id}/publish`, 'trainee', {}, 'POST')).status, 403);
  assert.equal((await request(`/api/drawing-library/${item.id}`, 'trainee', { specification: 'FORBIDDEN' }, 'PATCH')).status, 403);
  const category = await db.resourceCategory.create({ data: { name: '隔离验收图纸', code: 'QA-ACCESS-DRAWING', sortOrder: 999 } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1xkAAAAASUVORK5CYII=', 'base64');
  const s3 = new S3Client({ region: 'auto', endpoint: process.env.REPORT_QA_S3_ENDPOINT || 'http://127.0.0.1:19668', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || 'reportqa', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'ReportStorageIsolated2026' } });
  const objectKey = 'qa-access/drawing.png';
  await s3.send(new PutObjectCommand({ Bucket: 'workorder-resources', Key: objectKey, Body: png, ContentType: 'image/png' }));
  const file = await db.drawingLibraryFile.create({ data: { libraryItemId: item.id, categoryId: category.id, originalName: '隔离验收图纸.png', mimeType: 'image/png', size: png.length, objectKey } });
  const download = await fetch(base + `/api/drawing-library/files/${file.id}/download`, { headers: { Cookie: cookies.trainee }, redirect: 'follow' });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  results.push('Unique named trainee receives drawing and product-time read access after safe HR password setup; another trainee remains denied; edits/publication denied; S3 drawing download bytes verified');

  const proof = { ok: true, syntheticFixtures: true, base, database: database.pathname, results,
    users: Object.fromEntries(Object.entries(users).map(([key, user]) => [key, { id: user.id, username: user.username }])),
    employeeIds: { workerA: workerA.id, workerB: workerB.id, trainee: trainee.id }, itemId: item.id,
    report: adminReport.data.report,
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, syntheticFixtures: true, results, evidencePath }, null, 2));
} finally { await db.$disconnect(); }
