import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateEmployeeNumber } from '../lib/employee-number';
import {
  commitEmployeeNumberReorder,
  EmployeeNumberReorderError,
  previewEmployeeNumberReorder,
} from '../lib/employee-number-reorder';
import { prisma } from '../lib/prisma';

const enabled = process.env.RUN_EMPLOYEE_REORDER_INTEGRATION === '1';

test('real PostgreSQL employee renumbering swaps safely, rejects stale previews, preserves identity, and advances future hires', { skip: !enabled }, async () => {
  const prefix = `renumber-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const existingEmployeeCount = await prisma.employee.count();
  assert.equal(existingEmployeeCount, 0, 'integration database must start without employee records');

  let actorId = '';
  let boundUserId = '';
  try {
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-actor`,
        passwordHash: 'integration-only',
        displayName: '编号重排集成测试',
      },
    });
    actorId = actor.id;
    const employeeA = await prisma.employee.create({
      data: { employeeNo: '0001', name: `${prefix}-员工甲`, department: '生产部', position: '操作员', team: '装配' },
    });
    const employeeB = await prisma.employee.create({
      data: { employeeNo: '0002', name: `${prefix}-员工乙`, department: '生产部', position: '班组长', team: '压接' },
    });
    const boundUser = await prisma.user.create({
      data: {
        username: `${prefix}-bound`,
        passwordHash: 'integration-only',
        displayName: '员工甲账号',
        employeeId: employeeA.id,
      },
    });
    boundUserId = boundUser.id;

    await prisma.employeeNumberSequence.upsert({
      where: { key: 'employee' },
      create: { key: 'employee', nextValue: 3 },
      update: { nextValue: 3 },
    });

    const items = [
      { kind: 'EXISTING', employeeId: employeeB.id },
      { kind: 'NEW', clientKey: `${prefix}-new`, name: `${prefix}-员工丙`, department: '工程部', position: '工程师', team: '工程' },
      { kind: 'EXISTING', employeeId: employeeA.id },
    ];
    const stalePreview = await previewEmployeeNumberReorder(items);
    await prisma.employee.update({ where: { id: employeeA.id }, data: { name: `${prefix}-员工甲修订` } });
    await assert.rejects(
      () => commitEmployeeNumberReorder({
        actorUserId: actor.id,
        idempotencyKey: `${prefix}-stale`,
        items,
        rosterFingerprint: stalePreview.rosterFingerprint,
        confirmationText: stalePreview.confirmationText,
      }),
      (error: unknown) => error instanceof EmployeeNumberReorderError
        && error.code === 'EMPLOYEE_REORDER_STALE_PREVIEW',
    );
    assert.deepEqual(
      (await prisma.employee.findMany({ orderBy: { employeeNo: 'asc' }, select: { employeeNo: true } })).map(item => item.employeeNo),
      ['0001', '0002'],
    );

    const preview = await previewEmployeeNumberReorder(items);
    const committed = await commitEmployeeNumberReorder({
      actorUserId: actor.id,
      idempotencyKey: `${prefix}-commit`,
      items,
      rosterFingerprint: preview.rosterFingerprint,
      confirmationText: preview.confirmationText,
    });
    assert.equal(committed.replayed, false);
    assert.deepEqual(committed.batch.items.map(item => [item.name, item.oldEmployeeNo, item.newEmployeeNo]), [
      [`${prefix}-员工乙`, '0002', '0001'],
      [`${prefix}-员工丙`, null, '0002'],
      [`${prefix}-员工甲修订`, '0001', '0003'],
    ]);
    assert.equal((await prisma.user.findUnique({ where: { id: boundUser.id } }))?.employeeId, employeeA.id);
    assert.equal((await prisma.employeeNumberSequence.findUnique({ where: { key: 'employee' } }))?.nextValue, 4);

    const replay = await commitEmployeeNumberReorder({
      actorUserId: actor.id,
      idempotencyKey: `${prefix}-commit`,
      items,
      rosterFingerprint: preview.rosterFingerprint,
      confirmationText: preview.confirmationText,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.batch.id, committed.batch.id);

    const nextEmployee = await prisma.$transaction(async tx => {
      const employeeNo = await allocateEmployeeNumber(tx);
      return tx.employee.create({ data: { employeeNo, name: `${prefix}-后续入职员工` } });
    });
    assert.equal(nextEmployee.employeeNo, '0004');
    assert.equal((await prisma.employeeNumberSequence.findUnique({ where: { key: 'employee' } }))?.nextValue, 5);
  } finally {
    await prisma.operationLog.deleteMany({ where: { targetType: 'employee_number_reorder_batch' } });
    await prisma.employeeNumberReorderBatch.deleteMany();
    if (boundUserId) await prisma.user.deleteMany({ where: { id: boundUserId } });
    await prisma.employee.deleteMany({ where: { name: { startsWith: prefix } } });
    if (actorId) await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.employeeNumberSequence.upsert({
      where: { key: 'employee' },
      create: { key: 'employee', nextValue: 1 },
      update: { nextValue: 1 },
    });
  }
});
