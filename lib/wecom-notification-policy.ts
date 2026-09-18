/** Shared policy labels contain no credentials and may be shown in settings. */
export const QUALITY_WECOM_EVENTS = ['ASSIGNED', 'REVIEW', 'RETURNED', 'CONSOLIDATE', 'APPROVED'] as const;
export type QualityWeComEvent = typeof QUALITY_WECOM_EVENTS[number];
export type WeComNotificationSource = { sourceType: string; eventType: string };

export const WECOM_NOTIFICATION_POLICY = {
  automaticScope: 'QUALITY_AND_PURCHASING',
  label: '自动通知范围：质量管理与杭连采购',
  description: '质量与采购使用各自的推送配置；工艺变更、生产报工等保留站内通知。',
  manualTest: 'ADMIN_CONFIRMED_ONLY',
} as const;
export const WECOM_POLICY_BLOCK_REASON = '该事件未在质量或采购群推送范围内，仅保留站内通知';
export const PURCHASING_WECOM_EVENTS = ['SAVE_REQUEST', 'APPROVE_LINES', 'RETURN_LINES', 'WITHDRAW_LINES', 'VOID_LINES', 'CREATE_FUND', 'APPROVE_FUNDS', 'RETURN_FUNDS', 'WITHDRAW_FUND', 'CLOSE_FUND', 'TEST'];

export function isQualityWeComEvent(event: unknown): event is QualityWeComEvent {
  return typeof event === 'string' && QUALITY_WECOM_EVENTS.some(allowed => allowed === event);
}

/** Unknown sources/events fail closed; the test route separately requires admin + explicit confirmation. */
export function isWeComNotificationAllowed(source: WeComNotificationSource | null | undefined): boolean {
  return source?.sourceType === 'internal_quality_risk' && isQualityWeComEvent(source.eventType)
    || source?.sourceType === 'PURCHASING' && PURCHASING_WECOM_EVENTS.includes(source.eventType)
    || source?.sourceType === 'connection_test' && source.eventType === 'ADMIN_CONFIRMED_TEST';
}
