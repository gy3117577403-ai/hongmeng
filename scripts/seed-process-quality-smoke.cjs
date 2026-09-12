// Run only in the explicitly disposable acceptance database.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
async function createFixture(db, counts = [36, 60]) {
  if (process.env.PROCESS_QUALITY_QA_ALLOW !== 'disposable-quality-reporting-runtime') throw Error('Disposable quality reporting runtime acknowledgement required');
  const marker = 'PQ-' + randomUUID().slice(0, 8), password = 'Disposable-Quality-2026!Z', users = {}, orders = [];
  const department = await db.department.upsert({ where: { code: 'PRODUCTION' }, create: { code: 'PRODUCTION', name: '生产部' }, update: {} });
  for (const [kind, profile, name] of [['admin', 'ADMIN_GLOBAL', '质量验收管理员'], ['operator', 'FIELD_REPORTER', '报工检验员'], ['other', 'FIELD_REPORTER', '责任测试员工']]) {
    const employee = await db.employee.create({ data: { employeeNo: marker + '-' + kind, name, department: '生产部', departmentId: department.id, isActive: true, attendanceEnabled: true } });
    const user = await db.user.create({ data: { username: marker + '-' + kind, displayName: name, employeeId: employee.id, laborRole: kind === 'admin' ? 'ADMIN' : 'EMPLOYEE',
      passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, accessGrants: { create: { profile, departmentId: department.id,
        scopeKey: kind === 'admin' ? 'GLOBAL:' + marker : 'EMPLOYEE:' + employee.id } } } });
    users[kind] = { id: user.id, name, username: user.username, employeeId: employee.id };
  }
  for (const count of counts) {
    const qualityNames = { 8: '压检（A端）', 16: '导通（A端）', 24: '检验（A端）', 30: '压检（B端）', 32: '导通（B端）', 35: '检验（B端）' };
    const names = Array.from({ length: count }, (_, i) => qualityNames[i + 1] || (i === 0 ? '裁线' : i === count - 1 ? '包装' : ['剥皮', '穿管', '压接', '插入', '装配'][i % 5] + `（${i + 1}）`));
    const defs = [];
    for (const [index, name] of names.entries()) defs.push(await db.processDefinition.create({ data: { code: `${marker}-${count}-${index + 1}`, name, stageGroup: 'backend' } }));
    const item = await db.drawingLibraryItem.create({ data: { libraryKey: `${marker}-${count}`, customerName: '质量联动验收', specification: `HL-${count}-QA`, productName: `${count} 道工序线束` } });
    const profile = await db.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: 1, status: 'published', publishedAt: new Date(),
      createdById: users.admin.id, updatedById: users.admin.id, publishedById: users.admin.id,
      entries: { create: defs.map((d, i) => ({ processDefinitionId: d.id, occurrenceKey: 'step-' + (i + 1), position: i + 1, sequenceGroup: i + 1,
        timeBasis: 'per_unit', unitMilliseconds: 3000, occurrences: 1, unitLabel: '件', reportQuantityBasis: 'product', reportUnitLabel: '件' })) } }, include: { entries: { orderBy: { position: 'asc' } } } });
    const order = await db.workOrder.create({ data: { code: `${marker}-${count}`, customerName: item.customerName, productName: item.productName, specification: item.specification,
      drawingLibraryItemId: item.id, stage: 'backend', status: 'processing', productionTargetQty: 200, uncompletedQty: '200', completedQty: '0', planType: 'managed_plan', planActive: true, startedAt: new Date(),
      qrTicket: { create: { publicCode: randomUUID().replaceAll('-', '') } },
      processRoute: { create: { templateName: `${count} 工序验收路线`, templateVersion: 1, status: 'in_progress', version: 0, reportingPolicy: 'free_sequence', startedAt: new Date(), confirmedAt: new Date(), confirmedById: users.admin.id,
        routeSource: 'product_time_profile', productTimeProfileId: profile.id, productTimeProfileVersion: 1,
        steps: { create: defs.map((d, i) => ({ processDefinitionId: d.id, processCode: d.code, processName: d.name, stageGroup: 'backend', position: i + 1, sequenceGroup: i + 1,
          status: i === 0 ? 'current' : 'pending', inputQty: i === 0 ? 200 : 0, productTimeProfileId: profile.id, productTimeEntryId: profile.entries[i].id, productTimeProfileVersion: 1,
          standardSource: 'product_profile', timeBasis: 'per_unit', standardMillisecondsPerUnit: 3000, unitLabel: '件', unitsPerProduct: 1, countsForEfficiency: true,
          reportQuantityBasis: 'product', reportUnitLabel: '件' })) } } } }, include: { qrTicket: true, processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
    const today = new Date(new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10) + 'T00:00:00Z');
    const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    await db.productionPlanOrder.create({ data: { sourceOrderNo: `${marker}-${count}`, sourceLineNo: 1, drawingLibraryItemId: item.id, customerName: item.customerName, productName: item.productName, specification: item.specification,
      orderQuantity: 200, orderDate: today, customerDueDate: sunday, batches: { create: { batchNo: 1, quantity: 200, weekStartDate: monday, weekEndDate: sunday, plannedCompletionDate: sunday, workOrderId: order.id, releaseState: 'active' } } } });
    orders.push({ id: order.id, routeId: order.processRoute.id, publicCode: order.qrTicket.publicCode, count, specification: order.specification,
      steps: order.processRoute.steps.map(step => ({ id: step.id, position: step.position, name: step.processName })) });
  }
  return { marker, password, users, orders, workDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) };
}
module.exports = { createFixture };
if (require.main === module) {
  const db = new PrismaClient();
  createFixture(db).then(data => console.log(JSON.stringify(data))).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
