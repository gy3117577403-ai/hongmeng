import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type OperationLogInput = {
  userId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Prisma.InputJsonValue | null;
};

export async function logOp(d: OperationLogInput) {
  try {
    await prisma.operationLog.create({
      data: {
        userId: d.userId ?? null,
        action: d.action,
        targetType: d.targetType ?? null,
        targetId: d.targetId ?? null,
        detail: d.detail ?? undefined,
      },
    });
  } catch (e) {
    console.error('operation log failed', e);
  }
}
