import {
  hasCapability,
  type AccessContext,
  type AccessModuleCode,
} from '@/lib/department-access';

/**
 * A GET route may expose data to read-only users while retaining a legacy
 * reconciliation step for operators.  Only users who can create or update
 * one of the owning modules may trigger that write-side reconciliation.
 */
export function canRunGetReconciliation(
  access: Pick<AccessContext, 'capabilities'>,
  modules: readonly AccessModuleCode[],
): boolean {
  return modules.some(module => (
    hasCapability(access, module, 'CREATE')
    || hasCapability(access, module, 'UPDATE')
  ));
}
