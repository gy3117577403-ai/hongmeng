import { chinaDateKey } from '@/lib/china-date';
import { productionWeekDateValues } from '@/lib/production-week';
import { policyForWorkDate, type AttainmentPolicyChange } from '@/lib/employee-attainment-policy';
import { isEmployeeEmployedOnDate, isProductionDepartment } from '@/lib/production-workforce';

export const WORKLOAD_HOUR = 3_600_000;
export type WorkloadKind = 'plan' | 'carryover' | 'wip';
export type WorkloadStep = {
  id: string; name: string; position: number; planned: number; completed: number; remaining: number;
  reported: number; pending: number; excess: number; missingStandard: boolean; original: number; movedOut: number;
};
export type WorkloadTask = {
  id: string; workOrderId: string | null; code: string; specification: string; customer: string;
  kind: WorkloadKind; sourceWeek: string; routeVersion: number | null; steps: WorkloadStep[];
};
export type WorkloadTotals = {
  count: number; planned: number; completed: number; remaining: number; pending: number;
  reported: number; excess: number; missingStandard: number; original: number; movedOut: number; percentage: number | null;
};
export function workloadStep(input: {
  id: string; name: string; position: number; original: number; before?: number; movedOut?: number;
  reported: number; pending?: number; missingStandard?: boolean;
}): WorkloadStep {
  const safe = (n = 0) => Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  const original = Math.max(0, safe(input.original) - safe(input.before));
  const movedOut = Math.min(original, safe(input.movedOut));
  const planned = original - movedOut;
  const reported = safe(input.reported);
  const completed = Math.min(planned, reported);
  return { id: input.id, name: input.name, position: input.position, original, movedOut, planned,
    reported, completed, remaining: planned - completed, pending: Math.min(reported, safe(input.pending)),
    excess: Math.max(0, reported - planned), missingStandard: input.missingStandard === true };
}
export function workloadTotals(tasks: readonly WorkloadTask[]): WorkloadTotals {
  const result: WorkloadTotals = { count: tasks.length, planned: 0, completed: 0, remaining: 0, pending: 0,
    reported: 0, excess: 0, missingStandard: 0, original: 0, movedOut: 0, percentage: null };
  for (const task of tasks) for (const step of task.steps) {
    for (const key of ['planned', 'completed', 'remaining', 'pending', 'reported', 'excess', 'original', 'movedOut'] as const) result[key] += step[key];
    if (step.missingStandard) result.missingStandard += 1;
  }
  result.percentage = result.planned > 0 && !result.missingStandard ? Math.round(result.completed / result.planned * 1000) / 10 : null;
  return result;
}
export const workloadCoverage = (capacity: number, demand: number, incomplete = false) => demand > 0 && !incomplete
  ? Math.round(capacity / demand * 1000) / 10 : null;

/** Reported quantities earn their standard labor immediately, independently of predecessor matching.
 * Setup/batch labor is apportioned once across the target quantity, never once per reporter. */
export function reportedWorkloadMilliseconds(snapshot: {
  timeBasis?: unknown; standardMillisecondsPerUnit?: unknown; setupMilliseconds?: unknown; unitsPerProduct?: unknown;
}, quantity: number, targetQuantity: number): number {
  const standard = Number(snapshot.standardMillisecondsPerUnit || 0);
  if (!Number.isFinite(standard) || standard <= 0 || !Number.isFinite(quantity) || quantity <= 0) return 0;
  const setup = Math.max(0, Number(snapshot.setupMilliseconds || 0));
  if (snapshot.timeBasis === 'per_batch') return targetQuantity > 0 ? Math.round((standard + setup) * quantity / targetQuantity) : 0;
  if (snapshot.timeBasis !== 'per_unit') return 0;
  return Math.round(standard * Math.max(1, Number(snapshot.unitsPerProduct || 1)) * quantity
    + (targetQuantity > 0 ? setup * quantity / targetQuantity : 0));
}

export type WorkloadEmployeeInput = {
  id: string; employeeNo: string; name: string; department: string | null; team: string | null; position: string | null;
  attainmentStream: string; isActive: boolean; hireDate: Date | null; resignedAt: Date | null;
  attainmentPolicyChanges: AttainmentPolicyChange[];
};
export type WorkloadPerson = {
  id: string; employeeNo: string; name: string; team: string | null; position: string | null;
  included: boolean; reason: string; days: number; planned: number; remaining: number;
};
export function workloadExclusion(policy: { department: string | null; team: string | null; position: string | null; attainmentStream: string }): string | null {
  const description = [policy.department, policy.team, policy.position].filter(Boolean).join(' ');
  if (policy.attainmentStream === 'sample' || /样品|打样/.test(description)) return '样品人员';
  if (/组长|班长|领班|主管/.test(policy.position || '')) return '组长 / 主管';
  if (!isProductionDepartment(policy.department)) return '非生产人员';
  if (policy.attainmentStream === 'excluded') return '档案标记排除';
  return null;
}

/** Monday–Saturday, 08–12 and 13–17 Shanghai time. No attendance records or efficiency coefficient. */
export function remainingNormalMilliseconds(dateKey: string, now: Date): number {
  return [[8, 12], [13, 17]].reduce((sum, [start, end]) => {
    const from = new Date(`${dateKey}T${String(start).padStart(2, '0')}:00:00+08:00`).getTime();
    const to = new Date(`${dateKey}T${String(end).padStart(2, '0')}:00:00+08:00`).getTime();
    return sum + Math.max(0, to - Math.max(from, now.getTime()));
  }, 0);
}
export function workloadPeople(employees: readonly WorkloadEmployeeInput[], week: string, now: Date, allowedTeams?: Set<string>): WorkloadPerson[] {
  const days = productionWeekDateValues(week).slice(0, 6);
  const today = chinaDateKey(now);
  return employees.flatMap(employee => {
    let planned = 0, remaining = 0, includedDays = 0, inScope = false;
    let reason = '不在该周任职';
    const displayPolicy = policyForWorkDate(employee, employee.attainmentPolicyChanges, today < days[0] ? days[0] : today > days[5] ? days[5] : today).policy;
    for (const date of days) {
      const policy = policyForWorkDate(employee, employee.attainmentPolicyChanges, date).policy;
      if (allowedTeams && !allowedTeams.has((policy.team || '').toLocaleLowerCase('zh-CN'))) continue;
      if (!isProductionDepartment(policy.department) && !/样品|打样/.test([policy.team, policy.position].join(' '))) continue;
      inScope = true;
      if ((!employee.isActive && !employee.resignedAt) || !isEmployeeEmployedOnDate(employee, date)) continue;
      const exclusion = workloadExclusion(policy);
      if (exclusion) { reason = exclusion; continue; }
      includedDays += 1;
      planned += 8 * WORKLOAD_HOUR;
      remaining += remainingNormalMilliseconds(date, now);
    }
    if (!inScope) return [];
    return [{ id: employee.id, employeeNo: employee.employeeNo, name: employee.name, team: displayPolicy.team,
      position: displayPolicy.position, included: includedDays > 0, reason: includedDays === 6 ? '正常量产人员' : includedDays > 0 ? `本周有效 ${includedDays} 天` : reason,
      days: includedDays, planned, remaining }];
  });
}
export type ProductionWorkloadReport = {
  weekStart: string; weekEnd: string; calculatedAt: string; tasks: WorkloadTask[];
  plan: WorkloadTotals; carryover: WorkloadTotals; all: WorkloadTotals; people: WorkloadPerson[];
  capacity: { count: number; excludedCount: number; planned: number; remaining: number;
    planCoverage: number | null; outstandingCoverage: number | null; remainingCoverage: number | null; gap: number; surplus: number };
};
