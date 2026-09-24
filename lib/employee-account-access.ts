import { hasCapability, type AccessContext } from '@/lib/department-access';

export type EmployeeAccountActor = {
  id: string;
  laborRole: string;
  access: Pick<AccessContext, 'capabilities' | 'employeeAccountManager'>;
};

export function isGlobalAccountManager(actor: EmployeeAccountActor): boolean {
  return actor.laborRole === 'ADMIN' || hasCapability(actor.access, 'ACCOUNT_ADMIN', 'MANAGE');
}

export function canAuthorizeEmployeeAccounts(actor: EmployeeAccountActor): boolean {
  return isGlobalAccountManager(actor) || Boolean(actor.access.employeeAccountManager)
    && hasCapability(actor.access, 'HR', 'READ') && hasCapability(actor.access, 'HR', 'UPDATE');
}

export function canManageEmployeeAccounts(actor: EmployeeAccountActor): boolean {
  return isGlobalAccountManager(actor)
    || (hasCapability(actor.access, 'HR', 'READ') && hasCapability(actor.access, 'HR', 'UPDATE'));
}

export function canManageEmployeeAccountTarget(actor: EmployeeAccountActor, target: {
  id: string;
  employeeId: string | null;
  laborRole: string;
  accessGrants: readonly { profile: string }[];
}): boolean {
  if (isGlobalAccountManager(actor)) return true;
  return canManageEmployeeAccounts(actor)
    && target.id !== actor.id
    && Boolean(target.employeeId)
    && target.laborRole !== 'ADMIN'
    // Protect administrator accounts even when a grant is inactive or scheduled.
    && !target.accessGrants.some(grant => ['ADMIN_GLOBAL', 'EMPLOYEE_ACCESS_MANAGER'].includes(grant.profile));
}

/** HR changes account lifecycle, not bindings, roles, or authorization grants. */
export function employeeAccountUpdateFieldsAllowed(body: Record<string, unknown>): boolean {
  const allowed = new Set(['displayName', 'isActive', 'accountStatus']);
  return Object.keys(body).length > 0 && Object.keys(body).every(key => allowed.has(key));
}
