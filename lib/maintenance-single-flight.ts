export type MaintenanceFlight = {
  requestId: string;
  phase: string;
  startedAt: string;
};

export type MaintenanceSingleFlightResult<T> =
  | { started: true; value: T }
  | { started: false; active: MaintenanceFlight; activeForMs: number };

/**
 * Serializes maintenance work inside one application process. The check and
 * claim happen synchronously before the first await, so a timed-out caller
 * cannot start another phase while its original handler is still running.
 */
export class MaintenanceSingleFlightGate {
  private active: (MaintenanceFlight & { startedAtMs: number }) | null = null;

  async run<T>(
    input: { requestId: string; phase: string; now?: Date },
    execute: () => Promise<T>,
  ): Promise<MaintenanceSingleFlightResult<T>> {
    if (this.active) {
      const { startedAtMs, ...active } = this.active;
      return {
        started: false,
        active,
        activeForMs: Math.max(0, Date.now() - startedAtMs),
      };
    }

    const now = input.now || new Date();
    const claimed = {
      requestId: input.requestId,
      phase: input.phase,
      startedAt: now.toISOString(),
      startedAtMs: now.getTime(),
    };
    this.active = claimed;
    try {
      return { started: true, value: await execute() };
    } finally {
      if (this.active === claimed) this.active = null;
    }
  }
}

const globalMaintenance = globalThis as typeof globalThis & {
  backgroundMaintenanceGate?: MaintenanceSingleFlightGate;
};

export const backgroundMaintenanceGate =
  globalMaintenance.backgroundMaintenanceGate || new MaintenanceSingleFlightGate();

globalMaintenance.backgroundMaintenanceGate = backgroundMaintenanceGate;
