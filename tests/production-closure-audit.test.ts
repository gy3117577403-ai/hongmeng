import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditProductionClosure,
  type AuditLaborPool,
  type ProductionClosureAuditSnapshot,
} from '../lib/production-closure-audit';

const WORK_DATE = '2026-07-24T00:00:00.000Z';
const COMPLETED_AT = '2026-07-24T08:00:00.000Z';

function laborPool(input: {
  id: string;
  completionId: string;
  workOrderId: string;
  stepId: string;
  standardMillisecondsPerUnit: number;
  eligibleQty: number;
  claimedQty?: number;
  claims?: AuditLaborPool['claims'];
}): AuditLaborPool {
  const claimedQty = input.claimedQty || 0;
  const total = BigInt(input.standardMillisecondsPerUnit) * BigInt(input.eligibleQty);
  const claims = input.claims || [];
  const claimedLabor = claims
    .filter(claim => claim.status === 'ACTIVE')
    .reduce((sum, claim) => sum + claim.standardLaborMilliseconds, 0n);
  return {
    id: input.id,
    completionId: input.completionId,
    workOrderId: input.workOrderId,
    stepId: input.stepId,
    workDate: WORK_DATE,
    eligibleQty: input.eligibleQty,
    claimedQty,
    remainingQty: input.eligibleQty - claimedQty,
    status: claimedQty === 0
      ? 'OPEN'
      : claimedQty === input.eligibleQty
        ? 'EXHAUSTED'
        : 'PARTIAL',
    standardMillisecondsPerUnit: input.standardMillisecondsPerUnit,
    setupMilliseconds: 0,
    unitsPerProduct: 1,
    totalStandardLaborMilliseconds: total,
    claimedStandardLaborMilliseconds: claimedLabor,
    remainingStandardLaborMilliseconds: total - claimedLabor,
    standardSource: 'product_profile',
    claims,
  };
}

function sequentialSnapshot(): ProductionClosureAuditSnapshot {
  const claims: AuditLaborPool['claims'] = [
    {
      id: 'claim-a',
      poolId: 'pool-cut',
      employeeId: 'employee-a',
      quantity: 800,
      standardLaborMilliseconds: 800_000n,
      workDate: WORK_DATE,
      status: 'ACTIVE',
      voidedAt: null,
      reversalOfId: null,
    },
    {
      id: 'claim-b',
      poolId: 'pool-cut',
      employeeId: 'employee-b',
      quantity: 200,
      standardLaborMilliseconds: 200_000n,
      workDate: WORK_DATE,
      status: 'ACTIVE',
      voidedAt: null,
      reversalOfId: null,
    },
  ];
  return {
    workOrders: [{
      id: 'order-a',
      code: 'AUDIT-SEQUENTIAL-001',
      targetQty: 1_000,
      completedQty: 1_000,
      frontendTransferredQty: 1_000,
      stage: 'completed',
      status: 'done',
      parentWorkOrderId: null,
      rootWorkOrderId: null,
      branchType: null,
      branchStatus: null,
      originCompletionId: null,
      originStepId: null,
      rejoinStepId: null,
      branchSequence: null,
      completedAt: COMPLETED_AT,
      route: {
        id: 'route-a',
        workOrderId: 'order-a',
        status: 'completed',
        completedAt: COMPLETED_AT,
        steps: [
          {
            id: 'step-cut',
            routeId: 'route-a',
            processName: '裁线',
            position: 1,
            sequenceGroup: 1,
            status: 'completed',
            inputQty: 1_000,
            processedQty: 1_000,
            goodOutputQty: 1_000,
            defectOutputQty: 0,
            releasedGoodQty: 1_000,
            timeBasis: 'per_unit',
          },
          {
            id: 'step-crimp',
            routeId: 'route-a',
            processName: '压接',
            position: 2,
            sequenceGroup: 2,
            status: 'completed',
            inputQty: 1_000,
            processedQty: 1_000,
            goodOutputQty: 1_000,
            defectOutputQty: 0,
            releasedGoodQty: 1_000,
            timeBasis: 'per_unit',
          },
        ],
      },
    }],
    completions: [
      {
        id: 'completion-cut',
        workOrderId: 'order-a',
        routeId: 'route-a',
        stepId: 'step-cut',
        workDate: WORK_DATE,
        processedQty: 1_000,
        goodQty: 1_000,
        defectQty: 0,
        defectDisposition: null,
        routeVersion: 1,
        timeBasis: 'per_unit',
        voidedAt: null,
      },
      {
        id: 'completion-crimp',
        workOrderId: 'order-a',
        routeId: 'route-a',
        stepId: 'step-crimp',
        workDate: WORK_DATE,
        processedQty: 1_000,
        goodQty: 1_000,
        defectQty: 0,
        defectDisposition: null,
        routeVersion: 2,
        timeBasis: 'per_unit',
        voidedAt: null,
      },
    ],
    movements: [
      {
        id: 'movement-cut-crimp',
        completionId: 'completion-cut',
        workOrderId: 'order-a',
        sourceStepId: 'step-cut',
        targetStepId: 'step-crimp',
        branchWorkOrderId: null,
        type: 'GOOD_TRANSFER',
        quantity: 1_000,
        sourceSequenceGroup: 1,
        targetSequenceGroup: 2,
        voidedAt: null,
      },
      {
        id: 'movement-finished',
        completionId: 'completion-crimp',
        workOrderId: 'order-a',
        sourceStepId: 'step-crimp',
        targetStepId: null,
        branchWorkOrderId: null,
        type: 'FINISHED_GOOD',
        quantity: 1_000,
        sourceSequenceGroup: 2,
        targetSequenceGroup: null,
        voidedAt: null,
      },
    ],
    laborPools: [
      laborPool({
        id: 'pool-cut',
        completionId: 'completion-cut',
        workOrderId: 'order-a',
        stepId: 'step-cut',
        standardMillisecondsPerUnit: 1_000,
        eligibleQty: 1_000,
        claimedQty: 1_000,
        claims,
      }),
      laborPool({
        id: 'pool-crimp',
        completionId: 'completion-crimp',
        workOrderId: 'order-a',
        stepId: 'step-crimp',
        standardMillisecondsPerUnit: 2_000,
        eligibleQty: 1_000,
      }),
    ],
  };
}

test('a complete sequential route with 800 + 200 labor claims passes the closure audit', () => {
  const result = auditProductionClosure(sequentialSnapshot(), '2026-07-24T09:00:00.000Z');
  assert.equal(result.passed, true);
  assert.equal(result.counts.errors, 0);
  assert.equal(result.counts.warnings, 0);
  assert.equal(result.counts.laborClaims, 2);
});

test('parallel steps share one release quantity without double-counting target movements', () => {
  const snapshot: ProductionClosureAuditSnapshot = {
    workOrders: [{
      id: 'parallel-order',
      code: 'AUDIT-PARALLEL-001',
      targetQty: 100,
      completedQty: 100,
      frontendTransferredQty: 100,
      stage: 'completed',
      status: 'done',
      parentWorkOrderId: null,
      rootWorkOrderId: null,
      branchType: null,
      branchStatus: null,
      originCompletionId: null,
      originStepId: null,
      rejoinStepId: null,
      branchSequence: null,
      completedAt: COMPLETED_AT,
      route: {
        id: 'parallel-route',
        workOrderId: 'parallel-order',
        status: 'completed',
        completedAt: COMPLETED_AT,
        steps: [
          {
            id: 'parallel-a',
            routeId: 'parallel-route',
            processName: '并行 A',
            position: 1,
            sequenceGroup: 1,
            status: 'completed',
            inputQty: 100,
            processedQty: 100,
            goodOutputQty: 100,
            defectOutputQty: 0,
            releasedGoodQty: 100,
            timeBasis: null,
          },
          {
            id: 'parallel-b',
            routeId: 'parallel-route',
            processName: '并行 B',
            position: 2,
            sequenceGroup: 1,
            status: 'completed',
            inputQty: 100,
            processedQty: 100,
            goodOutputQty: 100,
            defectOutputQty: 0,
            releasedGoodQty: 100,
            timeBasis: null,
          },
          {
            id: 'parallel-finish',
            routeId: 'parallel-route',
            processName: '总装',
            position: 3,
            sequenceGroup: 2,
            status: 'completed',
            inputQty: 100,
            processedQty: 100,
            goodOutputQty: 100,
            defectOutputQty: 0,
            releasedGoodQty: 100,
            timeBasis: null,
          },
        ],
      },
    }],
    completions: [
      {
        id: 'parallel-completion-a',
        workOrderId: 'parallel-order',
        routeId: 'parallel-route',
        stepId: 'parallel-a',
        workDate: WORK_DATE,
        processedQty: 100,
        goodQty: 100,
        defectQty: 0,
        defectDisposition: null,
        routeVersion: 1,
        timeBasis: null,
        voidedAt: null,
      },
      {
        id: 'parallel-completion-b',
        workOrderId: 'parallel-order',
        routeId: 'parallel-route',
        stepId: 'parallel-b',
        workDate: WORK_DATE,
        processedQty: 100,
        goodQty: 100,
        defectQty: 0,
        defectDisposition: null,
        routeVersion: 2,
        timeBasis: null,
        voidedAt: null,
      },
      {
        id: 'parallel-completion-finish',
        workOrderId: 'parallel-order',
        routeId: 'parallel-route',
        stepId: 'parallel-finish',
        workDate: WORK_DATE,
        processedQty: 100,
        goodQty: 100,
        defectQty: 0,
        defectDisposition: null,
        routeVersion: 3,
        timeBasis: null,
        voidedAt: null,
      },
    ],
    movements: [
      {
        id: 'parallel-transfer',
        completionId: 'parallel-completion-b',
        workOrderId: 'parallel-order',
        sourceStepId: 'parallel-b',
        targetStepId: 'parallel-finish',
        branchWorkOrderId: null,
        type: 'GOOD_TRANSFER',
        quantity: 100,
        sourceSequenceGroup: 1,
        targetSequenceGroup: 2,
        voidedAt: null,
      },
      {
        id: 'parallel-finished',
        completionId: 'parallel-completion-finish',
        workOrderId: 'parallel-order',
        sourceStepId: 'parallel-finish',
        targetStepId: null,
        branchWorkOrderId: null,
        type: 'FINISHED_GOOD',
        quantity: 100,
        sourceSequenceGroup: 2,
        targetSequenceGroup: null,
        voidedAt: null,
      },
    ],
    laborPools: [],
  };
  const result = auditProductionClosure(snapshot);
  assert.equal(result.passed, true);
  assert.equal(result.counts.errors, 0);
});

test('resolved rework returns defect quantity to the original step and closes the parent order', () => {
  const snapshot: ProductionClosureAuditSnapshot = {
    workOrders: [
      {
        id: 'parent-order',
        code: 'AUDIT-REWORK-001',
        targetQty: 10,
        completedQty: 10,
        frontendTransferredQty: 10,
        stage: 'completed',
        status: 'done',
        parentWorkOrderId: null,
        rootWorkOrderId: null,
        branchType: null,
        branchStatus: null,
        originCompletionId: null,
        originStepId: null,
        rejoinStepId: null,
        branchSequence: null,
        completedAt: COMPLETED_AT,
        route: {
          id: 'parent-route',
          workOrderId: 'parent-order',
          status: 'completed',
          completedAt: COMPLETED_AT,
          steps: [{
            id: 'parent-step',
            routeId: 'parent-route',
            processName: '裁线',
            position: 1,
            sequenceGroup: 1,
            status: 'completed',
            inputQty: 10,
            processedQty: 10,
            goodOutputQty: 10,
            defectOutputQty: 0,
            releasedGoodQty: 10,
            timeBasis: null,
          }],
        },
      },
      {
        id: 'rework-order',
        code: 'AUDIT-REWORK-001-RW01',
        targetQty: 2,
        completedQty: 2,
        frontendTransferredQty: 2,
        stage: 'completed',
        status: 'done',
        parentWorkOrderId: 'parent-order',
        rootWorkOrderId: 'parent-order',
        branchType: 'REWORK',
        branchStatus: 'RESOLVED',
        originCompletionId: 'parent-completion',
        originStepId: 'parent-step',
        rejoinStepId: null,
        branchSequence: 1,
        completedAt: COMPLETED_AT,
        route: {
          id: 'rework-route',
          workOrderId: 'rework-order',
          status: 'completed',
          completedAt: COMPLETED_AT,
          steps: [{
            id: 'rework-step',
            routeId: 'rework-route',
            processName: '返工裁线',
            position: 1,
            sequenceGroup: 1,
            status: 'completed',
            inputQty: 2,
            processedQty: 2,
            goodOutputQty: 2,
            defectOutputQty: 0,
            releasedGoodQty: 2,
            timeBasis: null,
          }],
        },
      },
    ],
    completions: [
      {
        id: 'parent-completion',
        workOrderId: 'parent-order',
        routeId: 'parent-route',
        stepId: 'parent-step',
        workDate: WORK_DATE,
        processedQty: 10,
        goodQty: 8,
        defectQty: 2,
        defectDisposition: 'REWORK',
        routeVersion: 1,
        timeBasis: null,
        voidedAt: null,
      },
      {
        id: 'rework-completion',
        workOrderId: 'rework-order',
        routeId: 'rework-route',
        stepId: 'rework-step',
        workDate: WORK_DATE,
        processedQty: 2,
        goodQty: 2,
        defectQty: 0,
        defectDisposition: null,
        routeVersion: 1,
        timeBasis: null,
        voidedAt: null,
      },
    ],
    movements: [
      {
        id: 'parent-finished-initial',
        completionId: 'parent-completion',
        workOrderId: 'parent-order',
        sourceStepId: 'parent-step',
        targetStepId: null,
        branchWorkOrderId: null,
        type: 'FINISHED_GOOD',
        quantity: 8,
        sourceSequenceGroup: 1,
        targetSequenceGroup: null,
        voidedAt: null,
      },
      {
        id: 'rework-split',
        completionId: 'parent-completion',
        workOrderId: 'parent-order',
        sourceStepId: 'parent-step',
        targetStepId: 'rework-step',
        branchWorkOrderId: 'rework-order',
        type: 'REWORK_SPLIT',
        quantity: 2,
        sourceSequenceGroup: 1,
        targetSequenceGroup: 1,
        voidedAt: null,
      },
      {
        id: 'rework-return',
        completionId: 'rework-completion',
        workOrderId: 'parent-order',
        sourceStepId: 'rework-step',
        targetStepId: 'parent-step',
        branchWorkOrderId: 'rework-order',
        type: 'REWORK_RETURN',
        quantity: 2,
        sourceSequenceGroup: 1,
        targetSequenceGroup: 1,
        voidedAt: null,
      },
      {
        id: 'parent-finished-recovered',
        completionId: 'rework-completion',
        workOrderId: 'parent-order',
        sourceStepId: 'parent-step',
        targetStepId: null,
        branchWorkOrderId: 'rework-order',
        type: 'FINISHED_GOOD',
        quantity: 2,
        sourceSequenceGroup: 1,
        targetSequenceGroup: null,
        voidedAt: null,
      },
    ],
    laborPools: [],
  };
  const result = auditProductionClosure(snapshot);
  assert.equal(result.passed, true);
  assert.equal(result.counts.errors, 0);
});

test('quantity drift and labor over-allocation are reported with stable finding codes', () => {
  const snapshot = sequentialSnapshot();
  const route = snapshot.workOrders[0].route;
  assert.ok(route);
  route.steps[1].inputQty = 900;
  snapshot.laborPools[0].remainingQty = 1;
  snapshot.laborPools[0].claimedStandardLaborMilliseconds = 999_999n;
  snapshot.laborPools[0].remainingStandardLaborMilliseconds = 0n;

  const result = auditProductionClosure(snapshot);
  const codes = new Set(result.findings.map(finding => finding.code));
  assert.equal(result.passed, false);
  assert.ok(codes.has('STEP_PROCESSED_EXCEEDS_INPUT'));
  assert.ok(codes.has('STEP_INPUT_MOVEMENT_MISMATCH'));
  assert.ok(codes.has('LABOR_POOL_QUANTITY_MISMATCH'));
  assert.ok(codes.has('LABOR_POOL_DURATION_MISMATCH'));
  assert.ok(codes.has('LABOR_POOL_CLAIM_AGGREGATE_MISMATCH'));
});
