export const PROCESS_ROUTE_CHANGE_UPDATED_EVENT = 'process-route-change-updated';

const PROCESS_ROUTE_CHANGE_UPDATED_STORAGE_KEY = 'hongmeng:process-route-change-updated';

export type ProcessRouteChangeClientUpdate = {
  changeId: string;
  routeId: string;
  sourceId: string;
  status?: string | null;
  version?: number | null;
  occurredAt: number;
  nonce: string;
};

function normalizedUpdate(value: unknown): ProcessRouteChangeClientUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const changeId = typeof source.changeId === 'string' ? source.changeId.trim() : '';
  const routeId = typeof source.routeId === 'string' ? source.routeId.trim() : '';
  const sourceId = typeof source.sourceId === 'string' ? source.sourceId.trim() : '';
  if (!changeId || !routeId || !sourceId) return null;
  return {
    changeId,
    routeId,
    sourceId,
    status: typeof source.status === 'string' ? source.status : null,
    version: Number.isSafeInteger(Number(source.version)) ? Number(source.version) : null,
    occurredAt: Number.isFinite(Number(source.occurredAt)) ? Number(source.occurredAt) : Date.now(),
    nonce: typeof source.nonce === 'string' ? source.nonce : '',
  };
}

export function publishProcessRouteChangeClientUpdate(
  update: Omit<ProcessRouteChangeClientUpdate, 'occurredAt' | 'nonce'>,
): void {
  if (typeof window === 'undefined') return;
  const detail: ProcessRouteChangeClientUpdate = {
    ...update,
    occurredAt: Date.now(),
    nonce: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  };
  window.dispatchEvent(new CustomEvent(PROCESS_ROUTE_CHANGE_UPDATED_EVENT, { detail }));
  try {
    window.localStorage.setItem(PROCESS_ROUTE_CHANGE_UPDATED_STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // Storage can be disabled by the browser; same-page synchronization still works.
  }
}

export function subscribeProcessRouteChangeClientUpdates(
  listener: (update: ProcessRouteChangeClientUpdate) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const customListener = (event: Event) => {
    const update = normalizedUpdate((event as CustomEvent<unknown>).detail);
    if (update) listener(update);
  };
  const storageListener = (event: StorageEvent) => {
    if (event.key !== PROCESS_ROUTE_CHANGE_UPDATED_STORAGE_KEY || !event.newValue) return;
    try {
      const update = normalizedUpdate(JSON.parse(event.newValue));
      if (update) listener(update);
    } catch {
      // Ignore malformed state left by an older client.
    }
  };
  window.addEventListener(PROCESS_ROUTE_CHANGE_UPDATED_EVENT, customListener);
  window.addEventListener('storage', storageListener);
  return () => {
    window.removeEventListener(PROCESS_ROUTE_CHANGE_UPDATED_EVENT, customListener);
    window.removeEventListener('storage', storageListener);
  };
}
