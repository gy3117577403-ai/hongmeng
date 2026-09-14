import { createHash } from 'node:crypto';
import { toWeComMentionMobile, toWeComMentionUserId } from './wecom-robot';
import { maskEmployeeMobile } from './employee-contact';

export type WeComEmployeeIdentity = {
  id: string; mobile: string | null; wecomUserId: string | null;
  wecomUserIdVerifiedAt: Date | null; wecomMentionCheck?: unknown;
};
export function wecomIdentity(employee: WeComEmployeeIdentity) {
  const userId = employee.wecomUserIdVerifiedAt ? toWeComMentionUserId(employee.wecomUserId) : null;
  const mobile = toWeComMentionMobile(employee.mobile);
  const method = userId ? 'USER_ID' : mobile ? 'MOBILE' : 'MISSING';
  const target = userId || mobile || '';
  return { method, target, maskedTarget: userId ? `${userId.slice(0, 2)}…${userId.slice(-2)}` : maskEmployeeMobile(mobile),
    fingerprint: createHash('sha256').update(JSON.stringify([employee.id, method, target])).digest('hex'),
    mentionedMobiles: userId || !mobile ? [] : [mobile], mentionedUserIds: userId ? [userId] : [] };
}
export function wecomWebhookFingerprint(value = process.env.WECOM_ROBOT_WEBHOOK_URL || '') {
  return createHash('sha256').update(value.trim()).digest('hex');
}
export function wecomMentionState(employee: WeComEmployeeIdentity, webhook?: string) {
  const identity = wecomIdentity(employee);
  if (identity.method === 'MISSING') return 'MISSING';
  const check = employee.wecomMentionCheck as Record<string, unknown> | null;
  if (!check || check.fingerprint !== identity.fingerprint || check.webhookFingerprint !== wecomWebhookFingerprint(webhook)) return 'UNVERIFIED';
  return check.state === 'CONFIRMED' ? 'CONFIRMED' : check.state === 'NEEDS_CHECK' ? 'NEEDS_CHECK' : 'TEST_ACCEPTED';
}

export const WECOM_MENTION_STATE_LABELS: Record<string, string> = {
  MISSING: '待配置', UNVERIFIED: '已配置，待验证', TEST_ACCEPTED: '试发已接收，待群内确认',
  CONFIRMED: '群内提醒已确认', NEEDS_CHECK: '提醒需要检查',
};
