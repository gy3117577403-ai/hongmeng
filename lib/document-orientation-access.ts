import { hasCapability, type AccessContext, type AccessModuleCode } from '@/lib/department-access';

export function canSaveDocumentOrientation(access: AccessContext, drawingOwned: boolean): boolean {
  const modules: AccessModuleCode[] = drawingOwned ? ['ENGINEERING', 'DRAWING_LIBRARY'] : ['ENGINEERING', 'BUSINESS', 'PRODUCTION'];
  return modules.some(module => hasCapability(access, module, 'UPDATE') || hasCapability(access, module, 'MANAGE'));
}
