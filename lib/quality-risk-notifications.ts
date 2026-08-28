import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createSystemNotification } from '@/lib/system-notifications';
import { inspectWeComRobotConfig, sendWeComRobotText, toWeComMentionMobile } from '@/lib/wecom-robot';
import { qualityTaskPath } from '@/lib/quality-workflow-shared';
import { canIssuePasswordSession, hasPureFieldReporterAccess } from '@/lib/login-security';
import { isQualityWeComEvent, WECOM_POLICY_BLOCK_REASON, type QualityWeComEvent } from '@/lib/wecom-notification-policy';

export async function enqueueQualityNotification(tx: Prisma.TransactionClient, input: {
  reportId: string; reportNo: string; recipientId: string; taskId?: string; round?: number;
  event: QualityWeComEvent;
  title: string; summary: string; actorId: string; key: string;
}) {
  const targetRoute = qualityTaskPath(input.reportId, input.taskId, ['REVIEW', 'APPROVED'].includes(input.event));
  const dedupeKey = `quality-v3:${input.reportId}:${input.event}:${input.key}:${input.recipientId}`;
  const title = `${input.title} · ${input.reportNo}`;
  await createSystemNotification(tx, { eventType: `QUALITY_${input.event}`, dedupeKey,
    category: 'TODO', priority: 'HIGH', title, body: input.summary, targetRoute,
    actorId: input.actorId, sourceType: 'internal_quality_risk', sourceId: input.reportId,
    recipientUserIds: [input.recipientId] });
  if (!isQualityWeComEvent(input.event)) return;
  await tx.qualityRiskNotification.upsert({ where: { dedupeKey }, update: {}, create: {
    reportId: input.reportId, recipientId: input.recipientId, taskId: input.taskId,
    reviewRound: input.round, eventType: input.event, dedupeKey, title,
    summary: input.summary.slice(0, 1200), targetRoute,
  } });
}

export function qualityNotificationOrigin(value = process.env.APP_BASE_URL): string | null {
  try {
    if (!value || value.length > 300) return null;
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
export function qualityNotificationContent(title: string, summary: string, url: string, key: string) {
  const suffix = `\n打开处理：${url}\n通知编号：${key}\n请使用本人账号登录；此消息不表示已接单。`;
  let text = `【${title.slice(0, 160)}】\n${summary}`;
  while (Buffer.byteLength(text + suffix, 'utf8') > 2000 && text.length) text = Array.from(text).slice(0, -1).join('');
  return text + suffix;
}

/** At-least-once delivery; dedupe prevents duplicate enqueue, not uncertain HTTP delivery. */
export async function dispatchQualityNotifications(options: { fetchImpl?: typeof fetch; webhookUrl?: string; origin?: string; now?: Date } = {}) {
  const now = options.now || new Date();
  const claimed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('quality-robot-dispatch'))`;
    await tx.qualityRiskNotification.updateMany({ where: { state: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 120_000) } },
      data: { state: 'FAILED', leaseToken: null, availableAt: now, lastError: '发送进程中断，等待重试；若企微已接收可能重复，请按通知编号核对' } });
    const clock = await tx.qualityRobotDispatchClock.findUnique({ where: { id: 'quality' } });
    if (clock && now.getTime() - clock.lastAttemptAt.getTime() < 4000) return null;
    const item = await tx.qualityRiskNotification.findFirst({ where: { state: { in: ['PENDING', 'FAILED', 'WAITING_CONFIG'] }, attempts: { lt: 8 }, availableAt: { lte: now } }, orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }] });
    if (!item) return null;
    if (!isQualityWeComEvent(item.eventType)) {
      await tx.qualityRiskNotification.update({ where: { id: item.id }, data: { state: 'SKIPPED', leaseToken: null, lastError: WECOM_POLICY_BLOCK_REASON } });
      return null;
    }
    const report = await tx.internalQualityRiskReport.findUnique({ where: { id: item.reportId }, include: { tasks: true } });
    const task = report?.tasks.find(task => task.id === item.taskId);
    const obsolete = !report || report.deletedAt ||
      (['ASSIGNED', 'RETURNED'].includes(item.eventType) && (!task || task.ownerUserId !== item.recipientId || !['TODO', 'IN_PROGRESS'].includes(task.status))) ||
      (item.eventType === 'REVIEW' && (report.status !== 'VERIFYING' || report.reviewRound !== item.reviewRound || report.reviewerUserId !== item.recipientId)) ||
      (item.eventType === 'CONSOLIDATE' && (report.ownerUserId !== item.recipientId || !['COLLABORATING', 'REVISING'].includes(report.status))) ||
      (item.eventType === 'APPROVED' && report.status !== 'PENDING_CLOSE');
    if (obsolete) { await tx.qualityRiskNotification.update({ where: { id: item.id }, data: { state: 'SKIPPED', lastError: '任务或流程已变化，无需发送过期提醒' } }); return null; }
    const user = await tx.user.findUnique({ where: { id: item.recipientId }, include: { employee: true, accessGrants: true } });
    const mobile = toWeComMentionMobile(user?.employee?.mobile);
    const origin = qualityNotificationOrigin(options.origin);
    const config = inspectWeComRobotConfig(options.webhookUrl ?? process.env.WECOM_ROBOT_WEBHOOK_URL);
    const reason = !user?.isActive || user.accountStatus !== 'ACTIVE' ? '接收账号已停用' :
      !canIssuePasswordSession(user, now) || hasPureFieldReporterAccess(user, now) ? '接收账号没有生效的工作台登录授权' :
      !user.employee ? '账号尚未绑定人事员工' : !user.employee.isActive ? '人事员工已停用' :
      !user.employee.notificationEnabled ? '人事通知开关已关闭' : !mobile ? '人事手机号缺失或格式不正确' :
      !config.configured ? '企业微信 Webhook 未配置或格式不正确' : !origin ? 'APP_BASE_URL 需要配置正式 HTTPS 站点根地址' : null;
    if (reason) {
      await tx.qualityRiskNotification.update({ where: { id: item.id }, data: { state: 'WAITING_CONFIG', lastError: reason, availableAt: new Date(now.getTime() + 60_000) } });
      return null;
    }
    const leaseToken = crypto.randomUUID();
    await tx.qualityRiskNotification.update({ where: { id: item.id }, data: { state: 'SENDING', leaseToken, attempts: { increment: 1 }, lastError: null } });
    await tx.qualityRobotDispatchClock.upsert({ where: { id: 'quality' }, create: { id: 'quality', lastAttemptAt: now }, update: { lastAttemptAt: now } });
    return { item, leaseToken, mobile: mobile!, origin: origin! };
  });
  if (!claimed) return { processed: 0, accepted: 0 };
  const { item, mobile, origin, leaseToken } = claimed;
  try {
    await sendWeComRobotText({ source: { sourceType: 'internal_quality_risk', eventType: item.eventType },
      content: qualityNotificationContent(item.title, item.summary, origin + item.targetRoute, item.id.slice(0, 8)),
      mentionedMobiles: [mobile], webhookUrl: options.webhookUrl, fetchImpl: options.fetchImpl, timeoutMs: 6000 });
    await prisma.qualityRiskNotification.updateMany({ where: { id: item.id, leaseToken, state: 'SENDING' }, data: { state: 'SENT', acceptedAt: new Date(), leaseToken: null } });
    return { processed: 1, accepted: 1 };
  } catch (error) {
    await prisma.qualityRiskNotification.updateMany({ where: { id: item.id, leaseToken, state: 'SENDING' }, data: { state: 'FAILED', leaseToken: null,
      lastError: error instanceof Error ? error.message.slice(0, 240) : '发送失败',
      availableAt: new Date(now.getTime() + Math.min(60, 2 ** item.attempts) * 60_000) } });
    return { processed: 1, accepted: 0 };
  }
}
