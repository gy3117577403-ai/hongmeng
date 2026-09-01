export const PRODUCTION_DATA_INVALIDATED_EVENT = 'hongmeng:production-data-invalidated';

const PRODUCTION_DATA_INVALIDATED_STORAGE_KEY = 'hongmeng:production-data-invalidated:last';
const PRODUCTION_DATA_INVALIDATED_CHANNEL = 'hongmeng-production-data-v1';

export type ProductionDataInvalidationKind =
  | 'plan-order-deleted'
  | 'plan-batch-deleted'
  | 'plan-batch-updated'
  | 'wip-entered'
  | 'wip-scheduled'
  | 'wip-rescheduled'
  | 'wip-unscheduled'
  | 'wip-returned';

export type ProductionDataInvalidation = {
  kind: ProductionDataInvalidationKind;
  entityId: string;
  occurredAt: number;
  nonce: string;
};

export function normalizeProductionDataInvalidation(value: unknown): ProductionDataInvalidation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const kind = source.kind === 'plan-order-deleted'
    || source.kind === 'plan-batch-deleted'
    || source.kind === 'plan-batch-updated'
    || source.kind === 'wip-entered'
    || source.kind === 'wip-scheduled'
    || source.kind === 'wip-rescheduled'
    || source.kind === 'wip-unscheduled'
    || source.kind === 'wip-returned'
    ? source.kind
    : null;
  const entityId = typeof source.entityId === 'string' ? source.entityId.trim() : '';
  const nonce = typeof source.nonce === 'string' ? source.nonce.trim() : '';
  const occurredAt = Number(source.occurredAt);
  if (!kind || !entityId || !nonce || !Number.isFinite(occurredAt)) return null;
  return { kind, entityId, occurredAt, nonce };
}

function createInvalidation(
  input: Pick<ProductionDataInvalidation, 'kind' | 'entityId'>,
): ProductionDataInvalidation {
  return {
    kind: input.kind,
    entityId: input.entityId.trim(),
    occurredAt: Date.now(),
    nonce: typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

export function publishProductionDataInvalidation(
  input: Pick<ProductionDataInvalidation, 'kind' | 'entityId'>,
): void {
  if (typeof window === 'undefined' || !input.entityId.trim()) return;
  const detail = createInvalidation(input);
  window.dispatchEvent(new CustomEvent(PRODUCTION_DATA_INVALIDATED_EVENT, { detail }));
  try {
    window.localStorage.setItem(PRODUCTION_DATA_INVALIDATED_STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // Private browsing or managed devices may disable storage; other channels remain available.
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(PRODUCTION_DATA_INVALIDATED_CHANNEL);
      channel.postMessage(detail);
      channel.close();
    } catch {
      // BroadcastChannel is optional; storage and same-page events still keep the UI coherent.
    }
  }
}

export function subscribeProductionDataInvalidations(
  listener: (invalidation: ProductionDataInvalidation) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const seen = new Set<string>();
  const receive = (value: unknown): void => {
    const invalidation = normalizeProductionDataInvalidation(value);
    if (!invalidation || seen.has(invalidation.nonce)) return;
    seen.add(invalidation.nonce);
    if (seen.size > 100) seen.delete(seen.values().next().value || '');
    listener(invalidation);
  };
  const customListener = (event: Event): void => {
    receive((event as CustomEvent<unknown>).detail);
  };
  const storageListener = (event: StorageEvent): void => {
    if (event.key !== PRODUCTION_DATA_INVALIDATED_STORAGE_KEY || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      // Ignore stale or malformed values from an older client.
    }
  };
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(PRODUCTION_DATA_INVALIDATED_CHANNEL);
      channel.addEventListener('message', event => receive(event.data));
    } catch {
      channel = null;
    }
  }
  window.addEventListener(PRODUCTION_DATA_INVALIDATED_EVENT, customListener);
  window.addEventListener('storage', storageListener);
  return () => {
    window.removeEventListener(PRODUCTION_DATA_INVALIDATED_EVENT, customListener);
    window.removeEventListener('storage', storageListener);
    channel?.close();
  };
}
