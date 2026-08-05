import { createHash } from 'node:crypto';
import {
  DailyCrossTeamRequestStatus,
  DailyProcessTaskStatus,
  DailyProductionPlanStatus,
  DailyTaskAssignmentStatus,
  Prisma,
  ProductionPlanningRole,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  allocateIncrementalTaskLabor,
  formatWorkDate,
  isDailyPlanAssignableStatus,
  normalizeWorkDate,
  remainingCrossTeamApprovalQuantity,
  resolveDailyTaskAvailability,
  resolveEffectiveCapacity,
  scoreDailyPlanPriority,
  serializeDailyPlanValue,
  type DailyPlanTimeSnapshot,
} from '@/lib/daily-plan-domain';
import { processRouteExecutionReadiness } from '@/lib/process-route-readiness';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import { drawingReady } from '@/lib/daily-plan-readiness';
import {
  productionBatchWeekStartWindow,
  productionWeekDateBounds,
} from '@/lib/production-week';
import {
  summarizeWeeklyProcessAllocation,
  weeklyProcessTeamEligible,
} from '@/lib/weekly-process-allocation';
import {
  isProductionWorkforceEmployee,
  productionEmployeeWhere,
} from '@/lib/production-workforce';
import { splitProductionArrangementQuantity } from '@/lib/production-arrangement-domain';

const DEFAULT_SHIFT_CODE = 'DAY';
const ACTIVE_ROUTE_STATUSES = new Set(['confirmed', 'in_progress', 'completed']);
const ACTIVE_BATCH_STATES = ['active', 'preparation'];

type TransactionClient = Prisma.TransactionClient;
type MutationClient = TransactionClient | typeof prisma;

export class DailyPlanServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'DAILY_PLAN_INVALID', status = 400) {
    super(message);
    this.name = 'DailyPlanServiceError';
    this.code = code;
    this.status = status;
  }
}

type ActorScope = {
  userId: string;
  employeeId: string | null;
  isAdmin: boolean;
  isSupervisor: boolean;
  leaderTeamIds: string[];
  memberTeamIds: string[];
  configured: boolean;
};

type SuggestionCandidate = {
  productionPlanBatchId: string;
  batchWeekStartDate: string;
  batchWeekEndDate: string;
  workOrderId: string;
  workOrderCode: string;
  batchQuantity: number;
  processedQuantity: number;
  productName: string;
  customerName: string;
  dueDate: string;
  routeId: string;
  routeVersion: number;
  stepId: string;
  processDefinitionId: string | null;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  sequenceGroup: number;
  standardSource: string;
  timeBasis: DailyPlanTimeSnapshot['timeBasis'];
  unitLabel: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
  countsForEfficiency: boolean;
  productTimeProfileId: string | null;
  productTimeProfileVersion: number | null;
  plannedQty: number;
  availableQty: number;
  priority: number;
  priorityReason: string;
  riskWarnings: string[];
  status: 'READY' | 'WAITING_UPSTREAM';
  sortOrder: number;
  estimatedStandardMilliseconds: string;
};

function normalizeShiftCode(value?: string | null): string {
  const code = String(value || DEFAULT_SHIFT_CODE).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(code)) {
    throw new DailyPlanServiceError('班次编码无效', 'DAILY_PLAN_SHIFT_INVALID');
  }
  return code;
}

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new DailyPlanServiceError(`${label}必须为正整数`, 'DAILY_PLAN_NUMBER_INVALID');
  }
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new DailyPlanServiceError(`${label}必须为非负整数`, 'DAILY_PLAN_NUMBER_INVALID');
  }
  return result;
}

function expectedVersion(value: unknown): number {
  return nonNegativeInteger(value, '版本号');
}

function requiredText(value: unknown, label: string, maxLength = 500): string {
  const result = String(value || '').trim();
  if (!result) throw new DailyPlanServiceError(`${label}不能为空`, 'DAILY_PLAN_REQUIRED');
  if (result.length > maxLength) {
    throw new DailyPlanServiceError(`${label}不能超过 ${maxLength} 个字符`, 'DAILY_PLAN_TEXT_TOO_LONG');
  }
  return result;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(serializeDailyPlanValue(value))) as Prisma.InputJsonValue;
}

function canonicalDailyMutationValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalDailyMutationValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalDailyMutationValue(item)]),
    );
  }
  return value;
}

function dailyMutationPayloadHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalDailyMutationValue(value)))
    .digest('hex');
}

async function findDailyMutationReplay(client: MutationClient, input: {
  idempotencyKey: string;
  actorId: string;
  action: string;
  target: string;
  requestPayload: unknown;
}) {
  const requestHash = dailyMutationPayloadHash(input.requestPayload);
  if ('$executeRaw' in client) {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-plan:${input.idempotencyKey}`}))`;
  }
  const existing = await client.dailyPlanRevision.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!existing) return { existing: null, requestHash };
  const compatible = existing.actorId === input.actorId
    && existing.action === input.action
    && existing.idempotencyScope === input.target
    && existing.requestHash === requestHash;
  if (!compatible) {
    throw new DailyPlanServiceError(
      '幂等键已被不同的操作内容使用，请刷新后重试',
      'DAILY_PLAN_IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  return { existing, requestHash };
}

function snapshotForTask(task: {
  timeBasis: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
}): DailyPlanTimeSnapshot {
  if (task.timeBasis !== 'per_unit' && task.timeBasis !== 'per_batch') {
    throw new DailyPlanServiceError('工序工时计时口径无效', 'DAILY_PLAN_TIME_BASIS_INVALID', 409);
  }
  return {
    timeBasis: task.timeBasis,
    standardMillisecondsPerUnit: task.standardMillisecondsPerUnit,
    setupMilliseconds: task.setupMilliseconds,
    unitsPerProduct: task.unitsPerProduct,
  };
}

function activeMembershipWhere(workDate: Date): Prisma.ProductionPlanningMembershipWhereInput {
  return {
    isActive: true,
    effectiveFrom: { lte: workDate },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
  };
}

async function resolveActorScope(actorUserId: string, workDate = productionPlanningDateBoundary()): Promise<ActorScope> {
  const actor = await prisma.user.findUnique({
    where: { id: requiredText(actorUserId, '操作人') },
    select: {
      id: true,
      isActive: true,
      laborRole: true,
      employeeId: true,
      employee: {
        select: {
          productionPlanningMemberships: {
            where: activeMembershipWhere(workDate),
            select: { role: true, teamId: true },
          },
        },
      },
    },
  });
  if (!actor?.isActive) {
    throw new DailyPlanServiceError('登录用户不存在或已停用', 'DAILY_PLAN_ACTOR_INVALID', 401);
  }
  const memberships = actor.employee?.productionPlanningMemberships || [];
  const leaderTeamIds = memberships
    .filter(item => item.role === ProductionPlanningRole.TEAM_LEADER && item.teamId)
    .map(item => item.teamId as string);
  const memberTeamIds = memberships
    .filter(item => item.role === ProductionPlanningRole.MEMBER && item.teamId)
    .map(item => item.teamId as string);
  const isSupervisor = memberships.some(item => item.role === ProductionPlanningRole.WORKSHOP_SUPERVISOR);
  return {
    userId: actor.id,
    employeeId: actor.employeeId,
    isAdmin: actor.laborRole === 'ADMIN',
    isSupervisor,
    leaderTeamIds: [...new Set(leaderTeamIds)],
    memberTeamIds: [...new Set(memberTeamIds)],
    configured: memberships.length > 0,
  };
}

function assertVisible(scope: ActorScope): void {
  if (!scope.isAdmin && !scope.isSupervisor && scope.leaderTeamIds.length === 0) {
    throw new DailyPlanServiceError('当前用户不是已配置的车间主管或班组长', 'DAILY_PLAN_FORBIDDEN', 403);
  }
}

function assertTeamMutation(scope: ActorScope, teamId: string): void {
  if (scope.isAdmin || scope.isSupervisor || scope.leaderTeamIds.includes(teamId)) return;
  throw new DailyPlanServiceError('只能调整本班组的日计划', 'DAILY_PLAN_TEAM_FORBIDDEN', 403);
}

function assertSupervisor(scope: ActorScope): void {
  if (scope.isAdmin || scope.isSupervisor) return;
  throw new DailyPlanServiceError('该操作需要车间主管确认', 'DAILY_PLAN_SUPERVISOR_REQUIRED', 403);
}

function assertAdmin(scope: ActorScope): void {
  if (scope.isAdmin) return;
  throw new DailyPlanServiceError('该操作仅管理员可用', 'DAILY_PLAN_ADMIN_REQUIRED', 403);
}

function mapPrismaError(error: unknown): never {
  if (error instanceof DailyPlanServiceError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new DailyPlanServiceError('请求已处理或数据已存在', 'DAILY_PLAN_DUPLICATE', 409);
    }
    if (error.code === 'P2025') {
      throw new DailyPlanServiceError('目标数据不存在或已变更', 'DAILY_PLAN_NOT_FOUND', 404);
    }
    if (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001')) {
      throw new DailyPlanServiceError(
        '日计划数据正在被其他人修改，请刷新后重试',
        'DAILY_PLAN_CONCURRENCY_CONFLICT',
        409,
      );
    }
  }
  throw error;
}

async function serializable<T>(operation: (tx: TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    return mapPrismaError(error);
  }
}

async function readCommitted<T>(operation: (tx: TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    return mapPrismaError(error);
  }
}

type OrganizationMutationAction = 'UPSERT_TEAM' | 'UPSERT_MEMBERSHIP' | 'UPSERT_PROCESS_CAPABILITY';
type OrganizationMutationTarget =
  | 'PRODUCTION_TEAM'
  | 'PRODUCTION_PLANNING_MEMBERSHIP'
  | 'PRODUCTION_TEAM_PROCESS_CAPABILITY';

function organizationMutationPayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function readOrganizationMutationReplay(tx: TransactionClient, input: {
  idempotencyKey: string;
  payloadHash: string;
  actorId: string;
  action: OrganizationMutationAction;
  targetType: OrganizationMutationTarget;
}): Promise<Prisma.JsonValue | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-organization:${input.idempotencyKey}`}))`;
  const existing = await tx.dailyOrganizationMutation.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (!existing) return null;
  if (
    existing.payloadHash !== input.payloadHash
    || existing.actorId !== input.actorId
    || existing.action !== input.action
    || existing.targetType !== input.targetType
  ) {
    throw new DailyPlanServiceError(
      '该幂等键已用于不同的组织维护请求',
      'DAILY_PLAN_IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  return existing.resultData;
}

async function writeOrganizationMutation(tx: TransactionClient, input: {
  idempotencyKey: string;
  payloadHash: string;
  actorId: string;
  action: OrganizationMutationAction;
  targetType: OrganizationMutationTarget;
  targetId: string;
  resultVersion: number;
  resultData: unknown;
}): Promise<void> {
  await tx.dailyOrganizationMutation.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      resultVersion: input.resultVersion,
      resultData: jsonValue(input.resultData),
    },
  });
}

const assignmentInclude = {
  employee: { select: { id: true, employeeNo: true, name: true, department: true, position: true, team: true } },
  assignedTeam: { select: { id: true, code: true, name: true } },
} satisfies Prisma.DailyTaskAssignmentInclude;

const taskInclude = {
  workOrder: { select: { id: true, code: true, customerName: true, productName: true, productionTargetQty: true } },
  route: { select: { id: true, version: true, status: true, updatedAt: true } },
  step: { select: { id: true, inputQty: true, processedQty: true, goodOutputQty: true, releasedGoodQty: true, status: true } },
  assignments: {
    where: { status: { not: DailyTaskAssignmentStatus.CANCELLED } },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: assignmentInclude,
  },
  crossTeamRequests: {
    where: { status: DailyCrossTeamRequestStatus.PENDING },
    include: {
      requestingTeam: { select: { id: true, name: true } },
      targetTeam: { select: { id: true, name: true } },
      employee: { select: { id: true, employeeNo: true, name: true } },
    },
  },
} satisfies Prisma.DailyProcessTaskInclude;

const planInclude = {
  team: { select: { id: true, code: true, name: true, legacyTeamName: true } },
  tasks: { orderBy: [{ sortOrder: 'asc' as const }, { position: 'asc' as const }], include: taskInclude },
  capacityOverrides: {
    include: { employee: { select: { id: true, employeeNo: true, name: true } } },
    orderBy: { employee: { employeeNo: 'asc' as const } },
  },
  revisions: { orderBy: { createdAt: 'desc' as const }, take: 100 },
} satisfies Prisma.DailyProductionPlanInclude;

async function loadPlan(client: MutationClient, planId: string) {
  const plan = await client.dailyProductionPlan.findUnique({ where: { id: planId }, include: planInclude });
  if (!plan) throw new DailyPlanServiceError('日计划不存在', 'DAILY_PLAN_NOT_FOUND', 404);
  return plan;
}

async function loadTask(client: MutationClient, taskId: string) {
  const task = await client.dailyProcessTask.findUnique({
    where: { id: taskId },
    include: { ...taskInclude, plan: { include: { team: true } } },
  });
  if (!task) throw new DailyPlanServiceError('日计划工序任务不存在', 'DAILY_PLAN_TASK_NOT_FOUND', 404);
  return task;
}

async function writeRevision(client: MutationClient, input: {
  planId: string;
  taskId?: string | null;
  assignmentId?: string | null;
  action: string;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
  actorId: string;
  idempotencyKey?: string | null;
  idempotencyScope?: string | null;
  requestPayload?: unknown;
}) {
  return client.dailyPlanRevision.create({
    data: {
      planId: input.planId,
      taskId: input.taskId || null,
      assignmentId: input.assignmentId || null,
      action: input.action,
      beforeData: input.beforeData === undefined ? undefined : jsonValue(input.beforeData),
      afterData: input.afterData === undefined ? undefined : jsonValue(input.afterData),
      reason: input.reason || null,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey || null,
      idempotencyScope: input.idempotencyScope || null,
      requestHash: input.idempotencyKey && input.requestPayload !== undefined
        ? dailyMutationPayloadHash(input.requestPayload)
        : null,
    },
  });
}

function assertPlanCanAppendTasks(status: DailyProductionPlanStatus): void {
  if (status === DailyProductionPlanStatus.ARCHIVED || status === DailyProductionPlanStatus.CANCELLED) {
    throw new DailyPlanServiceError('已归档或已取消的日计划不能继续追加任务', 'DAILY_PLAN_STATUS_INVALID', 409);
  }
}

function appendMutationPlanState(status: DailyProductionPlanStatus) {
  if (status === DailyProductionPlanStatus.DRAFT) {
    return { updated: false, data: {} as Prisma.DailyProductionPlanUncheckedUpdateInput };
  }
  return {
    updated: true,
    data: {
      status: DailyProductionPlanStatus.NEEDS_REVIEW,
      confirmedAt: null,
      confirmedById: null,
      version: { increment: 1 },
    } satisfies Prisma.DailyProductionPlanUncheckedUpdateInput,
  };
}

async function ensureTaskVersion(
  tx: TransactionClient,
  taskId: string,
  version: number,
  data: Prisma.DailyProcessTaskUpdateManyMutationInput,
) {
  const result = await tx.dailyProcessTask.updateMany({ where: { id: taskId, version }, data });
  if (result.count !== 1) {
    throw new DailyPlanServiceError('任务已被其他人更新，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
  }
}

async function ensurePlanVersion(
  tx: TransactionClient,
  planId: string,
  version: number,
  data: Prisma.DailyProductionPlanUncheckedUpdateManyInput,
) {
  const result = await tx.dailyProductionPlan.updateMany({ where: { id: planId, version }, data });
  if (result.count !== 1) {
    throw new DailyPlanServiceError('日计划已被其他人更新，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
  }
}

async function activeEmployeeMembership(
  client: MutationClient,
  employeeId: string,
  workDate: Date,
) {
  const employee = await client.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, department: true, isActive: true, attendanceEnabled: true },
  });
  if (!isProductionWorkforceEmployee(employee)) {
    throw new DailyPlanServiceError(
      '员工不属于生产部、未启用考勤或已停用，不能分配日计划',
      'DAILY_PLAN_EMPLOYEE_INACTIVE',
      409,
    );
  }
  return client.productionPlanningMembership.findMany({
    where: { employeeId, ...activeMembershipWhere(workDate) },
    include: { team: true, employee: true },
  });
}

async function assertProductionEmployeesCanBeScheduled(
  client: MutationClient,
  employeeIds: string[],
) {
  const employees = await client.employee.findMany({
    where: {
      id: { in: employeeIds },
      ...productionEmployeeWhere({ requireAttendance: false }),
    },
    select: { id: true, employeeNo: true, name: true },
  });
  if (employees.length !== employeeIds.length) {
    throw new DailyPlanServiceError(
      '所选人员已离职、已转出生产部或人事档案不存在，请刷新人员名单后重试',
      'DAILY_PLAN_EMPLOYEE_INACTIVE',
      409,
    );
  }
  return employees;
}

async function assertEmployeeCanBeAssigned(input: {
  client: MutationClient;
  taskId: string;
  taskTeamId: string;
  workDate: Date;
  employeeId: string;
  quantity: number;
  excludeAssignmentId?: string;
}) {
  const memberships = await activeEmployeeMembership(input.client, input.employeeId, input.workDate);
  const ownTeam = memberships.find(item => item.teamId === input.taskTeamId && item.role !== ProductionPlanningRole.WORKSHOP_SUPERVISOR);
  if (ownTeam) return { assignedTeamId: input.taskTeamId, crossTeam: false };
  const targetMembership = memberships.find(item => item.teamId && item.role !== ProductionPlanningRole.WORKSHOP_SUPERVISOR);
  if (!targetMembership?.teamId) {
    throw new DailyPlanServiceError('员工尚未配置有效生产班组', 'DAILY_PLAN_EMPLOYEE_UNMAPPED', 409);
  }
  const approval = await input.client.dailyCrossTeamRequest.aggregate({
    where: {
      taskId: input.taskId,
      requestingTeamId: input.taskTeamId,
      targetTeamId: targetMembership.teamId,
      employeeId: input.employeeId,
      status: DailyCrossTeamRequestStatus.APPROVED,
    },
    _sum: { quantity: true },
  });
  const approvedQuantity = approval._sum.quantity || 0;
  if (approvedQuantity <= 0) {
    throw new DailyPlanServiceError('跨组分配必须先由车间主管批准', 'DAILY_PLAN_CROSS_TEAM_APPROVAL_REQUIRED', 409);
  }
  const existing = await input.client.dailyTaskAssignment.aggregate({
    where: {
      taskId: input.taskId,
      employeeId: input.employeeId,
      assignedTeamId: targetMembership.teamId,
      status: { not: DailyTaskAssignmentStatus.CANCELLED },
      ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
    },
    _sum: { quantity: true },
  });
  const remainingQuantity = remainingCrossTeamApprovalQuantity({
    approvedQuantity,
    alreadyAssignedQuantity: existing._sum.quantity || 0,
  });
  if (input.quantity > remainingQuantity) {
    throw new DailyPlanServiceError(
      `跨组审批剩余可分配数量不足（剩余 ${remainingQuantity}）`,
      'DAILY_PLAN_CROSS_TEAM_APPROVAL_EXCEEDED',
      409,
    );
  }
  return { assignedTeamId: targetMembership.teamId, crossTeam: true };
}

function assertPlanAllowsAssignments(status: DailyProductionPlanStatus): void {
  if (isDailyPlanAssignableStatus(status)) return;
  throw new DailyPlanServiceError(
    '日计划须经车间主管确认后才能领取并分配',
    'DAILY_PLAN_CONFIRMATION_REQUIRED',
    409,
  );
}

export async function previewDailyPlanSuggestions(input: {
  actorUserId: string;
  workDate: string | Date;
  shiftCode?: string;
  teamId: string;
  workOrderIds?: string[];
  includeWaitingUpstream?: boolean;
  allowCrossWeekWorkOrders?: boolean;
  allocationScope?: 'week' | 'all_active';
  productionWide?: boolean;
}) {
  const workDate = normalizeWorkDate(input.workDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertVisible(scope);
  const teamId = requiredText(input.teamId, '生产班组');
  assertTeamMutation(scope, teamId);
  const batchWeek = productionBatchWeekStartWindow(workDate);
  const taskWeek = productionWeekDateBounds(workDate);
  const [team, activeCapabilities] = await Promise.all([
    prisma.productionTeam.findFirst({
      where: { id: teamId, isActive: true },
      include: {
        processCapabilities: {
          where: { isActive: true, processDefinition: { isActive: true } },
          select: { processDefinitionId: true },
        },
      },
    }),
    prisma.productionTeamProcessCapability.findMany({
      where: { isActive: true, team: { isActive: true }, processDefinition: { isActive: true } },
      select: { processDefinitionId: true },
    }),
  ]);
  if (!team) throw new DailyPlanServiceError('生产班组不存在或已停用', 'DAILY_PLAN_TEAM_NOT_FOUND', 404);
  const globallyOwnedProcessDefinitionIds = new Set(activeCapabilities.map(item => item.processDefinitionId));
  const ownedProcessDefinitionIds = new Set(team.processCapabilities.map(item => item.processDefinitionId));
  const workOrderIds = [...new Set((input.workOrderIds || []).map(item => String(item).trim()).filter(Boolean))];
  const allowCrossWeekWorkOrders = input.allowCrossWeekWorkOrders === true && workOrderIds.length > 0;
  const batches = await prisma.productionPlanBatch.findMany({
    where: {
      deletedAt: null,
      releaseState: { in: ACTIVE_BATCH_STATES },
      workOrderId: { not: null, ...(workOrderIds.length ? { in: workOrderIds } : {}) },
      ...(allowCrossWeekWorkOrders ? {} : { weekStartDate: { gte: batchWeek.gte, lt: batchWeek.lt } }),
      planOrder: { deletedAt: null },
      workOrder: { is: { deletedAt: null } },
    },
    include: {
      planOrder: true,
      workOrder: {
        include: {
          materialTask: true,
          processRoute: { include: { steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] } } },
        },
      },
    },
    orderBy: [{ plannedCompletionDate: 'asc' }, { createdAt: 'asc' }],
  });
  const candidates: SuggestionCandidate[] = [];
  const blocked: Array<Record<string, unknown>> = [];
  for (const batch of batches) {
    const workOrder = batch.workOrder;
    const route = workOrder?.processRoute;
    const readiness = processRouteExecutionReadiness(route?.steps);
    if (!workOrder || !route || !ACTIVE_ROUTE_STATUSES.has(route.status) || !readiness.ready) {
      const activeSteps = route?.steps.filter(step => step.status !== 'skipped') || [];
      const reason = !workOrder
        ? 'WORK_ORDER_NOT_READY'
        : !route
          ? 'MISSING_PROCESS_ROUTE'
          : !ACTIVE_ROUTE_STATUSES.has(route.status)
            ? 'PROCESS_ROUTE_NOT_PUBLISHED'
            : activeSteps.length === 0
              ? 'EMPTY_PROCESS_ROUTE'
              : 'MISSING_PROCESS_TIME';
      const message = reason === 'WORK_ORDER_NOT_READY'
        ? '生产工单尚未准备完成'
        : reason === 'MISSING_PROCESS_ROUTE'
          ? '尚未生成已发布的产品工艺路线'
          : reason === 'PROCESS_ROUTE_NOT_PUBLISHED'
            ? '产品工艺路线尚未发布或未进入可执行状态'
            : reason === 'EMPTY_PROCESS_ROUTE'
              ? '产品工艺路线没有有效工序'
              : `以下工序缺少有效标准工时：${readiness.missingStepNames.join('、')}`;
      blocked.push({
        productionPlanBatchId: batch.id,
        workOrderId: batch.workOrderId,
        workOrderCode: workOrder?.code || batch.planOrder.specification,
        productName: batch.planOrder.productName,
        customerName: batch.planOrder.customerName,
        drawingLibraryItemId: workOrder?.drawingLibraryItemId || null,
        reason,
        message,
        missingStepNames: readiness.missingStepNames,
      });
      continue;
    }
    for (const step of route.steps.filter(item => item.status !== 'skipped' && item.status !== 'completed')) {
      if (!input.productionWide && !weeklyProcessTeamEligible({
        processDefinitionId: step.processDefinitionId,
        teamProcessDefinitionIds: ownedProcessDefinitionIds,
        globallyOwnedProcessDefinitionIds,
      })) continue;
      const availability = resolveDailyTaskAvailability({
        sequenceGroup: step.sequenceGroup,
        inputQty: step.inputQty,
        processedQty: step.processedQty,
      });
      if (availability.status === 'WAITING_UPSTREAM' && input.includeWaitingUpstream === false) continue;
      const plannedQty = Math.max(0, batch.quantity - step.processedQty);
      if (plannedQty <= 0) continue;
      const score = scoreDailyPlanPriority({
        workDate,
        dueDate: batch.plannedCompletionDate || batch.planOrder.customerDueDate,
        priority: batch.planOrder.priority,
        availableQty: availability.availableQty,
        sequenceGroup: step.sequenceGroup,
      });
      const snapshot = snapshotForTask({
        timeBasis: step.timeBasis || '',
        standardMillisecondsPerUnit: step.standardMillisecondsPerUnit || 0,
        setupMilliseconds: step.setupMilliseconds,
        unitsPerProduct: step.unitsPerProduct,
      });
      const estimated = allocateIncrementalTaskLabor({ snapshot, alreadyAssignedQuantity: 0, quantities: [plannedQty] })[0];
      const riskWarnings: string[] = [];
      if (availability.status === 'WAITING_UPSTREAM') riskWarnings.push('WAITING_UPSTREAM');
      if (!drawingReady(workOrder)) riskWarnings.push('DRAWING_NOT_READY');
      if (workOrder.materialTask?.status !== 'completed') riskWarnings.push('MATERIAL_NOT_READY');
      if (workOrder.materialTask?.exceptionType || workOrder.materialTask?.status === 'exception') riskWarnings.push('WAREHOUSE_EXCEPTION');
      candidates.push({
        productionPlanBatchId: batch.id,
        batchWeekStartDate: formatWorkDate(batch.weekStartDate),
        batchWeekEndDate: formatWorkDate(batch.weekEndDate),
        workOrderId: workOrder.id,
        workOrderCode: workOrder.code,
        batchQuantity: batch.quantity,
        processedQuantity: step.processedQty,
        productName: batch.planOrder.productName,
        customerName: batch.planOrder.customerName,
        dueDate: batch.plannedCompletionDate.toISOString(),
        routeId: route.id,
        routeVersion: route.version,
        stepId: step.id,
        processDefinitionId: step.processDefinitionId,
        processCode: step.processCode,
        processName: step.processName,
        stageGroup: step.stageGroup,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        standardSource: step.standardSource,
        timeBasis: snapshot.timeBasis,
        unitLabel: step.unitLabel || '',
        standardMillisecondsPerUnit: snapshot.standardMillisecondsPerUnit,
        setupMilliseconds: snapshot.setupMilliseconds,
        unitsPerProduct: snapshot.unitsPerProduct,
        countsForEfficiency: step.countsForEfficiency,
        productTimeProfileId: step.productTimeProfileId,
        productTimeProfileVersion: step.productTimeProfileVersion,
        plannedQty,
        availableQty: availability.availableQty,
        priority: score.score,
        priorityReason: score.reasons.join('；'),
        riskWarnings,
        status: availability.status,
        sortOrder: 0,
        estimatedStandardMilliseconds: estimated.toString(),
      });
    }
  }
  const activeTasks = candidates.length
    ? await prisma.dailyProcessTask.findMany({
        where: {
          ...(input.allocationScope === 'all_active'
            ? {}
            : { workDate: { gte: taskWeek.startDate, lt: taskWeek.endExclusiveDate } }),
          productionPlanBatchId: { in: [...new Set(candidates.map(item => item.productionPlanBatchId))] },
          stepId: { in: candidates.map(item => item.stepId) },
          status: { notIn: [DailyProcessTaskStatus.CANCELLED, DailyProcessTaskStatus.CARRIED_OVER] },
        },
        select: {
          id: true,
          planId: true,
          productionPlanBatchId: true,
          stepId: true,
          plannedQty: true,
          workDate: true,
          shiftCode: true,
        },
      })
    : [];
  const activeTasksByPoolItem = activeTasks.reduce((map, item) => {
    const key = `${item.productionPlanBatchId || ''}:${item.stepId}`;
    map.set(key, [...(map.get(key) || []), item]);
    return map;
  }, new Map<string, typeof activeTasks>());
  const availableCandidates = candidates.filter(candidate => {
    const key = `${candidate.productionPlanBatchId}:${candidate.stepId}`;
    const existing = activeTasksByPoolItem.get(key) || [];
    const allocation = summarizeWeeklyProcessAllocation({
      batchQuantity: candidate.batchQuantity,
      processedQuantity: candidate.processedQuantity,
      plannedQuantities: existing.map(item => item.plannedQty),
    });
    const allocatedQuantity = allocation.allocatedQuantity;
    const remainingQuantity = allocation.remainingQuantity;
    if (remainingQuantity <= 0) {
      const first = existing[0];
      blocked.push({
        productionPlanBatchId: candidate.productionPlanBatchId,
        workOrderId: candidate.workOrderId,
        workOrderCode: candidate.workOrderCode,
        stepId: candidate.stepId,
        reason: 'ALREADY_PLANNED',
        message: first
          ? `本周已安排至 ${formatWorkDate(first.workDate)}，不再重复生成`
          : '本周工序数量已经完成',
        dailyProcessTaskId: first?.id || null,
        dailyProductionPlanId: first?.planId || null,
        nonMaintenance: true,
      });
      return false;
    }
    candidate.plannedQty = remainingQuantity;
    candidate.availableQty = Math.min(candidate.availableQty, remainingQuantity);
    candidate.estimatedStandardMilliseconds = allocateIncrementalTaskLabor({
      snapshot: {
        timeBasis: candidate.timeBasis,
        standardMillisecondsPerUnit: candidate.standardMillisecondsPerUnit,
        setupMilliseconds: candidate.setupMilliseconds,
        unitsPerProduct: candidate.unitsPerProduct,
      },
      alreadyAssignedQuantity: Math.max(candidate.processedQuantity, allocatedQuantity),
      quantities: [remainingQuantity],
    })[0].toString();
    return true;
  });
  availableCandidates.sort((left, right) => right.priority - left.priority
    || left.sequenceGroup - right.sequenceGroup
    || left.position - right.position
    || left.workOrderCode.localeCompare(right.workOrderCode, 'zh-CN'));
  availableCandidates.forEach((item, index) => { item.sortOrder = index; });

  const certificationInclude = {
    where: {
      status: 'ACTIVE',
      effectiveFrom: { lte: workDate },
      OR: [{ expiresAt: null }, { expiresAt: { gte: workDate } }],
      skill: { is: { isActive: true } },
    },
    include: { skill: true },
  } satisfies Prisma.EmployeeSkillCertificationFindManyArgs;
  const workforce = input.productionWide
    ? (await prisma.employee.findMany({
        where: productionEmployeeWhere({ requireAttendance: false }),
        include: { skillCertifications: certificationInclude },
        orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
      })).map(employee => ({
        employeeId: employee.id,
        role: ProductionPlanningRole.MEMBER,
        employee,
      }))
    : await prisma.productionPlanningMembership.findMany({
        where: {
          teamId,
          role: { in: [ProductionPlanningRole.TEAM_LEADER, ProductionPlanningRole.MEMBER] },
          ...activeMembershipWhere(workDate),
          employee: { is: productionEmployeeWhere() },
        },
        include: {
          employee: { include: { skillCertifications: certificationInclude } },
        },
      });
  const employeeIds = workforce.map(item => item.employeeId);
  const [attendance, existingAssignments, dailyPlan] = await Promise.all([
    employeeIds.length ? prisma.attendanceRecord.findMany({ where: { workDate, employeeId: { in: employeeIds } } }) : [],
    employeeIds.length ? prisma.dailyTaskAssignment.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: { not: DailyTaskAssignmentStatus.CANCELLED },
        task: { workDate, shiftCode, status: { not: DailyProcessTaskStatus.CANCELLED } },
      },
      select: { employeeId: true, plannedStandardMilliseconds: true },
    }) : [],
    prisma.dailyProductionPlan.findUnique({
      where: { workDate_shiftCode_teamId: { workDate, shiftCode, teamId } },
      include: { capacityOverrides: true },
    }),
  ]);
  const attendanceByEmployee = new Map(attendance.map(item => [item.employeeId, item] as const));
  const overrideByEmployee = new Map((dailyPlan?.capacityOverrides || []).map(item => [item.employeeId, item] as const));
  const assignedByEmployee = existingAssignments.reduce((map, item) => {
    map.set(item.employeeId, (map.get(item.employeeId) || 0n) + item.plannedStandardMilliseconds);
    return map;
  }, new Map<string, bigint>());
  const employeeCapacity = workforce.map(member => {
    const record = attendanceByEmployee.get(member.employeeId);
    const override = overrideByEmployee.get(member.employeeId);
    const capacity = resolveEffectiveCapacity({
      attendanceActualMilliseconds: record?.actualMilliseconds,
      attendanceOvertimeMilliseconds: record?.overtimeMilliseconds,
      overrideRegularMilliseconds: override?.regularMilliseconds,
      overrideOvertimeMilliseconds: override?.overtimeMilliseconds,
    });
    const assigned = assignedByEmployee.get(member.employeeId) || 0n;
    return {
      employeeId: member.employeeId,
      employeeNo: member.employee.employeeNo,
      employeeName: member.employee.name,
      department: member.employee.department,
      position: member.employee.position,
      team: member.employee.team,
      role: member.role,
      attendanceEnabled: member.employee.attendanceEnabled,
      capacityMilliseconds: BigInt(capacity.totalMilliseconds),
      assignedMilliseconds: assigned,
      remainingMilliseconds: BigInt(capacity.totalMilliseconds) > assigned ? BigInt(capacity.totalMilliseconds) - assigned : 0n,
      source: capacity.source,
      attendanceStatus: record?.status || null,
      attendanceType: record?.attendanceType || null,
      leaveMilliseconds: record?.leaveMilliseconds || 0,
      certifications: member.employee.skillCertifications,
    };
  });
  const remainingByEmployee = new Map(employeeCapacity.map(item => [item.employeeId, item.remainingMilliseconds] as const));
  const employeeSuggestions: Array<Record<string, unknown>> = [];
  const unschedulable: Array<Record<string, unknown>> = [];
  for (const candidate of availableCandidates) {
    const estimated = BigInt(candidate.estimatedStandardMilliseconds);
    const ranked = employeeCapacity
      .map(employee => {
        const skillMatch = employee.certifications.some(certification => {
          const skill = certification.skill;
          return Boolean(candidate.processDefinitionId && skill.sourceProcessDefinitionId === candidate.processDefinitionId)
            || skill.code === candidate.processCode
            || skill.name === candidate.processName;
        });
        return { employee, skillMatch, remaining: remainingByEmployee.get(employee.employeeId) || 0n };
      })
      .sort((left, right) => Number(right.skillMatch) - Number(left.skillMatch)
        || (left.remaining > right.remaining ? -1 : left.remaining < right.remaining ? 1 : 0));
    const selected = ranked.find(item => item.remaining > 0n);
    if (!selected) {
      unschedulable.push({ stepId: candidate.stepId, workOrderId: candidate.workOrderId, reason: 'NO_REMAINING_CAPACITY' });
      continue;
    }
    const allocatedMilliseconds = selected.remaining < estimated ? selected.remaining : estimated;
    remainingByEmployee.set(selected.employee.employeeId, selected.remaining - allocatedMilliseconds);
    employeeSuggestions.push({
      stepId: candidate.stepId,
      workOrderId: candidate.workOrderId,
      employeeId: selected.employee.employeeId,
      employeeNo: selected.employee.employeeNo,
      employeeName: selected.employee.employeeName,
      plannedStandardMilliseconds: allocatedMilliseconds,
      skillMatched: selected.skillMatch,
      warnings: selected.skillMatch ? [] : ['SKILL_NOT_MATCHED'],
    });
  }
  const summary = {
    workOrderCount: new Set(availableCandidates.map(item => item.workOrderId)).size,
    taskCount: availableCandidates.length,
    readyCount: availableCandidates.filter(item => item.status === 'READY').length,
    waitingUpstreamCount: availableCandidates.filter(item => item.status === 'WAITING_UPSTREAM').length,
    blockedCount: blocked.length,
    estimatedStandardMilliseconds: availableCandidates.reduce((sum, item) => sum + BigInt(item.estimatedStandardMilliseconds), 0n).toString(),
  };
  return serializeDailyPlanValue({
    workDate: formatWorkDate(workDate),
    weekStartDate: taskWeek.startKey,
    weekEndDate: taskWeek.endKey,
    shiftCode,
    team,
    processOwnershipConfigured: activeCapabilities.length > 0,
    teamCapabilityCount: ownedProcessDefinitionIds.size,
    candidates: availableCandidates,
    blocked,
    employeeSuggestions,
    employeeCapacity,
    unschedulable,
    summary,
  });
}

export async function createDailyProductionPlan(input: {
  actorUserId: string;
  workDate: string | Date;
  shiftCode?: string;
  teamId: string;
  idempotencyKey: string;
  workOrderIds?: string[];
  includeWaitingUpstream?: boolean;
}) {
  const workDate = normalizeWorkDate(input.workDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const teamId = requiredText(input.teamId, '生产班组');
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const taskWeek = productionWeekDateBounds(workDate);
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertTeamMutation(scope, teamId);
  const preview = await previewDailyPlanSuggestions({ ...input, workDate, shiftCode, teamId });
  const candidates = preview.candidates as SuggestionCandidate[];
  const requestPayload = {
    workDate: formatWorkDate(workDate),
    shiftCode,
    teamId,
    workOrderIds: [...new Set(input.workOrderIds || [])].sort(),
    includeWaitingUpstream: input.includeWaitingUpstream !== false,
  };
  const revisionKey = `${idempotencyKey}:revision`;
  const result = await serializable(async tx => {
    const replay = await findDailyMutationReplay(tx, {
      idempotencyKey: revisionKey,
      actorId: scope.userId,
      action: 'CREATE_PLAN',
      target: `${requestPayload.workDate}:${shiftCode}:${teamId}`,
      requestPayload,
    });
    if (replay.existing) {
      const afterData = replay.existing.afterData as Record<string, unknown> | null;
      return {
        planId: replay.existing.planId,
        createdTaskCount: Number(afterData?.createdTaskCount || 0),
      };
    }
    let plan = await tx.dailyProductionPlan.findUnique({
      where: { workDate_shiftCode_teamId: { workDate, shiftCode, teamId } },
    });
    if (!plan) {
      plan = await tx.dailyProductionPlan.create({
        data: {
          workDate,
          shiftCode,
          teamId,
          idempotencyKey,
          createdById: scope.userId,
          updatedById: scope.userId,
        },
      });
    }
    assertPlanCanAppendTasks(plan.status);
    const targetPlanId = plan.id;
    let createdTaskCount = 0;
    for (const candidate of candidates) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-process:${candidate.productionPlanBatchId}:${candidate.stepId}`}))`;
      const existing = await tx.dailyProcessTask.findMany({
        where: {
          productionPlanBatchId: candidate.productionPlanBatchId,
          stepId: candidate.stepId,
          workDate: { gte: taskWeek.startDate, lt: taskWeek.endExclusiveDate },
          status: { notIn: [DailyProcessTaskStatus.CANCELLED, DailyProcessTaskStatus.CARRIED_OVER] },
        },
        select: { id: true, planId: true, plannedQty: true },
      });
      if (existing.some(task => task.planId === targetPlanId)) continue;
      const currentStep = await tx.workOrderProcessStep.findUnique({
        where: { id: candidate.stepId },
        select: { processedQty: true },
      });
      const remainingQuantity = summarizeWeeklyProcessAllocation({
        batchQuantity: candidate.batchQuantity,
        processedQuantity: currentStep?.processedQty || candidate.processedQuantity,
        plannedQuantities: existing.map(task => task.plannedQty),
      }).remainingQuantity;
      if (remainingQuantity <= 0) continue;
      const plannedQty = Math.min(candidate.plannedQty, remainingQuantity);
      await tx.dailyProcessTask.create({
        data: {
          planId: plan.id,
          workDate,
          shiftCode,
          productionPlanBatchId: candidate.productionPlanBatchId,
          workOrderId: candidate.workOrderId,
          routeId: candidate.routeId,
          stepId: candidate.stepId,
          routeVersion: candidate.routeVersion,
          processCode: candidate.processCode,
          processName: candidate.processName,
          stageGroup: candidate.stageGroup,
          position: candidate.position,
          sequenceGroup: candidate.sequenceGroup,
          standardSource: candidate.standardSource,
          timeBasis: candidate.timeBasis,
          unitLabel: candidate.unitLabel,
          standardMillisecondsPerUnit: candidate.standardMillisecondsPerUnit,
          setupMilliseconds: candidate.setupMilliseconds,
          unitsPerProduct: candidate.unitsPerProduct,
          countsForEfficiency: candidate.countsForEfficiency,
          productTimeProfileId: candidate.productTimeProfileId,
          productTimeProfileVersion: candidate.productTimeProfileVersion,
          plannedQty,
          availableQty: Math.min(candidate.availableQty, plannedQty),
          priority: candidate.priority,
          priorityReason: candidate.priorityReason,
          riskWarnings: candidate.riskWarnings,
          status: candidate.status,
          sortOrder: candidate.sortOrder,
        },
      });
      createdTaskCount += 1;
    }
    if (createdTaskCount > 0) {
      const mutation = appendMutationPlanState(plan.status);
      if (mutation.updated) {
        plan = await tx.dailyProductionPlan.update({
          where: { id: plan.id },
          data: { ...mutation.data, updatedById: scope.userId },
        });
      }
    }
    await writeRevision(tx, {
      planId: plan.id,
      action: 'CREATE_PLAN',
      afterData: { planId: plan.id, createdTaskCount, ...requestPayload },
      actorId: scope.userId,
      idempotencyKey: revisionKey,
      idempotencyScope: `${requestPayload.workDate}:${shiftCode}:${teamId}`,
      requestPayload,
    });
    return { planId: plan.id, createdTaskCount };
  });
  const plan = await loadPlan(prisma, result.planId);
  return serializeDailyPlanValue({ plan, createdTaskCount: result.createdTaskCount, blocked: preview.blocked });
}

export async function confirmDailyProductionPlan(input: {
  actorUserId: string;
  planId: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const existingRevision = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (existingRevision) return { planId: existingRevision.planId };
    const plan = await tx.dailyProductionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new DailyPlanServiceError('日计划不存在', 'DAILY_PLAN_NOT_FOUND', 404);
    const scope = await resolveActorScope(input.actorUserId, plan.workDate);
    assertSupervisor(scope);
    const before = plan;
    await ensurePlanVersion(tx, plan.id, expectedVersion(input.expectedVersion), {
      status: DailyProductionPlanStatus.CONFIRMED,
      confirmedAt: new Date(),
      confirmedById: scope.userId,
      updatedById: scope.userId,
      version: { increment: 1 },
    });
    await writeRevision(tx, {
      planId: plan.id,
      action: 'CONFIRM_PLAN',
      beforeData: before,
      afterData: { status: DailyProductionPlanStatus.CONFIRMED },
      actorId: scope.userId,
      idempotencyKey,
    });
    return { planId: plan.id };
  });
  return serializeDailyPlanValue(await loadPlan(prisma, result.planId));
}

type ProductionArrangementCapacityRow = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  remainingMilliseconds: string | bigint;
  leaveMilliseconds?: number;
};

type ProductionArrangementWarning = {
  code: 'EMPLOYEE_OVERLOAD' | 'EMPLOYEE_LEAVE' | 'CROSS_WEEK';
  message: string;
  employeeId?: string;
  workOrderId?: string;
  stepId?: string;
};

function uniqueRequiredIds(value: unknown, label: string, maximum = 100): string[] {
  if (!Array.isArray(value)) throw new DailyPlanServiceError(`${label}格式不正确`, 'DAILY_PLAN_BODY_INVALID');
  const ids = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  if (!ids.length) throw new DailyPlanServiceError(`${label}不能为空`, 'DAILY_PLAN_REQUIRED');
  if (ids.length > maximum) throw new DailyPlanServiceError(`${label}一次最多选择 ${maximum} 项`, 'DAILY_PLAN_TOO_MANY_ITEMS');
  return ids;
}

function arrangementCapacityWarnings(input: {
  candidates: SuggestionCandidate[];
  employeeIds: string[];
  capacityRows: ProductionArrangementCapacityRow[];
  workDate: string;
}): ProductionArrangementWarning[] {
  const warnings: ProductionArrangementWarning[] = [];
  const plannedByEmployee = new Map<string, bigint>();
  input.candidates.forEach((candidate, candidateIndex) => {
    const split = splitProductionArrangementQuantity(candidate.plannedQty, input.employeeIds, candidateIndex);
    const labor = allocateIncrementalTaskLabor({
      snapshot: snapshotForTask(candidate),
      alreadyAssignedQuantity: 0,
      quantities: split.map(item => item.quantity),
    });
    split.forEach((item, index) => {
      plannedByEmployee.set(item.employeeId, (plannedByEmployee.get(item.employeeId) || 0n) + labor[index]);
    });
    if (input.workDate < candidate.batchWeekStartDate || input.workDate > candidate.batchWeekEndDate) {
      warnings.push({
        code: 'CROSS_WEEK',
        message: `${candidate.workOrderCode} 的安排日期超出原生产周`,
        workOrderId: candidate.workOrderId,
        stepId: candidate.stepId,
      });
    }
  });
  const capacityByEmployee = new Map(input.capacityRows.map(item => [item.employeeId, item] as const));
  for (const employeeId of input.employeeIds) {
    const capacity = capacityByEmployee.get(employeeId);
    if (!capacity) continue;
    if ((capacity.leaveMilliseconds || 0) > 0) {
      warnings.push({
        code: 'EMPLOYEE_LEAVE',
        message: `${capacity.employeeName} 当日存在请假记录`,
        employeeId,
      });
    }
    const planned = plannedByEmployee.get(employeeId) || 0n;
    const remaining = BigInt(capacity.remainingMilliseconds || 0);
    if (planned > remaining) {
      warnings.push({
        code: 'EMPLOYEE_OVERLOAD',
        message: `${capacity.employeeName} 预计超负荷 ${Math.ceil(Number(planned - remaining) / 3_600_000)} 小时`,
        employeeId,
      });
    }
  }
  return warnings;
}

export async function getProductionArrangementContext(input: {
  actorUserId: string;
  workOrderIds: string[];
  workDate: string | Date;
  shiftCode?: string;
  teamId?: string | null;
  includeWaitingUpstream?: boolean;
}) {
  const workDate = normalizeWorkDate(input.workDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const workOrderIds = uniqueRequiredIds(input.workOrderIds, '生产工单', 50);
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertVisible(scope);
  const visibleTeamIds = scope.isAdmin || scope.isSupervisor ? null : scope.leaderTeamIds;
  const teams = await prisma.productionTeam.findMany({
    where: {
      isActive: true,
      ...(visibleTeamIds ? { id: { in: visibleTeamIds } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, legacyTeamName: true },
  });
  if (!teams.length) {
    throw new DailyPlanServiceError('生产排产基础数据尚未初始化', 'DAILY_PLAN_TEAM_NOT_FOUND', 409);
  }
  const requestedTeamId = String(input.teamId || '').trim();
  const teamId = teams.some(team => team.id === requestedTeamId)
    ? requestedTeamId
    : teams.find(team => scope.leaderTeamIds.includes(team.id))?.id || teams[0].id;
  const preview = await previewDailyPlanSuggestions({
    actorUserId: input.actorUserId,
    workDate,
    shiftCode,
    teamId,
    workOrderIds,
    includeWaitingUpstream: input.includeWaitingUpstream !== false,
    allowCrossWeekWorkOrders: true,
    allocationScope: 'all_active',
    productionWide: true,
  });
  const candidates = preview.candidates as SuggestionCandidate[];
  const taskWeek = productionWeekDateBounds(workDate);
  const processDefinitionIds = [...new Set(candidates.map(item => item.processDefinitionId).filter((id): id is string => Boolean(id)))];
  const stepIds = [...new Set(candidates.map(item => item.stepId))];
  const presets = stepIds.length || processDefinitionIds.length
    ? await prisma.weeklyProcessWorkerPreset.findMany({
        where: {
          weekStartDate: taskWeek.startDate,
          OR: [
            ...(stepIds.length ? [{ stepId: { in: stepIds } }] : []),
            ...(processDefinitionIds.length ? [{ processDefinitionId: { in: processDefinitionIds } }] : []),
          ],
        },
        include: {
          members: {
            where: { employee: { is: productionEmployeeWhere({ requireAttendance: false }) } },
            orderBy: { position: 'asc' },
            include: { employee: { select: { id: true, employeeNo: true, name: true } } },
          },
        },
        orderBy: { updatedAt: 'desc' },
      })
    : [];
  const recommendedEmployeeIds = [...new Set(presets.flatMap(preset => preset.members.map(member => member.employeeId)))];
  return serializeDailyPlanValue({
    ...preview,
    selectedTeamId: teamId,
    personnelSource: 'HR_PRODUCTION_DEPARTMENT',
    productionEmployeeCount: preview.employeeCapacity.length,
    canSchedule: scope.isAdmin || scope.isSupervisor,
    recommendedEmployeeIds,
    presets: presets.map(preset => ({
      id: preset.id,
      stepId: preset.stepId,
      processDefinitionId: preset.processDefinitionId,
      employees: preset.members.map(member => member.employee),
    })),
  });
}

export async function scheduleProductionArrangements(input: {
  actorUserId: string;
  workDate: string | Date;
  shiftCode?: string;
  teamId: string;
  workOrderIds: string[];
  employeeIds: string[];
  stepIds?: string[];
  includeWaitingUpstream?: boolean;
  reason?: string;
  idempotencyKey: string;
}) {
  const workDate = normalizeWorkDate(input.workDate);
  const workDateKey = formatWorkDate(workDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const teamId = requiredText(input.teamId, '生产班组');
  const workOrderIds = uniqueRequiredIds(input.workOrderIds, '生产工单', 50);
  const employeeIds = uniqueRequiredIds(input.employeeIds, '安排人员', 50);
  const stepIds = Array.isArray(input.stepIds)
    ? [...new Set(input.stepIds.map(item => String(item || '').trim()).filter(Boolean))]
    : [];
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const reason = String(input.reason || '').trim() || '生产执行主管快捷安排';
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertSupervisor(scope);
  assertTeamMutation(scope, teamId);
  const requestPayload = {
    workDate: workDateKey,
    shiftCode,
    teamId,
    workOrderIds: [...workOrderIds].sort(),
    employeeIds: [...employeeIds].sort(),
    stepIds: [...stepIds].sort(),
    includeWaitingUpstream: input.includeWaitingUpstream !== false,
    reason,
  };
  const revisionKey = `${idempotencyKey}:quick-schedule`;
  const previousReplay = await findDailyMutationReplay(prisma, {
    idempotencyKey: revisionKey,
    actorId: scope.userId,
    action: 'QUICK_SCHEDULE',
    target: `${workDateKey}:${shiftCode}:${teamId}`,
    requestPayload,
  });
  if (previousReplay.existing) {
    const afterData = previousReplay.existing.afterData as Record<string, unknown> | null;
    return serializeDailyPlanValue({
      plan: await loadPlan(prisma, previousReplay.existing.planId),
      taskIds: Array.isArray(afterData?.taskIds) ? afterData.taskIds.map(String) : [],
      warnings: Array.isArray(afterData?.warnings) ? afterData.warnings : [],
    });
  }
  const preview = await previewDailyPlanSuggestions({
    actorUserId: input.actorUserId,
    workDate,
    shiftCode,
    teamId,
    workOrderIds,
    includeWaitingUpstream: input.includeWaitingUpstream !== false,
    allowCrossWeekWorkOrders: true,
    allocationScope: 'all_active',
    productionWide: true,
  });
  const allCandidates = preview.candidates as SuggestionCandidate[];
  const candidates = stepIds.length ? allCandidates.filter(candidate => stepIds.includes(candidate.stepId)) : allCandidates;
  const candidateWorkOrderIds = new Set(candidates.map(candidate => candidate.workOrderId));
  const missingWorkOrderIds = workOrderIds.filter(workOrderId => !candidateWorkOrderIds.has(workOrderId));
  if (missingWorkOrderIds.length) {
    const blocked = preview.blocked as Array<{ workOrderId?: string; message?: string }>;
    const messages = missingWorkOrderIds.map(workOrderId => blocked.find(item => item.workOrderId === workOrderId)?.message || '没有可安排的未完成工序');
    throw new DailyPlanServiceError(`部分工单无法安排：${[...new Set(messages)].join('；')}`, 'DAILY_PLAN_QUICK_SCHEDULE_BLOCKED', 409);
  }
  const capacityRows = preview.employeeCapacity as ProductionArrangementCapacityRow[];
  const employeeCapacityIds = new Set(capacityRows.map(item => item.employeeId));
  const invalidEmployeeIds = employeeIds.filter(employeeId => !employeeCapacityIds.has(employeeId));
  if (invalidEmployeeIds.length) {
    throw new DailyPlanServiceError('所选人员已不在人事档案的生产部在职名单中', 'DAILY_PLAN_EMPLOYEE_UNMAPPED', 409);
  }
  const warnings = arrangementCapacityWarnings({ candidates, employeeIds, capacityRows, workDate: workDateKey });
  const result = await serializable(async tx => {
    const replay = await findDailyMutationReplay(tx, {
      idempotencyKey: revisionKey,
      actorId: scope.userId,
      action: 'QUICK_SCHEDULE',
      target: `${workDateKey}:${shiftCode}:${teamId}`,
      requestPayload,
    });
    if (replay.existing) {
      const afterData = replay.existing.afterData as Record<string, unknown> | null;
      return {
        planId: replay.existing.planId,
        taskIds: Array.isArray(afterData?.taskIds) ? afterData.taskIds.map(String) : [],
      };
    }
    await assertProductionEmployeesCanBeScheduled(tx, employeeIds);
    let plan = await tx.dailyProductionPlan.findUnique({
      where: { workDate_shiftCode_teamId: { workDate, shiftCode, teamId } },
    });
    if (!plan) {
      plan = await tx.dailyProductionPlan.create({
        data: {
          workDate,
          shiftCode,
          teamId,
          status: DailyProductionPlanStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: scope.userId,
          createdById: scope.userId,
          updatedById: scope.userId,
        },
      });
    } else {
      assertPlanCanAppendTasks(plan.status);
      if (plan.status === DailyProductionPlanStatus.DRAFT || plan.status === DailyProductionPlanStatus.NEEDS_REVIEW) {
        plan = await tx.dailyProductionPlan.update({
          where: { id: plan.id },
          data: {
            status: DailyProductionPlanStatus.CONFIRMED,
            confirmedAt: new Date(),
            confirmedById: scope.userId,
            updatedById: scope.userId,
            version: { increment: 1 },
          },
        });
      } else {
        assertPlanAllowsAssignments(plan.status);
      }
    }

    const poolKeys = [...new Set(candidates.map(candidate => `${candidate.productionPlanBatchId}:${candidate.stepId}`))];
    for (const poolKey of poolKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-arrangement:${poolKey}`}))`;
    }
    const batchIds = [...new Set(candidates.map(candidate => candidate.productionPlanBatchId))];
    const candidateStepIds = [...new Set(candidates.map(candidate => candidate.stepId))];
    const [activeTasks, batches, steps] = await Promise.all([
      tx.dailyProcessTask.findMany({
        where: {
          productionPlanBatchId: { in: batchIds },
          stepId: { in: candidateStepIds },
          status: { notIn: [DailyProcessTaskStatus.CANCELLED, DailyProcessTaskStatus.CARRIED_OVER] },
        },
        select: { id: true, productionPlanBatchId: true, stepId: true, workDate: true },
      }),
      tx.productionPlanBatch.findMany({ where: { id: { in: batchIds }, deletedAt: null }, select: { id: true, quantity: true } }),
      tx.workOrderProcessStep.findMany({
        where: { id: { in: candidateStepIds } },
        select: { id: true, inputQty: true, processedQty: true, status: true },
      }),
    ]);
    const activeByPool = new Map(activeTasks.map(task => [`${task.productionPlanBatchId || ''}:${task.stepId}`, task] as const));
    const conflicting = candidates.find(candidate => activeByPool.has(`${candidate.productionPlanBatchId}:${candidate.stepId}`));
    if (conflicting) {
      const conflict = activeByPool.get(`${conflicting.productionPlanBatchId}:${conflicting.stepId}`)!;
      throw new DailyPlanServiceError(
        `${conflicting.workOrderCode} 的${conflicting.processName}已安排在 ${formatWorkDate(conflict.workDate)}，请使用续排`,
        'DAILY_PLAN_ALREADY_SCHEDULED',
        409,
      );
    }
    const batchById = new Map(batches.map(batch => [batch.id, batch] as const));
    const stepById = new Map(steps.map(step => [step.id, step] as const));
    const maxSortOrder = await tx.dailyProcessTask.aggregate({ where: { planId: plan.id }, _max: { sortOrder: true } });
    const taskIds: string[] = [];
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      const batch = batchById.get(candidate.productionPlanBatchId);
      const step = stepById.get(candidate.stepId);
      if (!batch || !step) throw new DailyPlanServiceError('生产工序数据已变化，请刷新后重试', 'DAILY_PLAN_SOURCE_CHANGED', 409);
      const plannedQty = Math.max(0, batch.quantity - step.processedQty);
      if (plannedQty <= 0) continue;
      const availability = resolveDailyTaskAvailability({
        sequenceGroup: candidate.sequenceGroup,
        inputQty: step.inputQty,
        processedQty: step.processedQty,
      });
      const task = await tx.dailyProcessTask.create({
        data: {
          planId: plan.id,
          workDate,
          shiftCode,
          productionPlanBatchId: candidate.productionPlanBatchId,
          workOrderId: candidate.workOrderId,
          routeId: candidate.routeId,
          stepId: candidate.stepId,
          routeVersion: candidate.routeVersion,
          processCode: candidate.processCode,
          processName: candidate.processName,
          stageGroup: candidate.stageGroup,
          position: candidate.position,
          sequenceGroup: candidate.sequenceGroup,
          standardSource: candidate.standardSource,
          timeBasis: candidate.timeBasis,
          unitLabel: candidate.unitLabel,
          standardMillisecondsPerUnit: candidate.standardMillisecondsPerUnit,
          setupMilliseconds: candidate.setupMilliseconds,
          unitsPerProduct: candidate.unitsPerProduct,
          countsForEfficiency: candidate.countsForEfficiency,
          productTimeProfileId: candidate.productTimeProfileId,
          productTimeProfileVersion: candidate.productTimeProfileVersion,
          plannedQty,
          availableQty: Math.min(availability.availableQty, plannedQty),
          priority: candidate.priority,
          priorityReason: candidate.priorityReason,
          riskWarnings: candidate.riskWarnings,
          status: availability.status,
          sortOrder: (maxSortOrder._max.sortOrder || 0) + candidateIndex + 1,
        },
      });
      const split = splitProductionArrangementQuantity(plannedQty, employeeIds, candidateIndex);
      const labor = allocateIncrementalTaskLabor({
        snapshot: snapshotForTask(candidate),
        alreadyAssignedQuantity: 0,
        quantities: split.map(item => item.quantity),
      });
      for (let assignmentIndex = 0; assignmentIndex < split.length; assignmentIndex += 1) {
        const assignment = split[assignmentIndex];
        await tx.dailyTaskAssignment.create({
          data: {
            taskId: task.id,
            employeeId: assignment.employeeId,
            assignedTeamId: teamId,
            quantity: assignment.quantity,
            plannedStandardMilliseconds: labor[assignmentIndex],
            sortOrder: assignmentIndex,
            idempotencyKey: `${idempotencyKey}:${task.id}:${assignmentIndex}`,
            assignedById: scope.userId,
          },
        });
      }
      taskIds.push(task.id);
    }
    if (!taskIds.length) {
      throw new DailyPlanServiceError('所选工单已无剩余可安排数量', 'DAILY_PLAN_NOTHING_TO_SCHEDULE', 409);
    }
    await tx.dailyProductionPlan.update({
      where: { id: plan.id },
      data: { updatedById: scope.userId, version: { increment: 1 } },
    });
    await writeRevision(tx, {
      planId: plan.id,
      taskId: taskIds[0],
      action: 'QUICK_SCHEDULE',
      afterData: { taskIds, warnings, ...requestPayload },
      reason,
      actorId: scope.userId,
      idempotencyKey: revisionKey,
      idempotencyScope: `${workDateKey}:${shiftCode}:${teamId}`,
      requestPayload,
    });
    return { planId: plan.id, taskIds };
  });
  return serializeDailyPlanValue({
    plan: await loadPlan(prisma, result.planId),
    taskIds: result.taskIds,
    warnings,
  });
}

export async function continueProductionArrangement(input: {
  actorUserId: string;
  sourceTaskIds: string[];
  targetDate: string | Date;
  shiftCode?: string;
  employeeIds: string[];
  reason?: string;
  idempotencyKey: string;
}) {
  const sourceTaskIds = uniqueRequiredIds(input.sourceTaskIds, '待续排任务', 100);
  const employeeIds = uniqueRequiredIds(input.employeeIds, '安排人员', 50);
  const targetDate = normalizeWorkDate(input.targetDate);
  const targetDateKey = formatWorkDate(targetDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const reason = String(input.reason || '').trim() || '生产执行未完成续排';
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const scope = await resolveActorScope(input.actorUserId, targetDate);
  assertSupervisor(scope);
  const requestPayload = {
    sourceTaskIds: [...sourceTaskIds].sort(),
    targetDate: targetDateKey,
    shiftCode,
    employeeIds: [...employeeIds].sort(),
    reason,
  };
  const revisionKey = `${idempotencyKey}:continue-arrangement`;
  const result = await serializable(async tx => {
    const sources = await tx.dailyProcessTask.findMany({
      where: { id: { in: sourceTaskIds } },
      include: {
        plan: true,
        step: { select: { inputQty: true, processedQty: true, status: true } },
      },
      orderBy: [{ workDate: 'asc' }, { position: 'asc' }],
    });
    if (sources.length !== sourceTaskIds.length) {
      throw new DailyPlanServiceError('部分待续排任务不存在', 'DAILY_PLAN_TASK_NOT_FOUND', 404);
    }
    const teamIds = new Set(sources.map(source => source.plan.teamId));
    if (teamIds.size !== 1) {
      throw new DailyPlanServiceError('一次只能续排同一班组的任务', 'DAILY_PLAN_CARRY_TEAM_MISMATCH', 409);
    }
    const teamId = sources[0].plan.teamId;
    assertTeamMutation(scope, teamId);
    const replay = await findDailyMutationReplay(tx, {
      idempotencyKey: revisionKey,
      actorId: scope.userId,
      action: 'CONTINUE_ARRANGEMENT',
      target: `${targetDateKey}:${teamId}:${sourceTaskIds.sort().join(',')}`,
      requestPayload,
    });
    if (replay.existing) {
      const afterData = replay.existing.afterData as Record<string, unknown> | null;
      return {
        planId: replay.existing.planId,
        taskIds: Array.isArray(afterData?.taskIds) ? afterData.taskIds.map(String) : [],
      };
    }
    await assertProductionEmployeesCanBeScheduled(tx, employeeIds);
    for (const source of sources) {
      assertPlanAllowsAssignments(source.plan.status);
      if (targetDate <= source.workDate) {
        throw new DailyPlanServiceError('续排日期必须晚于原生产日期', 'DAILY_PLAN_CARRY_DATE_INVALID');
      }
      if (
        source.status === DailyProcessTaskStatus.COMPLETED
        || source.status === DailyProcessTaskStatus.CARRIED_OVER
        || source.status === DailyProcessTaskStatus.CANCELLED
      ) {
        throw new DailyPlanServiceError('已完成、已续排或已取消的任务不能再次续排', 'DAILY_PLAN_STATUS_INVALID', 409);
      }
    }
    const completions = await tx.processCompletion.findMany({
      where: {
        voidedAt: null,
        OR: sources.map(source => ({
          workOrderId: source.workOrderId,
          stepId: source.stepId,
          workDate: source.workDate,
        })),
      },
      select: { workOrderId: true, stepId: true, workDate: true, goodQty: true },
    });
    const completedBySource = completions.reduce((map, completion) => {
      const key = `${completion.workOrderId}:${completion.stepId}:${formatWorkDate(completion.workDate)}`;
      map.set(key, (map.get(key) || 0) + completion.goodQty);
      return map;
    }, new Map<string, number>());
    const remainingSources = sources.map(source => {
      const key = `${source.workOrderId}:${source.stepId}:${formatWorkDate(source.workDate)}`;
      const completedQty = Math.min(source.plannedQty, completedBySource.get(key) || 0);
      return { source, completedQty, remainingQty: Math.max(0, source.plannedQty - completedQty) };
    });
    let targetPlan = await tx.dailyProductionPlan.findUnique({
      where: { workDate_shiftCode_teamId: { workDate: targetDate, shiftCode, teamId } },
    });
    if (!targetPlan) {
      targetPlan = await tx.dailyProductionPlan.create({
        data: {
          workDate: targetDate,
          shiftCode,
          teamId,
          status: DailyProductionPlanStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: scope.userId,
          createdById: scope.userId,
          updatedById: scope.userId,
        },
      });
    } else {
      assertPlanCanAppendTasks(targetPlan.status);
      if (targetPlan.status === DailyProductionPlanStatus.DRAFT || targetPlan.status === DailyProductionPlanStatus.NEEDS_REVIEW) {
        targetPlan = await tx.dailyProductionPlan.update({
          where: { id: targetPlan.id },
          data: {
            status: DailyProductionPlanStatus.CONFIRMED,
            confirmedAt: new Date(),
            confirmedById: scope.userId,
            updatedById: scope.userId,
            version: { increment: 1 },
          },
        });
      } else {
        assertPlanAllowsAssignments(targetPlan.status);
      }
    }
    const taskIds: string[] = [];
    for (let sourceIndex = 0; sourceIndex < remainingSources.length; sourceIndex += 1) {
      const { source, remainingQty } = remainingSources[sourceIndex];
      if (remainingQty <= 0) {
        await tx.dailyProcessTask.update({
          where: { id: source.id },
          data: { status: DailyProcessTaskStatus.COMPLETED, availableQty: 0, version: { increment: 1 } },
        });
        continue;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-arrangement:${source.productionPlanBatchId || source.workOrderId}:${source.stepId}`}))`;
      const conflict = await tx.dailyProcessTask.findFirst({
        where: {
          id: { not: source.id },
          productionPlanBatchId: source.productionPlanBatchId,
          stepId: source.stepId,
          status: { notIn: [DailyProcessTaskStatus.CANCELLED, DailyProcessTaskStatus.CARRIED_OVER] },
        },
        select: { workDate: true },
      });
      if (conflict) {
        throw new DailyPlanServiceError(
          `${source.processName}已在 ${formatWorkDate(conflict.workDate)} 存在有效安排`,
          'DAILY_PLAN_ALREADY_SCHEDULED',
          409,
        );
      }
      const existingTarget = await tx.dailyProcessTask.findUnique({
        where: { planId_stepId: { planId: targetPlan.id, stepId: source.stepId } },
      });
      if (existingTarget) {
        throw new DailyPlanServiceError(`${source.processName}在目标日期已存在安排`, 'DAILY_PLAN_ALREADY_SCHEDULED', 409);
      }
      const availability = resolveDailyTaskAvailability({
        sequenceGroup: source.sequenceGroup,
        inputQty: source.step.inputQty,
        processedQty: source.step.processedQty,
      });
      const targetTask = await tx.dailyProcessTask.create({
        data: {
          planId: targetPlan.id,
          workDate: targetDate,
          shiftCode,
          productionPlanBatchId: source.productionPlanBatchId,
          workOrderId: source.workOrderId,
          routeId: source.routeId,
          stepId: source.stepId,
          routeVersion: source.routeVersion,
          processCode: source.processCode,
          processName: source.processName,
          stageGroup: source.stageGroup,
          position: source.position,
          sequenceGroup: source.sequenceGroup,
          standardSource: source.standardSource,
          timeBasis: source.timeBasis,
          unitLabel: source.unitLabel,
          standardMillisecondsPerUnit: source.standardMillisecondsPerUnit,
          setupMilliseconds: source.setupMilliseconds,
          unitsPerProduct: source.unitsPerProduct,
          countsForEfficiency: source.countsForEfficiency,
          productTimeProfileId: source.productTimeProfileId,
          productTimeProfileVersion: source.productTimeProfileVersion,
          plannedQty: remainingQty,
          availableQty: Math.min(availability.availableQty, remainingQty),
          priority: source.priority,
          priorityReason: source.priorityReason,
          riskWarnings: source.riskWarnings === null ? Prisma.JsonNull : source.riskWarnings,
          status: availability.status,
          sortOrder: source.sortOrder,
          carryOverFromTaskId: source.id,
        },
      });
      const split = splitProductionArrangementQuantity(remainingQty, employeeIds, sourceIndex);
      const labor = allocateIncrementalTaskLabor({
        snapshot: snapshotForTask(source),
        alreadyAssignedQuantity: 0,
        quantities: split.map(item => item.quantity),
      });
      for (let assignmentIndex = 0; assignmentIndex < split.length; assignmentIndex += 1) {
        const assignment = split[assignmentIndex];
        await tx.dailyTaskAssignment.create({
          data: {
            taskId: targetTask.id,
            employeeId: assignment.employeeId,
            assignedTeamId: teamId,
            quantity: assignment.quantity,
            plannedStandardMilliseconds: labor[assignmentIndex],
            sortOrder: assignmentIndex,
            idempotencyKey: `${idempotencyKey}:${targetTask.id}:${assignmentIndex}`,
            assignedById: scope.userId,
          },
        });
      }
      await tx.dailyProcessTask.update({
        where: { id: source.id },
        data: { status: DailyProcessTaskStatus.CARRIED_OVER, version: { increment: 1 } },
      });
      await tx.dailyTaskAssignment.updateMany({
        where: { taskId: source.id, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
        data: { status: DailyTaskAssignmentStatus.CANCELLED, cancelledAt: new Date(), version: { increment: 1 } },
      });
      taskIds.push(targetTask.id);
    }
    await tx.dailyProductionPlan.update({
      where: { id: targetPlan.id },
      data: { updatedById: scope.userId, version: { increment: 1 } },
    });
    await writeRevision(tx, {
      planId: targetPlan.id,
      taskId: sourceTaskIds[0],
      action: 'CONTINUE_ARRANGEMENT',
      beforeData: remainingSources.map(item => ({
        taskId: item.source.id,
        workDate: item.source.workDate,
        plannedQty: item.source.plannedQty,
        completedQty: item.completedQty,
      })),
      afterData: { taskIds, ...requestPayload },
      reason,
      actorId: scope.userId,
      idempotencyKey: revisionKey,
      idempotencyScope: `${targetDateKey}:${teamId}:${sourceTaskIds.sort().join(',')}`,
      requestPayload,
    });
    return { planId: targetPlan.id, taskIds };
  });
  return serializeDailyPlanValue({
    plan: await loadPlan(prisma, result.planId),
    taskIds: result.taskIds,
  });
}

type AssignmentInput = {
  employeeId: string;
  quantity: number;
  sortOrder?: number;
  regularStartAt?: string | Date | null;
  regularEndAt?: string | Date | null;
  overtimeStartAt?: string | Date | null;
  overtimeEndAt?: string | Date | null;
};

function optionalDate(value?: string | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new DailyPlanServiceError('时间区间无效', 'DAILY_PLAN_TIME_INVALID');
  return result;
}

function validateTimeWindow(start: Date | null, end: Date | null, label: string): void {
  if ((start && !end) || (!start && end)) {
    throw new DailyPlanServiceError(`${label}必须同时填写开始和结束时间`, 'DAILY_PLAN_TIME_INVALID');
  }
  if (start && end && start >= end) {
    throw new DailyPlanServiceError(`${label}结束时间必须晚于开始时间`, 'DAILY_PLAN_TIME_INVALID');
  }
}

async function recomputeAssignmentLabor(tx: TransactionClient, taskId: string): Promise<void> {
  const task = await tx.dailyProcessTask.findUnique({ where: { id: taskId } });
  if (!task) throw new DailyPlanServiceError('日计划工序任务不存在', 'DAILY_PLAN_TASK_NOT_FOUND', 404);
  const assignments = await tx.dailyTaskAssignment.findMany({
    where: { taskId, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const allocations = allocateIncrementalTaskLabor({
    snapshot: snapshotForTask(task),
    alreadyAssignedQuantity: 0,
    quantities: assignments.map(item => item.quantity),
  });
  for (let index = 0; index < assignments.length; index += 1) {
    await tx.dailyTaskAssignment.update({
      where: { id: assignments[index].id },
      data: { plannedStandardMilliseconds: allocations[index] },
    });
  }
}

export async function assignDailyProcessTask(input: {
  actorUserId: string;
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
  assignments: AssignmentInput[];
}) {
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  if (!Array.isArray(input.assignments) || input.assignments.length === 0) {
    throw new DailyPlanServiceError('至少需要分配一名员工', 'DAILY_PLAN_ASSIGNMENTS_EMPTY');
  }
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate?.taskId) return { taskId: duplicate.taskId };
    const task = await loadTask(tx, input.taskId);
    assertPlanAllowsAssignments(task.plan.status);
    const scope = await resolveActorScope(input.actorUserId, task.plan.workDate);
    assertTeamMutation(scope, task.plan.teamId);
    const activeAssignments = await tx.dailyTaskAssignment.findMany({
      where: { taskId: task.id, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const quantities = input.assignments.map(item => positiveInteger(item.quantity, '分配数量'));
    const assignedQuantity = activeAssignments.reduce((sum, item) => sum + item.quantity, 0);
    if (assignedQuantity + quantities.reduce((sum, item) => sum + item, 0) > task.plannedQty) {
      throw new DailyPlanServiceError('分配数量不能超过任务计划数量', 'DAILY_PLAN_ASSIGNMENT_EXCEEDS_TASK', 409);
    }
    const labor = allocateIncrementalTaskLabor({
      snapshot: snapshotForTask(task),
      alreadyAssignedQuantity: assignedQuantity,
      quantities,
    });
    for (let index = 0; index < input.assignments.length; index += 1) {
      const item = input.assignments[index];
      const quantity = quantities[index];
      const employeeId = requiredText(item.employeeId, '员工');
      const membership = await assertEmployeeCanBeAssigned({
        client: tx,
        taskId: task.id,
        taskTeamId: task.plan.teamId,
        workDate: task.plan.workDate,
        employeeId,
        quantity,
      });
      const regularStartAt = optionalDate(item.regularStartAt);
      const regularEndAt = optionalDate(item.regularEndAt);
      const overtimeStartAt = optionalDate(item.overtimeStartAt);
      const overtimeEndAt = optionalDate(item.overtimeEndAt);
      validateTimeWindow(regularStartAt, regularEndAt, '正常班时间');
      validateTimeWindow(overtimeStartAt, overtimeEndAt, '加班时间');
      await tx.dailyTaskAssignment.create({
        data: {
          taskId: task.id,
          employeeId,
          assignedTeamId: membership.assignedTeamId,
          quantity,
          plannedStandardMilliseconds: labor[index],
          sortOrder: item.sortOrder ?? activeAssignments.length + index,
          regularStartAt,
          regularEndAt,
          overtimeStartAt,
          overtimeEndAt,
          idempotencyKey: `${idempotencyKey}:${index}`,
          assignedById: scope.userId,
        },
      });
    }
    await ensureTaskVersion(tx, task.id, expectedVersion(input.expectedVersion), {
      version: { increment: 1 },
      status: task.status === DailyProcessTaskStatus.UNPLANNED ? DailyProcessTaskStatus.READY : task.status,
    });
    await writeRevision(tx, {
      planId: task.planId,
      taskId: task.id,
      action: 'ASSIGN_TASK',
      beforeData: { assignedQuantity },
      afterData: { assignments: input.assignments },
      actorId: scope.userId,
      idempotencyKey,
    });
    return { taskId: task.id };
  });
  return serializeDailyPlanValue(await loadTask(prisma, result.taskId));
}

export async function updateDailyTaskAssignment(input: {
  actorUserId: string;
  taskId: string;
  expectedTaskVersion: number;
  assignmentId: string;
  expectedVersion: number;
  quantity?: number;
  sortOrder?: number;
  employeeId?: string;
  regularStartAt?: string | Date | null;
  regularEndAt?: string | Date | null;
  overtimeStartAt?: string | Date | null;
  overtimeEndAt?: string | Date | null;
  reason: string;
  idempotencyKey: string;
}) {
  const reason = requiredText(input.reason, '调整原因');
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate?.taskId) return { taskId: duplicate.taskId };
    const assignment = await tx.dailyTaskAssignment.findUnique({
      where: { id: input.assignmentId },
      include: { task: { include: { plan: true } } },
    });
    if (!assignment) throw new DailyPlanServiceError('任务分配记录不存在', 'DAILY_PLAN_ASSIGNMENT_NOT_FOUND', 404);
    if (assignment.taskId !== input.taskId) {
      throw new DailyPlanServiceError('任务分配记录不存在', 'DAILY_PLAN_ASSIGNMENT_NOT_FOUND', 404);
    }
    if (assignment.status === DailyTaskAssignmentStatus.CANCELLED) {
      throw new DailyPlanServiceError('已撤回的分配不能再调整', 'DAILY_PLAN_ASSIGNMENT_CANCELLED', 409);
    }
    assertPlanAllowsAssignments(assignment.task.plan.status);
    const scope = await resolveActorScope(input.actorUserId, assignment.task.plan.workDate);
    assertTeamMutation(scope, assignment.task.plan.teamId);
    const targetEmployeeId = input.employeeId ? requiredText(input.employeeId, '员工') : assignment.employeeId;
    const targetQuantity = input.quantity === undefined ? assignment.quantity : positiveInteger(input.quantity, '分配数量');
    const otherQuantity = await tx.dailyTaskAssignment.aggregate({
      where: {
        taskId: assignment.taskId,
        id: { not: assignment.id },
        status: { not: DailyTaskAssignmentStatus.CANCELLED },
      },
      _sum: { quantity: true },
    });
    if ((otherQuantity._sum.quantity || 0) + targetQuantity > assignment.task.plannedQty) {
      throw new DailyPlanServiceError('分配数量不能超过任务计划数量', 'DAILY_PLAN_ASSIGNMENT_EXCEEDS_TASK', 409);
    }
    const membership = await assertEmployeeCanBeAssigned({
      client: tx,
      taskId: assignment.taskId,
      taskTeamId: assignment.task.plan.teamId,
      workDate: assignment.task.plan.workDate,
      employeeId: targetEmployeeId,
      quantity: targetQuantity,
      excludeAssignmentId: assignment.id,
    });
    const regularStartAt = input.regularStartAt === undefined ? assignment.regularStartAt : optionalDate(input.regularStartAt);
    const regularEndAt = input.regularEndAt === undefined ? assignment.regularEndAt : optionalDate(input.regularEndAt);
    const overtimeStartAt = input.overtimeStartAt === undefined ? assignment.overtimeStartAt : optionalDate(input.overtimeStartAt);
    const overtimeEndAt = input.overtimeEndAt === undefined ? assignment.overtimeEndAt : optionalDate(input.overtimeEndAt);
    validateTimeWindow(regularStartAt, regularEndAt, '正常班时间');
    validateTimeWindow(overtimeStartAt, overtimeEndAt, '加班时间');
    const updated = await tx.dailyTaskAssignment.updateMany({
      where: { id: assignment.id, version: expectedVersion(input.expectedVersion) },
      data: {
        employeeId: targetEmployeeId,
        assignedTeamId: membership.assignedTeamId,
        quantity: targetQuantity,
        sortOrder: input.sortOrder === undefined ? assignment.sortOrder : nonNegativeInteger(input.sortOrder, '排序号'),
        regularStartAt,
        regularEndAt,
        overtimeStartAt,
        overtimeEndAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new DailyPlanServiceError('分配记录已被其他人更新，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
    }
    await ensureTaskVersion(tx, assignment.taskId, expectedVersion(input.expectedTaskVersion), { version: { increment: 1 } });
    await recomputeAssignmentLabor(tx, assignment.taskId);
    await writeRevision(tx, {
      planId: assignment.task.planId,
      taskId: assignment.taskId,
      assignmentId: assignment.id,
      action: 'UPDATE_ASSIGNMENT',
      beforeData: assignment,
      afterData: { employeeId: targetEmployeeId, quantity: targetQuantity, sortOrder: input.sortOrder },
      reason,
      actorId: scope.userId,
      idempotencyKey,
    });
    return { taskId: assignment.taskId };
  });
  return serializeDailyPlanValue(await loadTask(prisma, result.taskId));
}

export async function cancelDailyTaskAssignment(input: {
  actorUserId: string;
  taskId: string;
  expectedTaskVersion: number;
  assignmentId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
}) {
  const reason = requiredText(input.reason, '撤回原因');
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate?.taskId) return { taskId: duplicate.taskId };
    const assignment = await tx.dailyTaskAssignment.findUnique({
      where: { id: input.assignmentId },
      include: { task: { include: { plan: true } } },
    });
    if (!assignment) throw new DailyPlanServiceError('任务分配记录不存在', 'DAILY_PLAN_ASSIGNMENT_NOT_FOUND', 404);
    if (assignment.taskId !== input.taskId) {
      throw new DailyPlanServiceError('任务分配记录不存在', 'DAILY_PLAN_ASSIGNMENT_NOT_FOUND', 404);
    }
    assertPlanAllowsAssignments(assignment.task.plan.status);
    const scope = await resolveActorScope(input.actorUserId, assignment.task.plan.workDate);
    assertTeamMutation(scope, assignment.task.plan.teamId);
    const updated = await tx.dailyTaskAssignment.updateMany({
      where: { id: assignment.id, version: expectedVersion(input.expectedVersion), status: { not: DailyTaskAssignmentStatus.CANCELLED } },
      data: { status: DailyTaskAssignmentStatus.CANCELLED, cancelledAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new DailyPlanServiceError('分配记录已撤回或版本已变化', 'DAILY_PLAN_VERSION_CONFLICT', 409);
    }
    await ensureTaskVersion(tx, assignment.taskId, expectedVersion(input.expectedTaskVersion), { version: { increment: 1 } });
    await recomputeAssignmentLabor(tx, assignment.taskId);
    await writeRevision(tx, {
      planId: assignment.task.planId,
      taskId: assignment.taskId,
      assignmentId: assignment.id,
      action: 'CANCEL_ASSIGNMENT',
      beforeData: assignment,
      afterData: { status: DailyTaskAssignmentStatus.CANCELLED },
      reason,
      actorId: scope.userId,
      idempotencyKey,
    });
    return { taskId: assignment.taskId };
  });
  return serializeDailyPlanValue(await loadTask(prisma, result.taskId));
}

export async function reviseDailyTaskAssignments(input: {
  actorUserId: string;
  taskId: string;
  expectedVersion: number;
  assignments: Array<{ assignmentId: string; expectedVersion: number; sortOrder: number }>;
  reason: string;
  idempotencyKey: string;
}) {
  const reason = requiredText(input.reason, '调整原因');
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate?.taskId) return { taskId: duplicate.taskId };
    const task = await loadTask(tx, input.taskId);
    assertPlanAllowsAssignments(task.plan.status);
    const scope = await resolveActorScope(input.actorUserId, task.plan.workDate);
    assertTeamMutation(scope, task.plan.teamId);
    if (new Set(input.assignments.map(item => item.assignmentId)).size !== input.assignments.length) {
      throw new DailyPlanServiceError('分配记录不能重复', 'DAILY_PLAN_ASSIGNMENT_DUPLICATE');
    }
    for (const item of input.assignments) {
      const updated = await tx.dailyTaskAssignment.updateMany({
        where: {
          id: requiredText(item.assignmentId, '分配记录'),
          taskId: task.id,
          version: expectedVersion(item.expectedVersion),
          status: { not: DailyTaskAssignmentStatus.CANCELLED },
        },
        data: { sortOrder: nonNegativeInteger(item.sortOrder, '排序号'), version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new DailyPlanServiceError('分配记录已被其他人更新，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
      }
    }
    await ensureTaskVersion(tx, task.id, expectedVersion(input.expectedVersion), { version: { increment: 1 } });
    await recomputeAssignmentLabor(tx, task.id);
    await writeRevision(tx, {
      planId: task.planId,
      taskId: task.id,
      action: 'REORDER_ASSIGNMENTS',
      beforeData: task.assignments,
      afterData: input.assignments,
      reason,
      actorId: scope.userId,
      idempotencyKey,
    });
    return { taskId: task.id };
  });
  return serializeDailyPlanValue(await loadTask(prisma, result.taskId));
}

/**
 * Reorders one employee's assignments across multiple process tasks in one
 * serializable transaction. The workbench renders an employee-centric queue,
 * so limiting reordering to a single task would make drag/drop partially apply.
 */
export async function reorderEmployeeDailyTaskAssignments(input: {
  actorUserId: string;
  anchorTaskId: string;
  expectedTaskVersion: number;
  assignments: Array<{ assignmentId: string; expectedVersion: number; sortOrder: number }>;
  reason: string;
  idempotencyKey: string;
}) {
  const reason = requiredText(input.reason, '调整原因');
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  if (!Array.isArray(input.assignments) || input.assignments.length === 0) {
    throw new DailyPlanServiceError('至少需要一条排序记录', 'DAILY_PLAN_ASSIGNMENTS_EMPTY');
  }
  if (new Set(input.assignments.map(item => item.assignmentId)).size !== input.assignments.length) {
    throw new DailyPlanServiceError('分配记录不能重复', 'DAILY_PLAN_ASSIGNMENT_DUPLICATE');
  }
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate?.taskId) return { taskId: duplicate.taskId };
    const anchor = await loadTask(tx, input.anchorTaskId);
    assertPlanAllowsAssignments(anchor.plan.status);
    const scope = await resolveActorScope(input.actorUserId, anchor.plan.workDate);
    assertTeamMutation(scope, anchor.plan.teamId);
    const requestedIds = input.assignments.map(item => requiredText(item.assignmentId, '分配记录'));
    const rows = await tx.dailyTaskAssignment.findMany({
      where: { id: { in: requestedIds }, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
      include: { task: { include: { plan: true } } },
    });
    if (rows.length !== requestedIds.length) {
      throw new DailyPlanServiceError('部分分配记录不存在或已撤回', 'DAILY_PLAN_ASSIGNMENT_NOT_FOUND', 404);
    }
    const employeeIds = new Set(rows.map(item => item.employeeId));
    if (employeeIds.size !== 1) {
      throw new DailyPlanServiceError('只能调整同一员工的任务顺序', 'DAILY_PLAN_REORDER_EMPLOYEE_MISMATCH');
    }
    if (rows.some(item => item.task.planId !== anchor.planId || item.task.plan.teamId !== anchor.plan.teamId)) {
      throw new DailyPlanServiceError('只能调整同一日计划内的任务顺序', 'DAILY_PLAN_REORDER_PLAN_MISMATCH');
    }
    const expectedById = new Map(input.assignments.map(item => [item.assignmentId, item]));
    for (const row of rows) {
      const next = expectedById.get(row.id)!;
      const updated = await tx.dailyTaskAssignment.updateMany({
        where: { id: row.id, version: expectedVersion(next.expectedVersion), status: { not: DailyTaskAssignmentStatus.CANCELLED } },
        data: { sortOrder: nonNegativeInteger(next.sortOrder, '排序号'), version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new DailyPlanServiceError('分配记录已被其他人更新，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
      }
    }
    await ensureTaskVersion(tx, anchor.id, expectedVersion(input.expectedTaskVersion), { version: { increment: 1 } });
    const otherTaskIds = [...new Set(rows.map(item => item.taskId))].filter(id => id !== anchor.id);
    if (otherTaskIds.length) {
      await tx.dailyProcessTask.updateMany({ where: { id: { in: otherTaskIds } }, data: { version: { increment: 1 } } });
    }
    await writeRevision(tx, {
      planId: anchor.planId,
      taskId: anchor.id,
      action: 'REORDER_EMPLOYEE_ASSIGNMENTS',
      beforeData: rows.map(item => ({ assignmentId: item.id, taskId: item.taskId, sortOrder: item.sortOrder })),
      afterData: input.assignments,
      reason,
      actorId: scope.userId,
      idempotencyKey,
    });
    return { taskId: anchor.id };
  });
  return serializeDailyPlanValue(await loadTask(prisma, result.taskId));
}

export async function carryOverDailyProcessTask(input: {
  actorUserId: string;
  taskId: string;
  expectedVersion: number;
  targetDate: string | Date;
  shiftCode?: string;
  reason: string;
  idempotencyKey: string;
}) {
  const targetDate = normalizeWorkDate(input.targetDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const reason = requiredText(input.reason, '顺延原因');
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate?.taskId) {
      const sourceTask = await tx.dailyProcessTask.findUnique({
        where: { id: duplicate.taskId },
        select: { stepId: true },
      });
      const carriedTask = sourceTask
        ? await tx.dailyProcessTask.findFirst({
            where: {
              OR: [
                { carryOverFromTaskId: duplicate.taskId },
                { planId: duplicate.planId, stepId: sourceTask.stepId },
              ],
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;
      if (carriedTask) return { taskId: carriedTask.id, targetPlanId: carriedTask.planId };
    }
    const source = await loadTask(tx, input.taskId);
    assertPlanAllowsAssignments(source.plan.status);
    if (targetDate <= source.plan.workDate) {
      throw new DailyPlanServiceError('顺延日期必须晚于原计划日期', 'DAILY_PLAN_CARRY_DATE_INVALID');
    }
    const scope = await resolveActorScope(input.actorUserId, source.plan.workDate);
    assertTeamMutation(scope, source.plan.teamId);
    let targetPlan = await tx.dailyProductionPlan.findUnique({
      where: { workDate_shiftCode_teamId: { workDate: targetDate, shiftCode, teamId: source.plan.teamId } },
    });
    if (!targetPlan) {
      targetPlan = await tx.dailyProductionPlan.create({
        data: {
          workDate: targetDate,
          shiftCode,
          teamId: source.plan.teamId,
          createdById: scope.userId,
          updatedById: scope.userId,
        },
      });
    }
    assertPlanCanAppendTasks(targetPlan.status);
    let appendedTargetTask = false;
    let targetTask = await tx.dailyProcessTask.findUnique({
      where: { planId_stepId: { planId: targetPlan.id, stepId: source.stepId } },
    });
    if (!targetTask) {
      targetTask = await tx.dailyProcessTask.create({
        data: {
          planId: targetPlan.id,
          workDate: targetDate,
          shiftCode,
          productionPlanBatchId: source.productionPlanBatchId,
          workOrderId: source.workOrderId,
          routeId: source.routeId,
          stepId: source.stepId,
          routeVersion: source.routeVersion,
          processCode: source.processCode,
          processName: source.processName,
          stageGroup: source.stageGroup,
          position: source.position,
          sequenceGroup: source.sequenceGroup,
          standardSource: source.standardSource,
          timeBasis: source.timeBasis,
          unitLabel: source.unitLabel,
          standardMillisecondsPerUnit: source.standardMillisecondsPerUnit,
          setupMilliseconds: source.setupMilliseconds,
          unitsPerProduct: source.unitsPerProduct,
          countsForEfficiency: source.countsForEfficiency,
          productTimeProfileId: source.productTimeProfileId,
          productTimeProfileVersion: source.productTimeProfileVersion,
          plannedQty: source.plannedQty,
          availableQty: source.availableQty,
          priority: source.priority,
          priorityReason: source.priorityReason,
          riskWarnings: source.riskWarnings === null ? Prisma.JsonNull : source.riskWarnings,
          status: source.status === DailyProcessTaskStatus.READY
            ? DailyProcessTaskStatus.READY
            : DailyProcessTaskStatus.WAITING_UPSTREAM,
          sortOrder: source.sortOrder,
          carryOverFromTaskId: source.id,
        },
      });
      appendedTargetTask = true;
    }
    if (appendedTargetTask) {
      const targetPlanMutation = appendMutationPlanState(targetPlan.status);
      if (targetPlanMutation.updated) {
        targetPlan = await tx.dailyProductionPlan.update({
          where: { id: targetPlan.id },
          data: targetPlanMutation.data,
        });
      }
    }
    await ensureTaskVersion(tx, source.id, expectedVersion(input.expectedVersion), {
      status: DailyProcessTaskStatus.CARRIED_OVER,
      version: { increment: 1 },
    });
    await tx.dailyTaskAssignment.updateMany({
      where: { taskId: source.id, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
      data: { status: DailyTaskAssignmentStatus.CANCELLED, cancelledAt: new Date(), version: { increment: 1 } },
    });
    await writeRevision(tx, {
      planId: targetPlan.id,
      taskId: source.id,
      action: 'CARRY_OVER_TASK',
      beforeData: { workDate: source.plan.workDate, status: source.status },
      afterData: { targetDate, targetPlanId: targetPlan.id, targetTaskId: targetTask.id },
      reason,
      actorId: scope.userId,
      idempotencyKey,
    });
    return { taskId: targetTask.id, targetPlanId: targetPlan.id };
  });
  return serializeDailyPlanValue({ plan: await loadPlan(prisma, result.targetPlanId), carriedTaskId: result.taskId });
}

export async function requestDailyCrossTeamAssignment(input: {
  actorUserId: string;
  taskId: string;
  targetTeamId: string;
  employeeId?: string | null;
  quantity: number;
  reason: string;
  idempotencyKey: string;
}) {
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyCrossTeamRequest.findUnique({ where: { idempotencyKey } });
    if (duplicate) return duplicate;
    const task = await loadTask(tx, input.taskId);
    assertPlanAllowsAssignments(task.plan.status);
    const scope = await resolveActorScope(input.actorUserId, task.plan.workDate);
    assertTeamMutation(scope, task.plan.teamId);
    const targetTeamId = requiredText(input.targetTeamId, '目标班组');
    if (targetTeamId === task.plan.teamId) {
      throw new DailyPlanServiceError('目标班组不能与原班组相同', 'DAILY_PLAN_CROSS_TEAM_INVALID');
    }
    const targetTeam = await tx.productionTeam.findFirst({ where: { id: targetTeamId, isActive: true } });
    if (!targetTeam) throw new DailyPlanServiceError('目标班组不存在或已停用', 'DAILY_PLAN_TEAM_NOT_FOUND', 404);
    const employeeId = input.employeeId ? requiredText(input.employeeId, '借调员工') : null;
    if (employeeId) {
      const membership = await activeEmployeeMembership(tx, employeeId, task.plan.workDate);
      if (!membership.some(item => item.teamId === targetTeamId)) {
        throw new DailyPlanServiceError('借调员工不属于目标班组', 'DAILY_PLAN_EMPLOYEE_TEAM_MISMATCH', 409);
      }
    }
    const quantity = positiveInteger(input.quantity, '借调数量');
    if (quantity > task.plannedQty) {
      throw new DailyPlanServiceError('借调数量不能超过任务计划数量', 'DAILY_PLAN_CROSS_TEAM_EXCEEDS_TASK', 409);
    }
    return tx.dailyCrossTeamRequest.create({
      data: {
        taskId: task.id,
        requestingTeamId: task.plan.teamId,
        targetTeamId,
        employeeId,
        quantity,
        reason: requiredText(input.reason, '借调原因'),
        requestedById: scope.userId,
        idempotencyKey,
      },
      include: { requestingTeam: true, targetTeam: true, employee: true },
    });
  });
  return serializeDailyPlanValue(result);
}

export async function reviewDailyCrossTeamRequest(input: {
  actorUserId: string;
  requestId: string;
  expectedVersion: number;
  decision: 'APPROVE' | 'REJECT';
  reviewNote?: string | null;
  idempotencyKey: string;
}) {
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      const found = await tx.dailyCrossTeamRequest.findUnique({ where: { id: input.requestId } });
      if (found) return found;
    }
    const request = await tx.dailyCrossTeamRequest.findUnique({
      where: { id: input.requestId },
      include: { task: { include: { plan: true } } },
    });
    if (!request) throw new DailyPlanServiceError('跨组借调申请不存在', 'DAILY_PLAN_CROSS_TEAM_NOT_FOUND', 404);
    const scope = await resolveActorScope(input.actorUserId, request.task.plan.workDate);
    assertSupervisor(scope);
    if (request.status !== DailyCrossTeamRequestStatus.PENDING) {
      throw new DailyPlanServiceError('该借调申请已经处理', 'DAILY_PLAN_CROSS_TEAM_REVIEWED', 409);
    }
    if (input.decision === 'APPROVE') {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "daily_process_tasks"
        WHERE "id" = ${request.taskId}
        FOR UPDATE
      `;
      if (lockedRows.length !== 1) {
        throw new DailyPlanServiceError('日计划工序任务不存在', 'DAILY_PLAN_TASK_NOT_FOUND', 404);
      }
      const lockedTask = await tx.dailyProcessTask.findUnique({
        where: { id: request.taskId },
        include: { plan: true },
      });
      if (!lockedTask) {
        throw new DailyPlanServiceError('日计划工序任务不存在', 'DAILY_PLAN_TASK_NOT_FOUND', 404);
      }
      assertPlanAllowsAssignments(lockedTask.plan.status);
      const activeAssignments = await tx.dailyTaskAssignment.aggregate({
        where: {
          taskId: lockedTask.id,
          status: { not: DailyTaskAssignmentStatus.CANCELLED },
        },
        _sum: { quantity: true },
      });
      const consumedCrossTeamAssignments = await tx.dailyTaskAssignment.aggregate({
        where: {
          taskId: lockedTask.id,
          assignedTeamId: { not: lockedTask.plan.teamId },
          status: { not: DailyTaskAssignmentStatus.CANCELLED },
        },
        _sum: { quantity: true },
      });
      const existingApprovals = await tx.dailyCrossTeamRequest.aggregate({
        where: {
          taskId: lockedTask.id,
          status: DailyCrossTeamRequestStatus.APPROVED,
        },
        _sum: { quantity: true },
      });
      const taskRemainingQuantity = Math.max(
        0,
        lockedTask.plannedQty - (activeAssignments._sum.quantity || 0),
      );
      const unconsumedApprovedQuantity = Math.max(
        0,
        (existingApprovals._sum.quantity || 0) - (consumedCrossTeamAssignments._sum.quantity || 0),
      );
      const approvableQuantity = Math.max(0, taskRemainingQuantity - unconsumedApprovedQuantity);
      if (request.quantity > approvableQuantity) {
        throw new DailyPlanServiceError(
          `累计跨组审批额度不能超过任务剩余量（本次最多可批准 ${approvableQuantity}）`,
          'DAILY_PLAN_CROSS_TEAM_APPROVAL_EXCEEDS_REMAINING',
          409,
        );
      }
      // The row lock serializes reviews for the same task; the version CAS also
      // turns a stale serializable snapshot into a conflict instead of allowing
      // two concurrent approvals to reserve the same remaining quantity.
      await ensureTaskVersion(tx, lockedTask.id, lockedTask.version, { version: { increment: 1 } });
    }
    const status = input.decision === 'APPROVE'
      ? DailyCrossTeamRequestStatus.APPROVED
      : DailyCrossTeamRequestStatus.REJECTED;
    const updated = await tx.dailyCrossTeamRequest.updateMany({
      where: { id: request.id, version: expectedVersion(input.expectedVersion), status: DailyCrossTeamRequestStatus.PENDING },
      data: {
        status,
        reviewedById: scope.userId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ? requiredText(input.reviewNote, '审核说明') : null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new DailyPlanServiceError('借调申请已被其他人处理，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
    }
    await writeRevision(tx, {
      planId: request.task.planId,
      taskId: request.taskId,
      action: input.decision === 'APPROVE' ? 'APPROVE_CROSS_TEAM' : 'REJECT_CROSS_TEAM',
      beforeData: request,
      afterData: { status },
      reason: input.reviewNote || null,
      actorId: scope.userId,
      idempotencyKey,
    });
    const reloaded = await tx.dailyCrossTeamRequest.findUnique({ where: { id: request.id } });
    if (!reloaded) throw new DailyPlanServiceError('跨组借调申请不存在', 'DAILY_PLAN_CROSS_TEAM_NOT_FOUND', 404);
    return reloaded;
  });
  return serializeDailyPlanValue(result);
}

export async function listDailyCrossTeamRequests(input: {
  actorUserId: string;
  workDate?: string | Date;
  planId?: string;
  status?: DailyCrossTeamRequestStatus;
  teamId?: string;
}) {
  const planId = input.planId ? requiredText(input.planId, '日计划') : null;
  const selectedPlan = planId
    ? await prisma.dailyProductionPlan.findUnique({
        where: { id: planId },
        select: { id: true, workDate: true },
      })
    : null;
  if (planId && !selectedPlan) {
    throw new DailyPlanServiceError('日计划不存在', 'DAILY_PLAN_NOT_FOUND', 404);
  }
  const workDate = selectedPlan?.workDate
    || (input.workDate ? normalizeWorkDate(input.workDate) : productionPlanningDateBoundary());
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertVisible(scope);
  if (input.teamId) assertTeamMutation(scope, input.teamId);
  const visibleTeamIds = scope.isAdmin || scope.isSupervisor
    ? null
    : scope.leaderTeamIds;
  const teamVisibility = input.teamId
    ? [{ requestingTeamId: input.teamId }, { targetTeamId: input.teamId }]
    : visibleTeamIds
      ? [{ requestingTeamId: { in: visibleTeamIds } }, { targetTeamId: { in: visibleTeamIds } }]
      : undefined;
  const requests = await prisma.dailyCrossTeamRequest.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(teamVisibility ? { OR: teamVisibility } : {}),
      task: planId ? { planId } : { plan: { workDate } },
    },
    include: {
      task: { include: { workOrder: true, plan: { include: { team: true } } } },
      requestingTeam: true,
      targetTeam: true,
      employee: true,
      requestedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return serializeDailyPlanValue(requests);
}

export async function upsertDailyCapacityOverride(input: {
  actorUserId: string;
  planId: string;
  employeeId: string;
  regularMilliseconds: number;
  overtimeMilliseconds?: number;
  overtimeStartAt?: string | Date | null;
  overtimeEndAt?: string | Date | null;
  reason?: string | null;
  expectedVersion?: number;
  idempotencyKey: string;
}) {
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const result = await serializable(async tx => {
    const duplicate = await tx.dailyPlanRevision.findUnique({ where: { idempotencyKey } });
    if (duplicate) return { planId: duplicate.planId };
    const plan = await tx.dailyProductionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new DailyPlanServiceError('日计划不存在', 'DAILY_PLAN_NOT_FOUND', 404);
    const scope = await resolveActorScope(input.actorUserId, plan.workDate);
    assertTeamMutation(scope, plan.teamId);
    const employeeId = requiredText(input.employeeId, '员工');
    const memberships = await activeEmployeeMembership(tx, employeeId, plan.workDate);
    const belongsToPlanTeam = memberships.some(membership => membership.teamId === plan.teamId);
    if (!belongsToPlanTeam) {
      const approvedBorrow = await tx.dailyCrossTeamRequest.findFirst({
        where: {
          employeeId,
          requestingTeamId: plan.teamId,
          status: DailyCrossTeamRequestStatus.APPROVED,
          task: { planId: plan.id },
        },
        select: { id: true },
      });
      if (!approvedBorrow) {
        throw new DailyPlanServiceError(
          '员工不属于当前班组，必须先完成跨组借调审批',
          'DAILY_PLAN_CROSS_TEAM_APPROVAL_REQUIRED',
          403,
        );
      }
    }
    const overtimeStartAt = optionalDate(input.overtimeStartAt);
    const overtimeEndAt = optionalDate(input.overtimeEndAt);
    validateTimeWindow(overtimeStartAt, overtimeEndAt, '加班时间');
    const existing = await tx.dailyCapacityOverride.findUnique({
      where: { planId_employeeId: { planId: plan.id, employeeId: input.employeeId } },
    });
    // The workbench exposes the plan version as the aggregate mutation token.
    // Capacity rows are not exposed individually, so comparing that token to a
    // capacity-row version would create false conflicts after the first edit.
    // Advance the plan version in the same serializable transaction instead.
    const planVersion = input.expectedVersion === undefined
      ? plan.version
      : expectedVersion(input.expectedVersion);
    const updatedPlan = await tx.dailyProductionPlan.updateMany({
      where: { id: plan.id, version: planVersion },
      data: { version: { increment: 1 } },
    });
    if (updatedPlan.count !== 1) {
      throw new DailyPlanServiceError('日计划已被其他人更新，请刷新后重试', 'DAILY_PLAN_VERSION_CONFLICT', 409);
    }
    await tx.dailyCapacityOverride.upsert({
      where: { planId_employeeId: { planId: plan.id, employeeId: input.employeeId } },
      create: {
        planId: plan.id,
        employeeId: input.employeeId,
        regularMilliseconds: nonNegativeInteger(input.regularMilliseconds, '正常班容量'),
        overtimeMilliseconds: nonNegativeInteger(input.overtimeMilliseconds || 0, '加班容量'),
        overtimeStartAt,
        overtimeEndAt,
        reason: input.reason || null,
        setById: scope.userId,
      },
      update: {
        regularMilliseconds: nonNegativeInteger(input.regularMilliseconds, '正常班容量'),
        overtimeMilliseconds: nonNegativeInteger(input.overtimeMilliseconds || 0, '加班容量'),
        overtimeStartAt,
        overtimeEndAt,
        reason: input.reason || null,
        setById: scope.userId,
        version: { increment: 1 },
      },
    });
    await writeRevision(tx, {
      planId: plan.id,
      action: 'SET_CAPACITY',
      beforeData: existing,
      afterData: input,
      reason: input.reason || null,
      actorId: scope.userId,
      idempotencyKey,
    });
    return { planId: plan.id };
  });
  return serializeDailyPlanValue(await loadPlan(prisma, result.planId));
}

export async function listProductionPlanningOrganization(input: {
  actorUserId: string;
  workDate?: string | Date;
  includeInactive?: boolean;
}) {
  const workDate = input.workDate ? normalizeWorkDate(input.workDate) : productionPlanningDateBoundary();
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertVisible(scope);
  const teams = await prisma.productionTeam.findMany({
    where: input.includeInactive ? {} : { isActive: true },
    include: {
      processCapabilities: {
        where: input.includeInactive ? {} : { isActive: true },
        include: { processDefinition: true },
        orderBy: [{ priority: 'desc' }, { processDefinition: { sortOrder: 'asc' } }],
      },
      memberships: {
        where: {
          ...(input.includeInactive ? {} : activeMembershipWhere(workDate)),
          employee: {
            is: productionEmployeeWhere({
              requireActive: !input.includeInactive,
              requireAttendance: !input.includeInactive,
            }),
          },
        },
        include: { employee: true },
        orderBy: [{ role: 'asc' }, { employee: { employeeNo: 'asc' } }],
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  const assignedIds = new Set(teams.flatMap(team => team.memberships.map(item => item.employeeId)));
  const unassignedEmployees = await prisma.employee.findMany({
    where: { ...productionEmployeeWhere(), id: { notIn: [...assignedIds] } },
    orderBy: { employeeNo: 'asc' },
  });
  const supervisors = await prisma.productionPlanningMembership.findMany({
    where: {
      role: ProductionPlanningRole.WORKSHOP_SUPERVISOR,
      ...activeMembershipWhere(workDate),
      employee: { is: productionEmployeeWhere() },
    },
    include: { employee: true },
  });
  const processDefinitions = await prisma.processDefinition.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return serializeDailyPlanValue({ workDate: formatWorkDate(workDate), teams, supervisors, unassignedEmployees, processDefinitions });
}

export async function upsertProductionTeam(input: {
  actorUserId: string;
  teamId?: string;
  code: string;
  name: string;
  legacyTeamName?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  expectedVersion?: number;
  idempotencyKey: string;
}) {
  const scope = await resolveActorScope(input.actorUserId);
  assertAdmin(scope);
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const teamId = input.teamId ? requiredText(input.teamId, '生产班组') : null;
  const name = requiredText(input.name, '班组名称', 100);
  const codeInput = String(input.code || '').trim();
  const code = codeInput || `TEAM-${createHash('sha256').update(name).digest('hex').slice(0, 8).toUpperCase()}`;
  if (code.length > 64) throw new DailyPlanServiceError('班组编码不能超过 64 个字符', 'DAILY_PLAN_TEXT_TOO_LONG');
  const legacyTeamName = input.legacyTeamName?.trim() || null;
  const sortOrder = input.sortOrder === undefined ? null : nonNegativeInteger(input.sortOrder, '排序号');
  const normalizedExpectedVersion = input.expectedVersion === undefined
    ? null
    : expectedVersion(input.expectedVersion);
  const payloadHash = organizationMutationPayloadHash({
    teamId,
    code,
    name,
    legacyTeamName,
    hasIsActive: input.isActive !== undefined,
    isActive: input.isActive ?? null,
    hasSortOrder: input.sortOrder !== undefined,
    sortOrder,
    expectedVersion: normalizedExpectedVersion,
  });
  // READ COMMITTED is intentional here: after a concurrent request releases
  // the advisory lock, the following lookup must see its committed log entry.
  const team = await readCommitted(async tx => {
    const replay = await readOrganizationMutationReplay(tx, {
      idempotencyKey,
      payloadHash,
      actorId: scope.userId,
      action: 'UPSERT_TEAM',
      targetType: 'PRODUCTION_TEAM',
    });
    if (replay) return replay;

    let result;
    if (!teamId) {
      result = await tx.productionTeam.create({
        data: {
          code,
          name,
          legacyTeamName,
          isActive: input.isActive ?? true,
          sortOrder: sortOrder ?? 0,
        },
      });
    } else {
      const current = await tx.productionTeam.findUnique({ where: { id: teamId } });
      if (!current) throw new DailyPlanServiceError('生产班组不存在', 'DAILY_PLAN_TEAM_NOT_FOUND', 404);
      if (normalizedExpectedVersion === null) {
        throw new DailyPlanServiceError('修改班组时必须提供版本号', 'DAILY_PLAN_VERSION_REQUIRED');
      }
      const updated = await tx.productionTeam.updateMany({
        where: { id: current.id, version: normalizedExpectedVersion },
        data: {
          code,
          name,
          legacyTeamName,
          isActive: input.isActive ?? current.isActive,
          sortOrder: sortOrder ?? current.sortOrder,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DailyPlanServiceError('班组已被其他人更新', 'DAILY_PLAN_VERSION_CONFLICT', 409);
      }
      result = await tx.productionTeam.findUniqueOrThrow({ where: { id: current.id } });
    }
    await writeOrganizationMutation(tx, {
      idempotencyKey,
      payloadHash,
      actorId: scope.userId,
      action: 'UPSERT_TEAM',
      targetType: 'PRODUCTION_TEAM',
      targetId: result.id,
      resultVersion: result.version,
      resultData: result,
    });
    return result;
  });
  return serializeDailyPlanValue(team);
}

export async function upsertProductionPlanningMembership(input: {
  actorUserId: string;
  membershipId?: string;
  employeeId: string;
  teamId?: string | null;
  role: 'WORKSHOP_SUPERVISOR' | 'TEAM_LEADER' | 'MEMBER';
  isActive?: boolean;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
  expectedVersion?: number;
  idempotencyKey: string;
}) {
  const scope = await resolveActorScope(input.actorUserId);
  assertAdmin(scope);
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const membershipId = input.membershipId ? requiredText(input.membershipId, '排程成员关系') : null;
  const role = ProductionPlanningRole[input.role];
  if (!role) throw new DailyPlanServiceError('生产排程角色无效', 'DAILY_PLAN_ROLE_INVALID');
  const employeeId = requiredText(input.employeeId, '员工');
  const teamId = input.teamId ? requiredText(input.teamId, '班组') : null;
  if (role !== ProductionPlanningRole.WORKSHOP_SUPERVISOR && !teamId) {
    throw new DailyPlanServiceError('组长和组员必须指定班组', 'DAILY_PLAN_TEAM_REQUIRED');
  }
  const effectiveFrom = normalizeWorkDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? normalizeWorkDate(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new DailyPlanServiceError('失效日期不能早于生效日期', 'DAILY_PLAN_EFFECTIVE_DATE_INVALID');
  }
  const scopeKey = role === ProductionPlanningRole.WORKSHOP_SUPERVISOR ? 'GLOBAL' : `TEAM:${teamId}`;
  const normalizedExpectedVersion = input.expectedVersion === undefined
    ? null
    : expectedVersion(input.expectedVersion);
  const payloadHash = organizationMutationPayloadHash({
    membershipId,
    employeeId,
    teamId,
    role,
    hasIsActive: input.isActive !== undefined,
    isActive: input.isActive ?? null,
    effectiveFrom: formatWorkDate(effectiveFrom),
    effectiveTo: effectiveTo ? formatWorkDate(effectiveTo) : null,
    expectedVersion: normalizedExpectedVersion,
  });
  const membership = await readCommitted(async tx => {
    const replay = await readOrganizationMutationReplay(tx, {
      idempotencyKey,
      payloadHash,
      actorId: scope.userId,
      action: 'UPSERT_MEMBERSHIP',
      targetType: 'PRODUCTION_PLANNING_MEMBERSHIP',
    });
    if (replay) return replay;

    const employee = await tx.employee.findFirst({ where: { id: employeeId, ...productionEmployeeWhere() } });
    if (!employee) {
      throw new DailyPlanServiceError(
        '员工不属于生产部、未启用考勤或已停用',
        'DAILY_PLAN_EMPLOYEE_NOT_FOUND',
        404,
      );
    }
    if (teamId) {
      const team = await tx.productionTeam.findFirst({ where: { id: teamId, isActive: true } });
      if (!team) throw new DailyPlanServiceError('生产班组不存在或已停用', 'DAILY_PLAN_TEAM_NOT_FOUND', 404);
    }
    let result;
    if (!membershipId) {
      result = await tx.productionPlanningMembership.upsert({
        where: { employeeId_role_scopeKey: { employeeId, role, scopeKey } },
        create: { employeeId, teamId, role, scopeKey, isActive: input.isActive ?? true, effectiveFrom, effectiveTo },
        update: { teamId, isActive: input.isActive ?? true, effectiveFrom, effectiveTo, version: { increment: 1 } },
        include: { employee: true, team: true },
      });
    } else {
      const current = await tx.productionPlanningMembership.findUnique({ where: { id: membershipId } });
      if (!current) throw new DailyPlanServiceError('排程成员关系不存在', 'DAILY_PLAN_MEMBERSHIP_NOT_FOUND', 404);
      if (normalizedExpectedVersion === null) {
        throw new DailyPlanServiceError('修改成员关系时必须提供版本号', 'DAILY_PLAN_VERSION_REQUIRED');
      }
      const updated = await tx.productionPlanningMembership.updateMany({
        where: { id: current.id, version: normalizedExpectedVersion },
        data: { employeeId, teamId, role, scopeKey, isActive: input.isActive ?? current.isActive, effectiveFrom, effectiveTo, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new DailyPlanServiceError('成员关系已被其他人更新', 'DAILY_PLAN_VERSION_CONFLICT', 409);
      }
      result = await tx.productionPlanningMembership.findUniqueOrThrow({
        where: { id: current.id },
        include: { employee: true, team: true },
      });
    }
    await writeOrganizationMutation(tx, {
      idempotencyKey,
      payloadHash,
      actorId: scope.userId,
      action: 'UPSERT_MEMBERSHIP',
      targetType: 'PRODUCTION_PLANNING_MEMBERSHIP',
      targetId: result.id,
      resultVersion: result.version,
      resultData: result,
    });
    return result;
  });
  return serializeDailyPlanValue(membership);
}

export async function upsertProductionTeamProcessCapability(input: {
  actorUserId: string;
  capabilityId?: string;
  teamId: string;
  processDefinitionId: string;
  priority?: number;
  isActive?: boolean;
  expectedVersion?: number;
  idempotencyKey: string;
}) {
  const scope = await resolveActorScope(input.actorUserId);
  assertAdmin(scope);
  const idempotencyKey = requiredText(input.idempotencyKey, '幂等键', 200);
  const capabilityId = input.capabilityId ? requiredText(input.capabilityId, '工序归属关系') : null;
  const teamId = requiredText(input.teamId, '生产班组');
  const processDefinitionId = requiredText(input.processDefinitionId, '标准工序');
  const priority = input.priority === undefined ? 0 : nonNegativeInteger(input.priority, '归属优先级');
  const normalizedExpectedVersion = input.expectedVersion === undefined
    ? null
    : expectedVersion(input.expectedVersion);
  const payloadHash = organizationMutationPayloadHash({
    capabilityId,
    teamId,
    processDefinitionId,
    priority,
    isActive: input.isActive ?? true,
    expectedVersion: normalizedExpectedVersion,
  });
  const capability = await readCommitted(async tx => {
    const replay = await readOrganizationMutationReplay(tx, {
      idempotencyKey,
      payloadHash,
      actorId: scope.userId,
      action: 'UPSERT_PROCESS_CAPABILITY',
      targetType: 'PRODUCTION_TEAM_PROCESS_CAPABILITY',
    });
    if (replay) return replay;

    const [team, processDefinition] = await Promise.all([
      tx.productionTeam.findFirst({ where: { id: teamId, isActive: true } }),
      tx.processDefinition.findFirst({ where: { id: processDefinitionId, isActive: true } }),
    ]);
    if (!team) throw new DailyPlanServiceError('生产班组不存在或已停用', 'DAILY_PLAN_TEAM_NOT_FOUND', 404);
    if (!processDefinition) throw new DailyPlanServiceError('标准工序不存在或已停用', 'DAILY_PLAN_PROCESS_NOT_FOUND', 404);

    const current = capabilityId
      ? await tx.productionTeamProcessCapability.findUnique({ where: { id: capabilityId } })
      : await tx.productionTeamProcessCapability.findUnique({
          where: { teamId_processDefinitionId: { teamId, processDefinitionId } },
        });
    let result;
    if (!current) {
      result = await tx.productionTeamProcessCapability.create({
        data: { teamId, processDefinitionId, priority, isActive: input.isActive ?? true },
        include: { processDefinition: true, team: true },
      });
    } else {
      if (normalizedExpectedVersion !== null && normalizedExpectedVersion !== current.version) {
        throw new DailyPlanServiceError('工序归属关系已被其他人更新', 'DAILY_PLAN_VERSION_CONFLICT', 409);
      }
      const updated = await tx.productionTeamProcessCapability.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          teamId,
          processDefinitionId,
          priority,
          isActive: input.isActive ?? true,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DailyPlanServiceError('工序归属关系已被其他人更新', 'DAILY_PLAN_VERSION_CONFLICT', 409);
      }
      result = await tx.productionTeamProcessCapability.findUniqueOrThrow({
        where: { id: current.id },
        include: { processDefinition: true, team: true },
      });
    }
    await writeOrganizationMutation(tx, {
      idempotencyKey,
      payloadHash,
      actorId: scope.userId,
      action: 'UPSERT_PROCESS_CAPABILITY',
      targetType: 'PRODUCTION_TEAM_PROCESS_CAPABILITY',
      targetId: result.id,
      resultVersion: result.version,
      resultData: result,
    });
    return result;
  });
  return serializeDailyPlanValue(capability);
}

export async function getDailyPlanWorkbench(input: {
  actorUserId: string;
  workDate: string | Date;
  shiftCode?: string;
  teamId?: string;
}) {
  const workDate = normalizeWorkDate(input.workDate);
  const taskWeek = productionWeekDateBounds(workDate);
  const shiftCode = normalizeShiftCode(input.shiftCode);
  const scope = await resolveActorScope(input.actorUserId, workDate);
  assertVisible(scope);
  if (input.teamId) assertTeamMutation(scope, input.teamId);
  const permittedTeamIds = scope.isAdmin || scope.isSupervisor ? null : scope.leaderTeamIds;
  const teamWhere: Prisma.ProductionTeamWhereInput = {
    isActive: true,
    ...(permittedTeamIds ? { id: { in: permittedTeamIds } } : {}),
  };
  const teamOptions = await prisma.productionTeam.findMany({
    where: teamWhere,
    include: {
      processCapabilities: {
        where: { isActive: true, processDefinition: { isActive: true } },
        select: { id: true, processDefinitionId: true },
      },
      memberships: {
        where: {
          ...activeMembershipWhere(workDate),
          employee: { is: productionEmployeeWhere() },
        },
        include: { employee: true },
        orderBy: [{ role: 'asc' }, { employee: { employeeNo: 'asc' } }],
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  const teams = input.teamId
    ? teamOptions.filter(team => team.id === input.teamId)
    : teamOptions;
  if (input.teamId && teams.length === 0) {
    throw new DailyPlanServiceError('生产班组不存在、已停用或不在当前账号的排程范围内', 'DAILY_PLAN_TEAM_NOT_FOUND', 404);
  }
  const plans = await prisma.dailyProductionPlan.findMany({
    where: {
      workDate,
      shiftCode,
      ...(input.teamId
        ? { teamId: input.teamId }
        : permittedTeamIds
          ? { teamId: { in: permittedTeamIds } }
          : {}),
    },
    include: planInclude,
    orderBy: { team: { sortOrder: 'asc' } },
  });
  const employeeIds = [...new Set(teams.flatMap(team => team.memberships.map(item => item.employeeId)))];
  const attendance = employeeIds.length
    ? await prisma.attendanceRecord.findMany({ where: { workDate, employeeId: { in: employeeIds } } })
    : [];
  const attendanceByEmployee = new Map(attendance.map(item => [item.employeeId, item]));
  const overrides = new Map(plans.flatMap(plan => plan.capacityOverrides.map(item => [item.employeeId, item] as const)));
  const capacity = employeeIds.map(employeeId => {
    const record = attendanceByEmployee.get(employeeId);
    const override = overrides.get(employeeId);
    return {
      employeeId,
      ...resolveEffectiveCapacity({
        attendanceActualMilliseconds: record?.actualMilliseconds,
        attendanceOvertimeMilliseconds: record?.overtimeMilliseconds,
        overrideRegularMilliseconds: override?.regularMilliseconds,
        overrideOvertimeMilliseconds: override?.overtimeMilliseconds,
      }),
    };
  });
  let suggestionPreview: Awaited<ReturnType<typeof previewDailyPlanSuggestions>> | null = null;
  if (input.teamId) {
    suggestionPreview = await previewDailyPlanSuggestions({
      actorUserId: input.actorUserId,
      workDate,
      shiftCode,
      teamId: input.teamId,
      includeWaitingUpstream: true,
    });
  }
  return serializeDailyPlanValue({
    workDate: formatWorkDate(workDate),
    shiftCode,
    scope: {
      isAdmin: scope.isAdmin,
      isSupervisor: scope.isSupervisor,
      teamIds: scope.leaderTeamIds,
    },
    selectedTeamId: input.teamId || null,
    teamOptions,
    teams,
    plans,
    capacity,
    unplannedSuggestions: suggestionPreview?.candidates || [],
    blocked: suggestionPreview?.blocked || [],
    weeklyPool: {
      weekStartDate: taskWeek.startKey,
      weekEndDate: taskWeek.endKey,
      availableTaskCount: suggestionPreview?.candidates.length || 0,
      alreadyPlannedTaskCount: suggestionPreview?.blocked.filter(item => item.reason === 'ALREADY_PLANNED').length || 0,
      processOwnershipConfigured: Boolean(
        suggestionPreview?.processOwnershipConfigured
        || teamOptions.some(team => team.processCapabilities.length > 0),
      ),
      teamCapabilityCount: input.teamId
        ? teamOptions.find(team => team.id === input.teamId)?.processCapabilities.length || 0
        : teamOptions.reduce((sum, team) => sum + team.processCapabilities.length, 0),
    },
  });
}

export async function getDailyPlanPrintSnapshot(input: {
  actorUserId: string;
  planId: string;
  employeeId?: string;
}) {
  const plan = await loadPlan(prisma, requiredText(input.planId, '日计划'));
  const scope = await resolveActorScope(input.actorUserId, plan.workDate);
  assertTeamMutation(scope, plan.teamId);
  const employee = input.employeeId
    ? await prisma.employee.findFirst({
        where: {
          id: input.employeeId,
          dailyTaskAssignments: {
            some: {
              task: { planId: plan.id },
              status: { not: DailyTaskAssignmentStatus.CANCELLED },
            },
          },
        },
        select: { id: true, employeeNo: true, name: true, team: true, position: true },
      })
    : null;
  if (input.employeeId && !employee) {
    throw new DailyPlanServiceError('员工不在当前日计划的有效分配名单中', 'DAILY_PLAN_PRINT_EMPLOYEE_NOT_FOUND', 404);
  }
  const filteredPlan = input.employeeId
    ? {
        ...plan,
        tasks: plan.tasks
          .map(task => ({ ...task, assignments: task.assignments.filter(item => item.employeeId === input.employeeId) }))
          .filter(task => task.assignments.length > 0),
        capacityOverrides: plan.capacityOverrides.filter(item => item.employeeId === input.employeeId),
      }
    : plan;
  return serializeDailyPlanValue({
    generatedAt: new Date().toISOString(),
    snapshotType: input.employeeId ? 'EMPLOYEE_TASK_SHEET' : 'TEAM_DAILY_PLAN',
    employeeId: input.employeeId || null,
    employee,
    plan: filteredPlan,
  });
}
