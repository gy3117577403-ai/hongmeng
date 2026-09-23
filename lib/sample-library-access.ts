import type { ModuleAccessCarrier } from './module-permissions';

/** Independent mobile entitlement never grants editing or desktop business access. */
export function canReadSampleLibrary(access: ModuleAccessCarrier & { capabilities?: readonly string[] }): boolean {
  if (access.sampleLibraryEnabled) return true;
  if (access.modulePermissions != null) return access.workbenchEnabled !== false && Boolean(access.modulePermissions.production || access.modulePermissions.technology);
  return ['PLANNING:READ', 'PRODUCTION:READ', 'ENGINEERING:READ', 'DRAWING_LIBRARY:READ', 'ACCOUNT_ADMIN:MANAGE'].some(code => access.capabilities?.includes(code));
}
