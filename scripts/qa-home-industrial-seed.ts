/** Disposable local home-page acceptance data. Never run against production. */
import { PrismaClient, type MaterialFollowUpStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const target = new URL(process.env.DATABASE_URL || '');
if (process.env.HOME_INDUSTRIAL_QA_ALLOW !== 'disposable-home-runtime'
  || !['127.0.0.1', 'localhost', 'hm-home-v134136-postgres'].includes(target.hostname)
  || !target.pathname.startsWith('/hongmeng_home_v134136')) {
  throw new Error('This seed only accepts the explicit disposable home runtime and its dedicated local database.');
}
const password = process.env.HOME_INDUSTRIAL_QA_PASSWORD;
if (!password || password.length < 12) throw new Error('A dedicated HOME_INDUSTRIAL_QA_PASSWORD is required.');
const db = new PrismaClient();
const marker = 'HOME-QA';

async function main() {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 3600_000);
  const start = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const yesterday = new Date(now.getTime() - 86400_000);
  const tomorrow = new Date(now.getTime() + 86400_000);
  const actor = await db.user.upsert({
    where: { username: 'homeqa' },
    create: { username: 'homeqa', displayName: '管理员', passwordHash: await bcrypt.hash(password!, 10),
      laborRole: 'ADMIN', mustChangePassword: false, accessGrants: { create: {
        profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL:HOME_QA', grantType: 'PRIMARY',
      } } },
    update: { passwordHash: await bcrypt.hash(password!, 10), mustChangePassword: false },
  });
  const products = ['控制线束', '连接器组件', '电源连接线', '端子线束', '工业信号线', '屏蔽电缆组件'];
  const specifications = ['HL-2609-A', 'J599-26B', 'PWR-480-20', 'TERM-125-C', 'SIG-08-P', 'SHD-420-X'];
  const ids: string[] = [];
  for (let index = 0; index < 24; index++) {
    const serial = String(index + 1).padStart(3, '0');
    const complete = index < 6;
    const overdue = index >= 6 && index < 9;
    const stage = complete ? 'completed' : index < 15 ? 'frontend' : index < 21 ? 'backend' : 'not_issued';
    const due = overdue ? yesterday : end;
    const common = {
      customerName: `隔离验收客户 ${['甲', '乙', '丙'][index % 3]}`,
      productName: products[index % products.length], specification: `${specifications[index % specifications.length]}-${serial}`,
      stage, status: complete ? 'completed' : 'processing', productionTargetQty: 120,
      uncompletedQty: complete ? '0' : '120', completedQty: complete ? '120' : '0',
      progress: complete ? 100 : index < 15 ? 40 : 65, priority: overdue ? 'urgent' : 'normal',
      drawingStatus: index % 5 === 0 ? '待客户确认' : '已确认', materialStatus: index >= 9 && index < 13 ? '缺料' : '齐套',
      planType: 'managed_plan', planActive: true, weekStartDate: start, weekEndDate: end,
      plannedAt: due, deliveryDay: due.toISOString().slice(0, 10),
      completedAt: complete ? yesterday : null,
      remark: '专用隔离数据库中的非敏感首页验收数据',
    };
    const order = await db.workOrder.upsert({ where: { code: `${marker}-${serial}` },
      create: { code: `${marker}-${serial}`, ...common }, update: common });
    ids.push(order.id);
    const plan = await db.productionPlanOrder.upsert({
      where: { sourceOrderNo_sourceLineNo: { sourceOrderNo: `${marker}-${serial}`, sourceLineNo: 1 } },
      create: { sourceOrderNo: `${marker}-${serial}`, sourceLineNo: 1, customerName: common.customerName,
        productName: common.productName, specification: common.specification, orderQuantity: 120,
        orderDate: start, customerDueDate: due, createdById: actor.id, updatedById: actor.id },
      update: { customerDueDate: due },
    });
    await db.productionPlanBatch.upsert({ where: { workOrderId: order.id },
      create: { planOrderId: plan.id, batchNo: 1, quantity: 120, weekStartDate: start, weekEndDate: end,
        plannedCompletionDate: due, releaseState: 'active', workOrderId: order.id },
      update: { weekStartDate: start, weekEndDate: end, plannedCompletionDate: due },
    });
    if (index >= 9 && index < 13) {
      const warehouse = await db.warehouseMaterialTask.upsert({ where: { workOrderId: order.id },
        create: { workOrderId: order.id, status: 'exception', exceptionType: 'shortage',
          exceptionNote: '隔离验收：连接端子待到货', expectedAt: index === 9 ? yesterday : tomorrow }, update: {} });
      const exception = await db.warehouseMaterialExceptionCase.upsert({
        where: { warehouseTaskId_sequence: { warehouseTaskId: warehouse.id, sequence: 1 } },
        create: { warehouseTaskId: warehouse.id, sequence: 1, exceptionType: 'shortage',
          exceptionNote: '隔离验收：连接端子待到货', weekStartDate: start, weekEndDate: end }, update: {},
      });
      const status: MaterialFollowUpStatus = index === 9 ? 'PENDING' : 'WAITING_ARRIVAL';
      await db.materialFollowUpTask.upsert({ where: { warehouseExceptionId: exception.id },
        create: { warehouseTaskId: warehouse.id, warehouseExceptionId: exception.id, status,
          ownerId: index === 9 ? null : actor.id, createdById: actor.id,
          expectedAt: index === 9 ? yesterday : tomorrow, latestProgress: '已确认预计到货时间' }, update: {} });
    }
  }
  const notifications = [
    ['MATERIAL', 'URGENT', '端子物料到货待确认', '4 项物料跟进中，优先查看预计到货已过期的事项。', '/workspace/procurement', 'material'],
    ['PRODUCTION', 'HIGH', '今日交付工单需要关注', '本周工单已更新，请核对计划与交付进度。', '/production', 'production'],
    ['QUALITY', 'HIGH', '首件检验结果待复核', '隔离验收：连接器组件首检记录已提交。', '/workspace/quality/data', 'quality'],
    ['PROCESS', 'NORMAL', '工艺资料版本更新', '隔离验收：请查看相关图纸与工艺说明。', '/drawing-library', 'process_time'],
    ['SYSTEM', 'NORMAL', '首页协同总览已就绪', '这是隔离数据库中的测试消息，用于验证分类、检索与阅读状态。', '/', 'home_qa'],
  ];
  for (const [category, priority, title, body, targetRoute, sourceType] of notifications) {
    await db.systemNotification.upsert({ where: { dedupeKey: `${marker}-${category}` },
      create: { dedupeKey: `${marker}-${category}`, eventType: `HOME_QA_${category}`, category: 'TODO',
        priority, title, body, targetRoute, sourceType, actorId: actor.id,
        recipients: { create: { userId: actor.id } } },
      update: { title, body, targetRoute },
    });
  }
  for (let index = 0; index < 3; index++) {
    await db.systemNotification.upsert({ where: { dedupeKey: `${marker}-DONE-${index}` },
      create: { dedupeKey: `${marker}-DONE-${index}`, eventType: 'HOME_QA_COMPLETED', category: 'SYSTEM',
        title: ['上周计划归档完成', '物料到货已确认', '工艺资料已同步'][index], sourceType: 'home_qa',
        recipients: { create: { userId: actor.id, readAt: yesterday, completedAt: yesterday, completionKind: 'MANUAL' } } }, update: {} });
  }
  for (let index = 0; index < 2; index++) {
    await db.issue.upsert({ where: { sourceFingerprint: `${marker}-ISSUE-${index}` },
      create: { sourceFingerprint: `${marker}-ISSUE-${index}`, title: ['连接器端子外观待复核', '成品线束标签待确认'][index],
        type: 'quality', priority: index === 0 ? 'high' : 'normal', status: 'pending',
        description: '隔离验收：用于首页质量关注状态与任务下钻验证。', workOrderId: ids[15 + index],
        reporterId: actor.id, assigneeId: actor.id, dueAt: tomorrow }, update: {} });
  }
  console.log(JSON.stringify({ ok: true, username: actor.username, workOrders: ids.length,
    materialTasks: 4, issues: 2, pendingMessages: notifications.length, completedMessages: 3,
    weekStart: start.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
