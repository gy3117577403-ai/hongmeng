import assert from 'node:assert/strict';
import test from 'node:test';
import { presentDailyPlanSuggestion, presentDailyPlanWorkbench } from '../lib/daily-plan-presenter';

function team(id: string, name: string) {
  return { id, name, code: id.toUpperCase(), memberships: [] };
}

test('all-team daily plan view is aggregate-only and keeps stable team options', () => {
  const result = presentDailyPlanWorkbench({
    workDate: '2026-08-03',
    shiftCode: 'DAY',
    selectedTeamId: null,
    scope: { isAdmin: true, isSupervisor: false, teamIds: [] },
    teamOptions: [team('team-a', '一组'), team('team-b', '二组')],
    teams: [team('team-a', '一组'), team('team-b', '二组')],
    plans: [
      { id: 'plan-a', teamId: 'team-a', status: 'CONFIRMED', version: 3, tasks: [], capacityOverrides: [] },
      { id: 'plan-b', teamId: 'team-b', status: 'DRAFT', version: 1, tasks: [], capacityOverrides: [] },
    ],
    capacity: [],
    unplannedSuggestions: [],
    blocked: [],
  });

  assert.equal(result.plan.id, null);
  assert.equal(result.plan.isAggregate, true);
  assert.equal(result.plan.teamCount, 2);
  assert.equal(result.plan.generatedTeamCount, 2);
  assert.equal(result.plan.confirmedTeamCount, 1);
  assert.deepEqual(result.teamOptions.map(item => item.id), ['team-a', 'team-b']);
});

test('planned KPI excludes unpersisted suggestions and exposes maintenance reasons', () => {
  const result = presentDailyPlanWorkbench({
    workDate: '2026-08-03',
    shiftCode: 'DAY',
    selectedTeamId: 'team-a',
    scope: { isAdmin: true, isSupervisor: false, teamIds: [] },
    teamOptions: [team('team-a', '一组'), team('team-b', '二组')],
    teams: [team('team-a', '一组')],
    plans: [{
      id: 'plan-a',
      teamId: 'team-a',
      status: 'DRAFT',
      version: 1,
      capacityOverrides: [],
      tasks: [{ id: 'task-a', stepId: 'step-a', workOrderId: 'wo-a', plannedQty: 10, estimatedStandardMilliseconds: 3_600_000, assignments: [], riskWarnings: [] }],
    }],
    capacity: [],
    unplannedSuggestions: [{ stepId: 'step-b', workOrderId: 'wo-b', plannedQty: 10, estimatedStandardMilliseconds: 7_200_000, riskWarnings: [] }],
    blocked: [{
      productionPlanBatchId: 'batch-c',
      workOrderId: 'wo-c',
      workOrderCode: 'WO-C',
      productName: '产品 C',
      reason: 'MISSING_PROCESS_TIME',
      message: '压接工序缺少有效标准工时',
      missingStepNames: ['压接'],
      drawingLibraryItemId: 'drawing-c',
    }],
  });

  assert.equal(result.summary.plannedMinutes, 60);
  assert.equal(result.unassignedTasks.length, 1);
  assert.equal(result.maintenanceItems.length, 1);
  assert.equal(result.maintenanceItems[0].reason, 'MISSING_PROCESS_TIME');
  assert.equal(result.maintenanceItems[0].actionHref, '/workspace/product-times?itemId=drawing-c');
});

test('drawing readiness is a Chinese review warning without hiding or hard-blocking the task', () => {
  const result = presentDailyPlanWorkbench({
    workDate: '2026-08-03',
    shiftCode: 'DAY',
    selectedTeamId: 'team-a',
    scope: { isAdmin: true, isSupervisor: false, teamIds: [] },
    teamOptions: [team('team-a', '一组')],
    teams: [team('team-a', '一组')],
    plans: [{
      id: 'plan-a',
      teamId: 'team-a',
      status: 'DRAFT',
      version: 1,
      capacityOverrides: [],
      tasks: [{
        id: 'task-drawing',
        stepId: 'step-drawing',
        workOrderId: 'wo-drawing',
        status: 'READY',
        plannedQty: 10,
        estimatedStandardMilliseconds: 600_000,
        assignments: [],
        riskWarnings: ['DRAWING_NOT_READY'],
      }],
    }],
    capacity: [],
    unplannedSuggestions: [],
    blocked: [],
  });

  assert.equal(result.tasks[0].status, 'NEEDS_REVIEW');
  assert.equal(result.tasks[0].hardBlocked, false);
  assert.deepEqual(result.tasks[0].warnings, ['图纸尚未下发或确认']);
  assert.equal(result.maintenanceItems.length, 0);
});

test('suggestion presenter returns computed employee recommendations instead of zeros', () => {
  const result = presentDailyPlanSuggestion({
    workDate: '2026-08-03',
    shiftCode: 'DAY',
    team: { id: 'team-a', name: '一组' },
    candidates: [{
      stepId: 'step-a',
      workOrderId: 'wo-a',
      plannedQty: 100,
      estimatedStandardMilliseconds: 3_600_000,
      riskWarnings: [],
    }],
    employeeSuggestions: [{
      stepId: 'step-a',
      employeeId: 'employee-a',
      employeeName: '张三',
      plannedStandardMilliseconds: 1_800_000,
      skillMatched: true,
    }],
    blocked: [],
    unschedulable: [],
  });

  assert.equal(result.assignmentCount, 1);
  assert.equal(result.assignedMinutes, 30);
  assert.equal(result.unassignedMinutes, 30);
  assert.equal(result.assignments[0].employeeName, '张三');
  assert.equal(result.assignments[0].quantity, 100);
});
