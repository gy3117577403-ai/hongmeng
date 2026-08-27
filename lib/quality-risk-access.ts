import { currentUser, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';

export async function qualityRiskSession() {
  const user = await currentUser();
  if (!user || user.mustChangePassword) throw new UnauthorizedError();
  return user;
}

export function qualityRiskActor(user: Awaited<ReturnType<typeof qualityRiskSession>>) {
  return { id: user.id, name: user.displayName || user.username,
    canCreate: user.laborRole === 'ADMIN' || hasCapability(user.access, 'QUALITY', 'CREATE'),
    canManage: user.laborRole === 'ADMIN' || hasCapability(user.access, 'QUALITY', 'UPDATE'),
    canVerify: user.laborRole === 'ADMIN' || hasCapability(user.access, 'QUALITY', 'EXECUTE_WORKFLOW'),
  };
}

/** Assignment grants access only to this incident; never opens the whole quality namespace. */
export async function requireQualityRiskParticipant(reportId: string, mode: 'read' | 'manage' | 'task' = 'read') {
  const user = await qualityRiskSession();
  const actor = qualityRiskActor(user);
  const report = await prisma.internalQualityRiskReport.findUnique({ where: { id: reportId }, select: { ownerUserId: true, reviewerUserId: true, createdById: true, deletedAt: true, tasks: { where: { ownerUserId: user.id }, select: { id: true } } } });
  if (!report) throw new ForbiddenError();
  if (actor.canManage || actor.canVerify && mode !== 'manage') return user;
  if (report.reviewerUserId === user.id && mode !== 'manage' && actor.canVerify) return user;
  if (mode !== 'manage' && !report.deletedAt && actor.canCreate && report.createdById === user.id) return user;
  if (mode === 'read' && (hasCapability(user.access, 'QUALITY', 'READ') || hasCapability(user.access, 'ISSUE_MANAGEMENT', 'READ'))) return user;
  if (!report.deletedAt && (report.ownerUserId === user.id || mode !== 'manage' && report.tasks.length)) return user;
  throw new ForbiddenError();
}
