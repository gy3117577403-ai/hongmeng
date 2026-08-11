export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;
export const FIELD_REPORT_DEFAULT_PASSWORD = '123456';

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
  fieldPasswordOnly: boolean;
  lastLoginAt: Date | null;
  accessGrants: readonly PasswordSessionAccessGrant[];
};

export type RetainedPasswordSessionAccount = PasswordSessionAccount & {
  sessionVersion: number;
};

function effectivePasswordGrants(
  account: PasswordSessionAccount,
  now: Date,
): readonly PasswordSessionAccessGrant[] {
  const nowValue = now.getTime();
  if (!Number.isFinite(nowValue)) return [];
  return account.accessGrants.filter(grant => (
    grant.isActive
    && grant.effectiveFrom.getTime() <= nowValue
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > nowValue)
  ));
}

function hasCurrentOrFutureNonFieldAccess(
  account: PasswordSessionAccount,
  now: Date,
): boolean {
  const nowValue = now.getTime();
  if (!Number.isFinite(nowValue)) return false;
  return account.accessGrants.some(grant => (
    grant.profile !== 'FIELD_REPORTER'
    && grant.isActive
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > nowValue)
  ));
}

/** A pure field account can use a password only for the existing QR report APIs. */
export function hasPureFieldReporterAccess(
  account: PasswordSessionAccount,
  now = new Date(),
): boolean {
  const grants = effectivePasswordGrants(account, now);
  return grants.length > 0
    && grants.every(grant => grant.profile === 'FIELD_REPORTER')
    && !hasCurrentOrFutureNonFieldAccess(account, now);
}

/**
 * The shared temporary credential is deliberately weak and must never unlock
 * workbench access. This persisted bit survives grant changes and closes the
 * promotion window before an administrator installs a strong password.
 */
export function requiresAdminPasswordSetup(
  account: PasswordSessionAccount,
  now = new Date(),
): boolean {
  if (
    !account.isActive
    || account.accountStatus !== 'ACTIVE'
    || !account.fieldPasswordOnly
  ) return false;

  return hasCurrentOrFutureNonFieldAccess(account, now);
}

/**
 * Compatibility fallback for FIELD_REPORTER accounts created while PIN-only
 * login stored an unrecoverable random password. Existing password hashes are
 * preserved; the fallback is available only to a still-pure field account.
 */
export function canUseDefaultFieldPassword(
  account: PasswordSessionAccount,
  now = new Date(),
): boolean {
  return account.isActive
    && account.accountStatus === 'ACTIVE'
    && account.fieldPasswordOnly
    && hasPureFieldReporterAccess(account, now);
}

/**
 * 123456 is accepted only while the account is still pure FIELD_REPORTER.
 * This plaintext check is required because a bcrypt hash cannot be classified
 * by a SQL migration and an old manager hash may still match the shared value.
 */
export function canAcceptPasswordCredential(
  account: PasswordSessionAccount,
  password: string,
  passwordMatches: boolean,
  now = new Date(),
): boolean {
  if (!canIssuePasswordSession(account, now)) return false;
  if (password === FIELD_REPORT_DEFAULT_PASSWORD) {
    return hasPureFieldReporterAccess(account, now)
      && (passwordMatches || canUseDefaultFieldPassword(account, now));
  }
  return passwordMatches;
}

/**
 * A password session may be issued to a pure FIELD_REPORTER for QR reporting,
 * or to a workbench account with an explicit live non-reporter grant. The API
 * route capability boundary keeps a pure reporter inside /api/field-report.
 */
export function canIssuePasswordSession(
  account: PasswordSessionAccount,
  now = new Date(),
): boolean {
  if (!account.isActive || account.accountStatus !== 'ACTIVE') return false;
  const grants = effectivePasswordGrants(account, now);
  if (!grants.length) return false;
  if (requiresAdminPasswordSetup(account, now)) return false;

  return grants.some(grant => grant.profile !== 'FIELD_REPORTER')
    || grants.every(grant => grant.profile === 'FIELD_REPORTER');
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
