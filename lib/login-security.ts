export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

export type LoginLockState = {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

export type PasswordSessionAccessGrant = {
  profile: string;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type PasswordSessionAccount = {
  isActive: boolean;
  accountStatus: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  accessGrants: readonly PasswordSessionAccessGrant[];
};

export type RetainedPasswordSessionAccount = PasswordSessionAccount & {
  sessionVersion: number;
};

/**
 * FIELD_REPORTER accounts start with an unrecoverable random password. If one
 * later receives live workbench access before an administrator resets that
 * password, both the UI and the authentication boundary must remain pending.
 */
export function requiresAdminPasswordSetup(
  account: PasswordSessionAccount,
  now = new Date(),
): boolean {
  if (
    !account.isActive
    || account.accountStatus !== 'ACTIVE'
    || account.mustChangePassword
    || account.lastLoginAt
  ) return false;

  const nowValue = now.getTime();
  if (!Number.isFinite(nowValue)) return false;
  const originatedAsFieldReporter = account.accessGrants.some(
    grant => grant.profile === 'FIELD_REPORTER',
  );
  const hasLiveWorkbenchAccess = account.accessGrants.some(grant => (
    grant.profile !== 'FIELD_REPORTER'
    && grant.isActive
    && grant.effectiveFrom.getTime() <= nowValue
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > nowValue)
  ));
  return originatedAsFieldReporter && hasLiveWorkbenchAccess;
}

/**
 * Ordinary password sessions are a workbench access method. FIELD_REPORTER is
 * intentionally PIN-only, so a live explicit non-reporter grant is required.
 * Account lifecycle and grant windows both fail closed at this boundary.
 */
export function canIssuePasswordSession(
  account: PasswordSessionAccount,
  now = new Date(),
): boolean {
  if (!account.isActive || account.accountStatus !== 'ACTIVE') return false;
  const nowValue = now.getTime();
  if (!Number.isFinite(nowValue)) return false;
  if (requiresAdminPasswordSetup(account, now)) return false;

  return account.accessGrants.some(grant => (
    grant.profile !== 'FIELD_REPORTER'
    && grant.isActive
    && grant.effectiveFrom.getTime() <= nowValue
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > nowValue)
  ));
}

/**
 * Re-checks the same workbench boundary for every ordinary session use. Grant
 * windows can expire without a database write, so sessionVersion alone cannot
 * revoke a previously issued seven-day cookie at the effectiveTo boundary.
 */
export function canRetainPasswordSession(
  account: RetainedPasswordSessionAccount,
  presentedSessionVersion: number,
  now = new Date(),
): boolean {
  return Number.isInteger(presentedSessionVersion)
    && presentedSessionVersion >= 0
    && presentedSessionVersion === account.sessionVersion
    && canIssuePasswordSession(account, now);
}

export function isLoginLocked(
  lockedUntil: Date | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

export function nextFailedLoginState(
  previousAttempts: number,
  now = new Date(),
): LoginLockState {
  const failedLoginAttempts = Math.max(0, previousAttempts) + 1;
  return {
    failedLoginAttempts,
    lockedUntil: failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOGIN_LOCK_DURATION_MS)
      : null,
  };
}
