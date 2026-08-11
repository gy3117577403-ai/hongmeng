import { Prisma, ProcessRouteChangeOutboxStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createSystemNotification,
  eligibleUserIdsForCapability,
} from '@/lib/system-notifications';
import {
  inspectWeComRobotConfig,
  sendWeComRobotText,
  toWeComMentionMobile,
} from '@/lib/wecom-robot';

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
  return (error instanceof Error ? error.message : '企业微信通知发送失败').slice(0, 1_000);
}

async function createInAppNotification(outbox: {
  id: string;
  dedupeKey: string;
  eventType: string;
  changeId: string;
  payload: Prisma.JsonValue;
}) {
  const payload = payloadRecord(outbox.payload);
  return prisma.$transaction(async tx => {
    const change = await tx.processRouteChange.findUnique({
      where: { id: outbox.changeId },
      select: {
        createdById: true,
        workOrder: { select: { code: true, productName: true, specification: true } },
      },
    });
    if (!change) return { recipients: [] as string[], mentionedMobiles: [] as string[] };
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
    const users = recipients.length
      ? await tx.user.findMany({
          where: {
            id: { in: recipients },
            employee: { is: { isActive: true, notificationEnabled: true } },
          },
          select: { employee: { select: { mobile: true } } },
          take: 20,
        })
      : [];
    const mentionedMobiles = [...new Set(users
      .map(user => toWeComMentionMobile(user.employee?.mobile))
      .filter((mobile): mobile is string => Boolean(mobile)))].slice(0, 20);
    return { recipients, mentionedMobiles };
  });
}

export type ProcessRouteChangeOutboxDispatchResult = {
  processed: number;
  sent: number;
  failed: number;
  inAppRecipientCount: number;
};

/**
 * Delivers durable route-change events. Database state is committed before
 * this function is called, so a missing or unavailable robot never rolls back
 * an approved production change. Failed rows remain retryable.
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
      lastError: '发送进程中断，已自动重新排队',
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
      const notification = await createInAppNotification(candidate);
      result.inAppRecipientCount += notification.recipients.length;
      const change = await prisma.processRouteChange.findUnique({
        where: { id: candidate.changeId },
        select: {
          workOrder: { select: { code: true, productName: true, specification: true } },
          diffs: { orderBy: { position: 'asc' }, select: { kind: true, afterData: true } },
        },
      });
      const copy = eventCopy(candidate.eventType);
      const insertion = change?.diffs.find(diff => diff.kind === 'INSERT_STEP');
      const insertionData = insertion?.afterData && typeof insertion.afterData === 'object' && !Array.isArray(insertion.afterData)
        ? insertion.afterData as Record<string, unknown>
        : null;
      const timeChangeCount = change?.diffs.filter(diff => diff.kind === 'UPDATE_TIME').length || 0;
      const moveChangeCount = change?.diffs.filter(diff => diff.kind === 'MOVE_STEP').length || 0;
      const workOrderLabel = change?.workOrder.specification
        || change?.workOrder.productName
        || change?.workOrder.code
        || candidate.changeId;
      const lines = [
        `【${copy.title}】`,
        `工单：${workOrderLabel}`,
        insertionData?.processName ? `新增工序：${String(insertionData.processName)}` : null,
        timeChangeCount ? `工时变更：${timeChangeCount} 道工序` : null,
        moveChangeCount ? `顺序调整：${moveChangeCount} 个完整顺序组` : null,
        `状态：${copy.action}`,
        '系统入口：流程中心 → 现场工艺变更',
      ].filter((line): line is string => Boolean(line));
      const config = inspectWeComRobotConfig();
      if (!config.configured) throw new Error(
        config.state === 'invalid'
          ? 'WECOM_ROBOT_WEBHOOK_URL 格式无效'
          : 'WECOM_ROBOT_WEBHOOK_URL 尚未配置',
      );
      await sendWeComRobotText({
        content: lines.join('\n'),
        mentionedMobiles: notification.mentionedMobiles,
        allowEmptyMentions: true,
      });
      await prisma.processRouteChangeOutbox.update({
        where: { id: candidate.id },
        data: {
          status: ProcessRouteChangeOutboxStatus.SENT,
          processedAt: new Date(),
          lastError: null,
        },
      });
      result.sent += 1;
    } catch (error) {
      const attempts = candidate.attempts + 1;
      await prisma.processRouteChangeOutbox.update({
        where: { id: candidate.id },
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
