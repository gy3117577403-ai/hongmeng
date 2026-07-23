import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProductionPrimaryAction } from '../lib/production-primary-action';

test('active production rows always advance the published route', () => {
  assert.equal(resolveProductionPrimaryAction({
    readOnly: false,
    aggregateCompleted: false,
    awaitingBranchClosure: false,
    canAdministerProduction: true,
    routeNeedsMaintenance: false,
    drawingNotIssued: false,
  }), 'advance_route');
});

test('read-only and completed rows remain inspection actions', () => {
  assert.equal(resolveProductionPrimaryAction({
    readOnly: true,
    aggregateCompleted: false,
    awaitingBranchClosure: false,
    canAdministerProduction: true,
    routeNeedsMaintenance: false,
    drawingNotIssued: false,
  }), 'view_detail');
  assert.equal(resolveProductionPrimaryAction({
    readOnly: false,
    aggregateCompleted: true,
    awaitingBranchClosure: false,
    canAdministerProduction: true,
    routeNeedsMaintenance: false,
    drawingNotIssued: false,
  }), 'view_workflow');
  assert.equal(resolveProductionPrimaryAction({
    readOnly: false,
    aggregateCompleted: false,
    awaitingBranchClosure: true,
    canAdministerProduction: true,
    routeNeedsMaintenance: false,
    drawingNotIssued: false,
  }), 'view_workflow');
});

test('non-administrators inspect unpublished route states instead of mutating them', () => {
  assert.equal(resolveProductionPrimaryAction({
    readOnly: false,
    aggregateCompleted: false,
    awaitingBranchClosure: false,
    canAdministerProduction: false,
    routeNeedsMaintenance: true,
    drawingNotIssued: false,
  }), 'view_detail');
  assert.equal(resolveProductionPrimaryAction({
    readOnly: false,
    aggregateCompleted: false,
    awaitingBranchClosure: false,
    canAdministerProduction: false,
    routeNeedsMaintenance: false,
    drawingNotIssued: true,
  }), 'view_detail');
});
