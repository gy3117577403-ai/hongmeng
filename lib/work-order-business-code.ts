import type { Prisma } from '@prisma/client';

type WorkOrderCodeInput = {
  specification?: string | null;
  productName?: string | null;
  startedAt?: Date | null;
  plannedAt?: Date | null;
  orderDate?: Date | null;
  createdAt?: Date | null;
};

function chinaDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}${part('month')}${part('day')}`;
}

export function businessProductKey(input: Pick<WorkOrderCodeInput, 'specification' | 'productName'>): string {
  const source = String(input.specification || input.productName || 'PRODUCT').trim().toUpperCase();
  const normalized = source
    .replace(/[^A-Z0-9\u3400-\u9FFF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized || 'PRODUCT';
}

export function businessWorkOrderCodeBase(input: WorkOrderCodeInput, now = new Date()): string {
  const date = input.startedAt || input.plannedAt || input.orderDate || input.createdAt || now;
  return `SC-HL-${chinaDateKey(date)}-${businessProductKey(input)}`;
}

export async function allocateBusinessWorkOrderCode(
  tx: Prisma.TransactionClient,
  input: WorkOrderCodeInput,
): Promise<string> {
  const base = businessWorkOrderCodeBase(input);
  const existing = await tx.workOrder.findMany({
    where: { businessCode: { startsWith: `${base}-` } },
    select: { businessCode: true },
  });
  const largest = existing.reduce((max, item) => {
    const suffix = Number(item.businessCode?.slice(base.length + 1));
    return Number.isSafeInteger(suffix) && suffix > max ? suffix : max;
  }, 0);
  return `${base}-${String(largest + 1).padStart(2, '0')}`;
}

export function branchBusinessWorkOrderCode(
  parentBusinessCode: string | null | undefined,
  fallback: WorkOrderCodeInput,
  tag: string,
  sequence: number,
): string {
  const parent = String(parentBusinessCode || businessWorkOrderCodeBase(fallback)).trim();
  return `${parent}-${tag}${String(sequence).padStart(2, '0')}`.slice(0, 120);
}
