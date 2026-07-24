export type AuditSeverity = 'error' | 'warning';

export type ProductionClosureAuditFinding = {
  severity: AuditSeverity;
  domain: 'reference' | 'quantity' | 'route' | 'branch' | 'labor';
  code: string;
  entityType: 'work_order' | 'route' | 'step' | 'completion' | 'movement' | 'labor_pool' | 'labor_claim';
  entityId: string;
  workOrderCode?: string;
  message: string;
  detail?: Record<string, string | number | boolean | null>;
};

export type AuditStep = {
  id: string;
  routeId: string;
  processName: string;
  position: number;
  sequenceGroup: number;
  status: string;
  inputQty: number;
  processedQty: number;
  goodOutputQty: number;
  defectOutputQty: number;
  releasedGoodQty: number;
  timeBasis: string | null;
};

export type AuditRoute = {
  id: string;
  workOrderId: string;
  status: string;
  completedAt: string | null;
  steps: AuditStep[];
};

export type AuditWorkOrder = {
  id: string;
  code: string;
  targetQty: number | null;
  completedQty: number | null;
  frontendTransferredQty: number | null;
  stage: string;
  status: string;
  parentWorkOrderId: string | null;
  rootWorkOrderId: string | null;
  branchType: string | null;
  branchStatus: string | null;
  originCompletionId: string | null;
  originStepId: string | null;
  rejoinStepId: string | null;
  branchSequence: number | null;
  completedAt: string | null;
  route: AuditRoute | null;
};

export type AuditCompletion = {
  id: string;
  workOrderId: string;
  routeId: string;
  stepId: string;
  workDate: string;
  processedQty: number;
  goodQty: number;
  defectQty: number;
  defectDisposition: string | null;
  routeVersion: number;
  timeBasis: string | null;
  voidedAt: string | null;
};

export type AuditMovement = {
  id: string;
  completionId: string;
  workOrderId: string;
  sourceStepId: string;
  targetStepId: string | null;
  branchWorkOrderId: string | null;
  type: string;
  quantity: number;
  sourceSequenceGroup: number;
  targetSequenceGroup: number | null;
  voidedAt: string | null;
};

export type AuditLaborClaim = {
  id: string;
  poolId: string;
  employeeId: string;
  quantity: number;
  standardLaborMilliseconds: bigint;
  workDate: string;
  status: string;
  voidedAt: string | null;
  reversalOfId: string | null;
};

export type AuditLaborPool = {
  id: string;
  completionId: string;
  workOrderId: string;
  stepId: string;
  workDate: string;
  eligibleQty: number;
  claimedQty: number;
  remainingQty: number;
  status: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
  totalStandardLaborMilliseconds: bigint;
  claimedStandardLaborMilliseconds: bigint;
  remainingStandardLaborMilliseconds: bigint;
  standardSource: string;
  claims: AuditLaborClaim[];
};

export type ProductionClosureAuditSnapshot = {
  workOrders: AuditWorkOrder[];
  completions: AuditCompletion[];
  movements: AuditMovement[];
  laborPools: AuditLaborPool[];
};

export type ProductionClosureAuditResult = {
  generatedAt: string;
  mode: 'READ_ONLY';
  passed: boolean;
  counts: {
    workOrders: number;
    routes: number;
    steps: number;
    completions: number;
    movements: number;
    laborPools: number;
    laborClaims: number;
    errors: number;
    warnings: number;
  };
  findings: ProductionClosureAuditFinding[];
};

const CLOSED_STEP_STATUSES = new Set(['completed', 'skipped']);
const CLOSED_BRANCH_STATUSES = new Set(['RESOLVED', 'CANCELLED']);
const BRANCH_MOVEMENT_BY_DISPOSITION: Record<string, string> = {
  REWORK: 'REWORK_SPLIT',
  SCRAP_REPLENISH: 'SCRAP_REPLENISH_SPLIT',
  QUALITY_PENDING: 'QUALITY_HOLD',
};
const BRANCH_TYPE_BY_DISPOSITION: Record<string, string> = {
  REWORK: 'REWORK',
  SCRAP_REPLENISH: 'SCRAP_REPLENISH',
  QUALITY_PENDING: 'QUALITY_PENDING',
};
const INPUT_MOVEMENT_TYPES = new Set([
  'GOOD_TRANSFER',
  'REWORK_SPLIT',
  'SCRAP_REPLENISH_SPLIT',
  'QUALITY_HOLD',
]);
const RELEASE_MOVEMENT_TYPES = new Set([
  'GOOD_TRANSFER',
  'FINISHED_GOOD',
  'REWORK_RETURN',
]);

function sameDay(left: string, right: string): boolean {
  return left.slice(0, 10) === right.slice(0, 10);
}

function isNonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function detailNumber(value: bigint): string {
  return value.toString();
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function sumBigInts(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

function expectedPoolStatus(eligibleQty: number, claimedQty: number): 'OPEN' | 'PARTIAL' | 'EXHAUSTED' {
  if (claimedQty <= 0) return 'OPEN';
  return claimedQty >= eligibleQty ? 'EXHAUSTED' : 'PARTIAL';
}

function expectedPoolLabor(pool: AuditLaborPool, completion: AuditCompletion): bigint | null {
  if (
    completion.timeBasis !== 'per_unit'
    && completion.timeBasis !== 'per_batch'
  ) return null;
  if (
    pool.eligibleQty <= 0
    || pool.standardMillisecondsPerUnit <= 0
    || pool.unitsPerProduct <= 0
    || pool.setupMilliseconds < 0
  ) return null;
  const variable = completion.timeBasis === 'per_batch'
    ? BigInt(pool.standardMillisecondsPerUnit)
    : BigInt(pool.standardMillisecondsPerUnit)
      * BigInt(pool.eligibleQty)
      * BigInt(pool.unitsPerProduct);
  return BigInt(pool.setupMilliseconds) + variable;
}

export function auditProductionClosure(
  snapshot: ProductionClosureAuditSnapshot,
  generatedAt = new Date().toISOString(),
): ProductionClosureAuditResult {
  const findings: ProductionClosureAuditFinding[] = [];
  const findingKeys = new Set<string>();
  const workOrdersById = new Map(snapshot.workOrders.map(order => [order.id, order]));
  const routes = snapshot.workOrders.flatMap(order => order.route ? [order.route] : []);
  const steps = routes.flatMap(route => route.steps);
  const routesById = new Map(routes.map(route => [route.id, route]));
  const stepsById = new Map(steps.map(step => [step.id, step]));
  const completionsById = new Map(snapshot.completions.map(completion => [completion.id, completion]));
  const activeCompletions = snapshot.completions.filter(completion => !completion.voidedAt);
  const activeMovements = snapshot.movements.filter(movement => !movement.voidedAt);
  const branchByOriginCompletionId = new Map<string, AuditWorkOrder>();

  function add(
    finding: Omit<ProductionClosureAuditFinding, 'workOrderCode'> & { workOrderId?: string | null },
  ) {
    const key = `${finding.code}:${finding.entityType}:${finding.entityId}:${JSON.stringify(finding.detail || {})}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    const order = finding.workOrderId ? workOrdersById.get(finding.workOrderId) : undefined;
    findings.push({
      severity: finding.severity,
      domain: finding.domain,
      code: finding.code,
      entityType: finding.entityType,
      entityId: finding.entityId,
      ...(order?.code ? { workOrderCode: order.code } : {}),
      message: finding.message,
      ...(finding.detail ? { detail: finding.detail } : {}),
    });
  }

  for (const order of snapshot.workOrders) {
    if (order.originCompletionId) {
      const duplicate = branchByOriginCompletionId.get(order.originCompletionId);
      if (duplicate) {
        add({
          severity: 'error',
          domain: 'branch',
          code: 'BRANCH_ORIGIN_DUPLICATED',
          entityType: 'work_order',
          entityId: order.id,
          workOrderId: order.id,
          message: '同一工序完成记录关联了多个分支工单',
          detail: { originCompletionId: order.originCompletionId, duplicateWorkOrderId: duplicate.id },
        });
      } else {
        branchByOriginCompletionId.set(order.originCompletionId, order);
      }
    }
  }

  const childrenByParentId = new Map<string, AuditWorkOrder[]>();
  for (const order of snapshot.workOrders) {
    if (!order.parentWorkOrderId) continue;
    const children = childrenByParentId.get(order.parentWorkOrderId) || [];
    children.push(order);
    childrenByParentId.set(order.parentWorkOrderId, children);
  }

  function hasActiveDescendant(orderId: string): boolean {
    const visited = new Set<string>();
    const frontier = [...(childrenByParentId.get(orderId) || [])];
    while (frontier.length) {
      const child = frontier.shift();
      if (!child) continue;
      if (visited.has(child.id)) return true;
      visited.add(child.id);
      if (!CLOSED_BRANCH_STATUSES.has(child.branchStatus || '')) return true;
      frontier.push(...(childrenByParentId.get(child.id) || []));
    }
    return false;
  }

  for (const order of snapshot.workOrders) {
    if (!Number.isSafeInteger(order.targetQty) || (order.targetQty || 0) <= 0) {
      add({
        severity: 'warning',
        domain: 'quantity',
        code: 'WORK_ORDER_TARGET_INVALID',
        entityType: 'work_order',
        entityId: order.id,
        workOrderId: order.id,
        message: '工单缺少有效的正整数生产目标，无法完成数量闭环校验',
        detail: { targetQty: order.targetQty },
      });
    }
    if (order.completedQty === null || !isNonnegativeSafeInteger(order.completedQty)) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'WORK_ORDER_COMPLETED_QTY_INVALID',
        entityType: 'work_order',
        entityId: order.id,
        workOrderId: order.id,
        message: '工单累计完成数量不是非负整数',
        detail: { completedQty: order.completedQty },
      });
    }
    if (
      order.targetQty !== null
      && order.completedQty !== null
      && order.completedQty > order.targetQty
    ) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'WORK_ORDER_COMPLETED_EXCEEDS_TARGET',
        entityType: 'work_order',
        entityId: order.id,
        workOrderId: order.id,
        message: '工单累计完成数量超过生产目标',
        detail: { targetQty: order.targetQty, completedQty: order.completedQty },
      });
    }
    if (
      order.frontendTransferredQty !== null
      && (
        !isNonnegativeSafeInteger(order.frontendTransferredQty)
        || (order.targetQty !== null && order.frontendTransferredQty > order.targetQty)
        || (order.completedQty !== null && order.frontendTransferredQty < order.completedQty)
      )
    ) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'WORK_ORDER_FLOW_QUANTITY_INVALID',
        entityType: 'work_order',
        entityId: order.id,
        workOrderId: order.id,
        message: '工单前后段流转数量不满足 完成数量 ≤ 已转序数量 ≤ 生产目标',
        detail: {
          targetQty: order.targetQty,
          frontendTransferredQty: order.frontendTransferredQty,
          completedQty: order.completedQty,
        },
      });
    }
    if (order.stage === 'completed' || order.status === 'done') {
      const routeClosed = !order.route || order.route.status === 'completed';
      const quantityClosed = order.targetQty !== null && order.completedQty === order.targetQty;
      if (!routeClosed || !quantityClosed || hasActiveDescendant(order.id) || !order.completedAt) {
        add({
          severity: 'error',
          domain: 'route',
          code: 'WORK_ORDER_COMPLETION_STATE_INVALID',
          entityType: 'work_order',
          entityId: order.id,
          workOrderId: order.id,
          message: '工单标记完成，但路线、数量、分支或完成时间尚未闭环',
          detail: {
            routeClosed,
            quantityClosed,
            hasActiveDescendant: hasActiveDescendant(order.id),
            hasCompletedAt: Boolean(order.completedAt),
          },
        });
      }
    }
  }

  for (const route of routes) {
    const order = workOrdersById.get(route.workOrderId);
    if (!order || order.route?.id !== route.id) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'ROUTE_WORK_ORDER_REFERENCE_INVALID',
        entityType: 'route',
        entityId: route.id,
        workOrderId: route.workOrderId,
        message: '工艺路线与工单引用不一致',
      });
    }
    const allStepsClosed = route.steps.every(step => CLOSED_STEP_STATUSES.has(step.status));
    if (
      (route.status === 'completed' && (!allStepsClosed || !route.completedAt))
      || (route.status !== 'completed' && Boolean(route.completedAt))
    ) {
      add({
        severity: 'error',
        domain: 'route',
        code: 'ROUTE_COMPLETION_STATE_INVALID',
        entityType: 'route',
        entityId: route.id,
        workOrderId: route.workOrderId,
        message: '工艺路线状态与工序状态或完成时间不一致',
        detail: {
          routeStatus: route.status,
          allStepsClosed,
          hasCompletedAt: Boolean(route.completedAt),
        },
      });
    }

    const groups = new Map<number, AuditStep[]>();
    for (const step of route.steps) {
      const group = groups.get(step.sequenceGroup) || [];
      group.push(step);
      groups.set(step.sequenceGroup, group);
    }
    for (const [sequenceGroup, groupSteps] of groups) {
      const releases = new Set(groupSteps.map(step => step.releasedGoodQty));
      if (releases.size > 1) {
        add({
          severity: 'error',
          domain: 'quantity',
          code: 'PARALLEL_GROUP_RELEASE_MISMATCH',
          entityType: 'route',
          entityId: route.id,
          workOrderId: route.workOrderId,
          message: '同一并行工序组的已释放良品数量不一致',
          detail: { sequenceGroup, releases: [...releases].join(',') },
        });
      }
      const releasedQty = groupSteps[0]?.releasedGoodQty || 0;
      const releasableMaximum = Math.min(...groupSteps.map(step => step.goodOutputQty));
      if (releasedQty > releasableMaximum) {
        add({
          severity: 'error',
          domain: 'quantity',
          code: 'PARALLEL_GROUP_RELEASE_EXCEEDS_GOOD',
          entityType: 'route',
          entityId: route.id,
          workOrderId: route.workOrderId,
          message: '并行工序组释放数量超过共同可释放的良品数量',
          detail: { sequenceGroup, releasedQty, releasableMaximum },
        });
      }

      const groupStepIds = new Set(groupSteps.map(step => step.id));
      const movementReleaseByCompletion = new Map<string, number>();
      for (const movement of activeMovements) {
        if (!groupStepIds.has(movement.sourceStepId) || !RELEASE_MOVEMENT_TYPES.has(movement.type)) continue;
        movementReleaseByCompletion.set(
          movement.completionId,
          Math.max(movementReleaseByCompletion.get(movement.completionId) || 0, movement.quantity),
        );
      }
      const movementReleasedQty = sumNumbers([...movementReleaseByCompletion.values()]);
      if (releasedQty !== movementReleasedQty) {
        add({
          severity: 'error',
          domain: 'quantity',
          code: 'STEP_RELEASE_MOVEMENT_MISMATCH',
          entityType: 'route',
          entityId: route.id,
          workOrderId: route.workOrderId,
          message: '工序组累计释放数量与有效数量移动记录不一致',
          detail: { sequenceGroup, releasedQty, movementReleasedQty },
        });
      }
    }
  }

  const activeCompletionsByStepId = new Map<string, AuditCompletion[]>();
  for (const completion of activeCompletions) {
    const records = activeCompletionsByStepId.get(completion.stepId) || [];
    records.push(completion);
    activeCompletionsByStepId.set(completion.stepId, records);
  }
  const activeReworkReturnsByTargetStepId = new Map<string, number>();
  const activeInputMovementsByTargetStepId = new Map<string, number>();
  for (const movement of activeMovements) {
    if (movement.type === 'REWORK_RETURN' && movement.targetStepId) {
      activeReworkReturnsByTargetStepId.set(
        movement.targetStepId,
        (activeReworkReturnsByTargetStepId.get(movement.targetStepId) || 0) + movement.quantity,
      );
    }
    if (movement.targetStepId && INPUT_MOVEMENT_TYPES.has(movement.type)) {
      activeInputMovementsByTargetStepId.set(
        movement.targetStepId,
        (activeInputMovementsByTargetStepId.get(movement.targetStepId) || 0) + movement.quantity,
      );
    }
  }

  for (const step of steps) {
    const route = routesById.get(step.routeId);
    const order = route ? workOrdersById.get(route.workOrderId) : undefined;
    const workOrderId = route?.workOrderId;
    if (!route || !order) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'STEP_ROUTE_REFERENCE_INVALID',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序与工艺路线引用不一致',
      });
      continue;
    }
    const quantities = [
      step.inputQty,
      step.processedQty,
      step.goodOutputQty,
      step.defectOutputQty,
      step.releasedGoodQty,
    ];
    if (quantities.some(value => !isNonnegativeSafeInteger(value))) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_QUANTITY_INVALID',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序存在负数或非整数数量',
      });
    }
    if (step.processedQty !== step.goodOutputQty + step.defectOutputQty) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_QUANTITY_EQUATION_MISMATCH',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序数量不满足 已处理 = 良品 + 不良品',
        detail: {
          processedQty: step.processedQty,
          goodOutputQty: step.goodOutputQty,
          defectOutputQty: step.defectOutputQty,
        },
      });
    }
    if (step.processedQty > step.inputQty) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_PROCESSED_EXCEEDS_INPUT',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序已处理数量超过投入数量',
        detail: { inputQty: step.inputQty, processedQty: step.processedQty },
      });
    }
    if (step.releasedGoodQty > step.goodOutputQty) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_RELEASED_EXCEEDS_GOOD',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序已释放良品数量超过累计良品数量',
        detail: { releasedGoodQty: step.releasedGoodQty, goodOutputQty: step.goodOutputQty },
      });
    }
    if (
      (step.status === 'completed' && (step.inputQty <= 0 || step.processedQty < step.inputQty))
      || (step.status === 'skipped' && step.inputQty !== 0)
    ) {
      add({
        severity: 'error',
        domain: 'route',
        code: 'STEP_COMPLETION_STATE_INVALID',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序完成/跳过状态与投入、处理数量不一致',
        detail: { status: step.status, inputQty: step.inputQty, processedQty: step.processedQty },
      });
    }

    const directCompletions = activeCompletionsByStepId.get(step.id) || [];
    const directProcessedQty = sumNumbers(directCompletions.map(completion => completion.processedQty));
    const directGoodQty = sumNumbers(directCompletions.map(completion => completion.goodQty));
    const directDefectQty = sumNumbers(directCompletions.map(completion => completion.defectQty));
    const returnedQty = activeReworkReturnsByTargetStepId.get(step.id) || 0;
    if (step.processedQty !== directProcessedQty) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_COMPLETION_AGGREGATE_MISMATCH',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序累计处理数量与有效完成记录合计不一致',
        detail: { processedQty: step.processedQty, completionProcessedQty: directProcessedQty },
      });
    }
    if (
      step.goodOutputQty !== directGoodQty + returnedQty
      || step.defectOutputQty !== directDefectQty - returnedQty
    ) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_OUTPUT_AGGREGATE_MISMATCH',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序良品/不良品累计与完成记录及返工回流不一致',
        detail: {
          goodOutputQty: step.goodOutputQty,
          expectedGoodOutputQty: directGoodQty + returnedQty,
          defectOutputQty: step.defectOutputQty,
          expectedDefectOutputQty: directDefectQty - returnedQty,
        },
      });
    }

    const firstSequenceGroup = Math.min(...route.steps.map(candidate => candidate.sequenceGroup));
    const expectedInputQty = step.sequenceGroup === firstSequenceGroup
      ? order.targetQty
      : activeInputMovementsByTargetStepId.get(step.id) || 0;
    if (expectedInputQty !== null && step.inputQty !== expectedInputQty) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'STEP_INPUT_MOVEMENT_MISMATCH',
        entityType: 'step',
        entityId: step.id,
        workOrderId,
        message: '工序投入数量与生产目标或有效入站移动记录不一致',
        detail: { inputQty: step.inputQty, expectedInputQty },
      });
    }
  }

  for (const completion of snapshot.completions) {
    const order = workOrdersById.get(completion.workOrderId);
    const route = routesById.get(completion.routeId);
    const step = stepsById.get(completion.stepId);
    if (
      !order
      || !route
      || !step
      || route.workOrderId !== completion.workOrderId
      || step.routeId !== completion.routeId
    ) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'COMPLETION_REFERENCE_INVALID',
        entityType: 'completion',
        entityId: completion.id,
        workOrderId: completion.workOrderId,
        message: '工序完成记录引用的工单、路线或工序不一致',
      });
    }
    if (
      !Number.isSafeInteger(completion.processedQty)
      || completion.processedQty <= 0
      || !isNonnegativeSafeInteger(completion.goodQty)
      || !isNonnegativeSafeInteger(completion.defectQty)
      || completion.processedQty !== completion.goodQty + completion.defectQty
    ) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'COMPLETION_QUANTITY_INVALID',
        entityType: 'completion',
        entityId: completion.id,
        workOrderId: completion.workOrderId,
        message: '工序完成记录数量不满足 完成 = 良品 + 不良品',
        detail: {
          processedQty: completion.processedQty,
          goodQty: completion.goodQty,
          defectQty: completion.defectQty,
        },
      });
    }
    if (
      (completion.defectQty > 0 && !completion.defectDisposition)
      || (completion.defectQty === 0 && Boolean(completion.defectDisposition))
    ) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'COMPLETION_DEFECT_DISPOSITION_INVALID',
        entityType: 'completion',
        entityId: completion.id,
        workOrderId: completion.workOrderId,
        message: '不良品数量与处置方式不一致',
        detail: {
          defectQty: completion.defectQty,
          defectDisposition: completion.defectDisposition,
        },
      });
    }
    if (!completion.voidedAt) {
      const branch = branchByOriginCompletionId.get(completion.id);
      if (completion.defectQty > 0 && !branch) {
        add({
          severity: 'error',
          domain: 'branch',
          code: 'COMPLETION_BRANCH_MISSING',
          entityType: 'completion',
          entityId: completion.id,
          workOrderId: completion.workOrderId,
          message: '含不良品的完成记录没有建立后续分支工单',
        });
      }
      if (completion.defectQty === 0 && branch) {
        add({
          severity: 'error',
          domain: 'branch',
          code: 'COMPLETION_BRANCH_UNEXPECTED',
          entityType: 'completion',
          entityId: completion.id,
          workOrderId: completion.workOrderId,
          message: '无不良品的完成记录不应关联分支工单',
          detail: { branchWorkOrderId: branch.id },
        });
      }
    }
  }

  for (const movement of snapshot.movements) {
    const completion = completionsById.get(movement.completionId);
    const sourceStep = stepsById.get(movement.sourceStepId);
    const targetStep = movement.targetStepId ? stepsById.get(movement.targetStepId) : null;
    if (!completion || !sourceStep || (movement.targetStepId && !targetStep)) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'MOVEMENT_REFERENCE_INVALID',
        entityType: 'movement',
        entityId: movement.id,
        workOrderId: movement.workOrderId,
        message: '数量移动记录引用的完成记录或工序不存在',
      });
    }
    if (!movement.voidedAt && (!Number.isSafeInteger(movement.quantity) || movement.quantity <= 0)) {
      add({
        severity: 'error',
        domain: 'quantity',
        code: 'MOVEMENT_QUANTITY_INVALID',
        entityType: 'movement',
        entityId: movement.id,
        workOrderId: movement.workOrderId,
        message: '有效数量移动记录必须为正整数',
        detail: { quantity: movement.quantity },
      });
    }
    if (
      !movement.voidedAt
      && (
        (movement.type === 'FINISHED_GOOD' && movement.targetStepId)
        || (
          movement.type !== 'FINISHED_GOOD'
          && INPUT_MOVEMENT_TYPES.has(movement.type)
          && !movement.targetStepId
        )
      )
    ) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'MOVEMENT_TARGET_INVALID',
        entityType: 'movement',
        entityId: movement.id,
        workOrderId: movement.workOrderId,
        message: '数量移动类型与目标工序不匹配',
        detail: { type: movement.type, targetStepId: movement.targetStepId },
      });
    }
  }

  for (const branch of snapshot.workOrders.filter(order => order.branchType || order.originCompletionId)) {
    const parent = branch.parentWorkOrderId ? workOrdersById.get(branch.parentWorkOrderId) : undefined;
    const originCompletion = branch.originCompletionId
      ? completionsById.get(branch.originCompletionId)
      : undefined;
    const originStep = branch.originStepId ? stepsById.get(branch.originStepId) : undefined;
    const expectedRootId = parent?.rootWorkOrderId || parent?.id || null;
    if (!parent || !originCompletion || !originStep) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'BRANCH_ORIGIN_REFERENCE_INVALID',
        entityType: 'work_order',
        entityId: branch.id,
        workOrderId: branch.id,
        message: '分支工单缺少有效的父工单、来源完成记录或来源工序',
      });
      continue;
    }
    if (
      originCompletion.workOrderId !== parent.id
      || originCompletion.stepId !== originStep.id
      || branch.rootWorkOrderId !== expectedRootId
    ) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'BRANCH_ANCESTRY_INVALID',
        entityType: 'work_order',
        entityId: branch.id,
        workOrderId: branch.id,
        message: '分支工单的父级、根工单或来源工序链路不一致',
        detail: {
          parentWorkOrderId: branch.parentWorkOrderId,
          rootWorkOrderId: branch.rootWorkOrderId,
          expectedRootWorkOrderId: expectedRootId,
        },
      });
    }
    const expectedBranchType = originCompletion.defectDisposition
      ? BRANCH_TYPE_BY_DISPOSITION[originCompletion.defectDisposition]
      : undefined;
    if (
      !expectedBranchType
      || branch.branchType !== expectedBranchType
      || branch.targetQty !== originCompletion.defectQty
      || !branch.branchSequence
      || branch.branchSequence <= 0
    ) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'BRANCH_CONFIGURATION_INVALID',
        entityType: 'work_order',
        entityId: branch.id,
        workOrderId: branch.id,
        message: '分支类型、数量或序号与来源不良品记录不一致',
        detail: {
          branchType: branch.branchType,
          expectedBranchType: expectedBranchType || null,
          targetQty: branch.targetQty,
          defectQty: originCompletion.defectQty,
          branchSequence: branch.branchSequence,
        },
      });
    }
    if (branch.branchType !== 'REWORK' && branch.rejoinStepId) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'BRANCH_REJOIN_UNEXPECTED',
        entityType: 'work_order',
        entityId: branch.id,
        workOrderId: branch.id,
        message: '仅返工分支可以设置回流工序',
        detail: { branchType: branch.branchType, rejoinStepId: branch.rejoinStepId },
      });
    }
    const expectedMovementType = originCompletion.defectDisposition
      ? BRANCH_MOVEMENT_BY_DISPOSITION[originCompletion.defectDisposition]
      : undefined;
    const splitMovements = activeMovements.filter(movement => (
      movement.completionId === originCompletion.id
      && movement.branchWorkOrderId === branch.id
      && movement.type === expectedMovementType
    ));
    if (
      splitMovements.length !== 1
      || splitMovements[0]?.quantity !== originCompletion.defectQty
    ) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'BRANCH_SPLIT_MOVEMENT_INVALID',
        entityType: 'work_order',
        entityId: branch.id,
        workOrderId: branch.id,
        message: '分支工单缺少唯一且数量正确的不良品拆分移动记录',
        detail: {
          expectedMovementType: expectedMovementType || null,
          expectedQty: originCompletion.defectQty,
          matchingMovementCount: splitMovements.length,
        },
      });
    }
    if (
      branch.branchStatus === 'RESOLVED'
      && (
        branch.route?.status !== 'completed'
        || branch.completedQty !== branch.targetQty
      )
    ) {
      add({
        severity: 'error',
        domain: 'branch',
        code: 'BRANCH_RESOLUTION_STATE_INVALID',
        entityType: 'work_order',
        entityId: branch.id,
        workOrderId: branch.id,
        message: '分支标记已解决，但路线或完成数量尚未闭环',
      });
    }
  }

  for (const pool of snapshot.laborPools) {
    const completion = completionsById.get(pool.completionId);
    const step = stepsById.get(pool.stepId);
    const order = workOrdersById.get(pool.workOrderId);
    if (
      !completion
      || !step
      || !order
      || completion.workOrderId !== pool.workOrderId
      || completion.stepId !== pool.stepId
      || !sameDay(completion.workDate, pool.workDate)
    ) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'LABOR_POOL_REFERENCE_INVALID',
        entityType: 'labor_pool',
        entityId: pool.id,
        workOrderId: pool.workOrderId,
        message: '工时池与完成记录、工单、工序或生产日期引用不一致',
      });
    }
    if (
      !isNonnegativeSafeInteger(pool.eligibleQty)
      || !isNonnegativeSafeInteger(pool.claimedQty)
      || !isNonnegativeSafeInteger(pool.remainingQty)
      || pool.claimedQty + pool.remainingQty !== pool.eligibleQty
    ) {
      add({
        severity: 'error',
        domain: 'labor',
        code: 'LABOR_POOL_QUANTITY_MISMATCH',
        entityType: 'labor_pool',
        entityId: pool.id,
        workOrderId: pool.workOrderId,
        message: '工时池数量不满足 可领取 = 已领取 + 剩余',
        detail: {
          eligibleQty: pool.eligibleQty,
          claimedQty: pool.claimedQty,
          remainingQty: pool.remainingQty,
        },
      });
    }
    if (
      pool.totalStandardLaborMilliseconds < 0n
      || pool.claimedStandardLaborMilliseconds < 0n
      || pool.remainingStandardLaborMilliseconds < 0n
      || pool.claimedStandardLaborMilliseconds + pool.remainingStandardLaborMilliseconds
        !== pool.totalStandardLaborMilliseconds
    ) {
      add({
        severity: 'error',
        domain: 'labor',
        code: 'LABOR_POOL_DURATION_MISMATCH',
        entityType: 'labor_pool',
        entityId: pool.id,
        workOrderId: pool.workOrderId,
        message: '工时池标准工时不满足 总工时 = 已领取 + 剩余',
        detail: {
          total: detailNumber(pool.totalStandardLaborMilliseconds),
          claimed: detailNumber(pool.claimedStandardLaborMilliseconds),
          remaining: detailNumber(pool.remainingStandardLaborMilliseconds),
        },
      });
    }
    if (pool.status === 'LOCKED') {
      if (
        pool.standardSource !== 'pending_standard'
        || pool.claimedQty !== 0
        || pool.claimedStandardLaborMilliseconds !== 0n
      ) {
        add({
          severity: 'error',
          domain: 'labor',
          code: 'LABOR_POOL_LOCK_STATE_INVALID',
          entityType: 'labor_pool',
          entityId: pool.id,
          workOrderId: pool.workOrderId,
          message: '待补标准工时池的锁定状态或领取数量不一致',
        });
      }
    } else if (pool.status !== 'VOIDED') {
      const expectedStatus = expectedPoolStatus(pool.eligibleQty, pool.claimedQty);
      if (pool.status !== expectedStatus) {
        add({
          severity: 'error',
          domain: 'labor',
          code: 'LABOR_POOL_STATUS_INVALID',
          entityType: 'labor_pool',
          entityId: pool.id,
          workOrderId: pool.workOrderId,
          message: '工时池状态与领取进度不一致',
          detail: { status: pool.status, expectedStatus },
        });
      }
      if (completion) {
        const expectedLabor = expectedPoolLabor(pool, completion);
        if (
          expectedLabor !== null
          && expectedLabor !== pool.totalStandardLaborMilliseconds
        ) {
          add({
            severity: 'error',
            domain: 'labor',
            code: 'LABOR_POOL_STANDARD_CALCULATION_INVALID',
            entityType: 'labor_pool',
            entityId: pool.id,
            workOrderId: pool.workOrderId,
            message: '工时池总标准工时与冻结的计时规则不一致',
            detail: {
              expected: detailNumber(expectedLabor),
              actual: detailNumber(pool.totalStandardLaborMilliseconds),
            },
          });
        }
      }
    }

    if (completion) {
      const expectedEligibleQty = completion.timeBasis === 'per_batch'
        ? sumNumbers(activeCompletions
            .filter(record => record.stepId === pool.stepId)
            .map(record => record.goodQty))
        : completion.goodQty;
      if (pool.eligibleQty !== expectedEligibleQty) {
        add({
          severity: 'error',
          domain: 'labor',
          code: 'LABOR_POOL_ELIGIBLE_QTY_INVALID',
          entityType: 'labor_pool',
          entityId: pool.id,
          workOrderId: pool.workOrderId,
          message: '工时池可领取数量与有效良品产出不一致',
          detail: { eligibleQty: pool.eligibleQty, expectedEligibleQty },
        });
      }
    }

    const activeClaims = pool.claims.filter(claim => claim.status === 'ACTIVE');
    const activeClaimQty = sumNumbers(activeClaims.map(claim => claim.quantity));
    const activeClaimLabor = sumBigInts(activeClaims.map(claim => claim.standardLaborMilliseconds));
    if (
      activeClaimQty !== pool.claimedQty
      || activeClaimLabor !== pool.claimedStandardLaborMilliseconds
    ) {
      add({
        severity: 'error',
        domain: 'labor',
        code: 'LABOR_POOL_CLAIM_AGGREGATE_MISMATCH',
        entityType: 'labor_pool',
        entityId: pool.id,
        workOrderId: pool.workOrderId,
        message: '工时池累计领取量与有效员工领取记录合计不一致',
        detail: {
          poolClaimedQty: pool.claimedQty,
          activeClaimQty,
          poolClaimedLabor: detailNumber(pool.claimedStandardLaborMilliseconds),
          activeClaimLabor: detailNumber(activeClaimLabor),
        },
      });
    }
  }

  const claims = snapshot.laborPools.flatMap(pool => pool.claims);
  const claimsById = new Map(claims.map(claim => [claim.id, claim]));
  const poolById = new Map(snapshot.laborPools.map(pool => [pool.id, pool]));
  const reversalByOriginalId = new Map(
    claims
      .filter(claim => claim.reversalOfId)
      .map(claim => [claim.reversalOfId as string, claim]),
  );
  for (const claim of claims) {
    const pool = poolById.get(claim.poolId);
    if (!pool || !sameDay(pool.workDate, claim.workDate)) {
      add({
        severity: 'error',
        domain: 'reference',
        code: 'LABOR_CLAIM_REFERENCE_INVALID',
        entityType: 'labor_claim',
        entityId: claim.id,
        workOrderId: pool?.workOrderId,
        message: '员工工时领取记录与工时池或生产日期不一致',
      });
    }
    if (
      claim.status === 'ACTIVE'
      && (
        claim.quantity <= 0
        || claim.standardLaborMilliseconds <= 0n
        || claim.voidedAt
        || claim.reversalOfId
      )
    ) {
      add({
        severity: 'error',
        domain: 'labor',
        code: 'LABOR_CLAIM_ACTIVE_STATE_INVALID',
        entityType: 'labor_claim',
        entityId: claim.id,
        workOrderId: pool?.workOrderId,
        message: '有效员工领取记录的数量、工时或冲销状态不正确',
      });
    }
    if (claim.status === 'VOIDED') {
      const reversal = reversalByOriginalId.get(claim.id);
      if (
        !claim.voidedAt
        || !reversal
        || reversal.poolId !== claim.poolId
        || reversal.employeeId !== claim.employeeId
        || reversal.quantity !== -claim.quantity
        || reversal.standardLaborMilliseconds !== -claim.standardLaborMilliseconds
      ) {
        add({
          severity: 'error',
          domain: 'labor',
          code: 'LABOR_CLAIM_VOID_REVERSAL_INVALID',
          entityType: 'labor_claim',
          entityId: claim.id,
          workOrderId: pool?.workOrderId,
          message: '已冲销领取记录缺少完整且等额的反向记录',
        });
      }
    }
    if (claim.status === 'REVERSAL') {
      const original = claim.reversalOfId ? claimsById.get(claim.reversalOfId) : undefined;
      if (
        !original
        || original.status !== 'VOIDED'
        || original.poolId !== claim.poolId
        || original.employeeId !== claim.employeeId
        || claim.quantity !== -original.quantity
        || claim.standardLaborMilliseconds !== -original.standardLaborMilliseconds
      ) {
        add({
          severity: 'error',
          domain: 'labor',
          code: 'LABOR_CLAIM_REVERSAL_INVALID',
          entityType: 'labor_claim',
          entityId: claim.id,
          workOrderId: pool?.workOrderId,
          message: '反向领取记录与原领取记录不匹配',
        });
      }
    }
  }

  findings.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'error' ? -1 : 1;
    return `${left.code}:${left.entityId}`.localeCompare(`${right.code}:${right.entityId}`);
  });
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  return {
    generatedAt,
    mode: 'READ_ONLY',
    passed: errors === 0,
    counts: {
      workOrders: snapshot.workOrders.length,
      routes: routes.length,
      steps: steps.length,
      completions: snapshot.completions.length,
      movements: snapshot.movements.length,
      laborPools: snapshot.laborPools.length,
      laborClaims: claims.length,
      errors,
      warnings,
    },
    findings,
  };
}
