import type { Prisma } from '@prisma/client';
import { ForbiddenError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const reviewInclude = {
  allocations: { include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' as const } } },
  qualityConfirmedBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  workOrder: { select: { id: true, code: true, customerName: true, specification: true, productName: true } },
  processStep: { select: { id: true, processCode: true, processName: true } },
  reportedByEmployee: true,
} satisfies Prisma.AbnormalTimeEventInclude;

export type AbnormalTimeReviewDecision = 'confirmed' | 'rejected';

export async function reviewAbnormalTimeEvent(input: {
  eventId: string;
  reviewerId: string;
  decision: AbnormalTimeReviewDecision;
  note: string | null;
  expectedVersion?: number;
  canReviewEmployeeIds: (employeeIds: readonly string[]) => Promise<boolean>;
}) {
  return prisma.$transaction(async tx => {
    const existing = await tx.abnormalTimeEvent.findFirst({
      where: { id: input.eventId, deletedAt: null },
      include: { allocations: true },
    });
    if (!existing) throw new Error('异常工时记录不存在');
    if (!(await input.canReviewEmployeeIds(existing.allocations.map(item => item.employeeId)))) {
      throw new ForbiddenError();
    }

    const expectedVersion = input.expectedVersion ?? existing.version;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== existing.version) {
      throw new Error('异常记录已被其他人更新，请刷新后重新审核');
    }

    const employeeExempt = input.decision === 'confirmed';
    const updated = await tx.abnormalTimeEvent.updateMany({
      where: { id: existing.id, version: existing.version },
      data: {
        qualityStatus: input.decision,
        qualityNote: input.note,
        // Duration-only accounting: approval always recognizes the exact filed
        // duration. It is not clipped by attendance, production, or other events.
        approvedDurationMilliseconds: input.decision === 'confirmed'
          ? existing.durationMilliseconds
          : null,
        employeeExempt,
        qualityConfirmedById: input.reviewerId,
        qualityConfirmedAt: new Date(),
        updatedById: input.reviewerId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new Error('异常记录已被其他人更新，请刷新后重新审核');
    }
    return tx.abnormalTimeEvent.findUniqueOrThrow({
      where: { id: existing.id },
      include: reviewInclude,
    });
  });
}
