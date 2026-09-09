import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

async function main() {
  const db = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.port !== '55448' || !['/hongmeng_attainment_transfer_v134150', '/hongmeng_attainment_transfer_v134150_release'].includes(db.pathname)) throw Error('Only isolated transfer QA databases are allowed');
  const password = process.env.OTHER_HOURS_QA_PASSWORD;
  if (!password) throw Error('Private QA password required');
  const marker = 'TRANSFER-' + randomUUID().slice(0, 7), hash = await bcrypt.hash(password, 10), h = 3600000;
  const oldTeam = await prisma.productionTeam.create({ data: { name: '样品验收组 ' + marker, code: marker + '-sample' } });
  const newTeam = await prisma.productionTeam.create({ data: { name: '装配验收组 ' + marker, code: marker + '-batch' } });
  const users = [];
  for (const [suffix, profile, scopeKey, laborRole] of [['employee', 'FIELD_REPORTER', 'SELF', 'EMPLOYEE'], ['admin', 'ADMIN_GLOBAL', 'GLOBAL', 'ADMIN'], ['lead', 'WORKSHOP_TEAM_LEADER', 'TEAM:' + newTeam.id, 'EMPLOYEE']] as const) {
    const employee = await prisma.employee.create({ data: { employeeNo: marker + '-' + suffix, name: suffix === 'employee' ? '调岗验收员工' : suffix === 'admin' ? '调岗验收管理员' : '调岗验收组长',
      department: '生产部', team: oldTeam.name, hireDate: new Date('2026-07-01T00:00:00Z'), attendanceGroup: 'SAMPLE', attainmentStream: 'sample' } });
    const user = await prisma.user.create({ data: { username: employee.employeeNo, displayName: employee.name, passwordHash: hash, employeeId: employee.id, laborRole,
      accessGrants: { create: { profile, scopeKey, grantType: 'PRIMARY' } } } });
    users.push({ username: user.username, userId: user.id, employeeId: employee.id });
  }
  const employeeId = users[0].employeeId;
  const order = await prisma.workOrder.create({ data: { code: marker, productName: '调岗隔离验收产品', stage: 'backend', processRoute: { create: { templateName: marker, templateVersion: 1,
    steps: { create: { processCode: marker, processName: '装配', stageGroup: 'backend', position: 1 } } } } }, include: { processRoute: { include: { steps: true } } } });
  for (const day of ['2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03', '2026-09-09']) {
    await prisma.attendanceRecord.create({ data: { employeeId, workDate: new Date(day + 'T00:00:00Z'), status: 'confirmed', attendanceType: 'normal',
      actualMilliseconds: 10.5 * h, overtimeMilliseconds: 2.5 * h, plannedMilliseconds: 8 * h,
      departmentSnapshot: '生产部', teamSnapshot: oldTeam.name, attendanceGroupSnapshot: 'SAMPLE', attainmentStreamSnapshot: 'sample', attainmentEligibleSnapshot: true,
      attainmentPolicyOverride: day === '2026-08-03', attainmentPolicyReason: day === '2026-08-03' ? '当天临时回样品组' : null,
      segments: [{type:'regular',startedAt:day+'T08:00:00+08:00',endedAt:day+'T12:00:00+08:00'},{type:'regular',startedAt:day+'T13:00:00+08:00',endedAt:day+'T17:00:00+08:00'},{type:'overtime',startedAt:day+'T18:00:00+08:00',endedAt:day+'T20:30:00+08:00'}] } });
    await prisma.processExecution.create({ data: { employeeId, stepId: order.processRoute!.steps[0].id, startedAt: new Date(day + 'T08:00:00+08:00'), endedAt: new Date(day + 'T15:18:36+08:00'),
      unitLabel: '件', standardMillisecondsPerUnit: 360000, goodQty: 73.1, standardLaborMilliseconds: 7.31 * h, actualLaborMilliseconds: 7.31 * h, attainmentBasisPoints: 10000 } });
    await prisma.abnormalTimeEvent.create({ data: { workDate: new Date(day + 'T00:00:00Z'), category: 'equipment_tooling', title: marker, qualityStatus: 'confirmed', employeeExempt: true,
      durationMilliseconds: .5 * h, allocations: { create: { employeeId, workDate: new Date(day + 'T00:00:00Z'), durationMilliseconds: .5 * h } } } });
  }
  writeFileSync('.docker/transfer-fixture.json', JSON.stringify({ marker, password, users, oldTeam, newTeam, workOrderId: order.id }, null, 2));
  console.log('Created isolated transfer fixture ' + marker);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
