import assert from 'node:assert/strict';
import test from 'node:test';
import { MaterialFollowUpStatus } from '@prisma/client';
import {
  attendanceTotals,
  basisPoints,
  defaultAttendanceSegments,
} from '../lib/attendance';
import { aggregateDailyAttainment } from '../lib/employee-attainment-daily';
import {
  isTrackedWarehouseException,
  prepareMaterialFollowUpTransition,
} from '../lib/material-follow-up';
import { planningReadinessState } from '../lib/planning-readiness';
import {
  calculateCompletionLaborSnapshot,
  planLaborClaim,
  resolveCompletionQuantities,
} from '../lib/process-completion-domain';
import { prepareWarehouseTaskTransition } from '../lib/warehouse-material';
import type { ProductionPlanBatchDTO, ProductionPlanOrderDTO } from '../types';

const HOUR = 60 * 60 * 1000;

function order(): ProductionPlanOrderDTO {
  return {
    id: 'plan-order-001',
    sourceOrderNo: 'PLAN-001',
    sourceLineNo: 1,
    customerName: '验收客户',
    salesperson: '业务员',
    productName: 'A 产品',
    specification: 'A-001',
    drawingLibraryItemId: 'drawing-001',
    drawingFileCount: 1,
    sopFileCount: 1,
    orderQuantity: 1_000,
    planningUnitMilliseconds: 27_360,
    effectiveUnitMilliseconds: 27_360,
    planningTotalMilliseconds: '27360000',
    allocatedQuantity: 1_000,
    remainingQuantity: 0,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-26',
    priority: 'normal',
    status: 'scheduled',
    remark: null,
    currentUnitMilliseconds: 27_360,
    currentProductTimeVersion: 1,
    batches: [],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function batch(
  warehouseStatus: ProductionPlanBatchDTO['warehouseStatus'],
): ProductionPlanBatchDTO {
  return {
    id: 'batch-001',
    planOrderId: 'plan-order-001',
    batchNo: 1,
    quantity: 1_000,
    weekStartDate: '2026-07-20',
    weekEndDate: '2026-07-26',
    plannedCompletionDate: '2026-07-26',
    releaseState: 'active',
    workOrderId: 'work-order-001',
    productTimeProfileId: 'profile-001',
    productTimeProfileVersion: 1,
    unitMillisecondsSnapshot: 27_360,
    totalMillisecondsSnapshot: '27360000',
    warehouseStatus,
    processStatus: 'confirmed',
    releasedAt: '2026-07-20T00:00:00.000Z',
    activatedAt: '2026-07-20T00:00:00.000Z',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

test('the daily operations chain preserves readiness, shortage closure, labor, and attainment', () => {
  const now = new Date('2026-07-25T02:00:00.000Z');
  const plannedOrder = order();

  const waitingWarehouse = planningReadinessState(plannedOrder, batch('pending'));
  assert.equal(waitingWarehouse.ready_preparation, true);
  assert.equal(waitingWarehouse.missing_material, true);
  assert.equal(waitingWarehouse.ready_production, false);

  const warehouseException = prepareWarehouseTaskTransition({
    status: 'pending',
    exceptionType: null,
    exceptionNote: null,
    expectedAt: null,
    completedAt: null,
  }, {
    action: 'report_exception',
    exceptionType: 'shortage',
    exceptionNote: '端子缺少 200 套，等待调拨',
    expectedAt: '2026-07-26',
  }, now);
  assert.equal(warehouseException.ok, true);
  if (!warehouseException.ok) return;
  assert.equal(warehouseException.next.status, 'exception');
  assert.equal(isTrackedWarehouseException(warehouseException.next.exceptionType), true);
  assert.equal(
    planningReadinessState(plannedOrder, batch(warehouseException.next.status)).material_exception,
    true,
  );

  const claimedFollowUp = prepareMaterialFollowUpTransition({
    status: 'PENDING',
    ownerId: null,
    expectedAt: warehouseException.next.expectedAt,
  }, { action: 'claim' }, 'supervisor-001', now);
  assert.equal(claimedFollowUp.ok, true);
  if (!claimedFollowUp.ok) return;
  assert.equal(claimedFollowUp.next.status, MaterialFollowUpStatus.IN_PROGRESS);

  const waitingArrival = prepareMaterialFollowUpTransition({
    status: claimedFollowUp.next.status,
    ownerId: claimedFollowUp.next.ownerId,
    expectedAt: claimedFollowUp.next.expectedAt,
  }, {
    action: 'update',
    status: 'WAITING_ARRIVAL',
    ownerId: 'supervisor-001',
    expectedAt: '2026-07-26',
    note: '已完成内部调拨，预计明日到仓',
  }, 'supervisor-001', now);
  assert.equal(waitingArrival.ok, true);
  if (!waitingArrival.ok) return;
  assert.equal(waitingArrival.next.status, MaterialFollowUpStatus.WAITING_ARRIVAL);

  const waitingConfirmation = prepareMaterialFollowUpTransition({
    status: waitingArrival.next.status,
    ownerId: waitingArrival.next.ownerId,
    expectedAt: waitingArrival.next.expectedAt,
  }, {
    action: 'update',
    status: 'WAITING_WAREHOUSE',
    ownerId: 'supervisor-001',
    expectedAt: '2026-07-26',
    note: '物料已经到仓，等待仓库复核',
  }, 'supervisor-001', now);
  assert.equal(waitingConfirmation.ok, true);
  if (!waitingConfirmation.ok) return;
  assert.equal(waitingConfirmation.next.status, MaterialFollowUpStatus.WAITING_WAREHOUSE);

  const warehouseResolved = prepareWarehouseTaskTransition(
    warehouseException.next,
    {
      action: 'resolve',
      resolution: 'completed',
      note: '端子数量复核无误，配料完成',
    },
    now,
  );
  assert.equal(warehouseResolved.ok, true);
  if (!warehouseResolved.ok) return;
  assert.equal(warehouseResolved.next.status, 'completed');
  assert.equal(
    planningReadinessState(plannedOrder, batch(warehouseResolved.next.status)).ready_production,
    true,
  );

  const completion = resolveCompletionQuantities({
    availableInputQty: 1_000,
    processedQty: 1_000,
    defectQty: 0,
  });
  assert.equal(completion.goodQty, 1_000);
  assert.equal(completion.remainingInputQty, 0);

  const laborPool = calculateCompletionLaborSnapshot({
    timeBasis: 'per_unit',
    eligibleQty: completion.goodQty,
    standardMillisecondsPerUnit: 27_360,
  });
  assert.equal(laborPool.totalStandardLaborMilliseconds, 27_360_000n);

  const firstClaim = planLaborClaim({
    eligibleQty: laborPool.eligibleQty,
    claimedQty: 0,
    claimQty: 800,
    totalStandardLaborMilliseconds: laborPool.totalStandardLaborMilliseconds,
    claimedStandardLaborMilliseconds: 0n,
  });
  assert.equal(firstClaim.remainingQty, 200);
  assert.equal(firstClaim.nextStatus, 'PARTIAL');

  const secondClaim = planLaborClaim({
    eligibleQty: laborPool.eligibleQty,
    claimedQty: firstClaim.nextClaimedQty,
    claimQty: 200,
    totalStandardLaborMilliseconds: laborPool.totalStandardLaborMilliseconds,
    claimedStandardLaborMilliseconds: firstClaim.nextClaimedStandardLaborMilliseconds,
  });
  assert.equal(secondClaim.remainingQty, 0);
  assert.equal(secondClaim.nextStatus, 'EXHAUSTED');
  assert.equal(secondClaim.nextClaimedStandardLaborMilliseconds, laborPool.totalStandardLaborMilliseconds);

  const attendance = attendanceTotals({
    attendanceType: 'normal',
    segments: defaultAttendanceSegments('2026-07-25'),
    leaveMinutes: 0,
  });
  const attainment = aggregateDailyAttainment([{
    attendanceMilliseconds: attendance.actualMilliseconds,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: Number(secondClaim.nextClaimedStandardLaborMilliseconds),
    claimedStandardLaborMilliseconds: Number(secondClaim.nextClaimedStandardLaborMilliseconds),
    actualLaborMilliseconds: attendance.actualMilliseconds,
    attendanceConfirmed: true,
  }]);
  assert.equal(attainment.attainmentCapacityMilliseconds, 7.6 * HOUR);
  assert.equal(
    basisPoints(attainment.standardLaborMilliseconds, attainment.attainmentCapacityMilliseconds),
    10_000,
  );
});
