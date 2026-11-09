import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { moduleConfiguration, moduleLevel } from './module-permissions';
import { MaterialLossError } from './material-loss-domain';

type Tx = Prisma.TransactionClient;
const userSelect = { id: true, displayName: true, username: true, isActive: true, accountStatus: true,
  employee: { select: { isActive: true } }, accessGrants: { select: { profile: true, scopeKey: true, isActive: true, effectiveFrom: true, effectiveTo: true } } } as const;
function permissions(user: Prisma.UserGetPayload<{ select: typeof userSelect }>) {
  const now = Date.now();
  const grants = user.accessGrants.filter(g => g.isActive && g.effectiveFrom.getTime() <= now && (!g.effectiveTo || g.effectiveTo.getTime() > now));
  const adminRead = grants.some(g => g.profile === 'ADMIN_GLOBAL');
  const config = moduleConfiguration(grants);
  const access = { modulePermissions: config?.permissions || {}, workbenchEnabled: config?.workbenchEnabled === true };
  const active = user.isActive && user.accountStatus === 'ACTIVE' && (!user.employee || user.employee.isActive);
  const report = active ? moduleLevel(access, 'material-loss-report') : undefined, approval = active ? moduleLevel(access, 'material-loss-approval') : undefined;
  return { id: user.id, name: user.displayName || user.username, read: active && (adminRead || !!(report || approval)), report: report === 'COLLABORATE', approve: approval === 'COLLABORATE', reviewRead: active && (adminRead || !!approval) };
}
export async function materialLossAccess(userId: string, tx: Tx = prisma) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user) throw new MaterialLossError('账号不存在', 403);
  const access = permissions(user);
  if (!access.read) throw new MaterialLossError('请在账号权限中开通物料损耗申报或审批权限', 403);
  return access;
}
export type MaterialLossAccess = Awaited<ReturnType<typeof materialLossAccess>>;
export async function materialLossReviewers(tx: Tx, applicantId: string) {
  const users = await tx.user.findMany({ where: { id: { not: applicantId }, isActive: true, accountStatus: 'ACTIVE', accessGrants: { some: { profile: 'MODULE_ACCESS', scopeKey: 'MODULE:material-loss-approval:COLLABORATE', isActive: true } } }, select: userSelect });
  return users.filter(user => permissions(user).approve).map(user => user.id);
}
export function lossVisibility(access: MaterialLossAccess): Prisma.MaterialLossWhereInput {
  return { OR: [{ applicantId: access.id }, { status: { in: access.reviewRead ? ['PENDING', 'APPROVED', 'RETURNED', 'WITHDRAWN'] : ['PENDING', 'APPROVED'] } }] };
}
