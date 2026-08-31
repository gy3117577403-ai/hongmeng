import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderQrTicketStatus } from '@prisma/client';
import {
  ensureFieldReportParticipants,
  fieldReportCodeIsValid,
  resolveFieldReportAccess,
} from '../lib/work-order-qr-service';

const executableOrder = {
  planType: 'weekly_plan',
  planClearedAt: null,
  stage: 'in_progress',
  deletedAt: null,
};

test('field report codes reject short or malformed values', () => {
  assert.equal(fieldReportCodeIsValid('abc'), false);
  assert.equal(fieldReportCodeIsValid('not valid because spaces'), false);
  assert.equal(fieldReportCodeIsValid('Abcdefghijklmnopqrstuvwx_1234'), true);
});

test('mobile reporting always includes the logged-in employee once', () => {
  assert.deepEqual(
    ensureFieldReportParticipants('employee-self', ['helper-1', 'employee-self', '', 'helper-1']),
    ['employee-self', 'helper-1'],
  );
  assert.deepEqual(ensureFieldReportParticipants('', ['helper-1']), []);
  assert.equal(
    ensureFieldReportParticipants('employee-self', Array.from({ length: 40 }, (_, index) => `helper-${index}`)).length,
    30,
  );
});

test('ticket access is reportable only for active in-progress routes', () => {
  assert.deepEqual(
    resolveFieldReportAccess({
      ticketStatus: WorkOrderQrTicketStatus.ACTIVE,
      workOrder: executableOrder,
      route: { status: 'in_progress' },
    }),
    { canReport: true, state: 'READY', message: '工单生产中，可选择任意未完成工序报工' },
  );
  assert.equal(resolveFieldReportAccess({
    ticketStatus: WorkOrderQrTicketStatus.REVOKED,
    workOrder: executableOrder,
    route: { status: 'in_progress' },
  }).state, 'REVOKED');
  assert.equal(resolveFieldReportAccess({
    ticketStatus: WorkOrderQrTicketStatus.ACTIVE,
    workOrder: { ...executableOrder, stage: 'completed' },
    route: { status: 'completed' },
  }).state, 'COMPLETED');
  assert.equal(resolveFieldReportAccess({
    ticketStatus: WorkOrderQrTicketStatus.ACTIVE,
    workOrder: executableOrder,
    route: { status: 'confirmed' },
  }).state, 'WAITING_START');
  const blockedByMaterial = resolveFieldReportAccess({
    ticketStatus: WorkOrderQrTicketStatus.ACTIVE,
    workOrder: executableOrder,
    route: { status: 'in_progress' },
    materialExecutionAllowed: false,
  });
  assert.equal(blockedByMaterial.state, 'READY');
  assert.equal(blockedByMaterial.canReport, true);
});
