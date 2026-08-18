import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRecordableShipment,
  assertScheduledQuantity,
  carryoverPlannedShipAt,
  completionPercentage,
  netShipmentQuantity,
  parsePlannedShipmentTime,
  parseShipmentDate,
  shipmentItemStatus,
  shipmentPriority,
  shipmentPriorityRank,
  shipmentProgressState,
  shipmentReservationQuantity,
  shiftShipmentDateKey,
  shipmentWeek,
} from '@/lib/daily-shipment-domain';

test('shipment date and week use a stable Monday-to-Sunday business range', () => {
  assert.equal(parseShipmentDate('2026-08-07').key, '2026-08-07');
  assert.deepEqual(shipmentWeek('2026-08-07').dates, [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
    '2026-08-08',
    '2026-08-09',
  ]);
  assert.throws(() => parseShipmentDate('2026-02-30'), /有效的出货日期/);
});

test('planned shipment time is interpreted in Shanghai and cannot escape the selected day', () => {
  assert.equal(
    parsePlannedShipmentTime('2026-08-07T16:30', '2026-08-07').toISOString(),
    '2026-08-07T08:30:00.000Z',
  );
  assert.throws(
    () => parsePlannedShipmentTime('2026-08-08T00:05+08:00', '2026-08-07'),
    /必须在 2026-08-07 当天/,
  );
});

test('split planning cannot make cumulative daily allocations exceed the production batch', () => {
  assert.doesNotThrow(() => assertScheduledQuantity({
    batchQuantity: 120,
    alreadyScheduledQuantity: 70,
    requestedQuantity: 50,
  }));
  assert.throws(() => assertScheduledQuantity({
    batchQuantity: 120,
    alreadyScheduledQuantity: 70,
    requestedQuantity: 51,
  }), /超过批次数量 120/);
});

test('actual shipment is capped by both the day plan and completed-good quantity', () => {
  assert.doesNotThrow(() => assertRecordableShipment({
    plannedQuantity: 50,
    itemShippedQuantity: 20,
    batchCompletedQuantity: 80,
    batchShippedQuantity: 50,
    requestedQuantity: 30,
  }));
  assert.throws(() => assertRecordableShipment({
    plannedQuantity: 50,
    itemShippedQuantity: 20,
    batchCompletedQuantity: 100,
    batchShippedQuantity: 50,
    requestedQuantity: 31,
  }), /超过该日计划数量/);
  assert.throws(() => assertRecordableShipment({
    plannedQuantity: 60,
    itemShippedQuantity: 20,
    batchCompletedQuantity: 79,
    batchShippedQuantity: 50,
    requestedQuantity: 30,
  }), /超过已完工良品数量 79/);
});

test('reversal events reduce net shipment without erasing the original evidence', () => {
  const events = [
    { eventType: 'SHIPMENT', quantity: 30 },
    { eventType: 'SHIPMENT', quantity: 20 },
    { eventType: 'REVERSAL', quantity: 8 },
  ];
  assert.equal(netShipmentQuantity(events), 42);
  assert.equal(shipmentItemStatus(50, 42), 'PARTIALLY_SHIPPED');
  assert.equal(shipmentItemStatus(42, 42), 'SHIPPED');
});

test('visible state prioritizes shipped, partial and overdue before production readiness', () => {
  const future = new Date('2026-08-07T08:00:00.000Z');
  const now = new Date('2026-08-07T07:00:00.000Z');
  assert.equal(shipmentProgressState({
    plannedQuantity: 10,
    shippedQuantity: 10,
    completedQuantity: 10,
    plannedShipAt: future,
    now,
  }), 'SHIPPED');
  assert.equal(shipmentProgressState({
    plannedQuantity: 10,
    shippedQuantity: 2,
    completedQuantity: 10,
    plannedShipAt: future,
    now,
  }), 'PARTIAL');
  assert.equal(shipmentProgressState({
    plannedQuantity: 10,
    shippedQuantity: 0,
    completedQuantity: 10,
    plannedShipAt: new Date('2026-08-07T06:59:00.000Z'),
    now,
  }), 'OVERDUE');
  assert.equal(shipmentProgressState({
    plannedQuantity: 10,
    shippedQuantity: 0,
    completedQuantity: 10,
    plannedShipAt: future,
    now,
  }), 'READY');
  assert.equal(completionPercentage(3, 8), 37.5);
});

test('shipment priorities have a stable red-yellow-blue order', () => {
  assert.deepEqual(
    ['NORMAL', 'URGENT', 'PRIORITY'].map(shipmentPriority).sort((first, second) => (
      shipmentPriorityRank(first) - shipmentPriorityRank(second)
    )),
    ['URGENT', 'PRIORITY', 'NORMAL'],
  );
  assert.throws(() => shipmentPriority('critical'), /有效的出货优先级/);
});

test('carryover keeps Shanghai shipment time and reserves only historical shipped quantity', () => {
  assert.equal(shiftShipmentDateKey('2026-08-19', 1), '2026-08-20');
  assert.equal(
    carryoverPlannedShipAt(new Date('2026-08-19T08:35:00.000Z'), '2026-08-20').toISOString(),
    '2026-08-20T08:35:00.000Z',
  );
  assert.equal(shipmentReservationQuantity({
    status: 'CARRIED_OVER',
    plannedQuantity: 100,
    events: [
      { eventType: 'SHIPMENT', quantity: 45 },
      { eventType: 'REVERSAL', quantity: 5 },
    ],
  }), 40);
  assert.equal(shipmentProgressState({
    plannedQuantity: 100,
    shippedQuantity: 40,
    completedQuantity: 100,
    plannedShipAt: new Date('2026-08-19T08:35:00.000Z'),
    itemStatus: 'CARRIED_OVER',
  }), 'CARRIED_OVER');
});
