import {chinaDateKey} from './china-date';

/**
 * Prisma represents PostgreSQL DATE columns as Date values. Convert the
 * current instant to the Shanghai business date and compare at UTC midnight,
 * so an effectiveTo date remains active for that entire business day.
 */
export function productionPlanningDateBoundary(value = new Date()): Date {
  const dateKey = chinaDateKey(value);
  if (!dateKey) throw new RangeError('A valid date is required');
  return new Date(`${dateKey}T00:00:00.000Z`);
}
