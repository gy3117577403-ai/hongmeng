import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { validateNewPassword } from '@/lib/password-policy';
import { moduleConfiguration, parseModulePermissions, MODULE_MARKER_ON, MODULE_MARKER_OFF } from '@/lib/module-permissions';
import { AccessGrantInputError, adminUserInclude, serializeAdminUser, reconcileFieldReportPinEligibility } from '@/lib/user-access-admin';

export type ModuleAccountInput = {
  id?: unknown; employeeId?: unknown; username?: unknown; displayName?: unknown; password?: unknown;
  accountStatus?: unknown; modulePermissions?: unknown; workbenchEnabled?: unknown; fieldReportEnabled?: unknown;
  expectedUpdatedAt?: unknown;
};
export async function saveModuleAccount(actorId: string, input: ModuleAccountInput) {
  const id = typeof input.id === 'string' ? input.id : null;
  let permissions;
  try { permissions = parseModulePermissions(input.modulePermissions); } catch (error) { throw new AccessGrantInputError((error as Error).message); }
  if (typeof input.workbenchEnabled !== 'boolean' || typeof input.fieldReportEnabled !== 'boolean') throw new AccessGrantInputError('请选择后台与扫码访问方式');
  if (!input.workbenchEnabled && Object.keys(permissions).length) throw new AccessGrantInputError('关闭后台时请清空后台模块');
  if (input.workbenchEnabled && !Object.keys(permissions).length) throw new AccessGrantInputError('请至少开通一个后台模块');
  if (!input.workbenchEnabled && !input.fieldReportEnabled) throw new AccessGrantInputError('请至少保留一种访问方式；暂停访问请停用账号');
  const status = String(input.accountStatus || 'ACTIVE');
  if (!['ACTIVE', 'DISABLED', 'SUSPENDED', 'PENDING'].includes(status)) throw new AccessGrantInputError('账号状态不正确');
  const password = String(input.password || '');
  const displayName = String(input.displayName || '').trim();
  if (!displayName || displayName.length > 80) throw new AccessGrantInputError('请输入 1–80 字的显示姓名');
  if (id === actorId) throw new AccessGrantInputError('本人权限请由另一位管理员维护，避免失去管理入口', 403);
  const result = await prisma.$transaction(async tx => {
    const previous = id ? await tx.user.findUnique({ where: { id }, include: adminUserInclude }) : null;
    if (id && !previous) throw new AccessGrantInputError('账号不存在', 404);
    if (previous?.laborRole === 'ADMIN' || previous?.accessGrants.some(grant => grant.profile === 'ADMIN_GLOBAL')) throw new AccessGrantInputError('系统管理员保留全部模块，不通过业务授权面板修改', 403);
    const employeeId = previous?.employeeId || String(input.employeeId || '');
    if (previous && input.employeeId && input.employeeId !== previous.employeeId) throw new AccessGrantInputError('不能通过权限配置更换员工绑定');
    const employee = await tx.employee.findFirst({ where: { id: employeeId, isActive: true }, include: { departmentRef: true } });
    if (!employee) throw new AccessGrantInputError('请选择有效的在职员工');
    if (input.fieldReportEnabled && employee.departmentRef?.code !== 'PRODUCTION') throw new AccessGrantInputError('扫码报工仅对生产岗位开放，后台模块不受部门限制');
    const username = previous?.username || String(input.username || employee.employeeNo).trim();
    if (!username || username.length > 80) throw new AccessGrantInputError('账号格式不正确');
    if (!previous || password || previous.fieldPasswordOnly && input.workbenchEnabled) {
      const error = validateNewPassword(password, username);
      if (error) throw new AccessGrantInputError(previous?.fieldPasswordOnly ? `开通后台需设置独立密码：${error}` : error);
    }
    const now = new Date();
    const data = {
      displayName, accountStatus: status as 'ACTIVE' | 'DISABLED' | 'SUSPENDED' | 'PENDING', isActive: status === 'ACTIVE',
      ...(password ? { passwordHash: await bcrypt.hash(password, 10), fieldPasswordOnly: false, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null } : {}),
    };
    let accountId: string;
    if (previous) {
      const expected = new Date(String(input.expectedUpdatedAt || ''));
      if (!Number.isFinite(expected.getTime())) throw new AccessGrantInputError('缺少账号版本，请刷新后重试', 409);
      const changed = await tx.user.updateMany({ where: { id: previous.id, updatedAt: expected }, data: { ...data, sessionVersion: { increment: 1 } } });
      if (!changed.count) throw new AccessGrantInputError('该账号已被其他人更新，请刷新并核对最新权限后再保存', 409);
      accountId = previous.id;
      // Cancel future and concurrent business grants as well, never silently union old rights.
      await tx.userAccessGrant.updateMany({ where: { userId: accountId, isActive: true }, data: { isActive: false, version: { increment: 1 }, grantedById: actorId } });
    } else {
      const created = await tx.user.create({ data: { ...data, username, employeeId, laborRole: 'EMPLOYEE', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true } });
      accountId = created.id;
    }
    await tx.userAccessGrant.create({ data: { userId: accountId, profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: input.workbenchEnabled ? MODULE_MARKER_ON : MODULE_MARKER_OFF, effectiveFrom: now, grantedById: actorId } });
    for (const [module, level] of Object.entries(permissions)) await tx.userAccessGrant.create({ data: {
      userId: accountId, profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: `MODULE:${module}:${level}`, effectiveFrom: now, grantedById: actorId,
    } });
    if (input.fieldReportEnabled) await tx.userAccessGrant.create({ data: { userId: accountId, profile: 'FIELD_REPORTER', grantType: 'CONCURRENT', scopeKey: `EMPLOYEE:${employeeId}`, departmentId: employee.departmentId, effectiveFrom: now, grantedById: actorId } });
    await reconcileFieldReportPinEligibility(tx, employeeId, { resetById: actorId });
    const before = previous ? moduleConfiguration(previous.accessGrants.filter(grant => grant.isActive && grant.effectiveFrom <= now && (!grant.effectiveTo || grant.effectiveTo > now))) : null;
    await tx.operationLog.create({ data: { userId: actorId, action: id ? 'ACCOUNT_MODULE_ACCESS_UPDATED' : 'ACCOUNT_MODULE_ACCESS_CREATED', targetType: 'User', targetId: accountId, detail: {
      before: before || { legacyGrants: previous?.accessGrants.filter(grant => grant.isActive).map(grant => ({ profile: grant.profile, scopeKey: grant.scopeKey })) || [] },
      after: { permissions, workbenchEnabled: input.workbenchEnabled, fieldReportEnabled: input.fieldReportEnabled, status }, passwordChanged: Boolean(password),
    } as Prisma.InputJsonValue } });
    return tx.user.findUniqueOrThrow({ where: { id: accountId }, include: adminUserInclude });
  });
  return serializeAdminUser(result);
}
