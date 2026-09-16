const { PrismaClient } = require('@prisma/client');
const { createFixture } = require('./seed-realtime-hours-smoke.cjs');
async function seed(db) {
  if (process.env.WORKLOAD_QA_ALLOW !== 'disposable-workload-runtime') throw Error('Disposable runtime acknowledgement required');
  process.env.REALTIME_HOURS_QA_ALLOW = 'disposable-realtime-hours-runtime';
  const fixture = await createFixture(db);
  await db.attendanceRecord.deleteMany({ where: { employeeId: { in: fixture.employees.map(e => e.id) } } });
  const excluded = [];
  for (const [position, stream] of [['样品制作', 'sample'], ['组长', 'batch'], ['生产主管', 'batch']]) {
    excluded.push(await db.employee.create({ data: { employeeNo: `${fixture.marker}-${excluded.length + 2}`,
      name: position, department: '生产部', team: fixture.team, position, attainmentStream: stream,
      hireDate: new Date('2026-01-01'), isActive: true } }));
  }
  const source = new Date(`${fixture.weekStart}T00:00:00+08:00`); source.setUTCDate(source.getUTCDate() - 7);
  const target = new Date(`${fixture.weekStart}T00:00:00+08:00`);
  await db.productionPlanBatch.update({ where: { id: fixture.orders[2].batchId }, data: { weekStartDate: source } });
  await db.workOrder.update({ where: { id: fixture.orders[2].id }, data: { weekStartDate: source } });
  await db.productionCarryover.create({ data: { productionPlanBatchId: fixture.orders[2].batchId, workOrderId: fixture.orders[2].id,
    sourceWeekStartDate: source, targetWeekStartDate: target, inclusionType: 'MANUAL', status: 'ACTIVE' } });
  return { ...fixture, excludedIds: excluded.map(e => e.id), previousDate: new Date(source.getTime() + 8 * 3600000).toISOString().slice(0, 10) };
}
module.exports = { seed };
if (require.main === module) { const db = new PrismaClient(); seed(db).then(x => console.log(JSON.stringify(x))).catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect()); }
