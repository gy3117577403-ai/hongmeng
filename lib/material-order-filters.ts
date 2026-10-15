import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export const materialCompletionWhere: Prisma.WarehouseMaterialExceptionCaseWhereInput = {
  shortageQuantity: null, arrivalOutcome: { not: 'PARTIAL' },
  AND: [
    { arrivals: { some: { status: 'VERIFIED', acceptedQuantity: { gt: 0 } } } },
    { arrivals: { none: { OR: [{ status: { in: ['ARRIVED', 'SHIPPED'] } }, { status: 'VERIFIED', rejectedQuantity: { gt: 0 } }] } } },
  ],
};
const fullAwaitingVerification: Prisma.WarehouseMaterialExceptionCaseWhereInput = {
  shortageQuantity: { not: null, lte: prisma.warehouseMaterialExceptionCase.fields.receivedQuantity },
  arrivals: { some: { status: 'ARRIVED' } },
};

// Source and progress must belong to the same exception, also for the counters.
export function materialOrderFilterWhere(status: string, source = 'ALL', today = new Date()): Prisma.WarehouseMaterialTaskWhereInput {
  const sourceWhere = source === 'ALL' ? {} : { supplySource: source };
  const sourceScope: Prisma.WarehouseMaterialTaskWhereInput = source === 'ALL' ? {} : { exceptionCases: { some: sourceWhere } };
  const open = { ...sourceWhere, status: 'OPEN' as const };
  const midnight = new Date(today.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00+08:00');
  switch (status) {
    case 'shortage': return { exceptionCases: { some: { ...open, NOT: [materialCompletionWhere, fullAwaitingVerification] } } };
    case 'completion': return { exceptionCases: { some: { ...open, ...materialCompletionWhere } } };
    case 'waiting': return { exceptionCases: { some: { ...open, arrivals: { some: { status: 'ARRIVED' } } } } };
    case 'unknown': return { exceptionCases: { some: { ...open, NOT: [materialCompletionWhere, fullAwaitingVerification], expectedArrivalAt: null, OR: [{ followUpTask: { is: null } }, { followUpTask: { is: { status: { not: 'WAITING_WAREHOUSE' } } } }] } } };
    case 'late': return { exceptionCases: { some: { ...open, NOT: [materialCompletionWhere, fullAwaitingVerification], expectedArrivalAt: { lt: midnight }, followUpTask: { is: { status: { not: 'WAITING_WAREHOUSE' } } } } } };
    case 'active': return { AND: [sourceScope, { OR: [{ status: { not: 'completed' } }, { exceptionCases: { some: { status: 'OPEN' } } }] }] };
    case 'ready': return { AND: [sourceScope, { status: 'completed', exceptionCases: { none: { status: 'OPEN' } } }] };
    case 'unchecked': return { AND: [sourceScope, { status: 'pending', exceptionCases: { none: {} } }] };
    default: return sourceScope;
  }
}
