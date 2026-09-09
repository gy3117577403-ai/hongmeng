import { parseAttainmentStream, attainmentEligibleFromConfiguration, parseAttainmentFactorBasisPoints } from '@/lib/attendance';
import type { AttainmentStream } from '@/types';

export type EmployeeAttainmentPolicy = {
  department: string | null;
  team: string | null;
  position: string | null;
  attendanceGroup: string;
  attainmentStream: AttainmentStream;
  attainmentEligible: boolean;
  attainmentFactorBasisPoints: number;
};
type PolicyLike = Partial<Omit<EmployeeAttainmentPolicy, 'attainmentStream'>> & { attainmentStream?: string };
export type AttainmentPolicyChange = { effectiveDate: Date | string; revision: number; beforePolicy: unknown; afterPolicy: unknown };
export class AttainmentPolicyError extends Error {
  constructor(message: string, public status = 400, public code = 'ATTAINMENT_POLICY_INVALID') { super(message); }
}
export function employeeAttainmentPolicy(value: PolicyLike): EmployeeAttainmentPolicy {
  return {
    department: value.department?.trim() || null, team: value.team?.trim() || null, position: value.position?.trim() || null,
    attendanceGroup: value.attendanceGroup || 'UNASSIGNED', attainmentStream: parseAttainmentStream(value.attainmentStream),
    attainmentEligible: value.attainmentEligible !== false,
    attainmentFactorBasisPoints: value.attainmentFactorBasisPoints ?? 10000,
  };
}
export function sameEmployeeAttainmentPolicy(a: PolicyLike, b: PolicyLike) {
  return JSON.stringify(employeeAttainmentPolicy(a)) === JSON.stringify(employeeAttainmentPolicy(b));
}
const dateKey = (value: string | Date) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
export function policyForWorkDate(fallback: PolicyLike, changes: readonly AttainmentPolicyChange[], workDate: string | Date) {
  const sorted = [...changes].sort((a, b) => dateKey(b.effectiveDate).localeCompare(dateKey(a.effectiveDate)) || b.revision - a.revision);
  const active = sorted.find(change => dateKey(change.effectiveDate) <= dateKey(workDate));
  const first = sorted[sorted.length - 1];
  return {
    policy: employeeAttainmentPolicy((active?.afterPolicy ?? first?.beforePolicy ?? fallback) as PolicyLike),
    effectiveDate: active ? dateKey(active.effectiveDate) : null,
    hasHistory: sorted.length > 0,
  };
}
export function attendancePolicySnapshot(policy: EmployeeAttainmentPolicy) {
  return {
    departmentSnapshot: policy.department, teamSnapshot: policy.team, positionSnapshot: policy.position,
    attendanceGroupSnapshot: policy.attendanceGroup, attainmentEligibleSnapshot: policy.attainmentEligible,
    attainmentFactorBasisPointsSnapshot: policy.attainmentFactorBasisPoints, attainmentStreamSnapshot: policy.attainmentStream,
  };
}
export function policyFromAttendance(record: {
  departmentSnapshot?: string | null; teamSnapshot?: string | null; positionSnapshot?: string | null;
  attendanceGroupSnapshot?: string | null; attainmentEligibleSnapshot?: boolean | null;
  attainmentFactorBasisPointsSnapshot?: number | null; attainmentStreamSnapshot?: string | null;
}, fallback: EmployeeAttainmentPolicy): EmployeeAttainmentPolicy {
  return employeeAttainmentPolicy({
    department: record.departmentSnapshot ?? fallback.department, team: record.teamSnapshot ?? fallback.team,
    position: record.positionSnapshot ?? fallback.position, attendanceGroup: record.attendanceGroupSnapshot ?? fallback.attendanceGroup,
    attainmentEligible: record.attainmentEligibleSnapshot ?? fallback.attainmentEligible,
    attainmentFactorBasisPoints: record.attainmentFactorBasisPointsSnapshot ?? fallback.attainmentFactorBasisPoints,
    attainmentStream: record.attainmentStreamSnapshot ?? fallback.attainmentStream,
  });
}
export function attendanceWritePolicy(body: Record<string, unknown>, inherited: EmployeeAttainmentPolicy, existing?: {
  attainmentPolicyOverride?: boolean; attainmentPolicyReason?: string | null;
  attainmentStreamSnapshot?: string | null; attainmentFactorBasisPointsSnapshot?: number | null;
} | null) {
  const requestedStream = parseAttainmentStream(body.attainmentStream, existing?.attainmentStreamSnapshot ? parseAttainmentStream(existing.attainmentStreamSnapshot) : inherited.attainmentStream);
  const requestedFactor = requestedStream === 'excluded' ? 0 : parseAttainmentFactorBasisPoints(body.attainmentFactorBasisPoints, existing?.attainmentFactorBasisPointsSnapshot ?? inherited.attainmentFactorBasisPoints);
  const legacyChanged = (body.attainmentStream !== undefined && requestedStream !== (existing?.attainmentStreamSnapshot ?? inherited.attainmentStream))
    || (body.attainmentFactorBasisPoints !== undefined && requestedFactor !== (existing?.attainmentFactorBasisPointsSnapshot ?? inherited.attainmentFactorBasisPoints));
  const override = body.attainmentPolicyOverride === false ? false : body.attainmentPolicyOverride === true || existing?.attainmentPolicyOverride === true || legacyChanged;
  const reason = String(body.attainmentPolicyReason ?? existing?.attainmentPolicyReason ?? body.remark ?? '').trim().slice(0, 500);
  if (override && !reason) throw new AttainmentPolicyError('请填写当天单独调整达成口径的原因');
  const policy = override ? { ...inherited, attainmentStream: requestedStream, attainmentFactorBasisPoints: requestedFactor,
    attainmentEligible: attainmentEligibleFromConfiguration(requestedFactor, requestedStream) } : inherited;
  return { ...attendancePolicySnapshot(policy), attainmentPolicyOverride: override, attainmentPolicyReason: override ? reason : null };
}
