import { Prisma, ProcessRouteChangeOutboxStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createSystemNotification,
  eligibleUserIdsForCapability,
} from '@/lib/system-notifications';
import {
  isProcessRouteStageEvent,
  PROCESS_ROUTE_STAGE_EVENTS,
  processStageNotificationIsCurrent,
  type ProcessRouteStatusValue,
} from '@/lib/process-route-notification-lifecycle';
import { WECOM_POLICY_BLOCK_REASON } from '@/lib/wecom-notification-policy';

export { processStageNotificationIsCurrent } from '@/lib/process-route-notification-lifecycle';

const MAX_ATTEMPTS = 8;

type OutboxPayload = {
  changeId?: string;
  workOrderId?: string;
  routeId?: string;
  obligationId?: string;
  processName?: string;
  actor?: string;
  fromStatus?: string;
  toStatus?: string;
};

const TERMINAL_PROCESS_NOTIFICATION_EVENTS = new Set([
  'PROCESS_ROUTE_CHANGE_REJECTED',
  'PROCESS_ROUTE_CHANGE_ACTIVATED',
  'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED',
]);

export type ProcessNotificationLifecyclePolicy = {
  initiallyCompleted: boolean;
  supersedeScope: 'change' | 'obligation' | 'none';
};

/**
 * ACTIVATING is a lease-like intermediate state and FAILED is recoverable, so
 * neither may hide the last actionable notification. Supplement notifications
 * can supersede one another only when obligationId is present; changeId alone
 * is not precise when a route change created multiple supplement obligations.
 */
export function processNotificationLifecyclePolicy(
  eventType: string,
  obligationId?: string | null,
): ProcessNotificationLifecyclePolicy {
  if (isProcessRouteStageEvent(eventType)) {
    return {
      initiallyCompleted: TERMINAL_PROCESS_NOTIFICATION_EVENTS.has(eventType),
      supersedeScope: 'change',
    };
  }
  if (
    eventType === 'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED'
    || eventType === 'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED'
  ) {
    return {
      // REPORTED is a progress receipt, not a new task. Keep it in history
      // immediately even when a legacy payload lacks obligationId.
      initiallyCompleted: true,
      supersedeScope: obligationId ? 'obligation' : 'none',
    };
  }
  return { initiallyCompleted: false, supersedeScope: 'none' };
}

export async function reconcileProcessNotificationLifecycle(
  tx: Prisma.TransactionClient,
  input: {
    notificationId: string;
    changeId: string;
    eventType: string;
    obligationId?: string | null;
    stageIsCurrent?: boolean;
    now?: Date;
  },
): Promise<number> {
  const declaredLifecycle = processNotificationLifecyclePolicy(input.eventType, input.obligationId);
  const lifecycle = input.stageIsCurrent === false
    ? { initiallyCompleted: true, supersedeScope: 'none' as const }
    : declaredLifecycle;
  const now = input.now || new Date();
  let completedRecipientCount = 0;
  if (lifecycle.supersedeScope !== 'none') {
    const superseded = await tx.systemNotificationRecipient.updateMany({
      where: {
        OR: [{ completedAt: null }, { completionKind: 'MANUAL' }],
        notificationId: { not: input.notificationId },
        notification: {
          is: lifecycle.supersedeScope === 'change'
            ? {
              sourceType: 'process_route_change',
              sourceId: input.changeId,
              eventType: { in: [...PROCESS_ROUTE_STAGE_EVENTS] },
            }
            : {
              sourceType: 'process_route_change',
              sourceId: input.changeId,
              eventType: {
                in: [
                  'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED',
                  'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED',
                ],
              },
              metadata: { path: ['obligationId'], equals: input.obligationId! },
            },
        },
      },
      data: {
        completedAt: now,
        completionKind: 'SOURCE_RESOLVED',
        completionReason: `工艺变更已有后续阶段：${input.eventType}`,
        readAt: now,
        snoozedUntil: null,
      },
    });
    completedRecipientCount += superseded.count;
  }
  if (lifecycle.initiallyCompleted) {
    const completionReason = input.stageIsCurrent === false
      ? `工艺通知已被更新阶段取代：${input.eventType}`
      : input.eventType === 'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED'
        ? '补充工序报工进度已记录，通知自动归档'
        : `工艺通知已进入明确终态：${input.eventType}`;
    const terminal = await tx.systemNotificationRecipient.updateMany({
      where: {
        notificationId: input.notificationId,
        OR: [{ completedAt: null }, { completionKind: 'MANUAL' }],
      },
      data: {
        completedAt: now,
        completionKind: 'SOURCE_RESOLVED',
        completionReason,
        readAt: now,
        snoozedUntil: null,
      },
    });
    completedRecipientCount += terminal.count;
  }
  return completedRecipientCount;
}

function payloadRecord(value: Prisma.JsonValue): OutboxPayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as OutboxPayload
    : {};
}

function eventCopy(eventType: string): { title: string; action: string } {
  if (eventType === 'PROCESS_ROUTE_CHANGE_SUBMITTED') {
    return { title: '收到现场工艺变更申请', action: '已提交，等待工艺审核' };
  }
  if (eventType === 'PROCESS_ROUTE_CHANGE_APPROVED') {
    return { title: '现场工艺变更已审核通过', action: '已通过，等待一键启用' };
  }
  if (eventType === 'PROCESS_ROUTE_CHANGE_REJECTED') {
    return { title: '现场工艺变更已驳回', action: '工艺审核未通过' };
  }
  if (eventType === 'PROCESS_ROUTE_CHANGE_REEVALUATED') {
    return { title: '现场工艺变更已重新评估', action: '路线基线已更新，等待工艺重新审核' };
  }
  if (eventType === 'PROCESS_ROUTE_CHANGE_ACTIVATED') {
    return { title: '现场工艺变更已启用', action: '二维码、生产路线和产品工艺已同步新版本' };
  }
  if (eventType === 'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED') {
    return { title: '新增工序已完成报工', action: '补充工序义务已全部完成' };
  }
  if (eventType === 'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED') {
    return { title: '新增工序报工进度更新', action: '补充工序已有新的报工记录' };
  }
  return { title: '现场工艺变更状态更新', action: '工艺变更状态已更新' };
}

function retryAt(attempts: number): Date {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + minutes * 60_000);
}

function outboxError(error: unknown): string {
  return (error instanceof Error ? error.message : '站内通知保存失败').slice(0, 1_000);
}

async function createInAppNotification(tx: Prisma.TransactionClient, outbox: {
  id: string;
  dedupeKey: string;
  eventType: string;
  changeId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
}) {
  const payload = payloadRecord(outbox.payload);
  const change = await tx.processRouteChange.findUnique({
    where: { id: outbox.changeId },
    select: {
      createdById: true,
      status: true,
      workOrder: { select: { code: true, productName: true, specification: true } },
      outbox: {
        where: { eventType: { in: [...PROCESS_ROUTE_STAGE_EVENTS] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!change) throw new Error('工艺变更不存在，无法保存站内通知');
  const processRecipients = await eligibleUserIdsForCapability(tx, 'PROCESS', 'READ');
  const recipients = [...new Set([
    ...processRecipients,
    ...(outbox.eventType === 'PROCESS_ROUTE_CHANGE_SUBMITTED' || !change.createdById
      ? []
      : [change.createdById]),
  ])];
  const copy = eventCopy(outbox.eventType);
  const workOrderLabel = change.workOrder.specification
    || change.workOrder.productName
    || change.workOrder.code;
  const created = await createSystemNotification(tx, {
    eventType: outbox.eventType,
    dedupeKey: `route-change:${outbox.dedupeKey}`,
    category: 'APPROVAL',
    priority: outbox.eventType === 'PROCESS_ROUTE_CHANGE_SUBMITTED' ? 'HIGH' : 'NORMAL',
    title: copy.title,
    body: `${workOrderLabel}：${copy.action}`,
    targetRoute: payload.workOrderId
      ? `/workspace/workflows?workOrderId=${encodeURIComponent(payload.workOrderId)}`
      : '/workspace/workflows',
    sourceType: 'process_route_change',
    sourceId: outbox.changeId,
    metadata: {
      routeId: payload.routeId || null,
      workOrderId: payload.workOrderId || null,
      obligationId: payload.obligationId || null,
      processName: payload.processName || null,
      sourceOutboxId: outbox.id,
      sourceEventAt: outbox.createdAt.toISOString(),
      fromStatus: payload.fromStatus || null,
      toStatus: payload.toStatus || null,
      actor: payload.actor || null,
    },
    recipientUserIds: recipients,
  });
  if (!created) return { recipients, completedRecipientCount: 0 };

  const completedRecipientCount = await reconcileProcessNotificationLifecycle(tx, {
    notificationId: created.notificationId,
    changeId: outbox.changeId,
    eventType: outbox.eventType,
    obligationId: payload.obligationId,
    stageIsCurrent: isProcessRouteStageEvent(outbox.eventType)
      ? processStageNotificationIsCurrent(
        outbox.eventType,
        change.status as ProcessRouteStatusValue,
        change.outbox[0]?.id === outbox.id,
      )
      : undefined,
  });
  return { recipients, completedRecipientCount };
}

export type ProcessRouteChangeOutboxDispatchResult = {
  processed: number;
  sent: number;
  failed: number;
  inAppRecipientCount: number;
  inAppDelivered: number;
  cancelled: number;
};

/**
 * Process events are in-app only. Keep the durable worker and completion
 * recovery, but never contact a robot, even for legacy WECOM_ROBOT rows.
 * In-app creation and legacy external cancellation commit together.
 */
export async function dispatchProcessRouteChangeOutbox(options: {
  changeId?: string;
  limit?: number;
} = {}): Promise<ProcessRouteChangeOutboxDispatchResult> {
  const limit = Math.min(20, Math.max(1, Math.trunc(options.limit || 5)));
  const result: ProcessRouteChangeOutboxDispatchResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    inAppRecipientCount: 0,
    inAppDelivered: 0,
    cancelled: 0,
  };
  // A container can be terminated after claiming a row but before recording
  // the result. Recover stale leases so a restart never strands a message.
  await prisma.processRouteChangeOutbox.updateMany({
    where: {
      status: ProcessRouteChangeOutboxStatus.PROCESSING,
      updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
    },
    data: {
      status: ProcessRouteChangeOutboxStatus.FAILED,
      availableAt: new Date(),
      lastError: '站内通知进程中断，已自动重新排队；不会推送企业微信',
    },
  });
  for (let index = 0; index < limit; index += 1) {
    const candidate = await prisma.processRouteChangeOutbox.findFirst({
      where: {
        ...(options.changeId ? { changeId: options.changeId } : {}),
        status: { in: [ProcessRouteChangeOutboxStatus.PENDING, ProcessRouteChangeOutboxStatus.FAILED] },
        attempts: { lt: MAX_ATTEMPTS },
        availableAt: { lte: new Date() },
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) break;
    const claimed = await prisma.processRouteChangeOutbox.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        attempts: candidate.attempts,
        availableAt: { lte: new Date() },
      },
      data: {
        status: ProcessRouteChangeOutboxStatus.PROCESSING,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (claimed.count !== 1) continue;
    result.processed += 1;
    try {
      const externalCancelled = candidate.channel !== 'IN_APP';
      const notification = await prisma.$transaction(async tx => {
        const owned = await tx.processRouteChangeOutbox.findFirst({ where: {
          id: candidate.id, status: ProcessRouteChangeOutboxStatus.PROCESSING, attempts: candidate.attempts + 1,
        } });
        if (!owned) throw new Error('站内通知领取状态已变化，请重试');
        const saved = await createInAppNotification(tx, candidate);
        await tx.processRouteChangeOutbox.update({ where: { id: candidate.id }, data: {
          status: externalCancelled ? ProcessRouteChangeOutboxStatus.CANCELLED : ProcessRouteChangeOutboxStatus.SENT,
          processedAt: new Date(), lastError: externalCancelled ? WECOM_POLICY_BLOCK_REASON : null,
        } });
        return saved;
      });
      result.inAppRecipientCount += notification.recipients.length;
      result.inAppDelivered += 1;
      if (externalCancelled) result.cancelled += 1;
    } catch (error) {
      const attempts = candidate.attempts + 1;
      await prisma.processRouteChangeOutbox.updateMany({
        where: { id: candidate.id, status: ProcessRouteChangeOutboxStatus.PROCESSING, attempts },
        data: {
          status: ProcessRouteChangeOutboxStatus.FAILED,
          availableAt: retryAt(attempts),
          lastError: outboxError(error),
        },
      });
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Business mutations are already committed before notification delivery starts.
 * A transient dispatcher/database failure must therefore never turn a successful
 * review, activation, proposal, or completion into an HTTP failure that invites
 * the user to submit the same mutation again. The durable outbox worker will
 * retry every row that remains pending or failed.
 */
export async function dispatchProcessRouteChangeOutboxBestEffort(options: {
  changeId?: string;
  limit?: number;
} = {}): Promise<void> {
  try {
    await dispatchProcessRouteChangeOutbox(options);
  } catch {
    console.error('工艺变更通知即时调度失败，业务操作已提交，将由后台任务重试');
  }
}
