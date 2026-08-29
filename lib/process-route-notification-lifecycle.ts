export const PROCESS_ROUTE_STAGE_EVENTS = [
  'PROCESS_ROUTE_CHANGE_SUBMITTED',
  'PROCESS_ROUTE_CHANGE_APPROVED',
  'PROCESS_ROUTE_CHANGE_REJECTED',
  'PROCESS_ROUTE_CHANGE_REEVALUATED',
  'PROCESS_ROUTE_CHANGE_ACTIVATED',
] as const;

export type ProcessRouteStageEvent = typeof PROCESS_ROUTE_STAGE_EVENTS[number];

export type ProcessRouteStatusValue =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVATING'
  | 'ACTIVE'
  | 'FAILED';

export function isProcessRouteStageEvent(eventType: string): eventType is ProcessRouteStageEvent {
  return (PROCESS_ROUTE_STAGE_EVENTS as readonly string[]).includes(eventType);
}

/**
 * A core-stage notification is restorable/actionable only while both durable
 * projections agree: it belongs to the latest stage outbox and the current
 * ProcessRouteChange.status still represents that stage.
 */
export function processStageNotificationIsCurrent(
  eventType: string,
  changeStatus: ProcessRouteStatusValue,
  isLatestStageOutbox: boolean,
): boolean {
  if (!isLatestStageOutbox) return false;
  if (eventType === 'PROCESS_ROUTE_CHANGE_SUBMITTED' || eventType === 'PROCESS_ROUTE_CHANGE_REEVALUATED') {
    return changeStatus === 'SUBMITTED';
  }
  if (eventType === 'PROCESS_ROUTE_CHANGE_APPROVED') {
    // ACTIVATING is a lease-like intermediate state and FAILED is recoverable;
    // both still point to the latest approved action rather than a terminal.
    return ['APPROVED', 'ACTIVATING', 'FAILED'].includes(changeStatus);
  }
  if (eventType === 'PROCESS_ROUTE_CHANGE_REJECTED') return changeStatus === 'REJECTED';
  if (eventType === 'PROCESS_ROUTE_CHANGE_ACTIVATED') return changeStatus === 'ACTIVE';
  return false;
}
