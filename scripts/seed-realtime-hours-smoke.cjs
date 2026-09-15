const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
async function createFixture(db) {
  if (process.env.REALTIME_HOURS_QA_ALLOW !== 'disposable-realtime-hours-runtime') throw Error('Disposable runtime acknowledgement required');
  const marker = `RTH-${randomUUID().slice(0, 8)}`;
  const password = 'DisposableHours2026!A';
  const now = new Date();
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const day = new Date(`${today}T00:00:00+08:00`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 1) % 7) * 86400000);
  // Use the Shanghai calendar date, not the UTC weekday of Shanghai midnight.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = new Date(day.getTime() - ((weekday + 6) % 7) * 86400000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000 - 1);
  const department = await db.department.upsert({ where: { code: 'PRODUCTION' }, create: { code: 'PRODUCTION', name: '生产部' }, update: {} });
  const team = await db.productionTeam.create({ data: { code: marker, name: `实时工时验收 ${marker}` } });
  const employees = [];
  for (let i = 0; i < 2; i++) {
    const employee = await db.employee.create({ data: { employeeNo: `${marker}-${i}`, name: i ? '陈师傅' : '王师傅',
      department: '生产部', departmentId: department.id, team: team.name, isActive: true, attendanceEnabled: true,
      hireDate: new Date('2026-01-01'), attainmentEligible: true, attainmentStream: 'batch' } });
    await db.attendanceRecord.create({ data: { employeeId: employee.id, workDate: new Date(`${today}T00:00:00Z`),
      status: 'confirmed', attendanceType: 'normal', actualMilliseconds: 8 * 3600000, plannedMilliseconds: 8 * 3600000,
      segments: [], departmentSnapshot: '生产部', teamSnapshot: team.name, attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'batch' } });
    employees.push({ id: employee.id, name: employee.name, employeeNo: employee.employeeNo });
  }
  const actor = await db.user.create({ data: { username: `${marker}-admin`, displayName: '实时工时验收管理',
    passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, laborRole: 'ADMIN',
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', departmentId: department.id, scopeKey: 'GLOBAL' } } } });
  const reviewer = await db.user.create({ data: { username: `${marker}-reviewer`, displayName: '工时核对员',
    passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, laborRole: 'ADMIN',
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', departmentId: department.id, scopeKey: 'GLOBAL' } } } });
  const category = await db.otherWorkTimeCategory.create({ data: { id: `${marker}-category`, code: marker, name: `设备整理 ${marker}`, sortOrder: 999 } });
  const orders = [];
  for (let index = 0; index < 3; index++) {
    const order = await db.workOrder.create({ data: { code: `${marker}-${index}`, businessCode: `${marker}-${index}`,
      productName: ['控制器线束', '半成品续作线束', '多人协作线束'][index], specification: `RTH-0${index + 1}`, customerName: '工时验收客户',
      planType: 'managed_plan', planActive: true, stage: 'frontend', status: 'processing', productionTargetQty: 10,
      uncompletedQty: '10', completedQty: '0', startedAt: now, weekStartDate: weekStart, weekEndDate: weekEnd,
      processRoute: { create: { templateName: '实时工时验收路线', templateVersion: 1, status: 'in_progress', version: 0,
        routeSource: 'process_template', reportingPolicy: 'free_sequence', confirmedAt: now, confirmedById: actor.id, startedAt: now,
        steps: { create: [0, 1].map(i => ({ processCode: `${marker}-${index}-S${i}`, processName: i ? '组装检验' : '裁线压接',
          stageGroup: i ? 'backend' : 'frontend', position: i + 1, sequenceGroup: i + 1, status: i ? 'pending' : 'current',
          inputQty: i ? 0 : 10, standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '件',
          standardMillisecondsPerUnit: i ? 720000 : 360000, unitsPerProduct: 1, countsForEfficiency: i !== 0 })) } } },
    }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
    const plan = await db.productionPlanOrder.create({ data: { sourceOrderNo: order.code, sourceLineNo: 1,
      customerName: order.customerName, productName: order.productName, specification: order.specification, orderQuantity: 10,
      orderDate: day, customerDueDate: weekEnd, batches: { create: { batchNo: 1, quantity: 10, workOrderId: order.id,
        releaseState: 'active', weekStartDate: weekStart, weekEndDate: weekEnd, plannedCompletionDate: weekEnd } } }, include: { batches: true } });
    orders.push({ id: order.id, code: order.code, routeId: order.processRoute.id, steps: order.processRoute.steps.map(step => step.id), batchId: plan.batches[0].id });
  }
  return { marker, password, actor: { id: actor.id, username: actor.username }, reviewer: { id: reviewer.id, username: reviewer.username },
    employees, orders, categoryId: category.id, date: today, weekStart: new Date(weekStart.getTime() + 8 * 3600000).toISOString().slice(0, 10), team: team.name };
}
module.exports = { createFixture };
if (require.main === module || module.id === '[stdin]') {
  const db = new PrismaClient();
  createFixture(db).then(data => console.log(JSON.stringify(data))).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
}
