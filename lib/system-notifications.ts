import { Prisma } from '@prisma/client';
import { canAccessAppRoute } from '@/lib/app-route-access';
import {
  DEPARTMENT_CODES,
  hasCapability,
  resolveAccessContext,
  type AccessActionCode,
  type AccessContext,
  type AccessGrant,
  type AccessModuleCode,
  type AccessProfileCode,
  type DepartmentCode,
} from '@/lib/department-access';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';
import { prisma } from '@/lib/prisma';

export const SYSTEM_NOTIFICATION_CATEGORIES = ['SYSTEM', 'ACCOUNT', 'TODO', 'APPROVAL'] as const;
export const SYSTEM_NOTIFICATION_PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'] as const;
export const NOTIFICATION_BUSINESS_CATEGORIES = ['PRODUCTION', 'QUALITY', 'PROCESS', 'MATERIAL', 'SYSTEM'] as const;

export type SystemNotificationCategory = typeof SYSTEM_NOTIFICATION_CATEGORIES[number];
export type SystemNotificationPriority = typeof SYSTEM_NOTIFICATION_PRIORITIES[number];
export type NotificationBusinessCategory = typeof NOTIFICATION_BUSINESS_CATEGORIES[number];

export type NotificationClassificationInput = {
  eventType?: string | null;
  category?: SystemNotificationCategory | null;
  priority?: SystemNotificationPriority | null;
  title?: string | null;
  targetRoute?: string | null;
  sourceType?: string | null;
};

type NotificationTx = Prisma.TransactionClient;

export type CreateSystemNotificationInput = {
  eventType: string;
  dedupeKey: string;
  category: SystemNotificationCategory;
  priority?: SystemNotificationPriority;
  title: string;
  body?: string | null;
  targetRoute?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  expiresAt?: Date | null;
  recipientUserIds: readonly string[];
};

export type NotificationInboxQuery = {
  limit?: number;
  cursor?: string | null;
  unreadOnly?: boolean;
  category?: SystemNotificationCategory | null;
};

function text(value: unknown, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

function notificationSearchText(input: NotificationClassificationInput): string {
  return [input.eventType, input.title, input.targetRoute, input.sourceType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function includesNotificationToken(value: string, tokens: readonly string[]): boolean {
  return tokens.some(token => value.includes(token));
}

/**
 * Project system categories describe delivery semantics (todo, approval,
 * account, system). The home command center needs an orthogonal business
 * classification so a supervisor can triage by the affected operating area.
 */
export function notificationBusinessCategory(
  input: NotificationClassificationInput,
): NotificationBusinessCategory {
  const source = String(input.sourceType || '').toLowerCase();
  if (includesNotificationToken(source, ['internal_quality_risk', 'issue_major_approval', 'quality'])) return 'QUALITY';
  if (includesNotificationToken(source, ['process_route', 'process_time', 'product_time', 'process_reporting'])) return 'PROCESS';
  if (includesNotificationToken(source, ['warehouse', 'material', 'procurement', 'stock'])) return 'MATERIAL';
  if (includesNotificationToken(source, ['production', 'work_order', 'weekly_plan', 'planning'])) return 'PRODUCTION';

  const value = notificationSearchText(input);
  if (includesNotificationToken(value, [
    'internal_quality_risk', 'issue_major_approval', 'quality', '质量', '检验', '8d',
  ])) return 'QUALITY';
  if (includesNotificationToken(value, [
    'process_route', 'process_time', 'product_time', 'process_reporting', '/workspace/changes',
    '工艺', '工序', '报工', '变更',
  ])) return 'PROCESS';
  if (includesNotificationToken(value, [
    'warehouse', 'material', 'procurement', 'stock', '物料', '缺料', '仓库', '到货', '采购',
  ])) return 'MATERIAL';
  if (includesNotificationToken(value, [
    'production', 'work_order', 'weekly_plan', 'planning', '/production', '工单', '生产', '周计划', '设备',
  ])) return 'PRODUCTION';
  return 'SYSTEM';
}

export function notificationRequiresAction(input: NotificationClassificationInput): boolean {
  if (input.category === 'TODO' || input.category === 'APPROVAL') return true;
  return Boolean(input.targetRoute && (input.priority === 'HIGH' || input.priority === 'URGENT'));
}

export function notificationSnoozedUntil(minutes: number, now = new Date()): Date {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 7 * 24 * 60) {
    throw new Error('稍后提醒时间必须在 5 分钟到 7 天之间');
  }
  return new Date(now.getTime() + minutes * 60_000);
}

function departmentCode(value?: string | null): DepartmentCode | null {
  return DEPARTMENT_CODES.includes(value as DepartmentCode) ? value as DepartmentCode : null;
}

export function safeNotificationTargetRoute(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const route = text(value, 500);
  if (
    !route.startsWith('/')
    || route.startsWith('//')
    || route.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(route)
  ) {
    throw new Error('通知跳转地址必须是安全的站内路径');
  }
  return route;
}

function candidateAccess(user: {
  laborRole: 'ADMIN' | 'TEAM_LEAD' | 'EMPLOYEE';
  employeeId: string | null;
  employee: { id: string; isActive: boolean; departmentRef: { code: string } | null } | null;
  accessGrants: Array<{
    id: string;
    profile: string;
    scopeKey: string;
    grantType: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    isActive: boolean;
    department: { code: string } | null;
  }>;
}, now: Date): AccessContext {
  const grants: AccessGrant[] = user.accessGrants.map(grant => ({
    id: grant.id,
    profile: grant.profile as AccessProfileCode,
    grantType: grant.grantType as AccessGrant['grantType'],
    departmentCode: departmentCode(grant.department?.code),
    scopeKey: grant.scopeKey,
    isActive: grant.isActive,
    effectiveFrom: grant.effectiveFrom,
    effectiveTo: grant.effectiveTo,
  }));
  const compatibility = user.laborRole === 'ADMIN' ? legacyFallbackGrants(user) : [];
  return resolveAccessContext(
    grants.length ? [...grants, ...compatibility] : legacyFallbackGrants(user),
    { accountActive: true, now },
  );
}

/**
 * Resolve recipients from current effective capabilities, including dated
 * concurrent/acting grants. The resulting IDs are stored as an event-time
 * snapshot and are never recalculated for historical notifications.
 */
export async function eligibleUserIdsForCapability(
  tx: NotificationTx,
  module: AccessModuleCode,
  action: AccessActionCode,
  options: { excludeUserIds?: readonly string[]; now?: Date } = {},
): Promise<string[]> {
  const now = options.now || new Date();
  const excluded = new Set(options.excludeUserIds || []);
  const users = await tx.user.findMany({
    where: { isActive: true, accountStatus: 'ACTIVE' },
    select: {
      id: true,
      laborRole: true,
      employeeId: true,
      employee: {
        select: {
          id: true,
          isActive: true,
          departmentRef: { select: { code: true } },
        },
      },
      accessGrants: {
        select: {
          id: true,
          profile: true,
          scopeKey: true,
          grantType: true,
          effectiveFrom: true,
          effectiveTo: true,
          isActive: true,
          department: { select: { code: true } },
        },
      },
    },
  });

  return users
    .filter(user => !excluded.has(user.id))
    .filter(user => !user.employee || user.employee.isActive)
    .filter(user => hasCapability(candidateAccess(user, now), module, action))
    .map(user => user.id);
}

export async function activeUserIdsForEmployees(
  tx: NotificationTx,
  employeeIds: readonly string[],
  options: { excludeUserIds?: readonly string[] } = {},
): Promise<string[]> {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) return [];
  const excluded = new Set(options.excludeUserIds || []);
  const users = await tx.user.findMany({
    where: {
      employeeId: { in: ids },
      isActive: true,
      accountStatus: 'ACTIVE',
      employee: { is: { isActive: true } },
    },
    select: { id: true },
  });
  return users.map(user => user.id).filter(id => !excluded.has(id));
}

export async function issueParticipantUserIds(
  tx: NotificationTx,
  issueId: string,
  options: { excludeUserIds?: readonly string[] } = {},
): Promise<string[]> {
  const issue = await tx.issue.findUnique({
    where: { id: issueId },
    select: {
      reporterId: true,
      assigneeEmployeeId: true,
      verifierEmployeeId: true,
      collaborators: { select: { employeeId: true } },
    },
  });
  if (!issue) return [];
  const excluded = new Set(options.excludeUserIds || []);
  const employeeUsers = await activeUserIdsForEmployees(tx, [
    ...(issue.assigneeEmployeeId ? [issue.assigneeEmployeeId] : []),
    ...(issue.verifierEmployeeId ? [issue.verifierEmployeeId] : []),
    ...issue.collaborators.map(item => item.employeeId),
  ], options);
  return [...new Set([
    ...(issue.reporterId && !excluded.has(issue.reporterId) ? [issue.reporterId] : []),
    ...employeeUsers,
  ])];
}

export async function createSystemNotification(
  tx: NotificationTx,
  input: CreateSystemNotificationInput,
): Promise<{ notificationId: string; recipientCount: number } | null> {
  const recipientUserIds = [...new Set(input.recipientUserIds.filter(Boolean))];
  if (!recipientUserIds.length) return null;
  const eventType = text(input.eventType, 100);
  const dedupeKey = text(input.dedupeKey, 240);
  const title = text(input.title, 180);
  if (!eventType || !dedupeKey || !title) throw new Error('通知事件、去重键和标题不能为空');
  const notification = await tx.systemNotification.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      eventType,
      dedupeKey,
      category: input.category,
      priority: input.priority || 'NORMAL',
      title,
      body: input.body ? text(input.body, 1200) : null,
      targetRoute: safeNotificationTargetRoute(input.targetRoute),
      sourceType: input.sourceType ? text(input.sourceType, 80) : null,
      sourceId: input.sourceId ? text(input.sourceId, 100) : null,
      actorId: input.actorId || null,
      metadata: input.metadata === null ? Prisma.JsonNull : input.metadata,
      expiresAt: input.expiresAt || null,
    },
    select: { id: true },
  });
  await tx.systemNotificationRecipient.createMany({
    data: recipientUserIds.map(userId => ({ notificationId: notification.id, userId })),
    skipDuplicates: true,
  });
  return { notificationId: notification.id, recipientCount: recipientUserIds.length };
}

type NotificationCursor = { createdAt: string; id: string };

function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value?: string | null): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as NotificationCursor;
    const createdAt = new Date(parsed.createdAt);
    if (!parsed.id || !Number.isFinite(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function loadNotificationInbox(
  userId: string,
  access: Pick<AccessContext, 'modules'>,
  query: NotificationInboxQuery = {},
) {
  const limit = Math.min(Math.max(Math.trunc(query.limit || 30), 1), 100);
  const cursor = decodeCursor(query.cursor);
  const now = new Date();
  const notificationWhere: Prisma.SystemNotificationWhereInput = {
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ...(query.category ? [{ category: query.category }] : []),
      ...(cursor ? [{
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }] : []),
    ],
  };
  const where: Prisma.SystemNotificationRecipientWhereInput = {
    userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    notification: { is: notificationWhere },
  };
  const activeSummaryWhere: Prisma.SystemNotificationRecipientWhereInput = {
    userId,
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    notification: {
      is: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
  };
  const [recipients, summaryRecipients] = await Promise.all([
    prisma.systemNotificationRecipient.findMany({
      where,
      include: {
        notification: {
          include: { actor: { select: { displayName: true, username: true } } },
        },
      },
      orderBy: [
        { notification: { createdAt: 'desc' } },
        { notificationId: 'desc' },
      ],
      take: limit + 1,
    }),
    prisma.systemNotificationRecipient.findMany({
      where: activeSummaryWhere,
      select: {
        readAt: true,
        notification: {
          select: {
            eventType: true,
            category: true,
            priority: true,
            title: true,
            targetRoute: true,
            sourceType: true,
          },
        },
      },
    }),
  ]);
  const businessCategoryCounts: Record<NotificationBusinessCategory, number> = {
    PRODUCTION: 0,
    QUALITY: 0,
    PROCESS: 0,
    MATERIAL: 0,
    SYSTEM: 0,
  };
  let actionableCount = 0;
  let urgentCount = 0;
  let unreadCount = 0;
  for (const recipient of summaryRecipients) {
    const notification = recipient.notification as NotificationClassificationInput;
    businessCategoryCounts[notificationBusinessCategory(notification)] += 1;
    if (notificationRequiresAction(notification)) actionableCount += 1;
    if (notification.priority === 'URGENT') urgentCount += 1;
    if (!recipient.readAt) unreadCount += 1;
  }
  const hasMore = recipients.length > limit;
  const page = hasMore ? recipients.slice(0, limit) : recipients;
  const notifications = page.map(recipient => {
    const notification = recipient.notification;
    const targetRoute = notification.targetRoute && canAccessAppRoute(access, notification.targetRoute)
      ? notification.targetRoute
      : null;
    const classificationInput: NotificationClassificationInput = {
      eventType: notification.eventType,
      category: notification.category as SystemNotificationCategory,
      priority: notification.priority as SystemNotificationPriority,
      title: notification.title,
      targetRoute,
      sourceType: notification.sourceType,
    };
    return {
      id: notification.id,
      eventType: notification.eventType,
      category: notification.category as SystemNotificationCategory,
      priority: notification.priority as SystemNotificationPriority,
      title: notification.title,
      body: notification.body,
      targetRoute,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId,
      actorName: notification.actor?.displayName || notification.actor?.username || null,
      businessCategory: notificationBusinessCategory(classificationInput),
      requiresAction: notificationRequiresAction(classificationInput),
      readAt: recipient.readAt?.toISOString() || null,
      snoozedUntil: recipient.snoozedUntil?.toISOString() || null,
      createdAt: notification.createdAt.toISOString(),
    };
  });
  const last = page[page.length - 1]?.notification;
  return {
    notifications,
    unreadCount,
    actionableCount,
    urgentCount,
    businessCategoryCounts,
    nextCursor: hasMore && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null,
  };
}

export async function setNotificationReadState(
  userId: string,
  notificationId: string,
  read: boolean,
): Promise<boolean> {
  const result = await prisma.systemNotificationRecipient.updateMany({
    where: { userId, notificationId },
    data: { readAt: read ? new Date() : null },
  });
  return result.count === 1;
}

export async function snoozeNotification(
  userId: string,
  notificationId: string,
  minutes: number,
): Promise<Date | null> {
  const snoozedUntil = notificationSnoozedUntil(minutes);
  const result = await prisma.systemNotificationRecipient.updateMany({
    where: { userId, notificationId },
    data: { readAt: null, snoozedUntil },
  });
  return result.count === 1 ? snoozedUntil : null;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const now = new Date();
  const result = await prisma.systemNotificationRecipient.updateMany({
    where: {
      userId,
      readAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
