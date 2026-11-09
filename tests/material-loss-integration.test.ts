import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { materialLossAccess } from '../lib/material-loss-access';
import { getMaterialLoss, listMaterialLoss, mutateMaterialLoss, type MaterialLossDTO } from '../lib/material-loss-service';
import { mutateMaterialOrder, readMaterialOrder } from '../lib/material-order-service';

test('loss workflow isolates permissions, quantities, corrections, replenishment, notifications and existing ledgers', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const db = new URL(process.env.DATABASE_URL!); assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && /_test$|_ci$/.test(db.pathname));
  const tag = 'LOSS-' + randomUUID().slice(0, 8), users: string[] = [], losses: string[] = [];
  async function user(name: string, keys: Array<[string, string]>) {
    const u = await prisma.user.create({ data: { username: tag + name, displayName: name, passwordHash: 'not-for-login', accessGrants: { create: [{ profile: 'MODULE_ACCESS', scopeKey: 'MODULES:ON' }, ...keys.map(([k, l]) => ({ profile: 'MODULE_ACCESS' as const, scopeKey: `MODULE:${k}:${l}` }))] } } }); users.push(u.id); return u.id;
  }
  const reporter = await user('仓库申报', [['material-loss-report', 'COLLABORATE']]);
  const reviewer = await user('审批', [['material-loss-approval', 'COLLABORATE']]);
  const readOnly = await user('只读', [['material-loss-report', 'READ']]);
  const both = await user('双权限', [['material-loss-report', 'COLLABORATE'], ['material-loss-approval', 'COLLABORATE']]);
  const work = await prisma.workOrder.create({ data: { code: tag, productName: '损耗验收', stage: 'frontend', specification: 'T10', customerName: '测试客户' } });
  const warehouse = await prisma.warehouseMaterialTask.create({ data: { workOrderId: work.id } });
  const baseline = await Promise.all([prisma.processCompletion.count(), prisma.otherWorkTimeRequest.count(), prisma.pcPayment.count(), prisma.pcStockBalance.findMany({ orderBy: { id: 'asc' } }), prisma.pcStockMovement.count()]);
  const data = { warehouseTaskId: warehouse.id, materialName: '连接器', materialModel: 'T10-端子', quantity: '3.25', unit: '个', supplySource: 'PURCHASED', occurredOn: '2026-10-29', category: '工艺调试', reason: '调机压接时 3.25 个计量单位报损，现场留存照片', affectsKitting: true, needReplenishment: true, replenishmentQuantity: '4', expectedOn: '2026-11-20' };
  async function create(actor = reporter, overrides = {}) { const row = await mutateMaterialLoss(actor, { action: 'create', requestKey: randomUUID(), ...data, ...overrides }); losses.push(row.id); return row; }
  async function change(row: MaterialLossDTO, action: string, actor = reporter, extra = {}) { return mutateMaterialLoss(actor, { action, version: row.version, requestKey: randomUUID(), ...extra }, row.id); }
  try {
    await t.test('read-only and approval-only cannot submit, drafts private, report-only cannot approve', async () => {
      await assert.rejects(create(readOnly), /独立权限/); await assert.rejects(create(reviewer), /独立权限/);
      const row = await create();
      await assert.rejects(getMaterialLoss(row.id, both), /不可查看/);
      await assert.rejects(change(row, 'approve'), /独立权限/);
      assert.equal((await getMaterialLoss(row.id, reporter)).record.status, 'DRAFT');
    });
    let approved!: MaterialLossDTO;
    await t.test('concurrent submit and same-key approval retries have one effect', async () => {
      let row = await create();
      const key = randomUUID(), input = { action: 'submit', version: row.version, requestKey: key };
      const submitted = await Promise.all([mutateMaterialLoss(reporter, input, row.id), mutateMaterialLoss(reporter, input, row.id)]);
      assert.equal(submitted[0].version, submitted[1].version); row = submitted[0];
      const recipients = await prisma.systemNotificationRecipient.findMany({ where: { notification: { sourceType: 'MATERIAL_LOSS', sourceId: row.id, eventType: 'MATERIAL_LOSS_SUBMITTED' } } });
      assert.deepEqual(new Set(recipients.map(r => r.userId)), new Set([reviewer, both]));
      const approval = { action: 'approve', version: row.version, requestKey: randomUUID(), note: '同意，补料跟进' };
      const results = await Promise.all([mutateMaterialLoss(reviewer, approval, row.id), mutateMaterialLoss(reviewer, approval, row.id)]);
      approved = results[0]; assert.equal(approved.status, 'APPROVED');
      assert.equal(await prisma.materialLossReplenishment.count({ where: { lossId: row.id } }), 1);
      assert.equal(await prisma.materialLossEvent.count({ where: { lossId: row.id, action: 'approve' } }), 1);
      assert.equal(await prisma.systemNotificationRecipient.count({ where: { notification: { sourceType: 'MATERIAL_LOSS', sourceId: row.id, eventType: 'MATERIAL_LOSS_SUBMITTED' }, completedAt: null } }), 0);
      await assert.rejects(mutateMaterialLoss(reviewer, { ...approval, note: '偷改内容' }, row.id), /编号/);
    });
    await t.test('independent reviewers cannot race approve and return or approve their own declaration', async () => {
      let row = await create(both); row = await change(row, 'submit', both);
      await assert.rejects(change(row, 'approve', both), /本人/);
      await assert.rejects(change(row, 'return', reviewer), /原因/);
      const raced = await Promise.allSettled([change(row, 'approve', reviewer), change(row, 'return', reviewer, { note: '复核中' })]);
      assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
    });
    await t.test('warehouse warning does not change production state and needs explicit physical review', async () => {
      let order = await readMaterialOrder(warehouse.id);
      assert.ok(order.materialLossWarnings.some(l => l.id === approved.id));
      assert.equal(order.status, 'pending');
      await assert.rejects(mutateMaterialOrder(order.id, { action: 'complete', version: order.version, requestKey: randomUUID() }, reporter, true), /实物复核/);
      const input = { action: 'acknowledge_loss', version: order.version, lossId: approved.id, requestKey: randomUUID(), physicalVerified: true, note: '已核对，备用物料齐全，补料用于恢复安全备量' };
      await assert.rejects(mutateMaterialOrder(order.id, input, reporter, false), /仓库/);
      order = await mutateMaterialOrder(order.id, input, reporter, true);
      assert.ok(!order.materialLossWarnings.some(l => l.id === approved.id));
      assert.equal(order.status, 'pending');
      approved = (await getMaterialLoss(approved.id, reporter)).record;
    });
    await t.test('replenishment is independent and cumulative quantities cannot be invented, reduced or cross-owned', async () => {
      await assert.rejects(change(approved, 'replenishment', both, { replenishmentVersion: 0, receivedQuantity: 4, complete: true, physicalVerified: true, note: '他人操作' }), /申报人员/);
      await assert.rejects(change(approved, 'replenishment', reporter, { replenishmentVersion: 0, receivedQuantity: 2, complete: true, physicalVerified: true, note: '未全到' }), /尚未达到/);
      approved = await change(approved, 'replenishment', reporter, { replenishmentVersion: 0, receivedQuantity: 2, note: '第一批 2 个已核验可用' });
      assert.equal(approved.replenishment?.status, 'IN_PROGRESS');
      await assert.rejects(change(approved, 'replenishment', reporter, { replenishmentVersion: 1, receivedQuantity: 1, note: '倒退数量' }), /不能减少/);
      await assert.rejects(change(approved, 'replenishment', reporter, { replenishmentVersion: 1, receivedQuantity: 4, complete: true, note: '未核对实物' }), /核对实物/);
      approved = await change(approved, 'replenishment', reporter, { replenishmentVersion: 1, receivedQuantity: 4, complete: true, physicalVerified: true, note: '补料 4 个已逐个核验' });
      assert.equal(approved.replenishment?.status, 'COMPLETED');
    });
    await t.test('corrections preserve original evidence, count once and retain the original replenishment', async () => {
      let correction = await change(approved, 'correct'); losses.push(correction.id);
      const search = new URLSearchParams({ q: data.reason });
      const before = await listMaterialLoss(search, reporter);
      correction = await change(correction, 'save', reporter, { ...data, quantity: '2.5', correctionReason: '复核计数后更正，不改实物补料记录' });
      correction = await change(correction, 'submit');
      assert.equal((await listMaterialLoss(search, reporter)).totals[0].quantity, before.totals[0].quantity);
      correction = await change(correction, 'approve', reviewer);
      assert.ok((await getMaterialLoss(approved.id, reporter)).record.supersededAt);
      assert.equal((await listMaterialLoss(search, reporter)).totals[0].quantity, String(Number(before.totals[0].quantity) - .75));
      assert.equal(correction.replenishment?.id, approved.replenishment?.id);
      assert.equal(correction.replenishment?.receivedQuantity, '4');
      await assert.rejects(change(correction, 'save', reporter, data), /仅草稿/);
      assert.equal((await getMaterialLoss(approved.id, reporter)).record.quantity, '3.25');
    });
    await t.test('six-decimal quantities survive approval and replenishment without floating-point rounding', async () => {
      const quantity = '999999999999.123456';
      let row = await create(reporter, { quantity, replenishmentQuantity: quantity, reason: 'PRECISION-' + tag, unit: '米', affectsKitting: false });
      row = await change(row, 'submit'); row = await change(row, 'approve', reviewer);
      assert.equal(row.quantity, quantity); assert.equal(row.replenishment?.quantity, quantity);
      row = await change(row, 'replenishment', reporter, { replenishmentVersion: 0, receivedQuantity: quantity, complete: true, physicalVerified: true, note: '隔离环境精度边界验收' });
      assert.equal(row.replenishment?.receivedQuantity, quantity);
    });
    await t.test('grant revocation and no eligible reviewer fail immediately without losing drafts', async () => {
      let row = await create();
      await prisma.userAccessGrant.updateMany({ where: { userId: { in: [reviewer, both] }, scopeKey: 'MODULE:material-loss-approval:COLLABORATE' }, data: { isActive: false } });
      await assert.rejects(change(row, 'submit'), /没有可审批/);
      assert.equal((await getMaterialLoss(row.id, reporter)).record.status, 'DRAFT');
      await assert.rejects(materialLossAccess(reviewer), /权限/);
      await prisma.userAccessGrant.updateMany({ where: { userId: reviewer, scopeKey: 'MODULE:material-loss-approval:COLLABORATE' }, data: { isActive: true } });
      row = await change(row, 'submit');
      row = await change(row, 'return', reviewer, { note: '原因需补充现场证据' });
      assert.equal(row.status, 'RETURNED');
      row = await change(row, 'submit'); row = await change(row, 'withdraw'); assert.equal(row.status, 'WITHDRAWN');
      await prisma.userAccessGrant.updateMany({ where: { userId: reporter, scopeKey: 'MODULE:material-loss-report:COLLABORATE' }, data: { isActive: false } });
      await assert.rejects(change(row, 'submit'), /权限/);
    });
    assert.deepEqual(await Promise.all([prisma.processCompletion.count(), prisma.otherWorkTimeRequest.count(), prisma.pcPayment.count(), prisma.pcStockBalance.findMany({ orderBy: { id: 'asc' } }), prisma.pcStockMovement.count()]), baseline, 'hours, purchasing payments and inventory remain unchanged');
  } finally {
    await prisma.systemNotification.deleteMany({ where: { sourceType: 'MATERIAL_LOSS', sourceId: { in: losses } } });
    await prisma.materialLossEvent.deleteMany({ where: { lossId: { in: losses } } });
    await prisma.materialLossCommand.deleteMany({ where: { actorId: { in: users } } });
    await prisma.materialLossReplenishment.deleteMany({ where: { lossId: { in: losses } } });
    for (const id of [...losses].reverse()) await prisma.materialLoss.delete({ where: { id } });
    await prisma.warehouseMaterialTask.delete({ where: { id: warehouse.id } });
    await prisma.workOrder.delete({ where: { id: work.id } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
