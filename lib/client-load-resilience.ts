export const AUTO_REFRESH_BASE_DELAY_MS = 60_000;
export const AUTO_REFRESH_JITTER_MS = 30_000;
export const AUTO_REFRESH_CHECK_INTERVAL_MS = 15_000;
export const AUTO_REFRESH_MAX_DELAY_MS = 5 * 60_000;

export type CacheBoundSnapshot<T> = {
  cacheKey: string;
  value: T;
};

export type ClientLoadWarning = {
  code: string;
  message?: string;
};

export function auxiliaryValueAfterLoad<T>(
  current: T,
  incoming: T,
  warnings: readonly ClientLoadWarning[],
  unavailableWarningCode: string,
): T {
  return warnings.some(warning => warning.code === unavailableWarningCode)
    ? current
    : incoming;
}

export function cacheBoundSnapshotValue<T>(
  snapshot: CacheBoundSnapshot<T> | null,
  cacheKey: string,
): T | null {
  return snapshot?.cacheKey === cacheKey ? snapshot.value : null;
}

export function retainCacheBoundSnapshot<T>(
  snapshot: CacheBoundSnapshot<T> | null,
  cacheKey: string,
): CacheBoundSnapshot<T> | null {
  return snapshot?.cacheKey === cacheKey ? snapshot : null;
}

export function autoRefreshDelayMs(consecutiveFailures: number, randomUnit = 0): number {
  const failures = Math.max(0, Math.floor(consecutiveFailures));
  const boundedRandom = Number.isFinite(randomUnit)
    ? Math.min(1, Math.max(0, randomUnit))
    : 0;
  const jitter = Math.floor(AUTO_REFRESH_JITTER_MS * boundedRandom);
  return Math.min(
    AUTO_REFRESH_MAX_DELAY_MS,
    AUTO_REFRESH_BASE_DELAY_MS * (2 ** failures) + jitter,
  );
}

export function shouldStartAutoRefresh(input: {
  visible: boolean;
  requestInFlight: boolean;
  now: number;
  nextAllowedAt: number;
}): boolean {
  return input.visible
    && !input.requestInFlight
    && input.now >= input.nextAllowedAt;
}
