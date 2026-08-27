import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { eligibleUserIdsForCapability } from '@/lib/system-notifications';
import { enqueueQualityNotification } from '@/lib/quality-risk-notifications';
import { QUALITY_ANALYSIS_FIELDS, QUALITY_PROBLEM_CATEGORIES, qualityAnalysisIssues } from '@/lib/quality-workflow-shared';
import { canIssuePasswordSession, hasPureFieldReporterAccess, type PasswordSessionAccount } from '@/lib/login-security';
import { InternalQualityRiskError, internalQualityRiskInclude, serializeInternalQualityRisk, normalizeQualityRiskRelationIds, requireActiveQualityRiskAssignee, type InternalQualityRiskActor } from '@/lib/internal-quality-risks';

const text = (value: unknown, limit = 8000) => typeof value === 'string' ? value.trim().slice(0, limit) || null : null;
export function qualityWorkflowAccountReady(account: PasswordSessionAccount, now = new Date()) {
  return canIssuePasswordSession(account, now) && !hasPureFieldReporterAccess(account, now);
}
const accountSelect = { isActive: true, accountStatus: true, mustChangePassword: true, fieldPasswordOnly: true, lastLoginAt: true,
  accessGrants: { select: { profile: true, isActive: true, effectiveFrom: true, effectiveTo: true } } } as const;
async function requireWorkflowAssignee(tx: Prisma.TransactionClient, id: string) {
  const person = await requireActiveQualityRiskAssignee(tx, id);
  const account = await tx.user.findUniqueOrThrow({ where: { id }, select: accountSelect });
  requireCondition(qualityWorkflowAccountReady(account), '该账号没有生效的工作台登录授权，请先完善账号权限', 400);
  return person;
}
function requireCondition(value: unknown, message: string, status = 409): asserts value {
  if (!value) throw new InternalQualityRiskError(message, status, 'QUALITY_STAGE_BLOCKED');
}
export async function qualityWorkflowPeople() {
  const [users, reviewers] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE', fieldPasswordOnly: false },
      select: { id: true, displayName: true, username: true, ...accountSelect, employee: { select: { isActive: true, notificationEnabled: true, mobile: true, department: true } } }, orderBy: { displayName: 'asc' } }),
    eligibleUserIdsForCapability(prisma, 'QUALITY', 'EXECUTE_WORKFLOW'),
  ]);
  return users.filter(user => qualityWorkflowAccountReady(user)).map(user => ({ id: user.id, displayName: user.displayName, username: user.username,
    department: user.employee?.department || '', canReview: reviewers.includes(user.id),
    notificationHint: !user.employee ? '未绑定人事' : !user.employee.isActive ? '员工已停用' : !user.employee.notificationEnabled ? '通知关闭' : !user.employee.mobile ? '未填写手机号' : '人事已绑定（需在企微群内）' }));
}

/** All stage writes share the report lock and optimistic version, including task/photo mutations. */
export async function actOnQualityWorkflow(tx: Prisma.TransactionClient, reportId: string, expectedVersion: number,
  action: string, payload: Record<string, unknown>, actor: InternalQualityRiskActor & { canCreate?: boolean }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-quality-risk:${reportId}`}))`;
  const report = await tx.internalQualityRiskReport.findUnique({ where: { id: reportId }, include: internalQualityRiskInclude });
  requireCondition(report && !report.deletedAt, '异常不存在或已移入回收站', 404);
  requireCondition(report.version === expectedVersion, '内容已被其他人员更新，请刷新后重试');
  requireCondition(report.status !== 'ARCHIVED', '已归档版本不可覆盖，请先启动修订');
  const isLead = report.ownerUserId === actor.id;
  const isReviewer = report.reviewerUserId === actor.id && actor.canVerify;
  const canInitiate = actor.canManage || actor.canCreate && report.createdById === actor.id;
  const handling = ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status);
  let data: Prisma.InternalQualityRiskReportUpdateInput = {};
  let detail: Prisma.InputJsonObject = { action };
  let description = '';
  const notify = (event: Parameters<typeof enqueueQualityNotification>[1]['event'], recipientId: string, title: string, extra: { taskId?: string; round?: number; summary?: string } = {}) =>
    enqueueQualityNotification(tx, { reportId, reportNo: report.reportNo, recipientId, event, title,
      summary: extra.summary || report.defectPhenomenon || report.title, taskId: extra.taskId, round: extra.round,
      actorId: actor.id, key: `${report.version + 1}`, });

  if (action === 'CONFIGURE') {
    requireCondition(canInitiate || isLead, '只有发起质量或牵头人可以配置责任分工', 403);
    requireCondition(report.status === 'DRAFT' || report.workflowVersion < 3 || report.status === 'REVISING', '提交后如需改派，请在对应任务内交接');
    const category = QUALITY_PROBLEM_CATEGORIES.find(item => item.id === payload.problemCategory);
    requireCondition(category, '请选择问题归属', 400);
    const ids = normalizeQualityRiskRelationIds(payload.responsibleUserIds, 30);
    const lead = String(payload.ownerUserId || ids[0] || '');
    const reviewer = String(payload.reviewerUserId || '');
    requireCondition(ids.length && ids.includes(lead), '至少选择一名责任人，并从中指定牵头人', 400);
    for (const id of ids) await requireWorkflowAssignee(tx, id);
    await requireWorkflowAssignee(tx, reviewer);
    requireCondition((await eligibleUserIdsForCapability(tx, 'QUALITY', 'EXECUTE_WORKFLOW')).includes(reviewer), '请选择具备品质确认权限的有效账号', 400);
    requireCondition(!ids.includes(reviewer) && !report.tasks.some(task => task.ownerUserId === reviewer && task.status !== 'CANCELLED'), '品质确认人不能同时担任本事件处理人', 400);
    data = { workflowVersion: 3, problemCategory: category.id, responsibleDepartment: category.department,
      responsibleUserIds: ids, owner: { connect: { id: lead } }, reviewer: { connect: { id: reviewer } },
      ...(report.status !== 'DRAFT' ? { status: 'COLLABORATING', verifiedAt: null, verifiedById: null, verificationResult: null } : {}) };
    if (report.status !== 'DRAFT') {
      for (const id of ids) {
        if (report.tasks.some(task => task.ownerUserId === id && task.status !== 'CANCELLED')) continue;
        const owner = await requireWorkflowAssignee(tx, id);
        const task = await tx.internalQualityRiskTask.create({ data: { reportId, isPrimary: true, title: `${category.label}处理`, department: category.department, ownerUserId: id, ownerName: owner.displayName || owner.username, requirement: report.defectPhenomenon } });
        await notify('ASSIGNED', id, '质量异常待处理', { taskId: task.id });
      }
    }
    description = '确认问题归属、多人责任分工及独立品质确认人';
    detail = { ...detail, previousWorkflowVersion: report.workflowVersion, category: category.id, responsibleUserIds: ids, lead, reviewer };
  } else {
    requireCondition(report.workflowVersion >= 3, '请先确认本事件的问题归属、责任人和品质确认人');
    if (action === 'SUBMIT') {
      requireCondition(report.status === 'DRAFT' && canInitiate, '只有发起质量可以提交草稿', 403);
      requireCondition(QUALITY_PROBLEM_CATEGORIES.some(item => item.id === report.problemCategory) && report.defectPhenomenon?.trim() && report.products.some(link => !link.product.deletedAt), '请补齐问题归属、实际问题和关联产品', 400);
      requireCondition(report.responsibleUserIds.length && report.ownerUserId && report.responsibleUserIds.includes(report.ownerUserId) && report.reviewerUserId, '请先配置责任人与品质确认人', 400);
      requireCondition(!report.responsibleUserIds.includes(report.reviewerUserId), '品质确认人与处理人必须分开', 400);
      requireCondition((await eligibleUserIdsForCapability(tx, 'QUALITY', 'EXECUTE_WORKFLOW')).includes(report.reviewerUserId), '品质确认人权限已变化，请重新指定');
      await requireWorkflowAssignee(tx, report.reviewerUserId);
      for (const ownerId of report.responsibleUserIds) {
        const owner = await requireWorkflowAssignee(tx, ownerId);
        const task = await tx.internalQualityRiskTask.create({ data: { reportId, isPrimary: true, title: `${report.title}处理`, department: report.responsibleDepartment || '待确定', ownerUserId: ownerId, ownerName: owner.displayName || owner.username, requirement: report.defectPhenomenon } });
        await notify('ASSIGNED', ownerId, '质量异常待接单', { taskId: task.id });
      }
      data.status = 'SUBMITTED'; description = '质量发起异常并分别生成责任任务';
    } else if (['START_TASK', 'SAVE_TASK', 'COMPLETE_TASK'].includes(action)) {
      requireCondition(handling, '当前阶段已冻结，须品质退回后再修改处理结果');
      const task = report.tasks.find(item => item.id === payload.taskId);
      requireCondition(task && task.ownerUserId === actor.id, '只能处理分配给自己的任务', 403);
      requireCondition(['TODO', 'IN_PROGRESS'].includes(task.status), '本任务已提交，不可覆盖；需要补充请由品质退回');
      if (action !== 'START_TASK') requireCondition(task.status === 'IN_PROGRESS', '请先接单再填写结果');
      const result = payload.result === undefined ? task.result : text(payload.result);
      const actionTaken = payload.actionTaken === undefined ? task.actionTaken : text(payload.actionTaken);
      if (action === 'COMPLETE_TASK') requireCondition(result && actionTaken, '请填写实际采取的措施和处理结果', 400);
      const nextStatus = action === 'COMPLETE_TASK' ? 'COMPLETED' : 'IN_PROGRESS';
      await tx.internalQualityRiskTask.update({ where: { id: task.id }, data: { status: nextStatus, actionTaken, result,
        completedAt: action === 'COMPLETE_TASK' ? new Date() : null, version: { increment: 1 } } });
      data.status = 'COLLABORATING';
      description = `${task.ownerName}：${action === 'START_TASK' ? '接单' : action === 'SAVE_TASK' ? '保存处理草稿' : '完成个人任务'}`;
      detail = { ...detail, taskId: task.id, previousResult: task.result, previousAction: task.actionTaken, result, actionTaken };
      if (action === 'COMPLETE_TASK' && report.ownerUserId && report.tasks.filter(item => item.id !== task.id).every(item => ['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(item.status))) {
        await notify('CONSOLIDATE', report.ownerUserId, '责任任务已完成，请汇总提交品质确认');
      }
    } else if (action === 'SAVE_ANALYSIS' || action === 'SUBMIT_REVIEW') {
      requireCondition(handling && isLead, '只有牵头人可在处理阶段汇总原因与方案', 403);
      const fields = Object.fromEntries(QUALITY_ANALYSIS_FIELDS.filter(([key]) => key in payload).map(([key]) => [key, text(payload[key])]));
      if (action === 'SUBMIT_REVIEW') {
        const issues = qualityAnalysisIssues({ ...report, ...fields });
        requireCondition(!issues.length, issues.map(item => item.message).join('；'), 400);
        requireCondition(report.tasks.length && report.tasks.every(task => ['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(task.status)), '所有责任任务必须完成，不能替其他人提交');
        requireCondition(report.reviewerUserId && report.reviewerUserId !== actor.id && !report.tasks.some(task => task.ownerUserId === report.reviewerUserId && task.status !== 'CANCELLED'), '请指定独立品质确认人');
        requireCondition((await eligibleUserIdsForCapability(tx, 'QUALITY', 'EXECUTE_WORKFLOW')).includes(report.reviewerUserId), '品质确认人的权限已失效，请联系质量重新指派');
        await requireWorkflowAssignee(tx, report.reviewerUserId);
        const round = report.reviewRound + 1;
        const serialized = serializeInternalQualityRisk(report);
        const snapshot = { reportNo: report.reportNo, title: report.title, defectPhenomenon: report.defectPhenomenon,
          problemCategory: report.problemCategory, severity: report.severity, products: serialized.products,
          tasks: serialized.tasks, attachments: serialized.attachments,
          analysis: Object.fromEntries(QUALITY_ANALYSIS_FIELDS.map(([key]) => [key, key in fields ? fields[key] : report[key]])),
          sourceVersion: report.version + 1 } as Prisma.InputJsonObject;
        await tx.qualityRiskReview.create({ data: { reportId, round, reviewerId: report.reviewerUserId, submittedById: actor.id, snapshot } });
        data = { ...fields, status: 'VERIFYING', reviewRound: round, verificationResult: null, verifiedAt: null, verifiedById: null };
        await notify('REVIEW', report.reviewerUserId, `待品质确认 · 第${round}轮`, { round });
        description = `提交第${round}轮品质确认，冻结本次任务、原因、方案与附件快照`;
      } else { data = fields; description = '牵头人保存原因与解决方案草稿'; }
    } else if (['SAVE_REVIEW', 'APPROVE', 'RETURN'].includes(action)) {
      requireCondition(['VERIFYING', 'PENDING_CLOSE'].includes(report.status) && isReviewer, '须由指定品质确认人在品质确认页面操作', 403);
      requireCondition(!report.tasks.some(task => task.ownerUserId === actor.id && task.status !== 'CANCELLED'), '处理人不能审核自己的事件', 403);
      const review = report.reviews[0];
      requireCondition(review && review.round === report.reviewRound && (review.decision === 'PENDING' || action === 'RETURN' && review.decision === 'APPROVED'), '审核版本已变化，请刷新');
      const result = payload.result === undefined ? review.result : text(payload.result);
      if (action === 'APPROVE') requireCondition(result, '请先填写验证结果，再确认通过', 400);
      const returnedIds = normalizeQualityRiskRelationIds(payload.taskIds, 100);
      const reason = text(payload.reason, 2000);
      if (action === 'RETURN') {
        requireCondition(reason && returnedIds.length, '请填写退回原因，并选择需要补充的责任任务', 400);
        requireCondition(returnedIds.every(id => report.tasks.some(task => task.id === id && task.status !== 'CANCELLED')), '退回任务不存在或已取消', 400);
      }
      await tx.qualityRiskReview.update({ where: { id: review.id }, data: { result,
        ...(action === 'APPROVE' ? { decision: 'APPROVED', decidedAt: new Date() } : {}),
        ...(action === 'RETURN' ? { decision: 'RETURNED', decidedAt: new Date(), returnReason: reason, returnedTaskIds: returnedIds } : {}) } });
      if (action === 'APPROVE') {
        await tx.internalQualityRiskTask.updateMany({ where: { reportId, status: 'COMPLETED' }, data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: actor.id, version: { increment: 1 } } });
        data = { status: 'PENDING_CLOSE', verificationResult: result, verifiedAt: new Date(), verifiedById: actor.id };
        await notify('APPROVED', actor.id, '品质确认通过，待归档发布', { round: review.round });
        description = `第${review.round}轮品质确认通过，等待归档`;
      } else if (action === 'RETURN') {
        await tx.internalQualityRiskTask.updateMany({ where: { reportId, id: { in: returnedIds } }, data: { status: 'IN_PROGRESS', reviewNote: reason, verifiedAt: null, verifiedById: null, completedAt: null, version: { increment: 1 } } });
        data = { status: 'COLLABORATING', verifiedAt: null, verifiedById: null, verificationResult: null };
        for (const task of report.tasks.filter(task => returnedIds.includes(task.id))) if (task.ownerUserId) await notify('RETURNED', task.ownerUserId, '品质退回，请补充处理', { taskId: task.id, summary: `${report.defectPhenomenon}\n退回原因：${reason}` });
        description = `第${review.round}轮定向退回${returnedIds.length}项任务，保留其他人员结果`;
      } else { description = `保存第${review.round}轮验证草稿`; }
      detail = { ...detail, round: review.round, result, reason, returnedTaskIds: returnedIds };
    } else if (action === 'ADD_TASK') {
      requireCondition(handling && (isLead || actor.canManage), '只有牵头人或质量管理人员可增补协同任务', 403);
      const owner = await requireWorkflowAssignee(tx, String(payload.ownerUserId || ''));
      const requirement = text(payload.requirement, 4000);
      requireCondition(requirement && owner.id !== report.reviewerUserId, '请填写任务要求，处理人与品质确认人必须分开', 400);
      requireCondition(!report.tasks.some(task => task.ownerUserId === owner.id && task.status !== 'CANCELLED'), '该人员已有任务，请在原任务内处理', 400);
      const task = await tx.internalQualityRiskTask.create({ data: { reportId, title: `${report.title}补充协同`, department: report.responsibleDepartment || '协同部门', ownerUserId: owner.id, ownerName: owner.displayName || owner.username, requirement } });
      data.status = 'COLLABORATING';
      await notify('ASSIGNED', owner.id, '新增质量协同任务', { taskId: task.id, summary: `${report.defectPhenomenon}\n协同要求：${requirement}` });
      detail = { ...detail, taskId: task.id, owner: owner.id, requirement };
      description = `增补协同任务：${owner.displayName || owner.username}`;
    } else if (action === 'CHANGE_REVIEWER') {
      requireCondition(actor.canManage && (handling || report.status === 'VERIFYING'), '仅质量管理人员可交接未结束的品质确认', 403);
      const reviewer = String(payload.reviewerUserId || '');
      const reason = text(payload.reason, 1000);
      requireCondition(reason && reviewer !== report.reviewerUserId, '请选择新的品质确认人并填写交接原因', 400);
      await requireWorkflowAssignee(tx, reviewer);
      requireCondition((await eligibleUserIdsForCapability(tx, 'QUALITY', 'EXECUTE_WORKFLOW')).includes(reviewer), '新确认人必须具备品质确认权限', 400);
      requireCondition(!report.tasks.some(task => task.ownerUserId === reviewer && task.status !== 'CANCELLED') && !report.responsibleUserIds.includes(reviewer), '处理人与品质确认人必须分开', 400);
      data.reviewer = { connect: { id: reviewer } };
      if (report.status === 'VERIFYING') {
        const currentReview = report.reviews[0];
        requireCondition(currentReview?.decision === 'PENDING', '当前轮次已结束');
        // Preserve previous reviewer/draft in the audit; new reviewer must verify independently.
        await tx.qualityRiskReview.update({ where: { id: currentReview.id }, data: { reviewerId: reviewer, result: null } });
        detail = { ...detail, previousResult: currentReview.result };
        await notify('REVIEW', reviewer, `品质确认已交接 · 第${report.reviewRound}轮`, { round: report.reviewRound });
      }
      detail = { ...detail, previousReviewer: report.reviewerUserId, reviewer, reason };
      description = '交接品质确认人，原审核人及草稿记录保留在审计中';
    } else if (action === 'RETRY_NOTIFICATION') {
      requireCondition(actor.canManage, '仅质量管理人员可重新投递通知', 403);
      const item = await tx.qualityRiskNotification.findFirst({ where: { id: String(payload.notificationId || ''), reportId, state: { in: ['FAILED', 'WAITING_CONFIG'] } } });
      requireCondition(item, '仅失败或等待配置的通知可重新投递', 400);
      await tx.qualityRiskNotification.update({ where: { id: item.id }, data: { state: 'PENDING', attempts: 0, availableAt: new Date(), leaseToken: null, lastError: null } });
      detail = { ...detail, notificationId: item.id, previousAttempts: item.attempts };
      description = '管理员重新排队通知；发送前仍会检查任务时效及接收人';
    } else if (action === 'REASSIGN') {
      requireCondition(handling && (isLead || actor.canManage), '只有牵头人/质量管理人员可在处理阶段交接任务', 403);
      const task = report.tasks.find(item => item.id === payload.taskId);
      const reason = text(payload.reason, 1000);
      const owner = await requireWorkflowAssignee(tx, String(payload.ownerUserId || ''));
      requireCondition(task && reason && owner.id !== report.reviewerUserId, '请选择处理人并填写交接原因，不能交给品质确认人', 400);
      requireCondition(task.status !== 'CANCELLED' && task.ownerUserId !== owner.id, '请选择不同的有效任务接收人', 400);
      requireCondition(!report.tasks.some(item => item.id !== task.id && item.ownerUserId === owner.id && item.status !== 'CANCELLED'), '该人员已有责任任务，请避免重复分派', 400);
      await tx.internalQualityRiskTask.update({ where: { id: task.id }, data: { ownerUserId: owner.id, ownerName: owner.displayName || owner.username, status: 'TODO', reviewNote: reason, completedAt: null, verifiedAt: null, verifiedById: null, version: { increment: 1 } } });
      data = { responsibleUserIds: [...new Set(report.responsibleUserIds.map(id => id === task.ownerUserId ? owner.id : id))], ...(report.ownerUserId === task.ownerUserId ? { owner: { connect: { id: owner.id } } } : {}) };
      await notify('ASSIGNED', owner.id, '质量任务已交接给你', { taskId: task.id });
      detail = { ...detail, taskId: task.id, previousOwner: task.ownerUserId, owner: owner.id, reason, previousResult: task.result };
      description = `任务交接：${task.ownerName} → ${owner.displayName || owner.username}（原始结果保留）`;
    } else throw new InternalQualityRiskError('未知的阶段操作', 400);
  }
  await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { ...data, updatedBy: { connect: { id: actor.id } }, version: { increment: 1 } } });
  await tx.internalQualityRiskActivity.create({ data: { reportId, actorId: actor.id, actorName: actor.name, action: `STAGE_${action}`, content: description, detail } });
  return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
}
