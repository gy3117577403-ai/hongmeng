// Only run in a disposable acceptance database. No messages are sent by this seed.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID, createHash } = require('node:crypto');
if (process.env.QUALITY_WORKBENCH_QA_ALLOW !== 'disposable-quality-runtime') throw Error('Disposable runtime guard required');
const db = new PrismaClient();
async function main() {
  const marker = 'qv4-' + randomUUID().slice(0, 8), password = 'Workbench-Smoke-2026!Z', users = {};
  const processDepartment = await db.department.upsert({ where: { code: 'PROCESS' }, update: {}, create: { code: 'PROCESS', name: '工艺部' } });
  for (const [kind, name, profile] of [['admin', '质量管理验收', 'ADMIN_GLOBAL'], ['lead', '工艺责任验收', 'PROCESS_SPECIALIST'], ['worker', '现场责任验收', 'PROCESS_SPECIALIST'], ['reviewer', '独立品质验收', 'QUALITY_REVIEWER'], ['employee', '普通员工验收', 'FIELD_REPORTER']]) {
    const departmentId = profile === 'PROCESS_SPECIALIST' ? processDepartment.id : undefined;
    const employee = await db.employee.create({ data: { employeeNo: marker + '-' + kind, name, department: profile === 'PROCESS_SPECIALIST' ? '工艺部' : '品质部', departmentId } });
    const user = await db.user.create({ data: { username: marker + '-' + kind, displayName: name, employeeId: kind === 'admin' ? null : employee.id, passwordHash: await bcrypt.hash(password, 10), laborRole: kind === 'admin' ? 'ADMIN' : 'EMPLOYEE', mustChangePassword: false, isActive: true, accountStatus: 'ACTIVE', accessGrants: { create: { profile, scopeKey: departmentId || 'GLOBAL', departmentId } } } });
    users[kind] = { id: user.id, username: user.username, name };
  }
  // Keep the target beyond the initially displayed 60 rows in every runtime.
  // Browser acceptance must use the same product search a real operator uses.
  await db.drawingLibraryItem.createMany({ data: Array.from({ length: 65 }, (_, index) => ({
    customerName: '000-' + marker, productName: '检索范围验收',
    specification: marker + '-SEARCH-' + String(index).padStart(3, '0'), libraryKey: marker + '-search-' + index,
  })) });
  const product = await db.drawingLibraryItem.create({ data: { customerName: '隔离验收客户', productName: '连接线束', specification: marker + '-HL2609', libraryKey: marker } });
  const order = await db.workOrder.create({ data: { code: marker + '-WO', productName: product.productName, specification: product.specification, customerName: product.customerName, drawingLibraryItemId: product.id, stage: 'frontend', processRoute: { create: { templateName: '质量来源验收工艺', templateVersion: 1, status: 'in_progress', steps: { create: { position: 1, sequenceGroup: 1, processCode: 'QV-FIRST', processName: '首件检验', stageGroup: 'frontend', standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '套', standardMillisecondsPerUnit: 1000, inputQty: 1, status: 'current' } } } }, qrTicket: { create: { publicCode: randomUUID().replaceAll('-', '') } } }, include: { qrTicket: true, processRoute: { include: { steps: true } } } });
  const operator = await db.employee.create({ data: { employeeNo: marker + '-operator', name: '现场作业验收', department: '生产部', team: '装配' } });
  // Historical FIRST records retain their source after date-only uploads replace
  // the old creation flow. Seed an existing record, then verify it through HTTP.
  const firstStep = order.processRoute.steps[0];
  const legacyFirst = await db.qualityDataRecord.create({ data: {
    code: marker + '-LEGACY-FIRST', workOrderId: order.id, inspectionStepId: firstStep.id,
    inspectionStepSnapshot: { id: firstStep.id, name: firstStep.processName, position: firstStep.position, routeId: order.processRoute.id },
    type: 'FIRST', title: '包胶首件检验记录（历史资料）', inspectedAt: new Date(), status: 'SUBMITTED', result: 'FAIL', submittedAt: new Date(),
    data: { mode: 'FORM', context: { processName: '首件检验', inspectedBy: '质量验收' }, summary: '隔离验收：图纸无需包胶，作业指导书标注需要包胶。', rows: [{ sample: '01', position: '', item: '图纸要求', standard: '', lower: '', upper: '', value: '标注冲突', unit: '', result: 'FAIL', note: '包胶标注冲突' }] },
    orderSnapshot: { id: order.id, code: order.code, businessCode: null, sourceOrderNo: null, customerName: product.customerName, productName: product.productName, specification: product.specification, orderDate: null, stage: 'frontend', quantity: 1, planOrderId: null, batchId: null, batchNo: null, sourceLineNo: null, rootWorkOrderId: null, parentWorkOrderId: null, steps: [{ id: firstStep.id, name: firstStep.processName, position: firstStep.position, routeId: order.processRoute.id }] },
    searchText: marker + ' 包胶首件检验记录 历史资料', createdById: users.admin.id, createdByName: users.admin.name, updatedById: users.admin.id,
    sourceQrCode: order.qrTicket.publicCode, idempotencyKey: randomUUID(), requestHash: createHash('sha256').update(marker + '-legacy-first').digest('hex'),
  } });
  return { marker, password, users, legacyFirstId: legacyFirst.id, operator: { id: operator.id, name: operator.name, employeeNo: operator.employeeNo }, product: { id: product.id, specification: product.specification }, order: { id: order.id, code: order.code, publicCode: order.qrTicket.publicCode, firstStepId: firstStep.id } };
}
main().then(data => console.log(JSON.stringify(data))).finally(() => db.$disconnect());
