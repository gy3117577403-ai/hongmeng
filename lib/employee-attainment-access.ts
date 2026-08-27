import { hasCapability, type AccessContext } from '@/lib/department-access';

/** Use the effective business scope, never the compatibility labor role. */
export function employeeAttainmentScope(actor: {
  laborRole: string;
  access: Pick<AccessContext, 'capabilities' | 'productionScope'>;
}): 'PRODUCTION' | 'TEAM' | 'SELF' {
  const globalModules = ['REPORT_CENTER', 'BUSINESS', 'PLANNING', 'MAJOR_APPROVAL', 'HR'] as const;
  if (
    actor.laborRole === 'ADMIN'
    || globalModules.some(module => hasCapability(actor.access, module, 'READ'))
    || (hasCapability(actor.access, 'PRODUCTION', 'READ')
      && ['WORKSHOP', 'GLOBAL'].includes(actor.access.productionScope))
  ) return 'PRODUCTION';
  if (hasCapability(actor.access, 'PRODUCTION', 'READ') && actor.access.productionScope === 'TEAM') return 'TEAM';
  return 'SELF';
}
