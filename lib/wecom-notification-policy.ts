/** Shared policy labels contain no credentials and may be shown in settings. */
export const QUALITY_WECOM_EVENTS = ['ASSIGNED', 'REVIEW', 'RETURNED', 'CONSOLIDATE', 'APPROVED'] as const;
export type QualityWeComEvent = typeof QUALITY_WECOM_EVENTS[number];
export type WeComNotificationSource = { sourceType: string; eventType: string };

export const WECOM_NOTIFICATION_POLICY = {
  automaticScope: 'QUALITY_ONLY',
  label: '自动通知范围：仅质量管理',
  description: '工艺变更、生产报工及其他业务仅保留站内通知。',
  manualTest: 'ADMIN_CONFIRMED_ONLY',
} as const;
export const WECOM_POLICY_BLOCK_REASON = '通知范围调整：仅质量管理允许企业微信，其他业务仅保留站内通知';

export function isQualityWeComEvent(event: unknown): event is QualityWeComEvent {
  return typeof event === 'string' && QUALITY_WECOM_EVENTS.some(allowed => allowed === event);
}

/** Unknown sources/events fail closed; the test route separately requires admin + explicit confirmation. */
export function isWeComNotificationAllowed(source: WeComNotificationSource | null | undefined): boolean {
  return source?.sourceType === 'internal_quality_risk' && isQualityWeComEvent(source.eventType)
    || source?.sourceType === 'connection_test' && source.eventType === 'ADMIN_CONFIRMED_TEST';
}
