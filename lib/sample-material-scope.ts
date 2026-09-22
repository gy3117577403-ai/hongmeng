import type { Prisma } from '@prisma/client';
import { chinaDateKey } from '@/lib/china-date';
/** Sample plan dates are DATE columns, independent of production work-order weeks. */
export function sampleMaterialScope(scope: string, current: Date, selected: Date): Prisma.SampleTaskWhereInput {
  const week = new Date(chinaDateKey(selected));
  const currentWeek = new Date(chinaDateKey(current));
  return {
    deletedAt: null, dataPurpose: 'PRODUCTION', status: { not: 'CANCELLED' },
    ...(scope === 'current' ? { OR: [
      { planWeekStartDate: week },
      { status: { notIn: ['COMPLETED','CANCELLED'] }, OR: [{ planWeekStartDate: null }, { planWeekStartDate: { lt: currentWeek } }] },
    ] } : { planWeekStartDate: week }),
  };
}
