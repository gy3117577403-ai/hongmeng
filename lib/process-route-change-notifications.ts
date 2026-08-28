import { Prisma, ProcessRouteChangeOutboxStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createSystemNotification,
  eligibleUserIdsForCapability,
} from '@/lib/system-notifications';
import { WECOM_POLICY_BLOCK_REASON } from '@/lib/wecom-notification-policy';

const MAX_ATTEMPTS = 8;

type OutboxPayload = {
  changeId?: string;
  workOrderId?: string;
  routeId?: string;
  actor?: string;
  fromStatus?: string;
  toStatus?: string;
};

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
}) {
  const payload = payloadRecord(outbox.payload);
  const change = await tx.processRouteChange.findUnique({
    where: { id: outbox.changeId },
    select: {
      createdById: true,
      workOrder: { select: { code: true, productName: true, specification: true } },
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
  await createSystemNotification(tx, {
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
      actor: payload.actor || null,
    },
    recipientUserIds: recipients,
  });
  return { recipients };
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
