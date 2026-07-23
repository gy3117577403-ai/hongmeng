import type { LaborAccessRole } from '@prisma/client';

export type WriteAccessMode = 'admin' | 'labor' | 'production' | 'self';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function canUseRequestMethod(
  role: LaborAccessRole,
  method: string | null | undefined,
  writeAccess: WriteAccessMode = 'admin',
): boolean {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  if (READ_METHODS.has(normalizedMethod)) return true;
  if (writeAccess === 'self' || writeAccess === 'labor') return true;
  if (writeAccess === 'production') {
    return role === 'ADMIN' || role === 'TEAM_LEAD';
  }
  return role === 'ADMIN';
}
