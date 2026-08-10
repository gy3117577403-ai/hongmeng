export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

export type LoginLockState = {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

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
