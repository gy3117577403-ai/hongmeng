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
    ['dispatcher', '物料协调员', 'MATERIAL_FOLLOW_UP_OPERATOR', departments.PROCUREMENT],
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
  const visual = {};
  const visualPrefix = 'material-visual-' + randomUUID().slice(0, 8);
  for (let index = 0; index < 12; index++) {
    const oldWeek = index === 1 ? new Date(week.start.getTime() - 14 * 86400000) : week.start;
    const visualOrder = await db.workOrder.create({ data: {
      code: visualPrefix + '-' + index, productName: index === 0 ? 'KTP4503 控制箱航插线 · 单弯头' : '线束物料协同验收',
      specification: index === 0 ? 'D014503-8301-V02' : 'D011601-' + (8412 + index) + '-V01',
      customerName: index % 2 ? '上海易矩' : '杭州昆泰', productionTargetQty: 20 + index * 5,
      stage: 'not_issued', planType: 'weekly_plan', planActive: true,
      weekStartDate: oldWeek, weekEndDate: new Date(oldWeek.getTime() + 6 * 86400000),
    } });
    const visualTask = await db.warehouseMaterialTask.create({ data: {
      workOrderId: visualOrder.id, status: 'exception', exceptionType: 'shortage',
      exceptionNote: '物料未齐，逐项跟进并核实',
    } });
    for (let item = 0; item < (index === 0 ? 3 : 1); item++) {
      const state = item === 1 ? 'WAITING_WAREHOUSE' : (index === 2 ? 'PENDING' : 'WAITING_ARRIVAL');
      const model = item === 0 ? 'DJ7061Y-89直扣' : item === 1 ? '132036-111国产尾夹' : 'LM-12-J12SX-03-401';
      const note = item === 1 ? '已报到料十件，等待仓库清点型号与数量。' : '供方确认今日发出，剩余物料继续跟进。';
      const expectedAt = new Date(Date.now() + (index === 1 ? -2 : 2) * 86400000);
      const exception = await db.warehouseMaterialExceptionCase.create({ data: {
        warehouseTaskId: visualTask.id, sequence: item + 1, exceptionType: 'shortage',
        exceptionNote: index === 2 ? '航插 客供缺' : item === 0 ? '连接器外壳尚未配齐' : '本次配料发现缺少附件',
        materialModel: index === 2 ? null : model, supplySource: index === 2 ? 'UNKNOWN' : item === 1 || index % 2 ? 'CUSTOMER' : 'PURCHASED',
        shortageQuantity: index === 2 ? null : 10, receivedQuantity: state === 'WAITING_WAREHOUSE' ? 10 : 3,
        unit: '个', expectedArrivalAt: expectedAt, reportedById: users.warehouse.id,
        weekStartDate: oldWeek, weekEndDate: new Date(oldWeek.getTime() + 6 * 86400000),
      } });
      const follow = await db.materialFollowUpTask.create({ data: {
        warehouseTaskId: visualTask.id, warehouseExceptionId: exception.id,
        status: state, ownerId: index === 2 ? null : users.operator.id,
        latestProgress: note, lastFollowedAt: new Date(), expectedAt,
        activities: { create: { action: 'note', content: note, actorId: users.operator.id } },
      } });
      if(index === 2) visual.pendingId = follow.id;
      if(index === 0 && item === 0) Object.assign(visual, {
        marker: visualPrefix,
        warehouseTaskId: visualTask.id, specification: visualOrder.specification,
        followUpId: follow.id, materialModel: model,
      });
    }
  }
  return {
    marker, password, users,
    workOrder: { id: workOrder.id, code: workOrder.code, specification },
    warehouseTaskId: warehouseTask.id,
    visual,
  };
}

main().then(fixture => console.log(JSON.stringify(fixture)))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
