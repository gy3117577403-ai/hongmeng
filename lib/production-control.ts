import { chinaDateKey } from '@/lib/china-date';

export const PRODUCTION_REASON_LABELS = {
  material: '缺料', quality: '品质', equipment: '设备', customer: '客户', process: '工艺', other: '其他',
} as const;
export type ProductionReason = keyof typeof PRODUCTION_REASON_LABELS;
export type ProductionNote = {
  text: string; category: ProductionReason; owner: string; followUpAt: string | null;
  updatedAt: string; updatedBy: string;
};
export type ProductionPause = {
  reason: string; category: ProductionReason; owner: string; followUpAt: string | null;
  expectedResumeAt: string | null; pausedBy: string; accumulatedMilliseconds?: number;
};
export type ProductionControlFields = {
  operationalNote?: unknown; productionPausedAt?: Date | string | null; productionPause?: unknown;
  productionControlVersion?: number; estimatedCompletionAt?: Date | string | null;
  deliveryDay?: string | null; plannedAt?: Date | string | null; deliveryBaselineDay?: string | null;
  planBaselineAt?: Date | string | null; dateBaselineSource?: string; deliveryAdjustmentCount?: number;
};
export type ProductionControlView = ReturnType<typeof serializeProductionControl>;
export const PRODUCTION_CONTROL_SELECT = {
  operationalNote: true, productionPausedAt: true, productionPause: true, productionControlVersion: true,
  estimatedCompletionAt: true, deliveryDay: true, plannedAt: true, deliveryBaselineDay: true,
  planBaselineAt: true, dateBaselineSource: true, deliveryAdjustmentCount: true,
} as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function iso(value: unknown): string | null {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function productionReason(value: unknown): ProductionReason {
  return Object.hasOwn(PRODUCTION_REASON_LABELS, String(value)) ? value as ProductionReason : 'other';
}
export function productionDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?=$|T|\s)/.exec(value);
    if (!match) return null;
    const [, y, m, d] = match;
    const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) return null;
    if (match[0] === value) return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return chinaDateKey(value instanceof Date ? value : new Date(value)) || null;
}
/** Customer risk never silently substitutes an internal planning date. */
export function productionCustomerDate(order: Pick<ProductionControlFields, 'deliveryDay'>): Date | null {
  const key = productionDateKey(order.deliveryDay);
  return key ? new Date(`${key}T00:00:00+08:00`) : null;
}
export function productionEstimatedDate(order: ProductionControlFields): Date | null {
  const key = productionDateKey(order.estimatedCompletionAt || order.plannedAt);
  return key ? new Date(`${key}T00:00:00+08:00`) : null;
}
export function serializeProductionControl(order: ProductionControlFields) {
  const note = object(order.operationalNote);
  const pause = object(order.productionPause);
  const pausedAt = iso(order.productionPausedAt);
  return {
    version: order.productionControlVersion || 0,
    pausedAt,
    note: typeof note.text === 'string' && note.text ? {
      text: note.text, category: productionReason(note.category), owner: String(note.owner || ''),
      followUpAt: iso(note.followUpAt), updatedAt: String(note.updatedAt || ''), updatedBy: String(note.updatedBy || ''),
    } as ProductionNote : null,
    pause: pausedAt ? {
      reason: String(pause.reason || ''), category: productionReason(pause.category), owner: String(pause.owner || ''),
      followUpAt: iso(pause.followUpAt), expectedResumeAt: iso(pause.expectedResumeAt), pausedBy: String(pause.pausedBy || ''),
    } as ProductionPause : null,
    accumulatedPauseMilliseconds: typeof pause.accumulatedMilliseconds === 'number' ? pause.accumulatedMilliseconds : 0,
    customerDueDate: productionDateKey(order.deliveryDay),
    estimatedCompletionDate: productionDateKey(order.estimatedCompletionAt || order.plannedAt),
    deliveryBaselineDate: productionDateKey(order.deliveryBaselineDay || order.deliveryDay),
    planBaselineDate: productionDateKey(order.planBaselineAt || order.plannedAt),
    dateBaselineSource: order.dateBaselineSource || 'initial',
    adjustmentCount: order.deliveryAdjustmentCount || 0,
  };
}
export function canManageProductionControl(subject: { access: { capabilities: readonly string[] } }): boolean {
  return subject.access.capabilities.includes('PLANNING:UPDATE') || subject.access.capabilities.includes('PRODUCTION:UPDATE');
}
export function canAdjustProductionDates(subject: { access: { capabilities: readonly string[]; effectiveGrants?: readonly { profile: string; departmentCode?: string | null }[] } }): boolean {
  return subject.access.capabilities.includes('PLANNING:UPDATE') && Boolean(subject.access.effectiveGrants?.some(grant =>
    grant.profile === 'ADMIN_GLOBAL' || (grant.profile === 'DEPARTMENT_FULL' && grant.departmentCode === 'PLANNING')));
}

export class ProductionControlError extends Error {
  constructor(message: string, public readonly code = 'PRODUCTION_CONTROL_INVALID', public readonly status = 400) {
    super(message);
    this.name = 'ProductionControlError';
  }
}
