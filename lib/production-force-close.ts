export type ProductionForceCloseMode = 'verified_output' | 'stop_execution';

export type ProductionForceCloseStep = {
  id: string;
  name: string;
  position: number;
  status: string;
  reported: number;
  covered: number;
  pendingCoverage: number;
  supplementalRemaining: number;
};

export type ProductionForceClosePreview = {
  workOrderId: string;
  code: string;
  specification: string | null;
  targetQty: number | null;
  verifiedQty: number | null;
  lastReportedQty: number | null;
  steps: ProductionForceCloseStep[];
  relatedOpenOrders: string[];
  pendingSubmissionCount: number;
  version: string;
  closure: {
    mode: ProductionForceCloseMode;
    actualQty: number | null;
    reason: string;
    actor: string;
    at: string;
  } | null;
  canClose: boolean;
};

export const PRODUCTION_FORCE_CLOSE_ROUTE_STATUS = 'force_closed';
export const PRODUCTION_FORCE_CLOSE_EVENT = 'force_close';
