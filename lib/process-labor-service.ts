import {
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateKeyFromDatabase, parseWorkDate } from '@/lib/attendance';
import {
  authorizeLaborClaim,
  authorizeLaborStandardResolution,
  authorizeLaborVoid,
  canViewLaborClaim,
  LaborAuthorizationError,
  laborAccessProfile,
  type LaborAccessProfile,
  type LaborAuthorizationActor,
} from '@/lib/labor-authorization';
import {
  calculateCompletionLaborSnapshot,
  planLaborClaim,
  ProcessCompletionDomainError,
} from '@/lib/process-completion-domain';
import { cleanProcessText, serializeEmployee } from '@/lib/process-time';
import type {
  ProcessLaborClaimDTO,
  ProcessLaborAccessDTO,
  ProcessLaborPoolDTO,
  ProcessLaborPoolSummaryDTO,
} from '@/types';

export class ProcessLaborServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PROCESS_LABOR_INVALID') {
    super(message);
    this.name = 'ProcessLaborServiceError';
    this.status = status;
    this.code = code;
  }
}

export type ClaimAllocationInput = {
  eligibleQty: number;
  claimedQty: number;
  requestedQty: number;
  totalStandardLaborMilliseconds: bigint;
  claimedStandardLaborMilliseconds: bigint;
};

export function parseClaimQuantity(value: unknown): number {
  const quantity = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ProcessLaborServiceError('领取数量必须是正整数', 400, 'PROCESS_LABOR_QUANTITY_INVALID');
  }
  return quantity;
}

export function parseExpectedPoolVersion(value: unknown): number {
  const version = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ProcessLaborServiceError('工时池版本不正确，请刷新后重试', 400, 'PROCESS_LABOR_VERSION_INVALID');
  }
  return version;
}

export function parseIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 8 || key.length > 120) {
    throw new ProcessLaborServiceError('请求标识无效，请重新提交', 400, 'PROCESS_LABOR_IDEMPOTENCY_INVALID');
  }
  return key;
}

export function calculateClaimStandardLaborMilliseconds(input: ClaimAllocationInput): bigint {
  try {
    return planLaborClaim({
      eligibleQty: input.eligibleQty,
      claimedQty: input.claimedQty,
      claimQty: input.requestedQty,
      totalStandardLaborMilliseconds: input.totalStandardLaborMilliseconds,
      claimedStandardLaborMilliseconds: input.claimedStandardLaborMilliseconds,
    }).claimStandardLaborMilliseconds;
  } catch (error) {
    if (error instanceof ProcessCompletionDomainError) {
      throw new ProcessLaborServiceError(
        error.message,
        error.code === 'INVALID_CLAIM_QTY' ? 400 : 409,
        `PROCESS_LABOR_${error.code}`,
      );
    }
    throw error;
  }
}

export function poolStatusAfterClaim(eligibleQty: number, claimedQty: number): 'OPEN' | 'PARTIAL' | 'EXHAUSTED' {
  if (claimedQty <= 0) return 'OPEN';
  return claimedQty >= eligibleQty ? 'EXHAUSTED' : 'PARTIAL';
}

export function pendingPerBatchResolutionIsSafe(input: {
  routeStatus: string;
  workOrderStage: string | null;
  workOrderStatus: string | null;
  stepStatus: string;
  inputQty: number;
  processedQty: number;
  completionCount: number;
  laborPoolCount: number;
}): boolean {
  const routeClosed = input.routeStatus === 'completed'
    && (input.workOrderStage === 'completed' || input.workOrderStatus === 'completed');
  const quantityClosed = input.inputQty > 0
    && input.processedQty >= input.inputQty
    && input.stepStatus === 'completed';
  return routeClosed
    && quantityClosed
    && input.completionCount === 1
    && input.laborPoolCount === 1;
}

export function safeLaborMilliseconds(value: bigint): number {
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new ProcessLaborServiceError('标准工时超出报表可展示范围', 500, 'PROCESS_LABOR_DURATION_OVERFLOW');
  }
  return milliseconds;
}

const actorSelect = { id: true, username: true, displayName: true } as const;
const laborActorSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  isActive: true,
  laborRole: true,
  employee: {
    select: {
      id: true,
      isActive: true,
      team: true,
    },
  },
});

type LaborActorRecord = Prisma.UserGetPayload<{ select: typeof laborActorSelect }>;

function authorizationActor(actor: LaborActorRecord): LaborAuthorizationActor {
  return {
    id: actor.id,
    isActive: actor.isActive,
    laborRole: actor.laborRole,
    employee: actor.employee,
  };
}

function missingLaborActor(): never {
  throw new ProcessLaborServiceError(
    '当前账号不存在或已停用',
    403,
    'PROCESS_LABOR_ACTOR_INACTIVE',
  );
}

async function loadLaborAccessProfileForUser(userId: string): Promise<LaborAccessProfile> {
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: laborActorSelect,
  });
  if (!actor?.isActive) missingLaborActor();
  return laborAccessProfile(authorizationActor(actor));
}

const processLaborClaimInclude = Prisma.validator<Prisma.ProcessLaborClaimInclude>()({
  employee: true,
  claimedBy: { select: actorSelect },
  voidedBy: { select: actorSelect },
});

const processLaborPoolInclude = Prisma.validator<Prisma.ProcessLaborPoolInclude>()({
  completion: {
    select: {
      timeBasis: true,
      unitLabel: true,
    },
  },
  workOrder: {
    select: {
      id: true,
      code: true,
      customerName: true,
      specification: true,
      productName: true,
    },
  },
  step: {
    select: {
      id: true,
      processCode: true,
      processName: true,
      stageGroup: true,
      unitLabel: true,
    },
  },
  claims: {
    where: { status: ProcessLaborClaimStatus.ACTIVE },
    include: processLaborClaimInclude,
    orderBy: [{ claimedAt: 'asc' }, { createdAt: 'asc' }],
  },
});

type ProcessLaborClaimRecord = Prisma.ProcessLaborClaimGetPayload<{
  include: typeof processLaborClaimInclude;
}>;

type ProcessLaborPoolRecord = Prisma.ProcessLaborPoolGetPayload<{
  include: typeof processLaborPoolInclude;
}>;

function serializeProcessLaborClaim(claim: ProcessLaborClaimRecord): ProcessLaborClaimDTO {
  return {
    id: claim.id,
    poolId: claim.poolId,
    employee: serializeEmployee(claim.employee),
    quantity: claim.quantity,
    standardLaborMilliseconds: safeLaborMilliseconds(claim.standardLaborMilliseconds),
    workDate: dateKeyFromDatabase(claim.workDate),
    status: claim.status,
    claimedBy: claim.claimedBy,
    claimedAt: claim.claimedAt.toISOString(),
    voidedAt: claim.voidedAt?.toISOString() || null,
    voidedBy: claim.voidedBy,
    voidReason: claim.voidReason,
    reversalOfId: claim.reversalOfId,
    createdAt: claim.createdAt.toISOString(),
  };
}

export function serializeProcessLaborPool(pool: ProcessLaborPoolRecord): ProcessLaborPoolDTO {
  return {
    id: pool.id,
    completionId: pool.completionId,
    workOrderId: pool.workOrderId,
    stepId: pool.stepId,
    workDate: dateKeyFromDatabase(pool.workDate),
    eligibleQty: pool.eligibleQty,
    claimedQty: pool.claimedQty,
    remainingQty: pool.remainingQty,
    status: pool.status,
    pendingStandard: pool.status === ProcessLaborPoolStatus.LOCKED
      && pool.standardSource === 'pending_standard',
    timeBasis: pool.completion.timeBasis === 'per_unit' || pool.completion.timeBasis === 'per_batch'
      ? pool.completion.timeBasis
      : null,
    unitLabel: pool.completion.unitLabel || pool.step.unitLabel || '件',
    version: pool.version,
    standardMillisecondsPerUnit: pool.standardMillisecondsPerUnit,
    setupMilliseconds: pool.setupMilliseconds,
    unitsPerProduct: pool.unitsPerProduct,
    totalStandardLaborMilliseconds: safeLaborMilliseconds(pool.totalStandardLaborMilliseconds),
    claimedStandardLaborMilliseconds: safeLaborMilliseconds(pool.claimedStandardLaborMilliseconds),
    remainingStandardLaborMilliseconds: safeLaborMilliseconds(pool.remainingStandardLaborMilliseconds),
    countsForEfficiency: pool.countsForEfficiency,
    standardSource: pool.standardSource,
    productTimeProfileVersion: pool.productTimeProfileVersion,
    createdAt: pool.createdAt.toISOString(),
    updatedAt: pool.updatedAt.toISOString(),
    lockedAt: pool.lockedAt?.toISOString() || null,
    workOrder: pool.workOrder,
    step: pool.step,
    claims: pool.claims.map(serializeProcessLaborClaim),
  };
}

function serializeProcessLaborPoolForAccess(
  pool: ProcessLaborPoolRecord,
  access: LaborAccessProfile,
): ProcessLaborPoolDTO {
  return serializeProcessLaborPool({
    ...pool,
    claims: pool.claims.filter(claim => canViewLaborClaim(access, claim.employee)),
  });
}

async function loadPool(poolId: string): Promise<ProcessLaborPoolRecord> {
  const pool = await prisma.processLaborPool.findUnique({
    where: { id: poolId },
    include: processLaborPoolInclude,
  });
  if (!pool) throw new ProcessLaborServiceError('工时池不存在', 404, 'PROCESS_LABOR_POOL_NOT_FOUND');
  return pool;
}

async function loadClaim(claimId: string): Promise<ProcessLaborClaimRecord> {
  const claim = await prisma.processLaborClaim.findUnique({
    where: { id: claimId },
    include: processLaborClaimInclude,
  });
  if (!claim) throw new ProcessLaborServiceError('领取记录不存在', 404, 'PROCESS_LABOR_CLAIM_NOT_FOUND');
  return claim;
}

function summarizePools(pools: ProcessLaborPoolRecord[]): ProcessLaborPoolSummaryDTO {
  return pools.reduce<ProcessLaborPoolSummaryDTO>((summary, pool) => {
    const claimable = pool.status === ProcessLaborPoolStatus.OPEN
      || pool.status === ProcessLaborPoolStatus.PARTIAL;
    const pendingStandard = pool.status === ProcessLaborPoolStatus.LOCKED
      && pool.standardSource === 'pending_standard';
    return {
      poolCount: summary.poolCount + 1,
      openPoolCount: summary.openPoolCount + (claimable ? 1 : 0),
      pendingStandardPoolCount: summary.pendingStandardPoolCount + (pendingStandard ? 1 : 0),
      pendingStandardQty: summary.pendingStandardQty + (pendingStandard ? pool.eligibleQty : 0),
      eligibleQty: summary.eligibleQty + pool.eligibleQty,
      claimedQty: summary.claimedQty + pool.claimedQty,
      remainingQty: summary.remainingQty + (claimable ? pool.remainingQty : 0),
      totalStandardLaborMilliseconds: summary.totalStandardLaborMilliseconds
        + safeLaborMilliseconds(pool.totalStandardLaborMilliseconds),
      claimedStandardLaborMilliseconds: summary.claimedStandardLaborMilliseconds
        + safeLaborMilliseconds(pool.claimedStandardLaborMilliseconds),
      remainingStandardLaborMilliseconds: summary.remainingStandardLaborMilliseconds
        + (claimable ? safeLaborMilliseconds(pool.remainingStandardLaborMilliseconds) : 0),
    };
  }, {
    poolCount: 0,
    openPoolCount: 0,
    pendingStandardPoolCount: 0,
    pendingStandardQty: 0,
    eligibleQty: 0,
    claimedQty: 0,
    remainingQty: 0,
    totalStandardLaborMilliseconds: 0,
    claimedStandardLaborMilliseconds: 0,
    remainingStandardLaborMilliseconds: 0,
  });
}

export async function listProcessLaborPools(input: {
  workDate: unknown;
  includeExhausted?: boolean;
  userId: string;
}): Promise<{
  workDate: string;
  pools: ProcessLaborPoolDTO[];
  employees: ReturnType<typeof serializeEmployee>[];
  summary: ProcessLaborPoolSummaryDTO;
  access: ProcessLaborAccessDTO;
}> {
  const workDate = (() => {
    try {
      return parseWorkDate(input.workDate);
    } catch {
      throw new ProcessLaborServiceError('请选择有效完成日期', 400, 'PROCESS_LABOR_WORK_DATE_INVALID');
    }
  })();
  const actor = await prisma.user.findUnique({
    where: { id: input.userId },
    select: laborActorSelect,
  });
  if (!actor?.isActive) missingLaborActor();
  const access = laborAccessProfile(authorizationActor(actor));
  const employeeScope = access.role === 'ADMIN'
    ? {}
    : access.role === 'TEAM_LEAD' && access.team
      ? { team: access.team }
      : access.role === 'EMPLOYEE' && access.selfEmployeeId
        ? { id: access.selfEmployeeId }
        : { id: { in: [] as string[] } };
  const [pools, employees] = await Promise.all([
    prisma.processLaborPool.findMany({
      where: {
        workDate: workDate.value,
        ...(input.includeExhausted
          ? { status: { not: ProcessLaborPoolStatus.VOIDED } }
          : {
              OR: [
                { status: { in: [ProcessLaborPoolStatus.OPEN, ProcessLaborPoolStatus.PARTIAL] } },
                {
                  status: ProcessLaborPoolStatus.LOCKED,
                  standardSource: 'pending_standard',
                },
              ],
            }),
      },
      include: processLaborPoolInclude,
      orderBy: [
        { remainingQty: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    }),
    prisma.employee.findMany({
      where: { isActive: true, ...employeeScope },
      orderBy: [{ employeeNo: 'asc' }],
    }),
  ]);
  return {
    workDate: workDate.key,
    pools: pools.map(pool => serializeProcessLaborPoolForAccess(pool, access)),
    employees: employees.map(serializeEmployee),
    summary: summarizePools(pools),
    access,
  };
}

export async function resolveProcessLaborPoolStandard(command: {
  poolId: string;
  expectedVersion: unknown;
  timeBasis: unknown;
  standardMillisecondsPerUnit: unknown;
  setupMilliseconds?: unknown;
  unitsPerProduct?: unknown;
  countsForEfficiency?: unknown;
  reason: unknown;
  userId: string;
}): Promise<{ pool: ProcessLaborPoolDTO }> {
  const poolId = cleanProcessText(command.poolId, 80);
  const expectedVersion = parseExpectedPoolVersion(command.expectedVersion);
  const timeBasis = command.timeBasis === 'per_unit' || command.timeBasis === 'per_batch'
    ? command.timeBasis
    : null;
  const standardMillisecondsPerUnit = Number(command.standardMillisecondsPerUnit);
  const setupMilliseconds = Number(command.setupMilliseconds ?? 0);
  const unitsPerProduct = Number(command.unitsPerProduct ?? 1);
  const reason = cleanProcessText(command.reason, 500);
  if (!poolId) throw new ProcessLaborServiceError('缺少工时池标识', 400, 'PROCESS_LABOR_POOL_REQUIRED');
  if (!timeBasis) {
    throw new ProcessLaborServiceError('请选择按件或按批工时口径', 400, 'PROCESS_LABOR_TIME_BASIS_INVALID');
  }
  if (!Number.isSafeInteger(standardMillisecondsPerUnit) || standardMillisecondsPerUnit <= 0) {
    throw new ProcessLaborServiceError('标准工时必须是大于 0 的整毫秒数', 400, 'PROCESS_LABOR_STANDARD_INVALID');
  }
  if (!Number.isSafeInteger(setupMilliseconds) || setupMilliseconds < 0) {
    throw new ProcessLaborServiceError('准备工时必须是非负整毫秒数', 400, 'PROCESS_LABOR_SETUP_INVALID');
  }
  if (!Number.isSafeInteger(unitsPerProduct) || unitsPerProduct <= 0) {
    throw new ProcessLaborServiceError('每产品工序次数必须是正整数', 400, 'PROCESS_LABOR_UNITS_INVALID');
  }
  if (reason.length < 2) {
    throw new ProcessLaborServiceError('补录标准必须填写原因', 400, 'PROCESS_LABOR_STANDARD_REASON_REQUIRED');
  }

  try {
    await prisma.$transaction(async tx => {
      const [actor, pool] = await Promise.all([
        tx.user.findUnique({
          where: { id: command.userId },
          select: laborActorSelect,
        }),
        tx.processLaborPool.findUnique({
          where: { id: poolId },
          include: {
            completion: true,
            step: {
              select: {
                routeId: true,
                status: true,
                inputQty: true,
                processedQty: true,
                route: {
                  select: {
                    status: true,
                    workOrder: {
                      select: { stage: true, status: true },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);
      if (!actor?.isActive) missingLaborActor();
      authorizeLaborStandardResolution(authorizationActor(actor));
      if (!pool) throw new ProcessLaborServiceError('工时池不存在', 404, 'PROCESS_LABOR_POOL_NOT_FOUND');
      if (pool.version !== expectedVersion) {
        throw new ProcessLaborServiceError('工时池已更新，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      if (
        pool.status !== ProcessLaborPoolStatus.LOCKED
        || pool.standardSource !== 'pending_standard'
        || pool.claimedQty !== 0
      ) {
        throw new ProcessLaborServiceError(
          '该工时池不处于待补标准状态',
          409,
          'PROCESS_LABOR_POOL_NOT_PENDING_STANDARD',
        );
      }
      if (timeBasis === 'per_batch') {
        const [completionCount, laborPoolCount] = await Promise.all([
          tx.processCompletion.count({
            where: { stepId: pool.stepId, voidedAt: null },
          }),
          tx.processLaborPool.count({
            where: {
              stepId: pool.stepId,
              status: { not: ProcessLaborPoolStatus.VOIDED },
            },
          }),
        ]);
        if (!pendingPerBatchResolutionIsSafe({
          routeStatus: pool.step.route.status,
          workOrderStage: pool.step.route.workOrder.stage,
          workOrderStatus: pool.step.route.workOrder.status,
          stepStatus: pool.step.status,
          inputQty: pool.step.inputQty,
          processedQty: pool.step.processedQty,
          completionCount,
          laborPoolCount,
        })) {
          throw new ProcessLaborServiceError(
            '该工序已分批完成或数量仍可能变化，不能事后改为按整批；请按件补录，或在产品工序与工时中发布按批标准后用于新工单',
            409,
            'PROCESS_LABOR_PER_BATCH_BACKFILL_UNSAFE',
          );
        }
      }
      const labor = (() => {
        try {
          return calculateCompletionLaborSnapshot({
            timeBasis,
            eligibleQty: pool.eligibleQty,
            standardMillisecondsPerUnit,
            setupMilliseconds,
            unitsPerProduct,
          });
        } catch (error) {
          if (error instanceof ProcessCompletionDomainError) {
            throw new ProcessLaborServiceError(error.message, 400, `PROCESS_LABOR_${error.code}`);
          }
          throw error;
        }
      })();
      const updated = await tx.processLaborPool.updateMany({
        where: {
          id: pool.id,
          version: expectedVersion,
          status: ProcessLaborPoolStatus.LOCKED,
          standardSource: 'pending_standard',
          claimedQty: 0,
        },
        data: {
          status: ProcessLaborPoolStatus.OPEN,
          version: { increment: 1 },
          standardMillisecondsPerUnit: labor.standardMillisecondsPerUnit,
          setupMilliseconds: labor.setupMilliseconds,
          unitsPerProduct: labor.unitsPerProduct,
          totalStandardLaborMilliseconds: labor.totalStandardLaborMilliseconds,
          claimedStandardLaborMilliseconds: 0n,
          remainingStandardLaborMilliseconds: labor.totalStandardLaborMilliseconds,
          countsForEfficiency: command.countsForEfficiency !== false,
          standardSource: 'manual_backfill',
          productTimeProfileVersion: null,
        },
      });
      if (updated.count !== 1) {
        throw new ProcessLaborServiceError('工时池已更新，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      await tx.processCompletion.update({
        where: { id: pool.completionId },
        data: {
          timeBasis,
          standardMillisecondsPerUnit: labor.standardMillisecondsPerUnit,
          setupMilliseconds: labor.setupMilliseconds,
          unitsPerProduct: labor.unitsPerProduct,
          countsForEfficiency: command.countsForEfficiency !== false,
          standardSource: 'manual_backfill',
          standardTimeId: null,
          standardVersion: null,
          productTimeProfileId: null,
          productTimeEntryId: null,
          productTimeProfileVersion: null,
        },
      });
      await tx.workOrderProcessStep.update({
        where: { id: pool.stepId },
        data: {
          timeBasis,
          standardMillisecondsPerUnit: labor.standardMillisecondsPerUnit,
          setupMilliseconds: labor.setupMilliseconds,
          unitsPerProduct: labor.unitsPerProduct,
          countsForEfficiency: command.countsForEfficiency !== false,
          standardSource: 'manual_backfill',
          standardTimeId: null,
          standardVersion: null,
          productTimeProfileId: null,
          productTimeEntryId: null,
          productTimeProfileVersion: null,
        },
      });
      await tx.workOrderProcessRoute.update({
        where: { id: pool.step.routeId },
        data: { version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: command.userId,
          action: 'resolve_process_labor_standard',
          targetType: 'process_labor_pool',
          targetId: pool.id,
          detail: {
            completionId: pool.completionId,
            workOrderId: pool.workOrderId,
            stepId: pool.stepId,
            timeBasis,
            standardMillisecondsPerUnit,
            setupMilliseconds,
            unitsPerProduct,
            countsForEfficiency: command.countsForEfficiency !== false,
            reason,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { pool: serializeProcessLaborPool(await loadPool(poolId)) };
  } catch (error) {
    throw normalizeTransactionError(error);
  }
}

type ClaimCommand = {
  poolId: string;
  employeeId: unknown;
  quantity: unknown;
  expectedVersion: unknown;
  idempotencyKey: unknown;
  userId: string;
};

function normalizeTransactionError(error: unknown): ProcessLaborServiceError {
  if (error instanceof ProcessLaborServiceError) return error;
  if (error instanceof LaborAuthorizationError) {
    return new ProcessLaborServiceError(error.message, error.status, error.code);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return new ProcessLaborServiceError(
      '工时池刚被其他人更新，请刷新后重试',
      409,
      'PROCESS_LABOR_VERSION_CONFLICT',
    );
  }
  return new ProcessLaborServiceError('工时领取操作失败', 500, 'PROCESS_LABOR_OPERATION_FAILED');
}

async function idempotentClaimResult(input: {
  claim: {
    id: string;
    poolId: string;
    employeeId: string;
    quantity: number;
    status: ProcessLaborClaimStatus;
    claimedById: string | null;
  };
  poolId: string;
  employeeId: string;
  quantity: number;
  userId: string;
}): Promise<{ claim: ProcessLaborClaimDTO; pool: ProcessLaborPoolDTO }> {
  if (input.claim.poolId !== input.poolId
    || input.claim.employeeId !== input.employeeId
    || input.claim.quantity !== input.quantity
    || input.claim.status !== ProcessLaborClaimStatus.ACTIVE
    || input.claim.claimedById !== input.userId) {
    throw new ProcessLaborServiceError(
      '请求标识已用于其他领取操作',
      409,
      'PROCESS_LABOR_IDEMPOTENCY_CONFLICT',
    );
  }
  const [claim, pool, access] = await Promise.all([
    loadClaim(input.claim.id),
    loadPool(input.poolId),
    loadLaborAccessProfileForUser(input.userId),
  ]);
  return {
    claim: serializeProcessLaborClaim(claim),
    pool: serializeProcessLaborPoolForAccess(pool, access),
  };
}

export async function claimProcessLaborPool(command: ClaimCommand): Promise<{
  claim: ProcessLaborClaimDTO;
  pool: ProcessLaborPoolDTO;
}> {
  const poolId = cleanProcessText(command.poolId, 80);
  const employeeId = cleanProcessText(command.employeeId, 80);
  const quantity = parseClaimQuantity(command.quantity);
  const expectedVersion = parseExpectedPoolVersion(command.expectedVersion);
  const idempotencyKey = parseIdempotencyKey(command.idempotencyKey);
  if (!poolId) throw new ProcessLaborServiceError('缺少工时池标识', 400, 'PROCESS_LABOR_POOL_REQUIRED');
  if (!employeeId) throw new ProcessLaborServiceError('请选择领取员工', 400, 'PROCESS_LABOR_EMPLOYEE_REQUIRED');

  try {
    const result = await prisma.$transaction(async tx => {
      const [actor, employee] = await Promise.all([
        tx.user.findUnique({
          where: { id: command.userId },
          select: laborActorSelect,
        }),
        tx.employee.findUnique({ where: { id: employeeId } }),
      ]);
      if (!actor?.isActive) missingLaborActor();
      if (!employee) {
        throw new ProcessLaborServiceError(
          '请选择有效员工',
          400,
          'PROCESS_LABOR_EMPLOYEE_REQUIRED',
        );
      }
      authorizeLaborClaim(authorizationActor(actor), employee);

      const duplicate = await tx.processLaborClaim.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          poolId: true,
          employeeId: true,
          quantity: true,
          status: true,
          claimedById: true,
        },
      });
      if (duplicate) return { kind: 'duplicate' as const, duplicate };

      const pool = await tx.processLaborPool.findUnique({ where: { id: poolId } });
      if (!pool) throw new ProcessLaborServiceError('工时池不存在', 404, 'PROCESS_LABOR_POOL_NOT_FOUND');
      if (pool.version !== expectedVersion) {
        throw new ProcessLaborServiceError('工时池已更新，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      if (
        pool.status === ProcessLaborPoolStatus.LOCKED
        && pool.standardSource === 'pending_standard'
      ) {
        throw new ProcessLaborServiceError(
          '该工时池尚未补录标准工时，暂不能领取',
          409,
          'PROCESS_LABOR_STANDARD_PENDING',
        );
      }
      if (pool.lockedAt
        || pool.status === ProcessLaborPoolStatus.LOCKED
        || pool.status === ProcessLaborPoolStatus.VOIDED) {
        throw new ProcessLaborServiceError('工时池已锁定或作废，不能继续领取', 409, 'PROCESS_LABOR_POOL_LOCKED');
      }
      if (pool.status === ProcessLaborPoolStatus.EXHAUSTED || pool.remainingQty <= 0) {
        throw new ProcessLaborServiceError('该工时池已领取完', 409, 'PROCESS_LABOR_POOL_EXHAUSTED');
      }
      const allocation = calculateClaimStandardLaborMilliseconds({
        eligibleQty: pool.eligibleQty,
        claimedQty: pool.claimedQty,
        requestedQty: quantity,
        totalStandardLaborMilliseconds: pool.totalStandardLaborMilliseconds,
        claimedStandardLaborMilliseconds: pool.claimedStandardLaborMilliseconds,
      });
      const claimedAfter = pool.claimedQty + quantity;
      const status = poolStatusAfterClaim(pool.eligibleQty, claimedAfter);
      const updated = await tx.processLaborPool.updateMany({
        where: {
          id: pool.id,
          version: expectedVersion,
          lockedAt: null,
          remainingQty: { gte: quantity },
          remainingStandardLaborMilliseconds: { gte: allocation },
          status: { in: [ProcessLaborPoolStatus.OPEN, ProcessLaborPoolStatus.PARTIAL] },
        },
        data: {
          claimedQty: { increment: quantity },
          remainingQty: { decrement: quantity },
          claimedStandardLaborMilliseconds: { increment: allocation },
          remainingStandardLaborMilliseconds: { decrement: allocation },
          status,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ProcessLaborServiceError('工时池刚被其他人领取，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      const claim = await tx.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: employee.id,
          quantity,
          standardLaborMilliseconds: allocation,
          workDate: pool.workDate,
          status: ProcessLaborClaimStatus.ACTIVE,
          idempotencyKey,
          claimedById: command.userId,
        },
        select: { id: true },
      });
      await tx.operationLog.create({
        data: {
          userId: command.userId,
          action: 'claim_process_labor',
          targetType: 'process_labor_pool',
          targetId: pool.id,
          detail: {
            claimId: claim.id,
            employeeId: employee.id,
            quantity,
            standardLaborMilliseconds: allocation.toString(),
          },
        },
      });
      return { kind: 'created' as const, claimId: claim.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result.kind === 'duplicate') {
      return idempotentClaimResult({
        claim: result.duplicate,
        poolId,
        employeeId,
        quantity,
        userId: command.userId,
      });
    }
    const [claim, pool, access] = await Promise.all([
      loadClaim(result.claimId),
      loadPool(poolId),
      loadLaborAccessProfileForUser(command.userId),
    ]);
    return {
      claim: serializeProcessLaborClaim(claim),
      pool: serializeProcessLaborPoolForAccess(pool, access),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')) {
      const duplicate = await prisma.processLaborClaim.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          poolId: true,
          employeeId: true,
          quantity: true,
          status: true,
          claimedById: true,
        },
      });
      if (duplicate) {
        return idempotentClaimResult({
          claim: duplicate,
          poolId,
          employeeId,
          quantity,
          userId: command.userId,
        });
      }
    }
    throw normalizeTransactionError(error);
  }
}

type VoidClaimCommand = {
  claimId: string;
  expectedPoolVersion: unknown;
  reason: unknown;
  idempotencyKey: unknown;
  userId: string;
};

export async function voidProcessLaborClaim(command: VoidClaimCommand): Promise<{
  claim: ProcessLaborClaimDTO;
  reversal: ProcessLaborClaimDTO;
  pool: ProcessLaborPoolDTO;
}> {
  const claimId = cleanProcessText(command.claimId, 80);
  const expectedPoolVersion = parseExpectedPoolVersion(command.expectedPoolVersion);
  const reason = cleanProcessText(command.reason, 500);
  const idempotencyKey = parseIdempotencyKey(command.idempotencyKey);
  if (!claimId) throw new ProcessLaborServiceError('缺少领取记录标识', 400, 'PROCESS_LABOR_CLAIM_REQUIRED');
  if (!reason) throw new ProcessLaborServiceError('冲销必须填写原因', 400, 'PROCESS_LABOR_VOID_REASON_REQUIRED');

  try {
    const result = await prisma.$transaction(async tx => {
      const [actor, claim] = await Promise.all([
        tx.user.findUnique({
          where: { id: command.userId },
          select: laborActorSelect,
        }),
        tx.processLaborClaim.findUnique({
          where: { id: claimId },
          include: {
            pool: true,
            employee: { select: { id: true, isActive: true, team: true } },
            reversal: { select: { id: true } },
          },
        }),
      ]);
      if (!actor?.isActive) missingLaborActor();
      if (!claim) throw new ProcessLaborServiceError('领取记录不存在', 404, 'PROCESS_LABOR_CLAIM_NOT_FOUND');
      authorizeLaborVoid(authorizationActor(actor), claim.employee);

      const duplicate = await tx.processLaborClaim.findUnique({
        where: { idempotencyKey },
        select: { id: true, reversalOfId: true, poolId: true, claimedById: true },
      });
      if (duplicate) {
        if (duplicate.reversalOfId !== claimId || duplicate.claimedById !== command.userId) {
          throw new ProcessLaborServiceError(
            '请求标识已用于其他冲销操作',
            409,
            'PROCESS_LABOR_IDEMPOTENCY_CONFLICT',
          );
        }
        return { originalId: claimId, reversalId: duplicate.id, poolId: duplicate.poolId };
      }

      if (claim.status === ProcessLaborClaimStatus.VOIDED && claim.reversal) {
        return { originalId: claim.id, reversalId: claim.reversal.id, poolId: claim.poolId };
      }
      if (claim.status !== ProcessLaborClaimStatus.ACTIVE
        || claim.quantity <= 0
        || claim.standardLaborMilliseconds <= 0n) {
        throw new ProcessLaborServiceError('该领取记录不能冲销', 409, 'PROCESS_LABOR_CLAIM_NOT_ACTIVE');
      }
      const pool = claim.pool;
      if (pool.version !== expectedPoolVersion) {
        throw new ProcessLaborServiceError('工时池已更新，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      if (pool.lockedAt
        || pool.status === ProcessLaborPoolStatus.LOCKED
        || pool.status === ProcessLaborPoolStatus.VOIDED) {
        throw new ProcessLaborServiceError('工时池已锁定或作废，不能冲销', 409, 'PROCESS_LABOR_POOL_LOCKED');
      }
      const claimedAfter = pool.claimedQty - claim.quantity;
      const standardAfter = pool.claimedStandardLaborMilliseconds - claim.standardLaborMilliseconds;
      if (claimedAfter < 0 || standardAfter < 0n) {
        throw new ProcessLaborServiceError('工时池累计数据不正确', 409, 'PROCESS_LABOR_POOL_INVALID');
      }
      const updated = await tx.processLaborPool.updateMany({
        where: {
          id: pool.id,
          version: expectedPoolVersion,
          lockedAt: null,
          claimedQty: { gte: claim.quantity },
          claimedStandardLaborMilliseconds: { gte: claim.standardLaborMilliseconds },
          status: { in: [ProcessLaborPoolStatus.PARTIAL, ProcessLaborPoolStatus.EXHAUSTED] },
        },
        data: {
          claimedQty: { decrement: claim.quantity },
          remainingQty: { increment: claim.quantity },
          claimedStandardLaborMilliseconds: { decrement: claim.standardLaborMilliseconds },
          remainingStandardLaborMilliseconds: { increment: claim.standardLaborMilliseconds },
          status: poolStatusAfterClaim(pool.eligibleQty, claimedAfter),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ProcessLaborServiceError('工时池刚被其他人更新，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      const now = new Date();
      const voided = await tx.processLaborClaim.updateMany({
        where: { id: claim.id, status: ProcessLaborClaimStatus.ACTIVE, voidedAt: null },
        data: {
          status: ProcessLaborClaimStatus.VOIDED,
          voidedAt: now,
          voidedById: command.userId,
          voidReason: reason,
        },
      });
      if (voided.count !== 1) {
        throw new ProcessLaborServiceError('领取记录刚被其他人冲销，请刷新后重试', 409, 'PROCESS_LABOR_VERSION_CONFLICT');
      }
      const reversal = await tx.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: claim.employeeId,
          quantity: -claim.quantity,
          standardLaborMilliseconds: -claim.standardLaborMilliseconds,
          workDate: claim.workDate,
          status: ProcessLaborClaimStatus.REVERSAL,
          idempotencyKey,
          claimedById: command.userId,
          claimedAt: now,
          reversalOfId: claim.id,
        },
        select: { id: true },
      });
      await tx.operationLog.create({
        data: {
          userId: command.userId,
          action: 'void_process_labor_claim',
          targetType: 'process_labor_claim',
          targetId: claim.id,
          detail: {
            reversalId: reversal.id,
            poolId: pool.id,
            employeeId: claim.employeeId,
            quantity: claim.quantity,
            standardLaborMilliseconds: claim.standardLaborMilliseconds.toString(),
            reason,
          },
        },
      });
      return { originalId: claim.id, reversalId: reversal.id, poolId: pool.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const [claim, reversal, pool, access] = await Promise.all([
      loadClaim(result.originalId),
      loadClaim(result.reversalId),
      loadPool(result.poolId),
      loadLaborAccessProfileForUser(command.userId),
    ]);
    return {
      claim: serializeProcessLaborClaim(claim),
      reversal: serializeProcessLaborClaim(reversal),
      pool: serializeProcessLaborPoolForAccess(pool, access),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')) {
      const reversal = await prisma.processLaborClaim.findFirst({
        where: {
          status: ProcessLaborClaimStatus.REVERSAL,
          OR: [{ idempotencyKey }, { reversalOfId: claimId }],
        },
        select: { id: true, reversalOfId: true, poolId: true, claimedById: true },
      });
      if (reversal?.reversalOfId === claimId && reversal.claimedById === command.userId) {
        const [claim, reversalRecord, pool, access] = await Promise.all([
          loadClaim(claimId),
          loadClaim(reversal.id),
          loadPool(reversal.poolId),
          loadLaborAccessProfileForUser(command.userId),
        ]);
        return {
          claim: serializeProcessLaborClaim(claim),
          reversal: serializeProcessLaborClaim(reversalRecord),
          pool: serializeProcessLaborPoolForAccess(pool, access),
        };
      }
      if (error.code === 'P2002') {
        throw new ProcessLaborServiceError(
          '请求标识已用于其他冲销操作',
          409,
          'PROCESS_LABOR_IDEMPOTENCY_CONFLICT',
        );
      }
    }
    throw normalizeTransactionError(error);
  }
}
