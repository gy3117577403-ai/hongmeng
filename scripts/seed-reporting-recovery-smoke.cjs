// Disposable acceptance fixture only. Never connects to a production database implicitly.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
if (process.env.REPORT_RECOVERY_QA_ALLOW !== 'disposable-reporting-runtime') throw Error('Disposable reporting runtime acknowledgement required');
const db = new PrismaClient();
async function main() {
  const marker = 'QA-RECOVERY-' + randomUUID().slice(0, 8), password = 'Disposable-Reporting-2026!Z', users = {};
  const production = await db.department.upsert({ where: { code: 'PRODUCTION' }, update: {}, create: { code: 'PRODUCTION', name: '生产部' } });
  const processDepartment = await db.department.upsert({ where: { code: 'PROCESS' }, update: {}, create: { code: 'PROCESS', name: '工艺部' } });
  for (const [kind, name, profile] of [['admin', '报工验收管理员', 'ADMIN_GLOBAL'], ['handler', '报工工艺处理人', 'PROCESS_SPECIALIST'], ['operator', '现场报工验收员', 'FIELD_REPORTER'], ['other', '无关报工验收员', 'FIELD_REPORTER']]) {
    const department = kind === 'handler' ? processDepartment : production;
    const employee = await db.employee.create({ data: { employeeNo: marker + '-' + kind, name, department: department.name, departmentId: department.id, isActive: true, attendanceEnabled: true } });
    const user = await db.user.create({ data: { username: marker + '-' + kind, displayName: name, employeeId: employee.id,
      passwordHash: await bcrypt.hash(password, 10), laborRole: kind === 'admin' ? 'ADMIN' : 'EMPLOYEE', mustChangePassword: false,
      accessGrants: { create: { profile, departmentId: department.id, scopeKey: kind === 'operator' || kind === 'other' ? 'EMPLOYEE:' + employee.id : 'GLOBAL:' + marker } } } });
    users[kind] = { id: user.id, username: user.username, employeeId: employee.id, name };
  }
  const definition = await db.processDefinition.create({ data: { code: marker + '-INSERT', name: '插入', stageGroup: 'backend' } });
  const orders = {};
  for (const kind of ['http', 'browser', 'draft', 'missing']) {
    const item = await db.drawingLibraryItem.create({ data: { customerName: '报工隔离验收客户', productName: '机臂灯线束', specification: marker + '-' + kind, libraryKey: marker + '-' + kind } });
    const profile = await db.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: 6, status: 'published', publishedAt: new Date(), createdById: users.handler.id, updatedById: users.handler.id, publishedById: users.handler.id,
      entries: { create: { processDefinitionId: definition.id, occurrenceKey: 'insert-occurrence', position: 1, sequenceGroup: 1,
        timeBasis: 'per_unit', unitMilliseconds: 15000, occurrences: 1, unitLabel: '套', reportQuantityBasis: 'product', reportUnitLabel: '套' } } }, include: { entries: true } });
    const order = await db.workOrder.create({ data: { code: marker + '-' + kind, productName: item.productName, specification: item.specification, customerName: item.customerName,
      drawingLibraryItemId: item.id, stage: 'backend', status: 'processing', productionTargetQty: 40, uncompletedQty: '40', completedQty: '0', planActive: true, planType: 'managed_plan', startedAt: new Date(),
      qrTicket: { create: { publicCode: randomUUID().replaceAll('-', '') } },
      processRoute: { create: { templateName: marker, templateVersion: 6, status: 'in_progress', version: 0, startedAt: new Date(), confirmedAt: new Date(), confirmedById: users.handler.id,
        routeSource: 'product_time_profile', productTimeProfileId: profile.id, productTimeProfileVersion: 6,
        steps: { create: { processDefinitionId: definition.id, processCode: definition.code, processName: definition.name, stageGroup: 'backend', position: 1, sequenceGroup: 1, status: 'current', inputQty: 40,
          productTimeProfileId: profile.id, productTimeEntryId: profile.entries[0].id, productTimeProfileVersion: 6,
          standardSource: kind === 'missing' ? 'pending_standard' : 'product_profile', timeBasis: kind === 'missing' ? null : 'per_unit', standardMillisecondsPerUnit: kind === 'missing' ? null : 15000,
          unitsPerProduct: 1, unitLabel: '套', reportQuantityBasis: kind === 'missing' ? 'product' : 'action', reportUnitLabel: '套' } } } } }, include: { qrTicket: true, processRoute: { include: { steps: true } } } });
    orders[kind] = { id: order.id, code: order.code, routeId: order.processRoute.id, stepId: order.processRoute.steps[0].id, publicCode: order.qrTicket.publicCode, version: 0, profileVersion: 6, entryId: profile.entries[0].id };
  }
  return { marker, password, users, orders, workDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) };
}
main().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
