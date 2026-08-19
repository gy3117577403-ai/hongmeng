import {
  hasCapability,
  type AccessActionCode,
  type AccessContext,
} from '@/lib/department-access';

export type AbnormalTimeWriteOperation =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE';

/**
 * Abnormal-time records affect attendance and quality conclusions. HR and
 * Quality may maintain them globally; workshop production leaders may also
 * maintain them because the module is explicitly opened with full business
 * permissions. Entity/workshop checks remain at the review routes.
 */
export function canMutateAbnormalTimeEvent(
  access: Pick<AccessContext, 'capabilities'>,
  operation: AbnormalTimeWriteOperation,
): boolean {
  return hasCapability(access, 'HR', operation)
    || hasCapability(access, 'QUALITY', operation)
    || hasCapability(access, 'PRODUCTION', operation);
}

export const DAILY_SHIPMENT_MUTATION_ACTIONS = [
  'ADD_ITEMS',
  'UPDATE_ITEM',
  'CANCEL_ITEM',
  'CONFIRM_PLAN',
  'CLOSE_PLAN',
  'ROLL_OVER_PLAN',
  'RELEASE_RESERVATION',
  'TRANSFER_RESERVATION',
  'RECORD_SHIPMENT',
  'REVERSE_SHIPMENT',
] as const;

export type DailyShipmentMutationAction = typeof DAILY_SHIPMENT_MUTATION_ACTIONS[number];
export type DailyShipmentRequiredAction = Extract<
  AccessActionCode,
  'CREATE' | 'UPDATE' | 'EXECUTE_WORKFLOW'
>;

export function dailyShipmentRequiredAction(
  action: string,
): DailyShipmentRequiredAction | null {
  switch (action) {
    case 'ADD_ITEMS':
      return 'CREATE';
    case 'UPDATE_ITEM':
    case 'CANCEL_ITEM':
      return 'UPDATE';
    case 'CONFIRM_PLAN':
    case 'CLOSE_PLAN':
    case 'ROLL_OVER_PLAN':
    case 'RELEASE_RESERVATION':
    case 'TRANSFER_RESERVATION':
    case 'RECORD_SHIPMENT':
    case 'REVERSE_SHIPMENT':
      return 'EXECUTE_WORKFLOW';
    default:
      return null;
  }
}

export function canMutateDailyShipment(
  access: Pick<AccessContext, 'capabilities'>,
  action: string,
): boolean {
  const requiredAction = dailyShipmentRequiredAction(action);
  return requiredAction !== null
    && (
      hasCapability(access, 'PLANNING', requiredAction)
      || hasCapability(access, 'PRODUCTION', requiredAction)
    );
}
