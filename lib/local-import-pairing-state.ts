export type LocalImportPairingState = {
  expiresAt: string;
  state: string;
  helperInstanceId?: string;
  helperConnectedAt?: string;
  pairingUsedAt?: string;
};

export type LocalImportPairingResolution<T extends LocalImportPairingState> =
  | { outcome: 'connected' | 'already_connected'; detail: T }
  | { outcome: 'expired' }
  | { outcome: 'used_by_other_helper' };

export function resolveLocalImportHelperBinding<T extends LocalImportPairingState>(
  detail: T,
  helperInstanceId: string,
  now: Date,
): LocalImportPairingResolution<T> {
  const expiresAt = new Date(detail.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    return { outcome: 'expired' };
  }

  const currentHelper = detail.helperInstanceId?.trim() || '';
  if (currentHelper && currentHelper !== helperInstanceId) {
    return { outcome: 'used_by_other_helper' };
  }

  const connectedAt = detail.helperConnectedAt || now.toISOString();
  const pairingUsedAt = currentHelper === helperInstanceId && detail.pairingUsedAt
    ? detail.pairingUsedAt
    : now.toISOString();
  const state = detail.state === 'waiting' ? 'connected' : detail.state;

  return {
    outcome: currentHelper === helperInstanceId ? 'already_connected' : 'connected',
    detail: {
      ...detail,
      state,
      helperInstanceId,
      helperConnectedAt: connectedAt,
      pairingUsedAt,
    },
  };
}
