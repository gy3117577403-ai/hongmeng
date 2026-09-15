import { prisma } from '@/lib/prisma';
import { dateKeyFromDatabase } from '@/lib/attendance';
import { distributeReportedLabor, submittedWorkMilliseconds, type EmployeeWorkRecord } from '@/lib/employee-realtime-hours';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Read the original submission until its linked completion/claims take over, never both. */
export async function loadUncreditedEmployeeWork(start: Date, end: Date, employeeIds: string[]): Promise<EmployeeWorkRecord[]> {
  if (!employeeIds.length) return [];
  const allowed = new Set(employeeIds);
  const [completions, submissions] = await Promise.all([
    prisma.processCompletion.findMany({
      where: { voidedAt: null, workDate: { gte: start, lt: end },
        OR: [{ participants: { some: { employeeId: { in: employeeIds } } } }, { principalEmployeeId: { in: employeeIds } }] },
      include: { participants: true, laborPool: { include: { claims: { select: { id: true } } } },
        workOrder: { select: { code: true, specification: true, productionTargetQty: true } },
        step: { select: { processName: true } } },
    }),
    prisma.processReportSubmission.findMany({
      where: { status: 'PENDING', completionId: null, workDate: { gte: start, lt: end } },
      include: { workOrder: { select: { code: true, specification: true, productionTargetQty: true } },
        step: { select: { processName: true } } },
    }),
  ]);
  const records: EmployeeWorkRecord[] = [];
  for (const completion of completions) {
    // A deliberate claim withdrawal must not silently regenerate the same person's credit.
    if (completion.laborPool?.status === 'VOIDED' || completion.laborPool?.claims.length) continue;
    const ids = completion.participants.map(participant => participant.employeeId);
    if (!ids.length && completion.principalEmployeeId) ids.push(completion.principalEmployeeId);
    const knownPool = Number(completion.laborPool?.totalStandardLaborMilliseconds || 0n);
    const calculated = knownPool > 0 ? { milliseconds: knownPool, basis: 'standard' as const }
      : submittedWorkMilliseconds({ ...completion, quantity: completion.processedQty,
        targetQuantity: completion.workOrder.productionTargetQty || undefined });
    // Explicit elapsed duration is per person. Standard production labor is shared once.
    const shares = calculated.basis === 'reported_duration'
      ? [...new Set(ids)].map(employeeId => ({ employeeId, milliseconds: calculated.milliseconds }))
      : distributeReportedLabor(calculated.milliseconds, ids);
    for (const share of shares) {
      if (!allowed.has(share.employeeId)) continue;
      const pending = completion.processedQty > 0 ? Math.round(share.milliseconds
        * Math.max(0, completion.processedQty - completion.coveredQty) / completion.processedQty) : 0;
      records.push({ id: `completion:${completion.id}:${share.employeeId}`, employeeId: share.employeeId,
        workDate: dateKeyFromDatabase(completion.workDate), type: 'production', source: 'completion', sourceId: completion.id,
        title: completion.step.processName, processName: completion.step.processName,
        workOrderCode: completion.workOrder.code, specification: completion.workOrder.specification,
        milliseconds: share.milliseconds, pendingMatchingMilliseconds: pending, pendingReviewMilliseconds: 0,
        reportedDurationMilliseconds: calculated.basis === 'reported_duration' ? share.milliseconds : 0,
        missingTime: calculated.basis === 'missing',
        state: calculated.basis === 'missing' ? 'missing_time' : pending > 0 ? 'pending_match' : 'recorded',
        recordedAt: completion.completedAt.toISOString() });
    }
  }
  for (const submission of submissions) {
    const payload = object(submission.payload);
    const snapshot = object(submission.snapshot);
    const ids = Array.isArray(payload.employeeIds) ? payload.employeeIds.filter((id): id is string => typeof id === 'string') : [];
    if (!ids.length && typeof payload.principalEmployeeId === 'string') ids.push(payload.principalEmployeeId);
    const quantity = snapshot.reportQuantityBasis === 'action' ? Number(payload.reportedUnitQty || 0)
      : Number(payload.processedQty || 0);
    const calculated = submittedWorkMilliseconds({ ...snapshot,
      unitsPerProduct: snapshot.reportQuantityBasis === 'action' ? 1 : snapshot.unitsPerProduct,
      quantity, targetQuantity: Number(snapshot.targetQuantity || submission.workOrder.productionTargetQty || 0),
      workStartedAt: payload.workStartedAt, workEndedAt: payload.workEndedAt });
    const shares = calculated.basis === 'reported_duration'
      ? [...new Set(ids)].map(employeeId => ({ employeeId, milliseconds: calculated.milliseconds }))
      : distributeReportedLabor(calculated.milliseconds, ids);
    for (const share of shares) {
      if (!allowed.has(share.employeeId)) continue;
      records.push({ id: `submission:${submission.id}:${share.employeeId}`, employeeId: share.employeeId,
        workDate: dateKeyFromDatabase(submission.workDate), type: 'production', source: 'submission', sourceId: submission.id,
        title: submission.step.processName, processName: submission.step.processName,
        workOrderCode: submission.workOrder.code, specification: submission.workOrder.specification,
        milliseconds: share.milliseconds, pendingMatchingMilliseconds: share.milliseconds, pendingReviewMilliseconds: 0,
        reportedDurationMilliseconds: calculated.basis === 'reported_duration' ? share.milliseconds : 0,
        missingTime: calculated.basis === 'missing', state: calculated.basis === 'missing' ? 'missing_time' : 'pending_match',
        recordedAt: submission.createdAt.toISOString() });
    }
  }
  return records;
}
