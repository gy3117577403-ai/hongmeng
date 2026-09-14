import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createSystemNotification } from '@/lib/system-notifications';
import { inspectWeComRobotConfig, sendWeComRobotText, WeComRobotError } from '@/lib/wecom-robot';
import { wecomIdentity, wecomMentionState } from '@/lib/wecom-identity';
import { qualityTaskPath } from '@/lib/quality-workflow-shared';
import { canIssuePasswordSession, hasPureFieldReporterAccess } from '@/lib/login-security';
import { isQualityWeComEvent, WECOM_POLICY_BLOCK_REASON, type QualityWeComEvent } from '@/lib/wecom-notification-policy';

export async function enqueueQualityNotification(tx: Prisma.TransactionClient, input: {
  reportId: string; reportNo: string; recipientId: string; taskId?: string; round?: number;
  event: QualityWeComEvent;
  title: string; summary: string; actorId?: string; key: string;
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
    shortCode: crypto.randomBytes(9).toString('base64url'),
    availableAt: new Date(Date.now() + (input.event === 'ASSIGNED' ? qualityNotificationMergeSeconds() * 1000 : 0)),
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
export function qualityNotificationMergeSeconds() {
  const value = Number(process.env.QUALITY_NOTIFICATION_MERGE_SECONDS ?? 120);
  return Number.isFinite(value) ? Math.max(0, Math.min(300, Math.round(value))) : 120;
}
export function qualityNotificationContent(title: string, summary: string, url: string, _key?: string) {
  const suffix = `\n\n查看并处理：${url}`;
  let text = `【${title.slice(0, 160)}】\n${summary}`;
  while (Buffer.byteLength(text + suffix, 'utf8') > 2000 && text.length) text = Array.from(text).slice(0, -1).join('');
  return text + suffix;
}

const eventLabels: Record<string, string> = { ASSIGNED: '待接单', RETURNED: '退回补充', REVIEW: '待品质确认', APPROVED: '待归档', CONSOLIDATE: '待汇总' };
const eventActions: Record<string, string> = { ASSIGNED: '请接单处理，完成后提交品质确认。', RETURNED: '请按退回原因补充并重新提交。', REVIEW: '请核对处理结果，确认通过或定向退回。', APPROVED: '品质已确认，请完成归档并发布现场警示。', CONSOLIDATE: '请核对责任人提交内容并完成汇总。' };
const compact = (value: string, max: number) => Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
export function buildQualityNotificationMessage(input: { recipientName: string; event: string; url: string;
  items: Array<{ title: string; products: string[]; problem: string; dueAt?: Date | null; reason?: string }> }) {
  const lines = [`责任人：${compact(input.recipientName, 40)}`, ''];
  const visibleLimit = input.items.length === 1 ? 1 : 3;
  for (const [index, item] of input.items.slice(0, visibleLimit).entries()) {
    lines.push(`${index + 1}. ${compact(item.title, input.items.length === 1 ? 60 : 40)}`);
    const products = [...new Set(item.products.map(value => compact(value, 60)).filter(Boolean))];
    if (products.length) lines.push(`   产品：${compact(products.join('、'), input.items.length === 1 ? 100 : 48)}`);
    if (input.items.length === 1 && item.problem) lines.push(`   问题：${compact(item.problem, 120)}`);
    if (item.reason) lines.push(`   退回原因：${compact(item.reason, input.items.length === 1 ? 100 : 48)}`);
    if (item.dueAt) lines.push(`   截止：${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(item.dueAt)}`);
    lines.push('');
  }
  if (input.items.length > visibleLimit) lines.push(`另有 ${input.items.length - visibleLimit} 项，点击查看完整待办。`, '');
  lines.push(eventActions[input.event] || '请打开查看当前待办。');
  return qualityNotificationContent(`质量待办 · ${input.items.length} 项${eventLabels[input.event] || '待处理'}`, lines.join('\n'), input.url);
}

const dispatchReportInclude = { tasks: true, products: { include: { product: { select: { specification: true, productName: true } } } } } as const;
type Notification = Prisma.QualityRiskNotificationGetPayload<Record<string, never>>;
type DispatchReport = Prisma.InternalQualityRiskReportGetPayload<{ include: typeof dispatchReportInclude }>;
export function qualityNotificationObsolete(item: Pick<Notification, 'eventType' | 'recipientId' | 'taskId' | 'reviewRound'>, report: DispatchReport | null) {
  if (!report || report.deletedAt) return true;
  const task = report.tasks.find(task => task.id === item.taskId);
  if (item.eventType === 'ASSIGNED') return !task || task.ownerUserId !== item.recipientId || task.status !== 'TODO';
  if (item.eventType === 'RETURNED') return !task || task.ownerUserId !== item.recipientId || !['TODO', 'IN_PROGRESS'].includes(task.status);
  if (item.eventType === 'REVIEW') return report.status !== 'VERIFYING' || report.reviewRound !== item.reviewRound || report.reviewerUserId !== item.recipientId;
  if (item.eventType === 'CONSOLIDATE') return report.workflowVersion >= 4 || report.ownerUserId !== item.recipientId || !['COLLABORATING', 'REVISING'].includes(report.status);
  if (item.eventType === 'APPROVED') return report.status !== 'PENDING_CLOSE' || report.reviewerUserId !== item.recipientId;
  return true;
}

/** Explicit rejections may retry. Unknown delivery requires a human to check the group. */
export async function dispatchQualityNotifications(options: { fetchImpl?: typeof fetch; webhookUrl?: string; origin?: string; now?: Date } = {}) {
  const now = options.now || new Date();
  const claimed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('quality-robot-dispatch'))`;
    await tx.qualityRiskNotification.updateMany({ where: { state: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 120_000) } },
      data: { state: 'UNCERTAIN', leaseToken: null, lastError: '发送进程中断，回执未确认；请先核对群消息，再决定是否重发' } });
    const clock = await tx.qualityRobotDispatchClock.findUnique({ where: { id: 'quality' } });
    if (clock && now.getTime() - clock.lastAttemptAt.getTime() < 4000) return null;
    const item = await tx.qualityRiskNotification.findFirst({ where: { state: { in: ['PENDING', 'FAILED', 'WAITING_CONFIG'] }, attempts: { lt: 8 }, availableAt: { lte: now } }, orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }] });
    if (!item) return null;
    if (!isQualityWeComEvent(item.eventType)) {
      await tx.qualityRiskNotification.update({ where: { id: item.id }, data: { state: 'SKIPPED', leaseToken: null, lastError: WECOM_POLICY_BLOCK_REASON } });
      return null;
    }
    const candidates = await tx.qualityRiskNotification.findMany({ where: { recipientId: item.recipientId, eventType: item.eventType,
      state: { in: ['PENDING', 'FAILED', 'WAITING_CONFIG'] }, attempts: { lt: 8 }, OR: [
        { availableAt: { lte: now } },
        { state: 'PENDING', attempts: 0, createdAt: { lte: new Date(Math.min(now.getTime(), item.createdAt.getTime() + qualityNotificationMergeSeconds() * 1000)) } },
      ] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20 });
    const valid: Array<{ item: Notification; report: DispatchReport }> = [];
    for (const candidate of candidates) {
      const report = await tx.internalQualityRiskReport.findUnique({ where: { id: candidate.reportId }, include: dispatchReportInclude });
      if (qualityNotificationObsolete(candidate, report)) {
        await tx.qualityRiskNotification.update({ where: { id: candidate.id }, data: { state: 'SKIPPED', lastError: '任务已接单、改派或流程已变化，无需发送过期提醒' } });
      } else {
        const prior = valid.findIndex(row => row.item.reportId === candidate.reportId && row.item.taskId === candidate.taskId && row.item.reviewRound === candidate.reviewRound);
        if (prior >= 0) {
          await tx.qualityRiskNotification.update({ where: { id: valid[prior].item.id }, data: { state: 'SKIPPED', lastError: '同一任务已有更新的提醒，已合并取消旧通知' } });
          valid.splice(prior, 1);
        }
        valid.push({ item: candidate, report: report! });
      }
    }
    if (!valid.length) return null;
    const user = await tx.user.findUnique({ where: { id: item.recipientId }, include: { employee: true, accessGrants: true } });
    const identity = user?.employee ? wecomIdentity(user.employee) : null;
    const origin = qualityNotificationOrigin(options.origin);
    const config = inspectWeComRobotConfig(options.webhookUrl ?? process.env.WECOM_ROBOT_WEBHOOK_URL);
    const reason = !user?.isActive || user.accountStatus !== 'ACTIVE' ? '接收账号已停用' :
      !canIssuePasswordSession(user, now) || hasPureFieldReporterAccess(user, now) ? '接收账号没有生效的工作台登录授权' :
      !user.employee ? '账号尚未绑定人事员工' : !user.employee.isActive ? '人事员工已停用' :
      !user.employee.notificationEnabled ? '人事通知开关已关闭' : !identity || identity.method === 'MISSING' ? '请配置有效手机号或核实企业微信成员 UserID' :
      !config.configured ? '企业微信 Webhook 未配置或格式不正确' : !origin ? 'APP_BASE_URL 需要配置正式 HTTPS 站点根地址' : null;
    if (reason) {
      await tx.qualityRiskNotification.updateMany({ where: { id: { in: valid.map(row => row.item.id) } }, data: { state: 'WAITING_CONFIG', lastError: reason, availableAt: new Date(now.getTime() + 60_000) } });
      return null;
    }
    const leaseToken = crypto.randomUUID();
    const root = valid[0].item;
    const shortCode = root.shortCode || crypto.randomBytes(9).toString('base64url');
    const snapshot = { recipientId: user!.id, accountName: user!.displayName || user!.username, employeeId: user!.employee!.id,
      employeeNo: user!.employee!.employeeNo, employeeName: user!.employee!.name, method: identity!.method,
      maskedTarget: identity!.maskedTarget, verification: wecomMentionState(user!.employee!, options.webhookUrl) };
    const content = buildQualityNotificationMessage({ recipientName: user!.employee!.name, event: item.eventType,
      url: origin + '/q/' + shortCode, items: valid.map(({ item: notification, report }) => ({ title: report.title,
        products: report.products.map(link => link.product.specification || link.product.productName || ''), problem: report.defectPhenomenon || '',
        dueAt: report.tasks.find(task => task.id === notification.taskId)?.dueAt,
        reason: item.eventType === 'RETURNED' ? notification.summary : undefined,
      })) });
    await tx.qualityRiskNotification.update({ where: { id: root.id }, data: { shortCode } });
    await tx.qualityRiskNotification.updateMany({ where: { id: { in: valid.map(row => row.item.id) } }, data: {
      state: 'SENDING', leaseToken, attempts: { increment: 1 }, lastError: null, lastAttemptAt: now,
      deliveryGroup: leaseToken, deliveryCount: valid.length, deliverySnapshot: snapshot, deliveryContent: content,
    } });
    await tx.qualityRobotDispatchClock.upsert({ where: { id: 'quality' }, create: { id: 'quality', lastAttemptAt: now }, update: { lastAttemptAt: now } });
    return { item, ids: valid.map(row => row.item.id), leaseToken, identity: identity!, content };
  });
  if (!claimed) return { processed: 0, accepted: 0 };
  const { item, ids, identity, content, leaseToken } = claimed;
  try {
    await sendWeComRobotText({ source: { sourceType: 'internal_quality_risk', eventType: item.eventType },
      content, mentionedMobiles: identity.mentionedMobiles, mentionedUserIds: identity.mentionedUserIds,
      webhookUrl: options.webhookUrl, fetchImpl: options.fetchImpl, timeoutMs: 6000 });
    await prisma.qualityRiskNotification.updateMany({ where: { id: { in: ids }, leaseToken, state: 'SENDING' }, data: { state: 'SENT', acceptedAt: new Date(), leaseToken: null } });
    return { processed: ids.length, accepted: ids.length };
  } catch (error) {
    const uncertain = !(error instanceof WeComRobotError) || ['WECOM_TIMEOUT', 'WECOM_UNAVAILABLE', 'WECOM_BAD_RESPONSE'].includes(error.code);
    await prisma.qualityRiskNotification.updateMany({ where: { id: { in: ids }, leaseToken, state: 'SENDING' }, data: { state: uncertain ? 'UNCERTAIN' : 'FAILED', leaseToken: null,
      lastError: uncertain ? '回执未确认；请先核对群消息，再决定是否重发' : error.message.slice(0, 200) + (error.externalCode === undefined ? '' : `（企微代码 ${error.externalCode}）`),
      availableAt: new Date(now.getTime() + Math.min(60, 2 ** item.attempts) * 60_000) } });
    return { processed: ids.length, accepted: 0 };
  }
}
