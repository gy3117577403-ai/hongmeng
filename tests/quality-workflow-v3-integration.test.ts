import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { actOnQualityWorkflow } from '../lib/quality-workflow-v3';
import { createInternalQualityRiskRecord, parseInternalQualityRiskInput, updateInternalQualityRiskRecord, transitionInternalQualityRiskWorkflow, updateInternalQualityRiskTask, createInternalQualityRiskTask, archiveInternalQualityRisk, startInternalQualityRiskRevision } from '../lib/internal-quality-risks';
import { dispatchQualityNotifications, enqueueQualityNotification } from '../lib/quality-risk-notifications';

test('v3 PostgreSQL: multiple independent tasks, frozen rounds, targeted return, authorization and real outbox protocol', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const prefix = `qv3-${randomUUID().slice(0, 8)}`;
  const employees = await Promise.all(['a', 'b', 'quality', 'backup'].map((name, index) => prisma.employee.create({ data: { employeeNo: `${prefix}-${name}`, name: `${prefix}-${name}`, mobile: `199${String(Date.now()).slice(-7)}${index}` } })));
  const users = await Promise.all(employees.map((employee, index) => prisma.user.create({ data: { username: employee.name, displayName: ['工艺负责人', '现场负责人', '品质确认人', '品质备岗'][index], passwordHash: 'isolated-test-only', employeeId: employee.id, laborRole: index >= 2 ? 'ADMIN' : 'EMPLOYEE', accessGrants: { create: { profile: index >= 2 ? 'QUALITY_REVIEWER' : 'PROCESS_SPECIALIST', scopeKey: 'GLOBAL' } } } })));
  const [a, b, q, backup] = users;
  const actor = (id: string) => ({ id, name: users.find(user => user.id === id)!.displayName, canCreate: id === q.id || id === backup.id, canManage: id === q.id || id === backup.id, canVerify: id === q.id || id === backup.id });
  const product = await prisma.drawingLibraryItem.create({ data: { customerName: prefix, customerCode: prefix, productName: '16:9照片回归产品', specification: prefix, libraryKey: prefix } });
  const order = await prisma.workOrder.create({ data: { code: `${prefix}-WO`, productName: prefix, stage: 'frontend', drawingLibraryItemId: product.id } });
  const ids: string[] = [];
  try {
    let report = await prisma.$transaction(tx => createInternalQualityRiskRecord(tx, parseInternalQualityRiskInput({ workflowVersion: 3, title: '工艺问题', problemCategory: 'PROCESS', defectPhenomenon: '首件压接高度偏差，需核对模具与材料', productIds: [product.id], ownerUserId: a.id, responsibleUserIds: [a.id, b.id], reviewerUserId: q.id }), actor(q.id)));
    ids.push(report.id);
    const configure = { problemCategory: 'PROCESS', responsibleUserIds: [a.id, b.id], ownerUserId: a.id, reviewerUserId: q.id };
    const act = async (action: string, payload: Record<string, unknown> = {}, id = a.id) => {
      report = await prisma.$transaction(tx => actOnQualityWorkflow(tx, report.id, report.version, action, payload, actor(id)));
      return report;
    };
    const fail = (action: string, payload: Record<string, unknown>, id: string, pattern: RegExp) => assert.rejects(prisma.$transaction(tx => actOnQualityWorkflow(tx, report.id, report.version, action, payload, actor(id))), pattern);
    await fail('CONFIGURE', { ...configure, reviewerUserId: a.id }, q.id, /品质确认/);
    await act('CONFIGURE', configure, q.id);
    await act('SUBMIT', {}, q.id);
    assert.equal(report.status, 'SUBMITTED'); assert.equal(report.tasks.length, 2);
    await assert.rejects(prisma.$transaction(tx => createInternalQualityRiskTask(tx, report.id, { title: '绕过分工', department: '工艺部', ownerUserId: b.id }, actor(q.id))), /阶段处理/);
    const aTask = report.tasks.find(task => task.ownerUserId === a.id)!.id;
    const bTask = report.tasks.find(task => task.ownerUserId === b.id)!.id;
    assert.equal(await prisma.qualityRiskNotification.count({ where: { reportId: report.id, eventType: 'ASSIGNED' } }), 2);
    await fail('START_TASK', { taskId: bTask }, a.id, /自己/);
    await fail('COMPLETE_TASK', { taskId: aTask }, a.id, /接单/);
    const beforeVersion = report.version;
    await act('START_TASK', { taskId: aTask });
    await assert.rejects(prisma.$transaction(tx => actOnQualityWorkflow(tx, report.id, beforeVersion, 'START_TASK', { taskId: bTask }, actor(b.id))), /更新/);

    // Missing configuration does not roll back the task and never calls an external endpoint.
    let externalCalls = 0;
    const capture: Array<Record<string, any>> = [];
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => { externalCalls++; capture.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ errcode: 0 }), { status: 200 }); }) as typeof fetch;
    await dispatchQualityNotifications({ webhookUrl: '', origin: 'https://quality.example.com', fetchImpl: fakeFetch });
    assert.equal(externalCalls, 0);
    assert.ok(await prisma.qualityRiskNotification.count({ where: { reportId: report.id, state: 'WAITING_CONFIG' } }));
    // Isolate this test's valid queue item, exercising the exact WeCom text/@ payload.
    await prisma.qualityRiskNotification.updateMany({ where: { reportId: report.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    await prisma.qualityRobotDispatchClock.deleteMany({ where: { id: 'quality' } });
    await dispatchQualityNotifications({ webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=isolated-test-key-20260827', origin: 'https://quality.example.com', fetchImpl: fakeFetch });
    assert.equal(externalCalls, 1); assert.equal(capture[0].msgtype, 'text'); assert.equal(capture[0].text.mentioned_mobile_list.length, 1);
    assert.ok(employees.some(employee => capture[0].text.mentioned_mobile_list[0] === employee.mobile));
    assert.match(capture[0].text.content, /quality-tasks\?reportId=/);
    assert.match(capture[0].text.content, /taskId=/);
    // A rejected robot response is durable; explicit retry and concurrent workers
    // still claim the remaining task notification once, without double delivery.
    const validWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=isolated-test-key-20260827';
    const failedDelivery = await dispatchQualityNotifications({ webhookUrl: validWebhook, origin: 'https://quality.example.com', now: new Date(Date.now() + 5000),
      fetchImpl: (async () => new Response(JSON.stringify({ errcode: 93000, errmsg: 'isolated rejection' }), { status: 200 })) as typeof fetch });
    assert.deepEqual(failedDelivery, { processed: 1, accepted: 0 });
    const failedItem = await prisma.qualityRiskNotification.findFirstOrThrow({ where: { reportId: report.id, state: 'FAILED' } });
    assert.equal(failedItem.attempts, 1);
    assert.ok(failedItem.availableAt.getTime() > Date.now());
    await fail('RETRY_NOTIFICATION', { notificationId: failedItem.id }, a.id, /质量管理/);
    await act('RETRY_NOTIFICATION', { notificationId: failedItem.id }, q.id);
    const concurrentNow = new Date(Date.now() + 10_000);
    const concurrent = await Promise.all([1, 2].map(() => dispatchQualityNotifications({ webhookUrl: validWebhook, origin: 'https://quality.example.com', now: concurrentNow, fetchImpl: fakeFetch })));
    assert.equal(concurrent.reduce((sum, item) => sum + item.accepted, 0), 1);
    assert.equal(externalCalls, 2);
    assert.equal((await prisma.qualityRiskNotification.findUniqueOrThrow({ where: { id: failedItem.id } })).state, 'SENT');
    await fail('COMPLETE_TASK', { taskId: aTask, result: '完成' }, a.id, /措施/);
    await act('COMPLETE_TASK', { taskId: aTask, actionTaken: '重新调机', result: '首件复测正常' });
    const analysis = { occurrenceCause: '参数偏移', rootCause: '换模未复核', finalConclusion: '需增加换模首件确认', correctiveAction: '更新换模核对步骤并复测三件' };
    await fail('SUBMIT_REVIEW', analysis, a.id, /所有责任/);
    await act('START_TASK', { taskId: bTask }, b.id);
    await act('COMPLETE_TASK', { taskId: bTask, actionTaken: '隔离并核对物料', result: '确认本批规格一致' }, b.id);
    await fail('SUBMIT_REVIEW', {}, a.id, /发生原因/);
    await fail('SUBMIT_REVIEW', analysis, b.id, /牵头/);
    await act('SUBMIT_REVIEW', analysis);
    assert.equal(report.status, 'VERIFYING'); assert.equal(report.reviews.length, 1);
    const r1 = JSON.stringify(report.reviews[0].snapshot);
    await fail('SAVE_TASK', { taskId: aTask, result: '偷偷覆盖' }, a.id, /冻结/);
    await fail('SAVE_ANALYSIS', { rootCause: '覆盖' }, a.id, /处理阶段/);
    await assert.rejects(prisma.$transaction(tx => updateInternalQualityRiskRecord(tx, report.id, parseInternalQualityRiskInput({ title: '绕过', workflowVersion: 2 }), report.version, actor(q.id))), /流程|阶段/);
    await assert.rejects(prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'PENDING_CLOSE', actor(q.id))), /阶段|流程|品质/);
    await assert.rejects(prisma.$transaction(tx => updateInternalQualityRiskTask(tx, report.id, aTask, { expectedVersion: report.tasks[0].version, result: '绕过', status: 'COMPLETED' }, actor(a.id))), /阶段|流程/);
    await fail('APPROVE', { result: '其他人确认' }, backup.id, /指定/);
    await fail('APPROVE', {}, q.id, /验证结果/);
    await fail('RETURN', { reason: '请补图', taskIds: ['not-real-task'] }, q.id, /任务不存在/);
    await act('RETURN', { result: '第一轮复核，需补充换模照片', reason: '请工艺负责人补充换模核对证据', taskIds: [aTask] }, q.id);
    assert.equal(report.tasks.find(task => task.id === aTask)!.status, 'IN_PROGRESS');
    assert.equal(report.tasks.find(task => task.id === bTask)!.status, 'COMPLETED');
    assert.equal(report.tasks.find(task => task.id === aTask)!.result, '首件复测正常');
    assert.equal(JSON.stringify(report.reviews[0].snapshot), r1);
    await act('COMPLETE_TASK', { taskId: aTask, actionTaken: '补充换模复核并复测', result: '第二轮三件合格，证据齐全' });
    await act('SUBMIT_REVIEW', analysis);
    assert.equal(report.reviewRound, 2); assert.equal(report.reviews[0].result, null);
    assert.equal(report.reviews[1].result, '第一轮复核，需补充换模照片');
    await act('SAVE_REVIEW', { result: '原品质人员草稿' }, q.id);
    await act('CHANGE_REVIEWER', { reviewerUserId: backup.id, reason: '品质人员轮班交接' }, q.id);
    assert.equal(report.reviews[0].result, null);
    assert.ok(report.activities.some(item => item.action === 'STAGE_CHANGE_REVIEWER'));
    await fail('APPROVE', { result: '旧人员继续审核' }, q.id, /指定/);
    await fail('APPROVE', {}, backup.id, /验证结果/);
    await act('APPROVE', { result: '备岗独立复测三件合格，方案有效' }, backup.id);
    assert.equal(report.status, 'PENDING_CLOSE'); assert.ok(report.verifiedAt);
    report = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, report.id, report.version, actor(backup.id)));
    assert.equal(report.status, 'ARCHIVED'); assert.equal(report.alerts.length, 1); assert.equal(report.alerts[0].workOrderId, order.id);
    assert.equal(report.reviews.length, 2);
    report = await prisma.$transaction(tx => startInternalQualityRiskRevision(tx, report.id, report.version, actor(q.id)));
    assert.equal(report.status, 'REVISING');
    await assert.rejects(prisma.$transaction(tx => archiveInternalQualityRisk(tx, report.id, report.version, actor(q.id))), /品质|验证/);
    assert.equal(report.reviews[1].decision, 'RETURNED');

    // Enqueue idempotency: one durable message per event/recipient/key.
    const input = { reportId: report.id, reportNo: report.reportNo, event: 'CONSOLIDATE' as const, key: 'idempotency', recipientId: a.id, actorId: q.id, title: '汇总提醒', summary: '测试' };
    await prisma.$transaction(async tx => { await enqueueQualityNotification(tx, input); await enqueueQualityNotification(tx, input); });
    assert.equal(await prisma.qualityRiskNotification.count({ where: { reportId: report.id, dedupeKey: { contains: 'idempotency' } } }), 1);
  } finally {
    await prisma.internalQualityRiskReport.deleteMany({ where: { id: { in: ids } } });
    await prisma.workOrder.delete({ where: { id: order.id } });
    await prisma.drawingLibraryItem.delete({ where: { id: product.id } });
    await prisma.systemNotification.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.operationLog.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees.map(employee => employee.id) } } });
    await prisma.$disconnect();
  }
});
