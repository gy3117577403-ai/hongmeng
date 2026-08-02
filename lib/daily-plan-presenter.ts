import { createHash } from 'node:crypto';

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
  const warnings = Array.isArray(task.riskWarnings) ? task.riskWarnings.map((value) => asText(value)) : [];
  const dueDate = task.dueDate || null;
  const priority = asNumber(task.priority);
  const hardBlocked = Boolean(task.hardBlocked || task.reason === 'MISSING_PUBLISHED_PROCESS_ROUTE');
  return {
    id: asText(task.id || `suggestion:${task.stepId}`), planId: task.planId || fallbackPlanId || null,
    workOrderId: asText(task.workOrderId || order.id), workOrderCode: asText(task.workOrderCode || order.code),
    productCode: asText(order.code || task.workOrderCode), productName: asText(task.productName || order.productName),
    customerName: task.customerName || order.customerName || null, processStepId: asText(task.stepId),
    processName: asText(task.processName), processSequence: asNumber(task.position), sequenceGroup: asNumber(task.sequenceGroup),
    status: asText(task.status, hardBlocked ? 'UNPLANNED' : 'READY'), version: asNumber(task.version),
    plannedQuantity, remainingQuantity: Math.max(0, plannedQuantity - assignedQuantity),
    availableQuantity: asNumber(task.availableQty), assignedQuantity,
    unitStandardSeconds: asNumber(task.standardMillisecondsPerUnit) / 1000, plannedMinutes: minutes(plannedMs),
    dueDate, priority, priorityLabel: task.priorityReason || null,
    riskLevel: hardBlocked ? 'CRITICAL' : warnings.length ? 'WARNING' : priority >= 300 ? 'HIGH' : 'INFO',
    teamId: task.teamId || null, teamName: task.teamName || null, routeVersion: asNumber(task.routeVersion),
    routeVersionLabel: task.routeVersion ? `V${task.routeVersion}` : null, hardBlocked,
    hardBlockReason: hardBlocked ? asText(task.message || task.reason, '缺少有效且已发布的工序与工时版本') : null,
    warnings, upstreamProcessName: task.upstreamProcessName || null, assignments,
  };
}

export function presentDailyPlanWorkbench(value: unknown) {
  const raw = asRecord(value);
  const scopeRaw = asRecord(raw.scope);
  const teamsRaw = asArray(raw.teams);
  const plans = asArray(raw.plans);
  const selectedPlan = plans[0] || {};
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
  const plannedMinutes = tasks.reduce((sum, task) => sum + task.plannedMinutes, 0) + unplannedTasks.reduce((sum, task) => sum + task.plannedMinutes, 0);
  const assignedMinutes = tasks.flatMap(task => task.assignments).reduce((sum, assignment) => sum + assignment.plannedMinutes, 0);
  const blocked = asArray(raw.blocked);
  const risks = [
    ...blocked.map((item, index) => ({ id: `blocked:${index}`, level: 'CRITICAL', title: '工序与工时未发布', description: asText(item.message), workOrderCode: asText(item.workOrderCode), actionLabel: '配置工序与工时' })),
    ...tasks.filter(task => task.warnings.length).map(task => ({ id: `task:${task.id}`, level: task.riskLevel, title: task.workOrderCode, description: task.warnings.join('、'), taskId: task.id, workOrderCode: task.workOrderCode, actionLabel: '查看任务' })),
  ];
  const isAdmin = Boolean(scopeRaw.isAdmin);
  const isSupervisor = Boolean(scopeRaw.isSupervisor);
  return {
    generatedAt: new Date().toISOString(), workDate: asText(raw.workDate),
    shift: { code: asText(raw.shiftCode, 'DAY'), label: '白班', startTime: '08:00', endTime: '17:00', lunchStartTime: '12:00', lunchEndTime: '13:00' },
    plan: { id: selectedPlan.id || null, status: asText(selectedPlan.status, 'DRAFT'), version: asNumber(selectedPlan.version), confirmedAt: selectedPlan.confirmedAt || null, confirmedByName: null },
    scope: { role: isAdmin ? 'ADMIN' : isSupervisor ? 'WORKSHOP_SUPERVISOR' : 'TEAM_LEADER', teamIds: Array.isArray(scopeRaw.teamIds) ? scopeRaw.teamIds : [], canConfirm: isAdmin || isSupervisor, canManageOrganization: isAdmin, canRequestCrossTeam: true },
    summary: { plannedMinutes, assignedMinutes, unassignedMinutes: Math.max(0, plannedMinutes - assignedMinutes), urgentTaskCount: tasks.filter(task => task.riskLevel === 'HIGH' || task.riskLevel === 'CRITICAL').length, overloadedEmployeeCount: employees.filter(employee => employee.assignedMinutes > employee.capacityMinutes + employee.overtimeMinutes).length, carryOverTaskCount: tasks.filter(task => task.status === 'PENDING_CARRY_OVER').length },
    teams: teamsRaw.map(team => { const leader = asArray(team.memberships).find(item => item.role === 'TEAM_LEADER'); const leaderEmployee = asRecord(leader?.employee); return { id: asText(team.id), name: asText(team.name), code: team.code || null, leaderId: leaderEmployee.id || null, leaderName: leaderEmployee.name || null, memberCount: asArray(team.memberships).filter(item => item.role !== 'WORKSHOP_SUPERVISOR').length }; }),
    employees, tasks, unassignedTasks: unplannedTasks, risks,
  };
}

export function presentDailyPlanSuggestion(value: unknown) {
  const raw = asRecord(value);
  const candidates = asArray(raw.candidates).map(task => taskView(task, null));
  const assignedMinutes = 0;
  return {
    suggestionKey: createHash('sha256').update(JSON.stringify({ workDate: raw.workDate, shiftCode: raw.shiftCode, team: asRecord(raw.team).id, tasks: candidates.map(task => [task.workOrderId, task.processStepId, task.plannedQuantity]) })).digest('hex'),
    workDate: asText(raw.workDate), shiftCode: asText(raw.shiftCode, 'DAY'), teamId: asRecord(raw.team).id || null,
    taskCount: candidates.length, assignmentCount: 0, assignedMinutes,
    unassignedMinutes: candidates.reduce((sum, task) => sum + task.plannedMinutes, 0), overloadedEmployeeCount: 0,
    warnings: asArray(raw.blocked).map(item => asText(item.message || item.reason)), assignments: [],
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
  const teams = asArray(raw.teams).map(team => ({ id: asText(team.id), version: asNumber(team.version), code: team.code || null, name: asText(team.name), legacyTeamName: team.legacyTeamName || null, sortOrder: asNumber(team.sortOrder), isActive: Boolean(team.isActive), members: asArray(team.memberships).map(member => { const employee = asRecord(member.employee); return { id: asText(member.id), version: asNumber(member.version), employeeId: asText(member.employeeId), employeeNo: asText(employee.employeeNo), employeeName: asText(employee.name), position: employee.position || null, planningRole: asText(member.role), teamId: member.teamId || null, isActive: Boolean(member.isActive), effectiveFrom: member.effectiveFrom || null, effectiveTo: member.effectiveTo || null }; }) }));
  return { version: Math.max(0, ...teams.map(team => team.sortOrder || 0)), availableEmployees: raw.unassignedEmployees || [], teams };
}
