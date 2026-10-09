import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveAccessContext, type AccessGrant } from '@/lib/department-access';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';
import { BUSINESS_SUBMODULES, expandModulePermissions, moduleConfiguration, type ModulePermissions } from '@/lib/module-permissions';
import { ADMIN_EXCLUDED_NOTIFICATION_SOURCES, excludedAdminNotice, delegatedApprovalNotice, supportedHandoffApproval } from '@/lib/approval-routing';

export class HandoffError extends Error { constructor(message: string, public status = 400) { super(message); } }
const userInclude = { employee: { include: { departmentRef: true } }, accessGrants: { include: { department: true } } } satisfies Prisma.UserInclude;
type HandoffUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;
function currentPermissions(user: HandoffUser): ModulePermissions {
  const grants = user.accessGrants.map(grant => ({ ...grant, departmentCode: grant.department?.code })) as AccessGrant[];
  const access = resolveAccessContext(grants.length ? grants : legacyFallbackGrants(user));
  if (access.scopeHints.some(scope => scope.level === 'TEAM')) throw new HandoffError('目标账号含班组范围授权，请先核对其审批范围，不能自动扩大为全公司');
  const config = moduleConfiguration(access.effectiveGrants);
  if (config) return expandModulePermissions(config.permissions);
  throw new HandoffError('接替账号仍使用旧岗位授权，请先在模块权限中确认并保存小模块配置，再预览审批交接');
}
const REQUIRED = ['major-approval', 'other-hours-approval', 'reporting-recovery', 'workflows'] as const;
async function prepare(tx: Prisma.TransactionClient, fromUserId: string, toUserId: string) {
  const [source, target] = await Promise.all([tx.user.findUnique({ where: { id: fromUserId }, include: userInclude }), tx.user.findUnique({ where: { id: toUserId }, include: userInclude })]);
  if (!source || source.laborRole !== 'ADMIN' && !source.accessGrants.some(grant => grant.isActive && grant.profile === 'ADMIN_GLOBAL')) throw new HandoffError('请选择真实的管理员账号');
  if (!target || source.id === target.id || !target.isActive || target.accountStatus !== 'ACTIVE' || !target.employee?.isActive || target.laborRole === 'ADMIN' || target.accessGrants.some(grant => grant.isActive && grant.profile === 'ADMIN_GLOBAL')) throw new HandoffError('请选择绑定在职员工的有效普通账号');
  if (await tx.businessApprovalHandoff.findFirst({ where: { fromUserId: target.id, isActive: true } })) throw new HandoffError('接替账号已有向外移交关系，不能形成循环转交');
  const existing = await tx.businessApprovalHandoff.findUnique({ where: { fromUserId } });
  if (existing?.isActive && existing.toUserId !== toUserId) throw new HandoffError('此管理员已有生效的接替账号，请先完成原接替账号的业务交接');
  const previous = currentPermissions(target);
  const permissions: ModulePermissions = { ...previous };
  for (const key of REQUIRED) permissions[key] = 'COLLABORATE';
  const rows = await tx.systemNotificationRecipient.findMany({ where: { userId: source.id, completedAt: null, routedAwayAt: null, notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }, include: { notification: true }, orderBy: { notificationId: 'asc' } });
  const muted = rows.filter(row => excludedAdminNotice(row.notification));
  const approvals = rows.filter(row => delegatedApprovalNotice(row.notification));
  const majorIds = approvals.filter(row => row.notification.eventType === 'MAJOR_QUALITY_FINAL_APPROVAL_REQUESTED').map(row => row.notification.sourceId).filter((id): id is string => Boolean(id));
  const independent = await tx.issueMajorApproval.findMany({ where: { id: { in: majorIds }, OR: [{ submittedById: target.id }, { qualityReviewedById: target.id }] }, select: { id: true } });
  const routeIds = approvals.filter(row => /^PROCESS_ROUTE_CHANGE_(?:SUBMITTED|REEVALUATED)$/.test(row.notification.eventType)).map(row => row.notification.sourceId).filter((id): id is string => Boolean(id));
  const ownChanges = await tx.processRouteChange.findMany({ where: { id: { in: routeIds }, createdById: target.id }, select: { id: true } });
  const otherIds = approvals.filter(row => /^other_work_(?:submit|policy_change|correction)$/i.test(row.notification.eventType)).map(row => row.notification.sourceId).filter((id): id is string => Boolean(id));
  const ownWork = await tx.otherWorkTimeRequest.findMany({ where: { id: { in: otherIds }, OR: [{ createdById: target.id }, { employeeId: target.employee!.id }] }, select: { id: true } });
  const selfIds = new Set([...independent, ...ownChanges, ...ownWork].map(row => row.id));
  const isSelf = (row: typeof approvals[number]) => row.notification.actorId === target.id || Boolean(row.notification.sourceId && selfIds.has(row.notification.sourceId));
  const self = approvals.filter(isSelf);
  const transfer = approvals.filter(row => !isSelf(row) && supportedHandoffApproval(row.notification));
  const unsupported = approvals.filter(row => !isSelf(row) && !supportedHandoffApproval(row.notification));
  const submissions = await tx.processReportSubmission.findMany({ where: { status: 'PENDING', assigneeUserIds: { has: source.id } }, select: { id: true, version: true, createdById: true, assigneeUserIds: true } });
  const fingerprint = createHash('sha256').update(JSON.stringify({ from: source.id, to: target.id, targetUpdatedAt: target.updatedAt, permissions, rows: rows.map(row => [row.notificationId, row.notification.eventType]), submissions })).digest('hex');
  return { source, target, previous, permissions, muted, transfer, self, unsupported, submissions, fingerprint };
}
function dto(plan: Awaited<ReturnType<typeof prepare>>) {
  return { fingerprint: plan.fingerprint, from: { id: plan.source.id, name: plan.source.displayName, username: plan.source.username }, to: { id: plan.target.id, name: plan.target.employee!.name, username: plan.target.username, employeeNo: plan.target.employee!.employeeNo }, transferCount: plan.transfer.length, mutedCount: plan.muted.length, selfApprovalFallbackCount: plan.self.length, submissionCount: plan.submissions.filter(row => row.createdById !== plan.target.id).length,
    changes: BUSINESS_SUBMODULES.filter(item => plan.previous[item.key] !== plan.permissions[item.key]).map(item => ({ key: item.key, label: item.label, before: plan.previous[item.key] || 'OFF', after: plan.permissions[item.key] })),
    blockers: plan.unsupported.map(row => ({ id: row.notificationId, title: row.notification.title, sourceType: row.notification.sourceType, message: '该业务尚未配置交接适配，保留原审批人' })),
    items: plan.transfer.map(row => ({ id: row.notificationId, title: row.notification.title, sourceType: row.notification.sourceType })), excludedSources: ADMIN_EXCLUDED_NOTIFICATION_SOURCES };
}
export async function previewBusinessApprovalHandoff(fromUserId: string, toUserId: string) { return dto(await prepare(prisma, fromUserId, toUserId)); }
export async function applyBusinessApprovalHandoff(actorId: string, fromUserId: string, toUserId: string, expected: string, passwordHash?: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`business-handoff:${fromUserId}`}))`;
    const plan = await prepare(tx, fromUserId, toUserId);
    if (plan.fingerprint !== expected) throw new HandoffError('账号或待办已变化，请重新预览交接清单', 409);
    if (plan.unsupported.length) throw new HandoffError('存在尚未适配的审批类型，请先核对清单；本次未修改任何账号或待办', 409);
    const now = new Date();
    // Add only the approved responsibilities; preserve existing and scheduled grants verbatim.
    const grants = [];
    if (!plan.target.accessGrants.some(g => g.isActive && g.scopeKey === 'MODULES:ON' && g.effectiveFrom <= now && (!g.effectiveTo || g.effectiveTo >= now))) grants.push({ userId: toUserId, profile: 'MODULE_ACCESS' as const, grantType: 'PRIMARY' as const, scopeKey: 'MODULES:ON', effectiveFrom: now, grantedById: actorId });
    for (const key of REQUIRED) if (plan.previous[key] !== 'COLLABORATE') grants.push({userId:toUserId,profile:'MODULE_ACCESS' as const,grantType:'CONCURRENT' as const,scopeKey:`MODULE:${key}:COLLABORATE`,effectiveFrom:now,grantedById:actorId});
    if (grants.length) await tx.userAccessGrant.createMany({data:grants});
    await tx.user.update({ where: { id: toUserId }, data: { sessionVersion: { increment: 1 } } });
    await tx.businessApprovalHandoff.upsert({ where: { fromUserId }, create: { fromUserId, toUserId, excludedSources: [...ADMIN_EXCLUDED_NOTIFICATION_SOURCES], createdById: actorId }, update: { toUserId, isActive: true, excludedSources: [...ADMIN_EXCLUDED_NOTIFICATION_SOURCES] } });
    for (const row of plan.muted) await tx.systemNotificationRecipient.update({ where: { notificationId_userId: { notificationId: row.notificationId, userId: fromUserId } }, data: { routedAwayAt: now, routingReason: '退出资料变更、资料审核及采购通知；原业务处理人继续处理' } });
    for (const row of plan.transfer) {
      await tx.systemNotificationRecipient.upsert({ where: { notificationId_userId: { notificationId: row.notificationId, userId: toUserId } }, create: { notificationId: row.notificationId, userId: toUserId }, update: { completedAt: null, completionKind: null, completionReason: null, readAt: null, snoozedUntil: null, routedAwayAt: null, routedToUserId: null, routingReason: null } });
      await tx.systemNotificationRecipient.update({ where: { notificationId_userId: { notificationId: row.notificationId, userId: fromUserId } }, data: { routedAwayAt: now, routedToUserId: toUserId, routingReason: '管理员业务审批交接' } });
    }
    for (const row of plan.submissions.filter(row => row.createdById !== toUserId)) await tx.processReportSubmission.update({ where: { id: row.id, version: row.version }, data: { assigneeUserIds: [...new Set(row.assigneeUserIds.map(id => id === fromUserId ? toUserId : id))], version: { increment: 1 } } });
    if (passwordHash) {
      await tx.user.update({ where: { id: fromUserId }, data: { passwordHash, mustChangePassword: false, fieldPasswordOnly: false, sessionVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null } });
      await tx.operationLog.create({ data: { userId: actorId, action: 'change_password', targetType: 'user', targetId: fromUserId, detail: { reason: 'authorized_admin_handoff' } } });
    }
    await tx.operationLog.create({ data: { userId: actorId, action: 'BUSINESS_APPROVAL_HANDOFF', targetType: 'User', targetId: fromUserId, detail: { ...dto(plan), beforePermissions: plan.previous, afterPermissions: plan.permissions } as Prisma.InputJsonValue } });
    return { ...dto(plan), appliedAt: now.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
