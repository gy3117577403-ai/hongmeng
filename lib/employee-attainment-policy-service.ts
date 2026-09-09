import { createHash } from 'node:crypto';
import { Prisma, type Employee } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chinaTodayDateKey, parseWorkDate, parseAttainmentStream, parseAttainmentFactorBasisPoints, attainmentEligibleFromConfiguration } from '@/lib/attendance';
import { parseOptionalAttendanceGroup } from '@/lib/attendance-groups';
import { employeeAccessAdminInclude, departmentRecordSelect, resolveEmployeeDepartmentInput } from '@/lib/employee-access-admin';
import { cleanProcessText } from '@/lib/process-time';
import { AttainmentPolicyError, employeeAttainmentPolicy, attendancePolicySnapshot, policyFromAttendance, policyForWorkDate, type EmployeeAttainmentPolicy } from '@/lib/employee-attainment-policy';

type Client = Pick<Prisma.TransactionClient, 'employeeAttainmentPolicyChange' | 'attendanceRecord' | 'otherWorkTimeRequest'>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function inputDigest(employeeId: string, target: EmployeeAttainmentPolicy, effectiveDate: string, reason: string, body: Record<string, unknown>) {
  // Bind the reviewed profile fields as well as the policy; transport token and retry ID are excluded.
  const profile = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'attainmentChange').sort(([a], [b]) => a.localeCompare(b)));
  return digest({ employeeId, target, effectiveDate, reason, profile });
}

export async function employeePolicyChanges(client: Client, employeeIds: string[]) {
  const changes = employeeIds.length ? await client.employeeAttainmentPolicyChange.findMany({
    where: { employeeId: { in: employeeIds } }, orderBy: [{ effectiveDate: 'desc' }, { revision: 'desc' }],
  }) : [];
  const grouped = new Map<string, typeof changes>();
  for (const change of changes) grouped.set(change.employeeId, [...(grouped.get(change.employeeId) || []), change]);
  return grouped;
}
export async function employeePolicyOnDate(client: Client, employee: Parameters<typeof employeeAttainmentPolicy>[0] & { id: string }, date: string | Date) {
  const changes = await client.employeeAttainmentPolicyChange.findMany({ where: { employeeId: employee.id }, orderBy: [{ effectiveDate: 'desc' }, { revision: 'desc' }] });
  return policyForWorkDate(employee, changes, date);
}
export async function previewTarget(employee: Employee, body: Record<string, unknown>): Promise<EmployeeAttainmentPolicy> {
  const department = await resolveEmployeeDepartmentInput(body, lookup => prisma.department.findFirst({
    where: { isActive: true, ...lookup }, select: departmentRecordSelect,
  }));
  if (body.attainmentStream !== undefined && !['batch', 'sample', 'excluded'].includes(String(body.attainmentStream))) throw new AttainmentPolicyError('请选择有效的统计分账');
  const stream = body.attainmentEligible === false ? 'excluded'
    : body.attainmentEligible === true && body.attainmentStream === undefined ? 'batch'
      : parseAttainmentStream(body.attainmentStream, parseAttainmentStream(employee.attainmentStream));
  const factor = stream === 'excluded' ? 0 : parseAttainmentFactorBasisPoints(body.attainmentFactorBasisPoints,
    body.attainmentEligible === true && employee.attainmentFactorBasisPoints === 0 ? 10000 : employee.attainmentFactorBasisPoints);
  return employeeAttainmentPolicy({ ...employee,
    department: department ? department.department : employee.department,
    team: body.team === undefined ? employee.team : cleanProcessText(body.team, 80) || null,
    position: body.position === undefined ? employee.position : cleanProcessText(body.position, 80) || null,
    attendanceGroup: body.attendanceGroup === undefined ? employee.attendanceGroup : parseOptionalAttendanceGroup(body.attendanceGroup) ?? 'UNASSIGNED',
    attainmentStream: stream, attainmentEligible: attainmentEligibleFromConfiguration(factor, stream), attainmentFactorBasisPoints: factor,
  });
}
function changeInput(employee: Employee, body: Record<string, unknown>) {
  const change = body.attainmentChange as Record<string, unknown> | undefined;
  if (!change || typeof change !== 'object') throw new AttainmentPolicyError('调岗或达成口径变更需要生效日期及影响预览', 409, 'ATTAINMENT_EFFECTIVE_DATE_REQUIRED');
  const date = parseWorkDate(change.effectiveDate);
  if (date.key > chinaTodayDateKey()) throw new AttainmentPolicyError('请在调岗生效当天或之后办理，不能提前改变当前档案');
  if ((employee.hireDate && date.value < employee.hireDate) || (employee.resignedAt && date.value >= employee.resignedAt)) throw new AttainmentPolicyError('生效日期必须在员工任职期间');
  const reason = cleanProcessText(change.reason, 500);
  if (!reason) throw new AttainmentPolicyError('请填写调岗或历史口径修正原因');
  return { change, date, reason };
}
async function impactFor(client: Client, employee: Employee, target: EmployeeAttainmentPolicy, body: Record<string, unknown>) {
  const { change, date, reason } = changeInput(employee, body);
  const latest = await client.employeeAttainmentPolicyChange.findFirst({ where: { employeeId: employee.id }, orderBy: [{ effectiveDate: 'desc' }, { revision: 'desc' }] });
  if (latest && date.value < latest.effectiveDate) throw new AttainmentPolicyError(`已有 ${latest.effectiveDate.toISOString().slice(0, 10)} 生效的后续调岗记录。更早日期请在考勤中单独修正，避免覆盖后续调岗。`, 409);
  const priorAttendance = !latest ? await client.attendanceRecord.findFirst({ where: { employeeId: employee.id,
    workDate: { lt: date.value }, status: 'confirmed', attainmentPolicyOverride: false, attainmentStreamSnapshot: { not: null } }, orderBy: { workDate: 'desc' } }) : null;
  const priorPolicy = priorAttendance ? policyFromAttendance(priorAttendance, employeeAttainmentPolicy(employee)) : employeeAttainmentPolicy(employee);
  const attendance = await client.attendanceRecord.findMany({ where: { employeeId: employee.id, workDate: { gte: date.value } }, orderBy: { workDate: 'asc' }, take: 2001 });
  if (attendance.length > 2000) throw new AttainmentPolicyError('本次涉及超过 2000 天，请缩小生效范围');
  const other = await client.otherWorkTimeRequest.findMany({ where: { employeeId: employee.id, workDate: { gte: date.value } }, orderBy: { id: 'asc' }, take: 10001 });
  if (other.length > 10000) throw new AttainmentPolicyError('本次其他工时记录过多，请缩小生效范围');
  const overrideDates = new Set(attendance.filter(row => row.attainmentPolicyOverride).map(row => row.workDate.toISOString().slice(0, 10)));
  const writable = attendance.filter(row => !row.attainmentPolicyOverride);
  const writableOther = other.filter(row => !overrideDates.has(row.workDate.toISOString().slice(0, 10)));
  const inputHash = inputDigest(employee.id, target, date.key, reason, body);
  const token = digest({ inputHash, employeeUpdatedAt: employee.updatedAt, lastRevision: latest?.revision,
    priorAttendance: priorAttendance ? [priorAttendance.id, priorAttendance.updatedAt, priorPolicy] : null,
    attendance: attendance.map(row => [row.id, row.updatedAt, row.attainmentPolicyOverride, row.attainmentStreamSnapshot, row.status, row.actualMilliseconds]),
    other: other.map(row => [row.id, row.updatedAt, row.version, row.status]) });
  const preview = {
    token, employeeId: employee.id, employeeNo: employee.employeeNo, employeeName: employee.name, effectiveDate: date.key, reason,
    before: employeeAttainmentPolicy(employee), after: target,
    priorPolicy, priorPolicySource: priorAttendance ? priorAttendance.workDate.toISOString().slice(0, 10) : null,
    attendanceCount: writable.length, confirmedCount: writable.filter(row => row.status === 'confirmed').length,
    preservedOverrideCount: overrideDates.size, otherWorkCount: writableOther.length,
    dates: attendance.map(row => ({ date: row.workDate.toISOString().slice(0, 10), status: row.status,
      attendanceHours: row.actualMilliseconds / 3600000, previousStream: row.attainmentStreamSnapshot ?? employee.attainmentStream,
      nextStream: row.attainmentPolicyOverride ? row.attainmentStreamSnapshot ?? employee.attainmentStream : target.attainmentStream,
      preserved: row.attainmentPolicyOverride, reason: row.attainmentPolicyReason })),
  };
  return { preview, writable, writableOther, inputHash, change, date, reason };
}
export async function previewEmployeeAttainmentChange(employee: Employee, target: EmployeeAttainmentPolicy, body: Record<string, unknown>) {
  return (await impactFor(prisma, employee, target, body)).preview;
}
export async function applyEmployeeAttainmentChange(employeeId: string, actorId: string, target: EmployeeAttainmentPolicy,
  body: Record<string, unknown>, employeeUpdate: Prisma.EmployeeUpdateInput) {
  const requestId = String((body.attainmentChange as Record<string, unknown> | undefined)?.requestId || '');
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new AttainmentPolicyError('缺少变更提交标识，请重新预览');
  try {
    return await prisma.$transaction(async tx => {
      // Shared with other-hours writes, so pending approvals and historical scope corrections cannot race.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`other-work:${employeeId}`}))`;
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const input = changeInput(employee, body);
      const expectedHash = inputDigest(employeeId, target, input.date.key, input.reason, body);
      const previous = await tx.employeeAttainmentPolicyChange.findUnique({ where: { employeeId_requestId: { employeeId, requestId } } });
      if (previous) {
        if (previous.requestHash !== expectedHash || previous.actorId !== actorId) throw new AttainmentPolicyError('该提交标识已用于其他变更', 409);
        return { employee: await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeAccessAdminInclude }), impact: previous.impact };
      }
      const impact = await impactFor(tx, employee, target, body);
      if (impact.change.token !== impact.preview.token) throw new AttainmentPolicyError('档案或考勤在预览后发生了变化，请重新预览再保存', 409, 'ATTAINMENT_PREVIEW_STALE');
      for (const row of impact.writable) {
        const changed = await tx.attendanceRecord.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, attainmentPolicyOverride: false },
          data: { ...attendancePolicySnapshot(target), updatedById: actorId } });
        if (changed.count !== 1) throw new AttainmentPolicyError('考勤刚被修改，请重新预览', 409, 'ATTAINMENT_PREVIEW_STALE');
      }
      const team = target.team ? await tx.productionTeam.findFirst({ where: { OR: [{ name: target.team }, { legacyTeamName: target.team }, { code: target.team }] } }) : null;
      for (const row of impact.writableOther) {
        const changed = await tx.otherWorkTimeRequest.updateMany({ where: { id: row.id, version: row.version }, data: {
          attainmentEligibleSnapshot: target.attainmentEligible, attainmentStreamSnapshot: target.attainmentStream,
          teamSnapshot: target.team, teamIdSnapshot: team?.id ?? null, version: { increment: 1 },
        } });
        if (changed.count !== 1) throw new AttainmentPolicyError('其他工时刚被处理，请重新预览', 409, 'ATTAINMENT_PREVIEW_STALE');
        await tx.otherWorkTimeReview.create({ data: { requestId: row.id, actorId, action: 'POLICY_CHANGE', requestVersion: row.version + 1,
          reason: impact.reason, detail: { effectiveDate: impact.date.key, before: { stream: row.attainmentStreamSnapshot, team: row.teamSnapshot },
            after: { stream: target.attainmentStream, team: target.team } } } });
        if (row.status === 'PENDING') {
          const { refreshOtherWorkAfterPolicyChange } = await import('@/lib/other-work-time-service');
          await refreshOtherWorkAfterPolicyChange(tx, row.id, actorId);
        }
      }
      const audit = { ...impact.preview,
        attendanceBefore: impact.writable.map(row => ({ id: row.id, date: row.workDate.toISOString().slice(0, 10),
          department: row.departmentSnapshot, team: row.teamSnapshot, position: row.positionSnapshot, attendanceGroup: row.attendanceGroupSnapshot,
          eligible: row.attainmentEligibleSnapshot, stream: row.attainmentStreamSnapshot, factor: row.attainmentFactorBasisPointsSnapshot })),
        otherBefore: impact.writableOther.map(row => ({ id: row.id, version: row.version, team: row.teamSnapshot, teamId: row.teamIdSnapshot,
          eligible: row.attainmentEligibleSnapshot, stream: row.attainmentStreamSnapshot })),
      };
      await tx.employeeAttainmentPolicyChange.create({ data: { employeeId, effectiveDate: impact.date.value,
        beforePolicy: impact.preview.priorPolicy, afterPolicy: target, reason: impact.reason,
        actorId, requestId, requestHash: impact.inputHash, impact: audit as Prisma.InputJsonValue } });
      const updated = await tx.employee.update({ where: { id: employeeId }, data: employeeUpdate, include: employeeAccessAdminInclude });
      return { employee: updated, impact: impact.preview };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2034') throw new AttainmentPolicyError('档案或考勤正在被其他人修改，请重新预览后保存', 409, 'ATTAINMENT_PREVIEW_STALE');
    throw error;
  }
}
