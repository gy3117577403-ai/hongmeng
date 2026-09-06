// Only run in a disposable acceptance database. No messages are sent by this seed.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
if (process.env.QUALITY_WORKBENCH_QA_ALLOW !== 'disposable-quality-runtime') throw Error('Disposable runtime guard required');
const db = new PrismaClient();
async function main() {
  const marker = 'qv4-' + randomUUID().slice(0, 8), password = 'Workbench-Smoke-2026!Z', users = {};
  const processDepartment = await db.department.upsert({ where: { code: 'PROCESS' }, update: {}, create: { code: 'PROCESS', name: '工艺部' } });
  for (const [kind, name, profile] of [['admin', '质量管理验收', 'ADMIN_GLOBAL'], ['lead', '工艺牵头验收', 'PROCESS_SPECIALIST'], ['worker', '现场责任验收', 'PROCESS_SPECIALIST'], ['reviewer', '独立品质验收', 'QUALITY_REVIEWER'], ['employee', '普通员工验收', 'FIELD_REPORTER']]) {
    const departmentId = profile === 'PROCESS_SPECIALIST' ? processDepartment.id : undefined;
    const employee = await db.employee.create({ data: { employeeNo: marker + '-' + kind, name, department: profile === 'PROCESS_SPECIALIST' ? '工艺部' : '品质部', departmentId } });
    const user = await db.user.create({ data: { username: marker + '-' + kind, displayName: name, employeeId: kind === 'admin' ? null : employee.id, passwordHash: await bcrypt.hash(password, 10), laborRole: kind === 'admin' ? 'ADMIN' : 'EMPLOYEE', mustChangePassword: false, isActive: true, accountStatus: 'ACTIVE', accessGrants: { create: { profile, scopeKey: departmentId || 'GLOBAL', departmentId } } } });
    users[kind] = { id: user.id, username: user.username, name };
  }
  const product = await db.drawingLibraryItem.create({ data: { customerName: '隔离验收客户', productName: '连接线束', specification: marker + '-HL2609', libraryKey: marker } });
  const order = await db.workOrder.create({ data: { code: marker + '-WO', productName: product.productName, specification: product.specification, customerName: product.customerName, drawingLibraryItemId: product.id, stage: 'frontend', qrTicket: { create: { publicCode: randomUUID().replaceAll('-', '') } } }, include: { qrTicket: true } });
  return { marker, password, users, product: { id: product.id, specification: product.specification }, order: { id: order.id, code: order.code, publicCode: order.qrTicket.publicCode } };
}
main().then(data => console.log(JSON.stringify(data))).finally(() => db.$disconnect());
