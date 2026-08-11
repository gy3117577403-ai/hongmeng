import type { ChangeRequestDTO } from '@/types';

export const PROCESS_ROUTE_CHANGE_MANAGED_TRANSITION_ERROR =
  '该事项由现场工艺变更专用流程管理，请前往流程中心审核并启用';

type ProcessRouteChangeLinkHolder = {
  processRouteChange?: Pick<NonNullable<ChangeRequestDTO['processRouteChange']>, 'id'> | null;
};

export function isProcessRouteChangeManaged(change: ProcessRouteChangeLinkHolder): boolean {
  return Boolean(change.processRouteChange?.id);
}

export function processRouteChangeManagedTransitionBlock(change: ProcessRouteChangeLinkHolder): {
  status: 409;
  body: {
    ok: false;
    error: string;
    code: 'PROCESS_ROUTE_CHANGE_MANAGED';
  };
} | null {
  return isProcessRouteChangeManaged(change) ? {
    status: 409,
    body: {
      ok: false,
      error: PROCESS_ROUTE_CHANGE_MANAGED_TRANSITION_ERROR,
      code: 'PROCESS_ROUTE_CHANGE_MANAGED',
    },
  } : null;
}

export function processRouteChangeWorkflowHref(
  processRouteChangeId: string,
  workOrderId?: string | null,
): string {
  const params = new URLSearchParams();
  params.set('processRouteChangeId', processRouteChangeId);
  if (workOrderId) params.set('workOrderId', workOrderId);
  return `/workspace/workflows?${params.toString()}`;
}
