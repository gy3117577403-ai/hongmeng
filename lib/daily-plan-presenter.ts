import { createHash } from 'node:crypto';
import {
  dailyPlanWarningTexts,
  displayTeamCode,
} from '@/lib/daily-plan-readiness';

type AnyRecord = Record<string, any>;

const asRecord = (value: unknown): AnyRecord => value && typeof value === 'object' ? value as AnyRecord : {};
const asArray = (value: unknown): AnyRecord[] => Array.isArray(value) ? value.map(asRecord) : [];
const asNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const asText = (value: unknown, fallback = ''): string => value == null ? fallback : String(value);
const minutes = (value: unknown): number => Math.max(0, Math.round(asNumber(value) / 60_000));

function assignmentView(value: unknown) {
  const item = asRecord(value);
  const employee = asRecord(item.employee);
  const team = asRecord(item.assignedTeam);
  return {
    id: asText(item.id), taskId: asText(item.taskId), employeeId: asText(item.employeeId || employee.id),
    employeeNo: asText(employee.employeeNo), employeeName: asText(employee.name, '未配置员工'),
    teamId: asText(item.assignedTeamId || team.id), teamName: asText(team.name), quantity: asNumber(item.quantity),
    plannedMinutes: minutes(item.plannedStandardMilliseconds), order: asNumber(item.sortOrder),
    status: asText(item.status, 'PLANNED'), version: asNumber(item.version), overtimeStart: item.overtimeStartAt || null,
    overtimeEnd: item.overtimeEndAt || null, actualCompletedQuantity: asNumber(item.actualCompletedQuantity),
    actualClaimedMinutes: minutes(item.actualClaimedMilliseconds), laborPoolQuantity: asNumber(item.laborPoolQuantity),
  };
}

function taskView(value: unknown, fallbackPlanId?: string | null) {
  const task = asRecord(value);
  const order = asRecord(task.workOrder);
  const assignments = asArray(task.assignments).map(assignmentView);
  const plannedQuantity = asNumber(task.plannedQty);
  const assignedQuantity = assignments.reduce((sum, item) => sum + item.quantity, 0);
  const plannedMs = asNumber(task.estimatedStandardMilliseconds)
    || asNumber(task.setupMilliseconds) + plannedQuantity * asNumber(task.standardMillisecondsPerUnit);
  const warningView = dailyPlanWarningTexts(task.riskWarnings);
  const warnings = warningView.labels;
  const dueDate = task.dueDate || null;
  const priority = asNumber(task.priority);
  const hardBlocked = Boolean(task.hardBlocked || task.reason === 'MISSING_PUBLISHED_PROCESS_ROUTE');
  const needsReview = warningView.codes.includes('DRAWING_NOT_READY');
  const rawStatus = asText(task.status, hardBlocked ? 'NEEDS_REVIEW' : 'READY');
  const status = (hardBlocked || needsReview) && rawStatus !== 'COMPLETED' && rawStatus !== 'CANCELLED'
    ? 'NEEDS_REVIEW'
    : rawStatus;
  return {
    id: asText(task.id || `suggestion:${task.stepId}`), planId: task.planId || fallbackPlanId || null,
    workOrderId: asText(task.workOrderId || order.id), workOrderCode: asText(task.workOrderCode || order.code),
    productCode: asText(order.code || task.workOrderCode), productName: asText(task.productName || order.productName),
    customerName: task.customerName || order.customerName || null, processStepId: asText(task.stepId),
    processName: asText(task.processName), processSequence: asNumber(task.position), sequenceGroup: asNumber(task.sequenceGroup),
    status, version: asNumber(task.version),
    plannedQuantity, remainingQuantity: Math.max(0, plannedQuantity - assignedQuantity),
    availableQuantity: asNumber(task.availableQty), assignedQuantity,
    unitStandardSeconds: asNumber(task.standardMillisecondsPerUnit) / 1000, plannedMinutes: minutes(plannedMs),
    dueDate, priority, priorityLabel: task.priorityReason || null,
    riskLevel: hardBlocked ? 'CRITICAL' : warnings.length ? 'WARNING' : priority >= 300 ? 'HIGH' : 'INFO',
    teamId: task.teamId || null, teamName: task.teamName || null, routeVersion: asNumber(task.routeVersion),
    routeVersionLabel: task.routeVersion ? `V${task.routeVersion}` : null, hardBlocked,
    hardBlockReason: hardBlocked ? asText(task.message || task.reason, '缺少有效且已发布的工序与工时版本') : null,
    warningCodes: warningView.codes, warnings, upstreamProcessName: task.upstreamProcessName || null, assignments,
  };
}

function teamView(value: unknown) {
  const team = asRecord(value);
  const memberships = asArray(team.memberships);
  const leader = memberships.find(item => item.role === 'TEAM_LEADER');
  const leaderEmployee = asRecord(leader?.employee);
  return {
    id: asText(team.id),
    name: asText(team.name),
    code: displayTeamCode(team.code),
    leaderId: leaderEmployee.id || null,
    leaderName: leaderEmployee.name || null,
    memberCount: memberships.filter(item => item.role !== 'WORKSHOP_SUPERVISOR').length,
  };
}

export function presentDailyPlanWorkbench(value: unknown) {
  const raw = asRecord(value);
  const weeklyPoolRaw = asRecord(raw.weeklyPool);
  const scopeRaw = asRecord(raw.scope);
  const teamsRaw = asArray(raw.teams);
  const teamOptionsRaw = asArray(raw.teamOptions);
  const plans = asArray(raw.plans);
  const selectedTeamId = asText(raw.selectedTeamId) || null;
  const selectedPlan = selectedTeamId
    ? plans.find(plan => asText(plan.teamId) === selectedTeamId) || plans[0] || {}
    : {};
  const capacities = new Map(asArray(raw.capacity).map(item => [asText(item.employeeId), item]));
  const tasks = plans.flatMap(plan => asArray(plan.tasks).map(task => taskView(task, asText(plan.id))));
  const unplannedTasks = asArray(raw.unplannedSuggestions).map(task => taskView(task, null));
  const employees = teamsRaw.flatMap(team => asArray(team.memberships).map(membership => {
    const employee = asRecord(membership.employee);
    const capacity = asRecord(capacities.get(asText(employee.id)));
    const assignments = tasks.flatMap(task => task.assignments).filter(item => item.employeeId === employee.id);
    return {
      id: asText(employee.id), employeeNo: asText(employee.employeeNo), name: asText(employee.name),
      position: employee.position || null, teamId: asText(team.id), teamName: asText(team.name),
      planningRole: asText(membership.role) === 'MEMBER' ? 'EMPLOYEE' : asText(membership.role),
      attendanceSource: asText(capacity.source, 'DEFAULT_8H'), capacityMinutes: minutes(capacity.totalMilliseconds || capacity.regularMilliseconds),
      overtimeMinutes: minutes(capacity.overtimeMilliseconds), assignedMinutes: assignments.reduce((s, a) => s + a.plannedMinutes, 0),
      completedMinutes: assignments.filter(a => a.status === 'COMPLETED').reduce((s, a) => s + a.plannedMinutes, 0), assignments,
    };
  }));
  const employeeOptions = [...new Map(teamOptionsRaw.flatMap(team => asArray(team.memberships).map(membership => {
    const employee = asRecord(membership.employee);
    return [asText(employee.id), {
      id: asText(employee.id),
      employeeNo: asText(employee.employeeNo),
      name: asText(employee.name),
      teamId: asText(team.id),
      teamName: asText(team.name),
    }] as const;
  }))).values()];
  const plannedMinutes = tasks.reduce((sum, task) => sum + task.plannedMinutes, 0);
  const assignedMinutes = tasks.flatMap(task => task.assignments).reduce((sum, assignment) => sum + assignment.plannedMinutes, 0);
  const blocked = asArray(raw.blocked);
  const maintenanceItems = blocked.filter(item => !item.nonMaintenance).map((item, index) => {
    const drawingLibraryItemId = asText(item.drawingLibraryItemId);
    return {
      id: asText(item.productionPlanBatchId, `blocked:${index}`),
      workOrderId: asText(item.workOrderId),
      workOrderCode: asText(item.workOrderCode),
      productName: asText(item.productName),
      customerName: asText(item.customerName),
      reason: asText(item.reason, 'MISSING_PROCESS_TIME'),
      message: asText(item.message, '缺少有效且已发布的工序与工时版本'),
      missingStepNames: Array.isArray(item.missingStepNames) ? item.missingStepNames.map(name => asText(name)).filter(Boolean) : [],
      actionHref: asText(item.reason) === 'DRAWING_NOT_READY'
        ? drawingLibraryItemId
          ? `/drawing-library?itemId=${encodeURIComponent(drawingLibraryItemId)}`
          : '/drawing-library'
        : drawingLibraryItemId
          ? `/workspace/product-times?itemId=${encodeURIComponent(drawingLibraryItemId)}`
          : '/workspace/product-times',
    };
  });
  const risks = [
    ...maintenanceItems.map(item => ({ id: `blocked:${item.id}`, level: 'CRITICAL', title: '工序与工时待维护', description: item.message, workOrderCode: item.workOrderCode, actionLabel: '配置工序与工时', actionHref: item.actionHref })),
    ...tasks.filter(task => task.warnings.length).map(task => ({ id: `task:${task.id}`, level: task.riskLevel, title: task.workOrderCode, description: task.warnings.join('、'), taskId: task.id, workOrderCode: task.workOrderCode, actionLabel: '查看任务' })),
  ];
  const isAdmin = Boolean(scopeRaw.isAdmin);
  const isSupervisor = Boolean(scopeRaw.isSupervisor);
  const confirmedStatuses = new Set(['CONFIRMED', 'IN_PROGRESS', 'ARCHIVED']);
  const generatedTeamCount = plans.length;
  const confirmedTeamCount = plans.filter(plan => confirmedStatuses.has(asText(plan.status))).length;
  const teamCount = teamOptionsRaw.length;
  return {
    generatedAt: new Date().toISOString(), workDate: asText(raw.workDate),
    shift: { code: asText(raw.shiftCode, 'DAY'), label: '白班', startTime: '08:00', endTime: '17:00', lunchStartTime: '12:00', lunchEndTime: '13:00' },
    plan: {
      id: selectedTeamId ? selectedPlan.id || null : null,
      status: asText(selectedPlan.status, 'DRAFT'),
      version: selectedTeamId ? asNumber(selectedPlan.version) : 0,
      confirmedAt: selectedTeamId ? selectedPlan.confirmedAt || null : null,
      confirmedByName: null,
      isAggregate: !selectedTeamId,
      teamCount,
      generatedTeamCount,
      confirmedTeamCount,
    },
    selectedTeamId,
    scope: { role: isAdmin ? 'ADMIN' : isSupervisor ? 'WORKSHOP_SUPERVISOR' : 'TEAM_LEADER', teamIds: Array.isArray(scopeRaw.teamIds) ? scopeRaw.teamIds : [], canConfirm: isAdmin || isSupervisor, canManageOrganization: isAdmin, canRequestCrossTeam: true },
    summary: { plannedMinutes, assignedMinutes, unassignedMinutes: Math.max(0, plannedMinutes - assignedMinutes), urgentTaskCount: tasks.filter(task => task.riskLevel === 'HIGH' || task.riskLevel === 'CRITICAL').length, overloadedEmployeeCount: employees.filter(employee => employee.assignedMinutes > employee.capacityMinutes + employee.overtimeMinutes).length, carryOverTaskCount: tasks.filter(task => task.status === 'PENDING_CARRY_OVER').length },
    weeklyPool: {
      weekStartDate: asText(weeklyPoolRaw.weekStartDate),
      weekEndDate: asText(weeklyPoolRaw.weekEndDate),
      availableTaskCount: asNumber(weeklyPoolRaw.availableTaskCount),
      alreadyPlannedTaskCount: asNumber(weeklyPoolRaw.alreadyPlannedTaskCount),
      processOwnershipConfigured: Boolean(weeklyPoolRaw.processOwnershipConfigured),
      teamCapabilityCount: asNumber(weeklyPoolRaw.teamCapabilityCount),
    },
    teamOptions: teamOptionsRaw.map(teamView),
    teams: teamsRaw.map(teamView),
    employeeOptions,
    employees,
    tasks,
    unassignedTasks: unplannedTasks,
    maintenanceItems,
    risks,
  };
}

export function presentDailyPlanSuggestion(value: unknown) {
  const raw = asRecord(value);
  const candidates = asArray(raw.candidates).map(task => taskView(task, null));
  const candidateByStep = new Map(candidates.map(task => [task.processStepId, task]));
  const team = asRecord(raw.team);
  const assignments = asArray(raw.employeeSuggestions).map(item => {
    const task = candidateByStep.get(asText(item.stepId));
    const skillMatched = Boolean(item.skillMatched);
    return {
      taskId: task?.id || `suggestion:${asText(item.stepId)}`,
      employeeId: asText(item.employeeId),
      employeeName: asText(item.employeeName),
      teamName: asText(team.name),
      quantity: task?.plannedQuantity || 0,
      plannedMinutes: minutes(item.plannedStandardMilliseconds),
      reason: skillMatched ? '技能匹配且当日容量可用' : '按剩余容量推荐，技能匹配待确认',
    };
  });
  const assignedMinutes = assignments.reduce((sum, item) => sum + item.plannedMinutes, 0);
  const totalMinutes = candidates.reduce((sum, task) => sum + task.plannedMinutes, 0);
  const blockedWarnings = asArray(raw.blocked)
    .filter(item => !item.nonMaintenance)
    .map(item => asText(item.message || item.reason)).filter(Boolean);
  const unschedulableCount = asArray(raw.unschedulable).length;
  const warnings = [...new Set([
    ...blockedWarnings,
    ...(unschedulableCount ? [`${unschedulableCount} 道工序暂无剩余人员容量，生成后需人工安排`] : []),
  ])];
  return {
    suggestionKey: createHash('sha256').update(JSON.stringify({ workDate: raw.workDate, shiftCode: raw.shiftCode, team: asRecord(raw.team).id, tasks: candidates.map(task => [task.workOrderId, task.processStepId, task.plannedQuantity]) })).digest('hex'),
    workDate: asText(raw.workDate), shiftCode: asText(raw.shiftCode, 'DAY'), teamId: asRecord(raw.team).id || null,
    taskCount: candidates.length, assignmentCount: assignments.length, assignedMinutes,
    unassignedMinutes: Math.max(0, totalMinutes - assignedMinutes), overloadedEmployeeCount: 0,
    warnings, assignments,
  };
}

export function presentCrossTeamRequests(value: unknown) {
  return asArray(value).map(item => {
    const task = asRecord(item.task); const order = asRecord(task.workOrder);
    return { id: asText(item.id), taskId: asText(item.taskId), workOrderCode: asText(order.code), processName: asText(task.processName), sourceTeamId: item.requestingTeamId || null, sourceTeamName: asRecord(item.requestingTeam).name || null, targetTeamId: asText(item.targetTeamId), targetTeamName: asText(asRecord(item.targetTeam).name), employeeId: item.employeeId || null, employeeName: asRecord(item.employee).name || null, quantity: asNumber(item.quantity), reason: asText(item.reason), status: asText(item.status), version: asNumber(item.version), requestedByName: asText(asRecord(item.requestedBy).displayName), requestedAt: asText(item.createdAt) };
  });
}

export function presentOrganization(value: unknown) {
  const raw = asRecord(value);
  const teams = asArray(raw.teams).map(team => ({
    id: asText(team.id),
    version: asNumber(team.version),
    code: displayTeamCode(team.code),
    name: asText(team.name),
    legacyTeamName: team.legacyTeamName || null,
    sortOrder: asNumber(team.sortOrder),
    isActive: Boolean(team.isActive),
    capabilities: asArray(team.processCapabilities).map(capability => ({
      id: asText(capability.id),
      version: asNumber(capability.version),
      processDefinitionId: asText(capability.processDefinitionId),
      processCode: asText(asRecord(capability.processDefinition).code),
      processName: asText(asRecord(capability.processDefinition).name),
      priority: asNumber(capability.priority),
      isActive: Boolean(capability.isActive),
    })),
    members: asArray(team.memberships).map(member => { const employee = asRecord(member.employee); return { id: asText(member.id), version: asNumber(member.version), employeeId: asText(member.employeeId), employeeNo: asText(employee.employeeNo), employeeName: asText(employee.name), position: employee.position || null, planningRole: asText(member.role), teamId: member.teamId || null, isActive: Boolean(member.isActive), effectiveFrom: member.effectiveFrom || null, effectiveTo: member.effectiveTo || null }; }),
  }));
  const processDefinitions = asArray(raw.processDefinitions).map(process => ({
    id: asText(process.id),
    code: asText(process.code),
    name: asText(process.name),
    stageGroup: asText(process.stageGroup),
  }));
  return { version: Math.max(0, ...teams.map(team => team.sortOrder || 0)), availableEmployees: raw.unassignedEmployees || [], processDefinitions, teams };
}
