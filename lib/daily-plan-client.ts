import type { EmployeeDTO, ProcessLaborPoolDTO } from '@/types';

export type DailyPlanStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'ARCHIVED' | 'CANCELLED';

export type DailyTaskStatus =
  | 'UNPLANNED'
  | 'WAITING_UPSTREAM'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PENDING_CARRY_OVER'
  | 'CARRIED_OVER'
  | 'NEEDS_REVIEW'
  | 'CANCELLED';

export type DailyPlanScopeRole = 'ADMIN' | 'WORKSHOP_SUPERVISOR' | 'TEAM_LEADER' | 'EMPLOYEE';
export type DailyPlanRiskLevel = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export type DailyPlanAssignmentStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type DailyPlanTeam = {
  id: string;
  name: string;
  code?: string | null;
  leaderId?: string | null;
  leaderName?: string | null;
  memberCount: number;
};

export type DailyPlanAssignment = {
  id: string;
  taskId: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  teamId: string;
  teamName: string;
  quantity: number;
  plannedMinutes: number;
  order: number;
  status: DailyPlanAssignmentStatus;
  version: number;
  overtimeStart?: string | null;
  overtimeEnd?: string | null;
  actualCompletedQuantity?: number;
  actualClaimedMinutes?: number;
  laborPoolQuantity?: number;
};

export type DailyPlanTask = {
  id: string;
  planId?: string | null;
  workOrderId: string;
  workOrderCode: string;
  productCode: string;
  productName: string;
  customerName?: string | null;
  processStepId: string;
  processName: string;
  processSequence: number;
  sequenceGroup: number;
  status: DailyTaskStatus;
  version: number;
  plannedQuantity: number;
  remainingQuantity: number;
  availableQuantity: number;
  assignedQuantity: number;
  unitStandardSeconds: number;
  plannedMinutes: number;
  dueDate?: string | null;
  priority: number;
  priorityLabel?: string | null;
  riskLevel: DailyPlanRiskLevel;
  teamId?: string | null;
  teamName?: string | null;
  routeVersion: number;
  routeVersionLabel?: string | null;
  hardBlocked: boolean;
  hardBlockReason?: string | null;
  warnings: string[];
  upstreamProcessName?: string | null;
  assignments: DailyPlanAssignment[];
};

export type DailyPlanEmployee = {
  id: string;
  employeeNo: string;
  name: string;
  position?: string | null;
  teamId: string;
  teamName: string;
  planningRole?: DailyPlanScopeRole | null;
  attendanceSource: 'CONFIRMED' | 'DEFAULT_8H' | 'OVERRIDE';
  capacityMinutes: number;
  overtimeMinutes: number;
  assignedMinutes: number;
  completedMinutes: number;
  assignments: DailyPlanAssignment[];
};

export type DailyPlanEmployeeOption = {
  id: string;
  employeeNo: string;
  name: string;
  teamId: string;
  teamName: string;
};

export type DailyPlanMaintenanceItem = {
  id: string;
  workOrderId: string;
  workOrderCode: string;
  productName: string;
  customerName?: string | null;
  reason: string;
  message: string;
  missingStepNames: string[];
  actionHref: string;
};

export type DailyPlanRisk = {
  id: string;
  level: DailyPlanRiskLevel;
  title: string;
  description: string;
  taskId?: string | null;
  workOrderCode?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
};

export type DailyPlanSummary = {
  plannedMinutes: number;
  assignedMinutes: number;
  unassignedMinutes: number;
  urgentTaskCount: number;
  overloadedEmployeeCount: number;
  carryOverTaskCount: number;
};

export type DailyPlanScope = {
  role: DailyPlanScopeRole;
  teamIds: string[];
  canConfirm: boolean;
  canManageOrganization: boolean;
  canRequestCrossTeam: boolean;
};

export type DailyPlanWorkbench = {
  generatedAt: string;
  workDate: string;
  shift: {
    code: string;
    label: string;
    startTime: string;
    endTime: string;
    lunchStartTime?: string | null;
    lunchEndTime?: string | null;
  };
  plan: {
    id?: string | null;
    status: DailyPlanStatus;
    version: number;
    confirmedAt?: string | null;
    confirmedByName?: string | null;
    isAggregate: boolean;
    teamCount: number;
    generatedTeamCount: number;
    confirmedTeamCount: number;
  };
  selectedTeamId?: string | null;
  scope: DailyPlanScope;
  summary: DailyPlanSummary;
  teamOptions: DailyPlanTeam[];
  teams: DailyPlanTeam[];
  employeeOptions: DailyPlanEmployeeOption[];
  employees: DailyPlanEmployee[];
  tasks: DailyPlanTask[];
  unassignedTasks: DailyPlanTask[];
  maintenanceItems: DailyPlanMaintenanceItem[];
  risks: DailyPlanRisk[];
};

export type DailyPlanSuggestionAssignment = {
  taskId: string;
  employeeId: string;
  employeeName: string;
  teamName: string;
  quantity: number;
  plannedMinutes: number;
  reason: string;
};

export type DailyPlanSuggestionPreview = {
  suggestionKey: string;
  workDate: string;
  shiftCode: string;
  teamId?: string | null;
  taskCount: number;
  assignmentCount: number;
  assignedMinutes: number;
  unassignedMinutes: number;
  overloadedEmployeeCount: number;
  warnings: string[];
  assignments: DailyPlanSuggestionAssignment[];
};

export type DailyPlanCrossTeamRequest = {
  id: string;
  taskId: string;
  workOrderCode: string;
  processName: string;
  sourceTeamId?: string | null;
  sourceTeamName?: string | null;
  targetTeamId: string;
  targetTeamName: string;
  employeeId?: string | null;
  employeeName?: string | null;
  quantity: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  version: number;
  requestedByName: string;
  requestedAt: string;
};

export type DailyPlanOrganizationMember = {
  id?: string;
  version?: number;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  position?: string | null;
  planningRole: 'WORKSHOP_SUPERVISOR' | 'TEAM_LEADER' | 'MEMBER';
  teamId?: string | null;
  isActive?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export type DailyPlanOrganizationTeam = {
  id: string;
  version: number;
  code?: string | null;
  name: string;
  legacyTeamName?: string | null;
  sortOrder?: number;
  isActive: boolean;
  members: DailyPlanOrganizationMember[];
};

export type DailyPlanOrganization = {
  version: number;
  availableEmployees: EmployeeDTO[];
  teams: DailyPlanOrganizationTeam[];
};

export type DailyPlanOrganizationMutation =
  | { action: 'upsertTeam'; teamId?: string; code: string; name: string; legacyTeamName?: string; isActive?: boolean; sortOrder?: number; expectedVersion?: number }
  | { action: 'upsertMembership'; membershipId?: string; employeeId: string; teamId?: string; role: 'WORKSHOP_SUPERVISOR' | 'TEAM_LEADER' | 'MEMBER'; isActive?: boolean; effectiveFrom: string; effectiveTo?: string; expectedVersion?: number };

export type DailyPlanLaborPoolList = {
  pools: ProcessLaborPoolDTO[];
  employees: EmployeeDTO[];
};

export type DailyPlanPrintMode = 'team' | 'employee';

type ErrorPayload = { error?: string | { message?: string; code?: string }; message?: string; code?: string };

function errorMessage(body: ErrorPayload | null, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === 'string') return body.error;
  if (body.error?.message) return body.error.message;
  return body.message || fallback;
}

async function responsePayload<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: (T & ErrorPayload) | { data?: T } | null = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as (T & ErrorPayload) | { data?: T };
    } catch {
      if (!response.ok) throw new Error(raw);
    }
  }
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new Error('登录状态已失效，请重新登录');
  }
  if (!response.ok) {
    const errorBody = body as ErrorPayload | null;
    throw new Error(errorMessage(errorBody, `请求失败（${response.status}）`));
  }
  if (body && typeof body === 'object' && 'data' in body && body.data !== undefined) return body.data;
  return (body || {}) as T;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  return responsePayload<T>(response);
}

export const dailyPlanClient = {
  getWorkbench(workDate: string, teamId: string, signal?: AbortSignal, shiftCode = 'DAY'): Promise<DailyPlanWorkbench> {
    const query = new URLSearchParams({ date: workDate, shiftCode });
    if (teamId) query.set('teamId', teamId);
    return request(`/api/daily-plans/workbench?${query.toString()}`, { signal });
  },

  previewSuggestions(input: { workDate: string; shiftCode: string; teamId: string }): Promise<DailyPlanSuggestionPreview> {
    return request('/api/daily-plans/suggestions/preview', { method: 'POST', body: JSON.stringify(input) });
  },

  createFromSuggestion(input: { workDate: string; shiftCode: string; teamId: string; suggestionKey: string }, idempotencyKey: string): Promise<{ planId: string; version: number }> {
    return request('/api/daily-plans', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) });
  },

  updatePlan(planId: string, input: Record<string, unknown>, expectedVersion: number, idempotencyKey: string): Promise<{ version: number }> {
    return request(`/api/daily-plans/${encodeURIComponent(planId)}`, {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, expectedVersion, idempotencyKey }),
    });
  },

  assignTask(taskId: string, input: {
    expectedVersion: number;
    reason?: string;
    assignments: Array<{ employeeId: string; quantity: number; sortOrder: number; regularStartAt?: string; regularEndAt?: string; overtimeStartAt?: string; overtimeEndAt?: string }>;
  }, idempotencyKey: string): Promise<{ version: number }> {
    return request(`/api/daily-plan-tasks/${encodeURIComponent(taskId)}/assignments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  mutateAssignments(taskId: string, input: {
    action: 'adjust' | 'withdraw' | 'reorder';
    expectedVersion: number;
    reason: string;
    assignments?: Array<{ assignmentId?: string; expectedVersion?: number; employeeId?: string; quantity?: number; sortOrder?: number }>;
  }, idempotencyKey: string): Promise<{ version: number }> {
    return request(`/api/daily-plan-tasks/${encodeURIComponent(taskId)}/assignments`, {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  requestCrossTeam(taskId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<{ revisionId: string }> {
    return request(`/api/daily-plan-tasks/${encodeURIComponent(taskId)}/cross-team-request`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  carryOverTask(taskId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<{ revisionId: string }> {
    return request(`/api/daily-plan-tasks/${encodeURIComponent(taskId)}/carry-over`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  listCrossTeamRequests(signal?: AbortSignal): Promise<{ requests: DailyPlanCrossTeamRequest[] }> {
    return request('/api/daily-plans/cross-team-requests?status=PENDING', { signal });
  },

  reviewCrossTeamRequest(requestId: string, input: { decision: 'APPROVE' | 'REJECT'; expectedVersion: number; reviewNote?: string }, idempotencyKey: string): Promise<{ version: number }> {
    return request(`/api/daily-plans/cross-team-requests/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  getOrganization(signal?: AbortSignal): Promise<DailyPlanOrganization> {
    return request('/api/daily-plans/organization', { signal });
  },

  updateOrganization(input: DailyPlanOrganizationMutation, idempotencyKey: string): Promise<DailyPlanOrganization> {
    return request('/api/daily-plans/organization', {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  listLaborPools(workDate: string, signal?: AbortSignal): Promise<DailyPlanLaborPoolList> {
    const query = new URLSearchParams({ workDate, includeExhausted: 'false' });
    return request(`/api/process-labor-pools?${query.toString()}`, { signal });
  },

  batchClaimLaborPool(poolId: string, input: { expectedVersion: number; allocations: Array<{ employeeId: string; quantity: number }> }, idempotencyKey: string): Promise<{ claims: unknown[]; pool: ProcessLaborPoolDTO }> {
    return request(`/api/process-labor-pools/${encodeURIComponent(poolId)}/claims/batch`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
  },

  printUrl(planId: string, mode: DailyPlanPrintMode, employeeId?: string): string {
    const query = new URLSearchParams({ mode });
    if (employeeId) query.set('employeeId', employeeId);
    return `/api/daily-plans/${encodeURIComponent(planId)}/print?${query.toString()}`;
  },
};

export function createIdempotencyKey(prefix: string): string {
  const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  const suffix = cryptoObject?.randomUUID ? cryptoObject.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function formatMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (!hours) return `${remainder} 分钟`;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

export function taskStatusLabel(status: DailyTaskStatus): string {
  return ({
    UNPLANNED: '待排程',
    WAITING_UPSTREAM: '等待上游',
    READY: '可执行',
    IN_PROGRESS: '进行中',
    COMPLETED: '已完成',
    PENDING_CARRY_OVER: '待顺延',
    CARRIED_OVER: '已顺延',
    NEEDS_REVIEW: '待复核',
    CANCELLED: '已取消',
  })[status];
}

export function assignmentStatusLabel(status: DailyPlanAssignmentStatus): string {
  return ({ PLANNED: '已安排', ACTIVE: '进行中', COMPLETED: '已完成', CANCELLED: '已撤回' })[status];
}
