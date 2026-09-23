// Disposable release acceptance only. Never run against a shared or production database.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');

if (process.env.MATERIAL_COLLAB_QA_ALLOW !== 'disposable-material-runtime') {
  throw new Error('Disposable material collaboration runtime guard required');
}
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['localhost', '127.0.0.1'].includes(database.hostname)
  || !/(_ci|_test)$/.test(database.pathname.slice(1))) {
  throw new Error('Material collaboration fixture requires a local disposable CI/test database');
}
const db = new PrismaClient();

function currentProductionWeek() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = key => Number(parts.find(item => item.type === key).value);
  const day = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const distance = day.getUTCDay() === 0 ? -6 : 1 - day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + distance);
  const end = new Date(day); end.setUTCDate(end.getUTCDate() + 6);
  return { start: day, end };
}

async function main() {
  const marker = 'mat-collab-' + randomUUID().slice(0, 8);
  const password = 'Disposable-Material-2026!A';
  const departments = {
    WAREHOUSE: await db.department.upsert({ where: { code: 'WAREHOUSE' }, update: {}, create: { code: 'WAREHOUSE', name: '仓库' } }),
    PROCUREMENT: await db.department.upsert({ where: { code: 'PROCUREMENT' }, update: {}, create: { code: 'PROCUREMENT', name: '采购' } }),
  };
  const users = {};
  for (const [key, displayName, profile, department] of [
    ['warehouse', '仓库验收员', 'DEPARTMENT_FULL', departments.WAREHOUSE],
    ['operator', '采购跟进员', 'MATERIAL_FOLLOW_UP_OPERATOR', departments.PROCUREMENT],
    ['ordinary', '普通协同员', 'FIELD_REPORTER', null],
  ]) {
    const employee = key === 'ordinary' ? await db.employee.create({ data: {
      employeeNo: `${marker}-ordinary-employee`, name: displayName, department: '生产部',
    } }) : null;
    const user = await db.user.create({ data: {
      username: `${marker}-${key}`, displayName,
      employeeId: employee?.id,
      passwordHash: await bcrypt.hash(password, 10), laborRole: 'EMPLOYEE',
      mustChangePassword: false, isActive: true, accountStatus: 'ACTIVE',
      accessGrants: { create: { profile, scopeKey: department?.id || `EMPLOYEE:${employee.id}`, departmentId: department?.id } },
    } });
    users[key] = { id: user.id, username: user.username, displayName };
  }
  const week = currentProductionWeek();
  const specification = `${marker}-连接线束`;
  const workOrder = await db.workOrder.create({ data: {
    code: `${marker}-WO`, productName: '隔离验收连接线束', specification,
    customerName: '杭连采购验收客户', stage: 'not_issued',
    productionTargetQty: 12, planType: 'weekly_plan', planActive: true,
    weekStartDate: week.start, weekEndDate: week.end,
  } });
  const warehouseTask = await db.warehouseMaterialTask.create({ data: { workOrderId: workOrder.id } });
  return {
    marker, password, users,
    workOrder: { id: workOrder.id, code: workOrder.code, specification },
    warehouseTaskId: warehouseTask.id,
  };
}

main().then(fixture => console.log(JSON.stringify(fixture)))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
