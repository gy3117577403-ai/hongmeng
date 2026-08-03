import {
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
} from '@prisma/client';
import { calculateCompletionLaborSnapshot } from '@/lib/process-completion-domain';
import { ProcessCompletionWithdrawalError } from '@/lib/process-completion-withdrawal-service';
import { calculateClaimStandardLaborMilliseconds } from '@/lib/process-labor-service';
import { prisma } from '@/lib/prisma';

export type CorrectProcessCompletionStandardCommand = {
  routeId: string;
  completionId: string;
  expectedRouteVersion: unknown;
  processName: unknown;
  standardMillisecondsPerUnit: unknown;
  reason: unknown;
  idempotencyKey: unknown;
  userId: string;
  actor: string;
};

export type CorrectProcessCompletionStandardResult = {
  completionId: string;
  routeVersion: number;
  processName: string;
  standardMillisecondsPerUnit: number;
  laborPoolId: string | null;
  replacedClaimCount: number;
  affectedEmployeeNames: string[];
};

const correctionInclude = Prisma.validator<Prisma.ProcessCompletionInclude>()({
  step: true,
  route: { include: { workOrder: true } },
  laborPool: {
    include: {
      claims: {
        where: { status: ProcessLaborClaimStatus.ACTIVE, quantity: { gt: 0 } },
        include: { employee: { select: { name: true } } },
        orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
      },
    },
  },
});

type CorrectionState = Prisma.ProcessCompletionGetPayload<{ include: typeof correctionInclude }>;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positiveMilliseconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 72 * 60 * 60 * 1000) {
    throw new ProcessCompletionWithdrawalError(
      '单位标准工时必须是 1 毫秒至 72 小时之间的整数',
      400,
      'PROCESS_COMPLETION_STANDARD_TIME_INVALID',
    );
  }
  return parsed;
}

function routeVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProcessCompletionWithdrawalError(
      '工艺路线版本不正确，请刷新后重试',
      400,
      'PROCESS_ROUTE_VERSION_INVALID',
    );
  }
  return parsed;
}

function idempotencyKey(value: unknown): string {
  const parsed = clean(value, 120);
  if (parsed.length < 8) {
    throw new ProcessCompletionWithdrawalError(
      '请求标识无效，请重新提交',
      400,
      'PROCESS_COMPLETION_CORRECTION_IDEMPOTENCY_INVALID',
    );
  }
  return parsed;
}

function poolStatus(eligibleQty: number, claimedQty: number): ProcessLaborPoolStatus {
  if (claimedQty <= 0) return ProcessLaborPoolStatus.OPEN;
  if (claimedQty >= eligibleQty) return ProcessLaborPoolStatus.EXHAUSTED;
  return ProcessLaborPoolStatus.PARTIAL;
}

function replayResult(detail: Prisma.JsonValue | null): CorrectProcessCompletionStandardResult | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const value = detail as Record<string, unknown>;
  if (
    typeof value.completionId !== 'string'
    || typeof value.processName !== 'string'
    || !Number.isSafeInteger(Number(value.routeVersion))
    || !Number.isSafeInteger(Number(value.standardMillisecondsPerUnit))
  ) return null;
  const names = Array.isArray(value.affectedEmployeeNames)
    ? value.affectedEmployeeNames.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    completionId: value.completionId,
    routeVersion: Number(value.routeVersion),
    processName: value.processName,
    standardMillisecondsPerUnit: Number(value.standardMillisecondsPerUnit),
    laborPoolId: typeof value.laborPoolId === 'string' ? value.laborPoolId : null,
    replacedClaimCount: Number(value.replacedClaimCount || 0),
    affectedEmployeeNames: names,
  };
}

async function loadCorrectionState(
  tx: Prisma.TransactionClient,
  routeId: string,
  completionId: string,
): Promise<CorrectionState> {
  const state = await tx.processCompletion.findFirst({
    where: { id: completionId, routeId },
    include: correctionInclude,
  });
  if (!state) {
    throw new ProcessCompletionWithdrawalError(
      '完工记录不存在或不属于当前路线',
      404,
      'PROCESS_COMPLETION_NOT_FOUND',
    );
  }
  if (state.voidedAt) {
    throw new ProcessCompletionWithdrawalError(
      '已撤回的完工记录不能再校正工序或工时',
      409,
      'PROCESS_COMPLETION_ALREADY_WITHDRAWN',
    );
  }
  return state;
}

export async function correctProcessCompletionStandard(
  command: CorrectProcessCompletionStandardCommand,
): Promise<CorrectProcessCompletionStandardResult> {
  const parsed = {
    routeId: clean(command.routeId, 80),
    completionId: clean(command.completionId, 80),
    expectedRouteVersion: routeVersion(command.expectedRouteVersion),
    processName: clean(command.processName, 80),
    standardMillisecondsPerUnit: positiveMilliseconds(command.standardMillisecondsPerUnit),
    reason: clean(command.reason, 500),
    idempotencyKey: idempotencyKey(command.idempotencyKey),
  };
  if (!parsed.routeId || !parsed.completionId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少路线或完工记录标识',
      400,
      'PROCESS_COMPLETION_CORRECTION_TARGET_REQUIRED',
    );
  }
  if (parsed.processName.length < 2) {
    throw new ProcessCompletionWithdrawalError(
      '工序名称至少填写 2 个字符',
      400,
      'PROCESS_COMPLETION_PROCESS_NAME_REQUIRED',
    );
  }
  if (parsed.reason.length < 4) {
    throw new ProcessCompletionWithdrawalError(
      '校正原因至少填写 4 个字符',
      400,
      'PROCESS_COMPLETION_CORRECTION_REASON_REQUIRED',
    );
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-completion-correction:${parsed.completionId}`}))`;
        const duplicate = await tx.processRouteActivity.findFirst({
          where: {
            routeId: parsed.routeId,
            action: 'correct_process_completion_standard',
            detail: { path: ['idempotencyKey'], equals: parsed.idempotencyKey },
          },
          select: { detail: true },
          orderBy: { createdAt: 'desc' },
        });
        if (duplicate) {
          const replay = replayResult(duplicate.detail);
          if (!replay || replay.completionId !== parsed.completionId) {
            throw new ProcessCompletionWithdrawalError(
              '请求标识已用于其他校正操作',
              409,
              'PROCESS_COMPLETION_CORRECTION_IDEMPOTENCY_CONFLICT',
            );
          }
          return replay;
        }

        const state = await loadCorrectionState(tx, parsed.routeId, parsed.completionId);
        if (state.route.version !== parsed.expectedRouteVersion) {
          throw new ProcessCompletionWithdrawalError(
            '工艺路线已更新，请刷新后重试',
            409,
            'PROCESS_ROUTE_VERSION_CONFLICT',
          );
        }
        if (!state.timeBasis || (state.timeBasis !== 'per_unit' && state.timeBasis !== 'per_batch')) {
          throw new ProcessCompletionWithdrawalError(
            '本次完工缺少有效计时方式，无法自动校正',
            409,
            'PROCESS_COMPLETION_TIME_BASIS_MISSING',
          );
        }
        if (state.laborPool?.status === ProcessLaborPoolStatus.VOIDED) {
          throw new ProcessCompletionWithdrawalError(
            '关联工时池已作废，不能再校正',
            409,
            'PROCESS_COMPLETION_LABOR_POOL_VOIDED',
          );
        }

        const now = new Date();
        const before = {
          processName: state.step.processName,
          standardMillisecondsPerUnit: state.standardMillisecondsPerUnit,
          standardSource: state.standardSource,
          routeVersion: state.route.version,
        };
        await tx.workOrderProcessStep.update({
          where: { id: state.stepId },
          data: {
            processName: parsed.processName,
            standardMillisecondsPerUnit: parsed.standardMillisecondsPerUnit,
            standardSource: 'supervisor_correction',
            quantityVersion: { increment: 1 },
          },
        });
        await tx.processCompletion.update({
          where: { id: state.id },
          data: {
            standardMillisecondsPerUnit: parsed.standardMillisecondsPerUnit,
            standardSource: 'supervisor_correction',
          },
        });

        let replacedClaimCount = 0;
        let affectedEmployeeNames: string[] = [];
        if (state.laborPool) {
          const snapshot = calculateCompletionLaborSnapshot({
            timeBasis: state.timeBasis,
            eligibleQty: state.laborPool.eligibleQty,
            standardMillisecondsPerUnit: parsed.standardMillisecondsPerUnit,
            setupMilliseconds: state.laborPool.setupMilliseconds,
            unitsPerProduct: state.laborPool.unitsPerProduct,
          });
          let claimedQty = 0;
          let claimedLabor = 0n;
          const replacements: Array<{
            claim: (typeof state.laborPool.claims)[number];
            standardLaborMilliseconds: bigint;
          }> = [];
          for (const claim of state.laborPool.claims) {
            const standardLaborMilliseconds = calculateClaimStandardLaborMilliseconds({
              eligibleQty: state.laborPool.eligibleQty,
              claimedQty,
              requestedQty: claim.quantity,
              totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
              claimedStandardLaborMilliseconds: claimedLabor,
            });
            claimedQty += claim.quantity;
            claimedLabor += standardLaborMilliseconds;
            replacements.push({ claim, standardLaborMilliseconds });
          }
          for (const [index, replacement] of replacements.entries()) {
            const { claim } = replacement;
            await tx.processLaborClaim.update({
              where: { id: claim.id },
              data: {
                status: ProcessLaborClaimStatus.VOIDED,
                voidedAt: now,
                voidedById: command.userId,
                voidReason: parsed.reason,
              },
            });
            await tx.processLaborClaim.create({
              data: {
                poolId: claim.poolId,
                employeeId: claim.employeeId,
                quantity: -claim.quantity,
                standardLaborMilliseconds: -claim.standardLaborMilliseconds,
                workDate: claim.workDate,
                status: ProcessLaborClaimStatus.REVERSAL,
                idempotencyKey: `${parsed.idempotencyKey}:reverse:${index}`.slice(0, 120),
                claimedById: command.userId,
                claimedAt: now,
                reversalOfId: claim.id,
              },
            });
            await tx.processLaborClaim.create({
              data: {
                poolId: claim.poolId,
                employeeId: claim.employeeId,
                quantity: claim.quantity,
                standardLaborMilliseconds: replacement.standardLaborMilliseconds,
                workDate: claim.workDate,
                status: ProcessLaborClaimStatus.ACTIVE,
                idempotencyKey: `${parsed.idempotencyKey}:replace:${index}`.slice(0, 120),
                claimedById: command.userId,
                claimedAt: now,
              },
            });
          }
          await tx.processLaborPool.update({
            where: { id: state.laborPool.id },
            data: {
              status: poolStatus(state.laborPool.eligibleQty, claimedQty),
              claimedQty,
              remainingQty: state.laborPool.eligibleQty - claimedQty,
              standardMillisecondsPerUnit: parsed.standardMillisecondsPerUnit,
              totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
              claimedStandardLaborMilliseconds: claimedLabor,
              remainingStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds - claimedLabor,
              standardSource: 'supervisor_correction',
              version: { increment: 1 },
              lockedAt: null,
            },
          });
          replacedClaimCount = replacements.length;
          affectedEmployeeNames = [...new Set(replacements.map(item => item.claim.employee.name))];
        }

        await tx.dailyProcessTask.updateMany({
          where: { stepId: state.stepId },
          data: {
            processName: parsed.processName,
            standardMillisecondsPerUnit: parsed.standardMillisecondsPerUnit,
            standardSource: 'supervisor_correction',
            version: { increment: 1 },
          },
        });
        const routeUpdate = await tx.workOrderProcessRoute.updateMany({
          where: { id: state.routeId, version: state.route.version },
          data: { version: { increment: 1 } },
        });
        if (routeUpdate.count !== 1) {
          throw new ProcessCompletionWithdrawalError(
            '工艺路线已更新，请刷新后重试',
            409,
            'PROCESS_ROUTE_VERSION_CONFLICT',
          );
        }
        const result: CorrectProcessCompletionStandardResult = {
          completionId: state.id,
          routeVersion: state.route.version + 1,
          processName: parsed.processName,
          standardMillisecondsPerUnit: parsed.standardMillisecondsPerUnit,
          laborPoolId: state.laborPool?.id || null,
          replacedClaimCount,
          affectedEmployeeNames,
        };
        await tx.processRouteActivity.create({
          data: {
            routeId: state.routeId,
            stepId: state.stepId,
            action: 'correct_process_completion_standard',
            content: `${before.processName}校正为${parsed.processName}，标准工时已同步员工报表`,
            actorId: command.userId,
            detail: {
              ...result,
              idempotencyKey: parsed.idempotencyKey,
              reason: parsed.reason,
              before,
            },
          },
        });
        await tx.operationLog.create({
          data: {
            userId: command.userId,
            action: 'correct_process_completion_standard',
            targetType: 'process_completion',
            targetId: state.id,
            detail: {
              workOrderId: state.workOrderId,
              routeId: state.routeId,
              stepId: state.stepId,
              reason: parsed.reason,
              before,
              after: result,
            },
          },
        });
        return result;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (
        attempt === 0
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) continue;
      throw error;
    }
  }
  throw new ProcessCompletionWithdrawalError(
    '校正事务发生并发冲突，请刷新后重试',
    409,
    'PROCESS_COMPLETION_CORRECTION_CONFLICT',
  );
}
