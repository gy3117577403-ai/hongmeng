import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { enqueueQualityNotification, dispatchQualityNotifications } from '../lib/quality-risk-notifications';
import { qualityNotificationBatchReportIds } from '../lib/quality-notification-links';
import { actOnQualityWorkflow } from '../lib/quality-workflow-v3';

test('quality notification identity, merge window, expiry, short link ownership and uncertain transport', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const prefix = 'notify-' + randomUUID().slice(0, 8);
  const employees = await Promise.all(['owner', 'other', 'quality'].map((name, index) => prisma.employee.create({ data: {
    employeeNo: prefix + name, name: index < 2 ? '林波' : '品质确认人', mobile: `198${String(Date.now()).slice(-7)}${index}`,
  } })));
  const users = await Promise.all(employees.map((employee, index) => prisma.user.create({ data: { employeeId: employee.id, username: prefix + index,
    displayName: employee.name, passwordHash: 'test-no-real-login', laborRole: index === 2 ? 'ADMIN' : 'EMPLOYEE',
    accessGrants: { create: { profile: index === 2 ? 'ADMIN_GLOBAL' : 'PROCESS_SPECIALIST', scopeKey: 'GLOBAL' } } } })));
  const [owner, other, quality] = users;
  const product = await prisma.drawingLibraryItem.create({ data: { libraryKey: prefix, specification: prefix, productName: '质量通知联调', customerName: prefix } });
  const reports: string[] = [];
  const validWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=isolated-protocol-only-no-real-robot';
  const start = new Date(); let calls = 0; const payloads: any[] = [];
  const fakeFetch = (async (_url, init) => { calls++; payloads.push(JSON.parse(String(init?.body))); return new Response('{"errcode":0}'); }) as typeof fetch;
  const clock = async () => prisma.qualityRobotDispatchClock.deleteMany({ where: { id: 'quality' } });
  const dispatch = async (offset: number, fetchImpl = fakeFetch) => { await clock(); return dispatchQualityNotifications({
    webhookUrl: validWebhook, origin: 'https://quality.example.com', now: new Date(start.getTime() + offset), fetchImpl }); };
  async function create(title: string) {
    const report = await prisma.internalQualityRiskReport.create({ data: { reportNo: prefix + reports.length, title,
      status: 'SUBMITTED', workflowVersion: 4, createdById: quality.id, reviewerUserId: quality.id, responsibleUserIds: [owner.id],
      products: { create: { drawingLibraryItemId: product.id } },
      tasks: { create: { title, department: '生产部', ownerUserId: owner.id, ownerName: '林波', status: 'TODO' } },
    }, include: { tasks: true } }); reports.push(report.id);
    await prisma.$transaction(tx => enqueueQualityNotification(tx, { reportId: report.id, reportNo: report.reportNo, recipientId: owner.id,
      taskId: report.tasks[0].id, event: 'ASSIGNED', title: '质量异常待接单', summary: '现场问题', actorId: quality.id, key: 'new' }));
    return report;
  }
  try {
    const first = await create('插入误配色'); await create('标识内容数字打错'); await create('插入颜色错误');
    assert.deepEqual(await dispatch(0), { processed: 0, accepted: 0 }, 'wait for the merge window');
    assert.deepEqual(await dispatch(125_000), { processed: 3, accepted: 3 });
    assert.equal(calls, 1); assert.deepEqual(payloads[0].text.mentioned_mobile_list, [employees[0].mobile]);
    assert.doesNotMatch(JSON.stringify(payloads[0]), new RegExp(employees[1].mobile!));
    assert.match(payloads[0].text.content, /3 项待接单/);
    const sent = await prisma.qualityRiskNotification.findMany({ where: { reportId: { in: reports }, state: 'SENT' } });
    assert.equal(new Set(sent.map(item => item.deliveryGroup)).size, 1);
    for (const row of sent) {
      const snapshot = row.deliverySnapshot as Record<string, string>;
      assert.equal(snapshot.employeeId, employees[0].id); assert.equal(snapshot.recipientId, owner.id);
      assert.ok(!JSON.stringify(snapshot).includes(employees[0].mobile!));
    }
    const code = payloads[0].text.content.match(/\/q\/([A-Za-z0-9_-]{12})/)[1];
    assert.deepEqual((await qualityNotificationBatchReportIds(code, owner.id)).sort(), [...reports].sort());
    assert.deepEqual(await qualityNotificationBatchReportIds(code, other.id), []);
    assert.deepEqual(await dispatch(140_000), { processed: 0, accepted: 0 });

    // Same display name never substitutes for the assigned account. UserID is opt-in and verified.
    await prisma.employee.update({ where: { id: employees[0].id }, data: { wecomUserId: prefix + '.linbo', wecomUserIdVerifiedAt: new Date() } });
    const fourth = await create('验证成员身份');
    const timeout = (async () => { calls++; throw new DOMException('uncertain', 'TimeoutError'); }) as typeof fetch;
    assert.deepEqual(await dispatch(250_000, timeout), { processed: 1, accepted: 0 });
    const uncertain = await prisma.qualityRiskNotification.findFirstOrThrow({ where: { reportId: fourth.id } });
    assert.equal(uncertain.state, 'UNCERTAIN');
    assert.deepEqual(await dispatch(500_000), { processed: 0, accepted: 0 });
    const actor = { id: quality.id, name: '品质', canManage: true, canVerify: true, canCreate: true };
    await assert.rejects(prisma.$transaction(tx => actOnQualityWorkflow(tx, fourth.id, fourth.version, 'RETRY_NOTIFICATION', { notificationId: uncertain.id }, actor)), /核对群消息/);
    await prisma.$transaction(tx => actOnQualityWorkflow(tx, fourth.id, fourth.version, 'RETRY_NOTIFICATION', { notificationId: uncertain.id, confirmResend: true }, actor));
    assert.deepEqual(await dispatch(510_000), { processed: 1, accepted: 1 });
    assert.deepEqual(payloads[1].text.mentioned_list, [prefix + '.linbo']);
    assert.equal(payloads[1].text.mentioned_mobile_list, undefined);

    const obsolete = await create('已接单的旧提醒');
    await prisma.internalQualityRiskTask.update({ where: { id: obsolete.tasks[0].id }, data: { status: 'IN_PROGRESS' } });
    const before = calls;
    await dispatch(600_000);
    assert.equal(calls, before); assert.equal((await prisma.qualityRiskNotification.findFirstOrThrow({ where: { reportId: obsolete.id } })).state, 'SKIPPED');
    const reassigned = await create('改派取消提醒');
    await prisma.internalQualityRiskTask.update({ where: { id: reassigned.tasks[0].id }, data: { ownerUserId: other.id } });
    await dispatch(610_000); assert.equal(calls, before);
    assert.equal((await prisma.qualityRiskNotification.findFirstOrThrow({ where: { reportId: reassigned.id } })).state, 'SKIPPED');
    const missing = await create('账号解除绑定');
    await prisma.user.update({ where: { id: owner.id }, data: { employeeId: null } });
    await dispatch(620_000); assert.equal(calls, before);
    assert.equal((await prisma.qualityRiskNotification.findFirstOrThrow({ where: { reportId: missing.id } })).state, 'WAITING_CONFIG');
    assert.equal((await prisma.internalQualityRiskReport.findUniqueOrThrow({ where: { id: first.id } })).status, 'SUBMITTED');
  } finally {
    await prisma.internalQualityRiskReport.deleteMany({ where: { id: { in: reports } } });
    await prisma.systemNotification.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.operationLog.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees.map(employee => employee.id) } } });
    await prisma.drawingLibraryItem.delete({ where: { id: product.id } });
    await prisma.$disconnect();
  }
});
