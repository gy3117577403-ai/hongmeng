import type { ProductionEntityScope } from '@/lib/production-access-scope';

export type ProductionReadOperation =
  | 'execution'
  | 'summary'
  | 'execution_csv'
  | 'dispatch_xlsx'
  | 'dispatch_print';

export type ProductionReadFlight = {
  requestId: string;
  operation: ProductionReadOperation;
  startedAt: string;
};

export type ProductionReadResult<T> =
  | { started: true; shared: boolean; value: T }
  | { started: false; active: ProductionReadFlight; activeForMs: number };

type ActiveProductionRead = ProductionReadFlight & {
  key: string;
  startedAtMs: number;
  promise: Promise<unknown>;
};

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

/**
 * The scope fingerprint is part of every shared-read key. Equivalent readers
 * may share immutable result data, but TEAM/GLOBAL and read-only/write-capable
 * views can never cross-contaminate one another.
 */
export function productionReadKey(
  operation: ProductionReadOperation,
  scope: ProductionEntityScope,
  input: Record<string, unknown>,
): string {
  return JSON.stringify(canonicalValue({
    operation,
    scope: {
      level: scope.level,
      readOnly: scope.readOnly,
      teamKeys: [...scope.teamKeys].map(key => key.trim()).sort((left, right) => left.localeCompare(right)),
    },
    input,
  }));
}

/**
 * One expensive production read may own the process at a time. Identical
 * requests join that work; distinct requests fail fast instead of queueing and
 * consuming every Prisma connection while the Node request loop is busy.
 * Settled values are deliberately not cached so writes remain immediately
 * visible; this is active-request coalescing, not a stale snapshot cache.
 */
export class ProductionReadCoordinator {
  private active: ActiveProductionRead | null = null;

  async run<T>(
    input: {
      key: string;
      requestId: string;
      operation: ProductionReadOperation;
      now?: Date;
    },
    execute: () => Promise<T>,
  ): Promise<ProductionReadResult<T>> {
    if (this.active) {
      if (this.active.key === input.key) {
        return {
          started: true,
          shared: true,
          value: await this.active.promise as T,
        };
      }
      const { key: _key, startedAtMs, promise: _promise, ...active } = this.active;
      return {
        started: false,
        active,
        activeForMs: Math.max(0, Date.now() - startedAtMs),
      };
    }

    const now = input.now || new Date();
    const promise = Promise.resolve().then(execute);
    const claimed: ActiveProductionRead = {
      key: input.key,
      requestId: input.requestId,
      operation: input.operation,
      startedAt: now.toISOString(),
      startedAtMs: now.getTime(),
      promise,
    };
    this.active = claimed;
    try {
      return { started: true, shared: false, value: await promise };
    } finally {
      if (this.active === claimed) this.active = null;
    }
  }
}

const globalProductionRead = globalThis as typeof globalThis & {
  productionReadCoordinator?: ProductionReadCoordinator;
};

export const productionReadCoordinator =
  globalProductionRead.productionReadCoordinator || new ProductionReadCoordinator();

globalProductionRead.productionReadCoordinator = productionReadCoordinator;
