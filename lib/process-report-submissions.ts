import crypto from 'node:crypto';
import { Prisma, ProcessCompletionSource, type ProcessReportSubmission } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chinaTodayDateKey, dateKeyFromDatabase, parseWorkDate } from '@/lib/attendance';
import { chinaWeekRange } from '@/lib/production-planning';
import type { HistoricalWipReportingAuthorization } from '@/lib/wip-reporting';
import { canAccessApiRoute } from '@/lib/api-route-access';
import { hasCapability, resolveAccessContext, type AccessGrant } from '@/lib/department-access';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';
import { assertProductionMayRun } from '@/lib/production-pause-guard';
import { matchesProductionTeam, resolveProductionEntityScope } from '@/lib/production-access-scope';
import { canManageWipWarehouse } from '@/lib/wip-access';
import { isExecutableProductionWorkOrder } from '@/lib/work-orders';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import { createSystemNotification } from '@/lib/system-notifications';
import { pendingProcessReportReservations } from '@/lib/process-report-reservations';
import { loadReportingWipSources } from '@/lib/reporting-source-context';
import { getProcessStepPublishedContract, repairUnreportedProcessStepContract } from '@/lib/process-report-contract';
import { rescheduleWipAllocationInTransaction, scheduleWipLotInTransaction, WipWarehouseError } from '@/lib/wip-warehouse';
import { ProductionControlError } from '@/lib/production-control';
import { resolveProcessLaborPoolStandardInTransaction } from '@/lib/process-labor-service';
import { completeProcessSupplementObligationInTransaction, ProcessRouteChangeServiceError } from '@/lib/process-route-change-service';
import { processSupplementActualRequiredQty } from '@/lib/process-supplement-coverage';
import { completeProcessStepInTransaction, parseProcessCompletionCommand, ProcessCompletionServiceError, processCompletionTargetQuantity,
  type CompleteProcessStepCommand, type ProcessCompletionResult } from '@/lib/process-completion-service';
import type { ReportRecoverySourceOption, ReportSubmissionDto, ReportSubmissionPreview,
  ReportSubmissionResolutionInput, ReportingSourceInput } from '@/lib/process-report-submission-contract';

const reasonLabels: Record<string, string> = {
  STANDARD_MISMATCH: '工序报工口径待核对', STANDARD_MISSING: '数量已登记，工时待核定',
  WIP_SOURCE_REQUIRED: '半成品来源待确认', WIP_WEEK_CONFIRMATION: '半成品续作周次待确认',
};
const recoverableCodes: Record<string, string> = {
  PROCESS_ACTION_REPORT_STANDARD_INVALID: 'STANDARD_MISMATCH',
  WIP_SOURCE_REPORT_EXCEEDS_NATIVE: 'WIP_SOURCE_REQUIRED',
  WIP_ALLOCATION_NOT_REPORTABLE: 'WIP_WEEK_CONFIRMATION',
};
const sourceType = 'process_reporting_submission';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const text = (value: unknown) => String(value ?? '').trim();
const errorCode = (error: unknown) => text((error as { code?: unknown })?.code);
const errorMessage = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError
  || error instanceof Prisma.PrismaClientValidationError ? '数据库操作尚未完成，原申报保留，请稍后刷新重试'
  : error instanceof Error ? error.message : '处理未完成，请刷新查看当前条件';
function fail(message: string, code: string, status = 409): never { throw new ProcessCompletionServiceError(message, status, code); }
type Tx = Prisma.TransactionClient;
type Input = CompleteProcessStepCommand & { allowPending?: boolean; source?: ReportingSourceInput; expectedUserId?: unknown; ticketCode?: string; reportingAccessAllowed?: boolean;
  obligationId?: string; expectedObligationVersion?: unknown };
type SubmitResult = { pending: false; data: ProcessCompletionResult } | { pending: true; submission: ReportSubmissionDto };

export function reportingSubmissionReason(error: unknown): string | null { return recoverableCodes[errorCode(error)] || null; }

/** Fingerprint includes identity and exact units, but not retry-time transport metadata. */
export function reportingSubmissionFingerprint(command: CompleteProcessStepCommand, source?: ReportingSourceInput): string {
  const parsed = parseProcessCompletionCommand(command);
  return crypto.createHash('sha256').update(JSON.stringify({
    routeId: parsed.routeId, stepId: parsed.stepId, processedQty: parsed.processedQty, defectQty: parsed.defectQty,
    reportedUnitQty: parsed.reportedUnitQty, reportedDefectUnitQty: parsed.reportedDefectUnitQty,
    defectDisposition: parsed.defectDisposition, workDate: parsed.workDateKey,
    workStartedAt: parsed.workStartedAt, workEndedAt: parsed.workEndedAt,
    employeeIds: [...parsed.employeeIds].sort(), team: parsed.team, workstation: parsed.workstation, remark: parsed.remark,
    reportSource: parsed.reportSource, principalEmployeeId: parsed.principalEmployeeId, userId: parsed.userId,
    source: source || { kind: parsed.wipAllocationId ? 'WIP' : 'NATIVE', allocationId: parsed.wipAllocationId },
  })).digest('hex');
}

const actorInclude = Prisma.validator<Prisma.UserInclude>()({
    employee: { include: { departmentRef: true, productionPlanningMemberships: {
      where: { isActive: true },
    } } }, accessGrants: { include: { department: true } },
});
function actorSnapshot(user: Prisma.UserGetPayload<{ include: typeof actorInclude }> | null) {
  if (!user || !user.isActive || user.accountStatus !== 'ACTIVE' || (user.employee && !user.employee.isActive)) {
    return null;
  }
  const grants = user.accessGrants.map(grant => ({ ...grant, departmentCode: grant.department?.code || null })) as AccessGrant[];
  const compatibility = user.laborRole === 'ADMIN' ? legacyFallbackGrants(user) : [];
  const access = resolveAccessContext(grants.length ? [...grants, ...compatibility] : legacyFallbackGrants(user), { accountActive: true, now: new Date() });
  const now = new Date();
  const memberships = user.employee?.productionPlanningMemberships.filter(item => item.effectiveFrom <= now && (!item.effectiveTo || item.effectiveTo >= now)) || [];
  return { ...user, access,
    dailyPlanningRoles: memberships.map(item => item.role),
    dailyPlanningTeamIds: memberships.map(item => item.teamId).filter((id): id is string => !!id),
  };
}
async function loadActor(tx: Tx, userId: string) { return actorSnapshot(await tx.user.findUnique({ where: { id: userId }, include: actorInclude })); }
type Actor = NonNullable<Awaited<ReturnType<typeof loadActor>>>;

function canResolveReason(actor: Actor, reasonCode: string) {
  if (reasonCode.startsWith('STANDARD_')) return hasCapability(actor.access, 'PROCESS', 'UPDATE');
  return canManageWipWarehouse(actor) && resolveProductionEntityScope(actor).canWrite;
}
async function assertOriginalActor(tx: Tx, command: CompleteProcessStepCommand) {
  const user = await loadActor(tx, command.userId);
  if (!user) fail('原申报账号已停用，不能代其继续入账；请管理员恢复账号或撤销后由实际作业人重新申报', 'PROCESS_SUBMISSION_ACTOR_INACTIVE', 403);
  const mobile = command.reportSource === ProcessCompletionSource.QR_MOBILE;
  const path = mobile ? '/api/field-report/tickets/report/completions' : `/api/process-management/routes/${command.routeId}/completions`;
  if (!canAccessApiRoute(user.access, path, 'POST')) fail('原申报账号当前没有报工权限，不能由处理人代为绕过', 'PROCESS_SUBMISSION_ACTOR_FORBIDDEN', 403);
  if (mobile && (!user.employeeId || user.employeeId !== command.principalEmployeeId)) fail('原手机申报账号关联的员工已变更，请核对身份', 'PROCESS_SUBMISSION_PRINCIPAL_CHANGED', 403);
  const parsed = parseProcessCompletionCommand(command);
  const count = await tx.employee.count({ where: { id: { in: parsed.employeeIds }, ...productionEmployeeWhere() } });
  if (!parsed.employeeIds.length || count !== parsed.employeeIds.length) fail('作业人员已停用或不在有效生产员工范围，请核对原申报人员', 'PROCESS_COMPLETION_EMPLOYEE_INVALID', 403);
  return user;
}

async function chooseAssignees(tx: Tx, reasonCode: string, preferred: readonly string[] = []) {
  const preferredActors = (await tx.user.findMany({ where: { id: { in: [...preferred] }, isActive: true, accountStatus: 'ACTIVE' }, include: actorInclude }))
    .map(actorSnapshot).filter((actor): actor is Actor => !!actor && canResolveReason(actor, reasonCode));
  if (preferredActors.length) return preferredActors.map(actor => actor.id);
  const candidates = await tx.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE' }, include: actorInclude });
  const eligible = candidates.map(actorSnapshot).filter((actor): actor is Actor => !!actor && canResolveReason(actor, reasonCode));
  const specialists = eligible.filter(actor => actor.laborRole !== 'ADMIN');
  const recipients = specialists.length ? specialists : eligible;
  if (!recipients.length) fail('当前没有具备处理权限的有效账号，请管理员先配置工艺或生产处理账号', 'PROCESS_SUBMISSION_ASSIGNEE_REQUIRED');
  return recipients.map(actor => actor.id);
}

async function canResolveWorkOrder(tx: Tx, actor: Actor, reasonCode: string, workOrderId: string, sourceAllocationId?: string | null) {
  if (!canResolveReason(actor, reasonCode)) return false;
  // PROCESS ownership is department-wide. Production-team grants must match an actual source team.
  if (reasonCode.startsWith('STANDARD_')) return true;
  const scope = resolveProductionEntityScope(actor);
  if (scope.level === 'GLOBAL' || scope.level === 'WORKSHOP') return true;
  const allocations = await tx.wipWeekAllocation.findMany({ where: {
    ...(sourceAllocationId ? { id: sourceAllocationId } : {}), lot: { workOrderId }, status: { in: ['ACTIVE', 'IN_PROGRESS'] },
  }, select: { team: { select: { id: true, code: true, name: true, legacyTeamName: true } } } });
  return allocations.some(item => item.team && matchesProductionTeam(scope, item.team));
}

async function notifyPending(tx: Tx, submission: ProcessReportSubmission, reassigned = false) {
  await createSystemNotification(tx, {
    eventType: reassigned ? 'PROCESS_REPORT_SUBMISSION_REASSIGNED' : 'PROCESS_REPORT_SUBMISSION_PENDING',
    dedupeKey: `report-submission:${submission.id}:pending:${reassigned ? submission.version : 0}`,
    category: 'TODO', priority: 'HIGH', title: reasonLabels[submission.reasonCode] || '报工待处理',
    body: '现场申报已保存。请核对并执行处理，系统完成原报工及计工后才会结束此待办，无需填写文字说明。',
    targetRoute: `/workspace/reporting-recovery?id=${submission.id}`, sourceType, sourceId: submission.id,
    actorId: submission.createdById, recipientUserIds: submission.assigneeUserIds,
  });
}

async function dto(tx: Tx, submission: ProcessReportSubmission, viewerId: string): Promise<ReportSubmissionDto> {
  const [order, step, creator, assignees, viewer] = await Promise.all([
    tx.workOrder.findUniqueOrThrow({ where: { id: submission.workOrderId } }),
    tx.workOrderProcessStep.findUniqueOrThrow({ where: { id: submission.stepId } }),
    tx.user.findUniqueOrThrow({ where: { id: submission.createdById } }),
    tx.user.findMany({ where: { id: { in: submission.assigneeUserIds } }, select: { id: true, displayName: true, username: true } }),
    loadActor(tx, viewerId),
  ]);
  const payload = submission.payload as unknown as CompleteProcessStepCommand;
  const employees = await tx.employee.findMany({ where: { id: { in: Array.isArray(payload.employeeIds) ? payload.employeeIds.map(String) : [] } }, select: { name: true } });
  const snapshot = submission.snapshot as { reportQuantityBasis?: string; reportUnitLabel?: string };
  const permitted = Boolean(viewer && await canResolveWorkOrder(tx, viewer, submission.reasonCode, submission.workOrderId, submission.sourceAllocationId)
    && (submission.assigneeUserIds.includes(viewerId) || viewer.laborRole === 'ADMIN'));
  return {
    id: submission.id, status: submission.status as ReportSubmissionDto['status'], version: submission.version,
    reasonCode: submission.reasonCode, reasonLabel: reasonLabels[submission.reasonCode] || submission.reasonCode,
    lastError: submission.lastError, workOrderId: order.id, workOrderCode: order.code,
    productName: order.productName, specification: order.specification, routeId: submission.routeId,
    stepId: submission.stepId, processName: step.processName, workDate: dateKeyFromDatabase(submission.workDate),
    createdById: creator.id, createdByName: creator.displayName || creator.username,
    assigneeUserIds: submission.assigneeUserIds, assigneeNames: assignees.map(user => user.displayName || user.username),
    sourceKind: submission.sourceKind, sourceLotId: submission.sourceLotId, sourceAllocationId: submission.sourceAllocationId,
    processedQty: Number(payload.processedQty), defectQty: Number(payload.defectQty || 0),
    reportedUnitQty: Number(payload.reportedUnitQty ?? payload.processedQty), reportedDefectUnitQty: Number(payload.reportedDefectUnitQty ?? payload.defectQty ?? 0),
    reportQuantityBasis: snapshot.reportQuantityBasis || step.reportQuantityBasis,
    reportUnitLabel: snapshot.reportUnitLabel || step.reportUnitLabel, employeeNames: employees.map(employee => employee.name),
    completionId: submission.completionId, result: submission.result, createdAt: submission.createdAt.toISOString(),
    completedAt: submission.completedAt?.toISOString() || null,
    canResolve: submission.status === 'PENDING' && permitted,
    canCancel: submission.status === 'PENDING' && !submission.completionId && (viewerId === creator.id || permitted),
  };
}

async function loadVisible(tx: Tx, id: string, userId: string) {
  const item = await tx.processReportSubmission.findUnique({ where: { id } });
  const user = await loadActor(tx, userId);
  if (!item || !user || (item.createdById !== userId && !item.assigneeUserIds.includes(userId) && user.laborRole !== 'ADMIN')) fail('申报不存在或无权查看', 'PROCESS_SUBMISSION_NOT_FOUND', 404);
  return { item, user };
}

async function assertPendingHardGuards(tx: Tx, command: CompleteProcessStepCommand) {
  const parsed = parseProcessCompletionCommand(command);
  await assertOriginalActor(tx, command);
  const route = await tx.workOrderProcessRoute.findUnique({ where: { id: parsed.routeId }, include: { workOrder: true, steps: true } });
  if (!route) fail('工艺路线不存在', 'PROCESS_ROUTE_NOT_FOUND', 404);
  await assertProductionMayRun(tx, route.workOrderId);
  if (!isExecutableProductionWorkOrder(route.workOrder) || route.workOrder.branchStatus === 'QUALITY_PENDING') fail('工单已关闭或质量未放行，不能保存待报工申报', 'WORK_ORDER_READ_ONLY');
  if (route.version !== parsed.expectedRouteVersion) fail('工序已变化，请刷新后核对再保存', 'PROCESS_ROUTE_VERSION_CONFLICT');
  const step = route.steps.find(item => item.id === parsed.stepId && !item.retiredAt && item.status !== 'skipped');
  if (!step) fail('原工序已变更，不能按名称替代原工序', 'PROCESS_STEP_NOT_FOUND', 404);
  const obligationId = (command as Input).obligationId;
  const obligation = obligationId ? await tx.processSupplementObligation.findFirst({ where: { id: obligationId, displayStepId: step.id, routeId: route.id, status: 'ACTIVE' } }) : null;
  if (route.status !== 'in_progress' && !(obligation && route.status === 'completed')) fail('工艺路线已结束或尚未生产，不能保存申报', 'PROCESS_ROUTE_NOT_IN_PROGRESS');
  if (step.executionMode !== 'NORMAL' && !obligation) fail('补充工序义务已变更，请刷新后核对', 'PROCESS_SUPPLEMENT_REQUIRED');
  if (obligation && obligation.version !== Number((command as Input).expectedObligationVersion)) fail('补充工序义务已更新，请刷新后核对', 'PROCESS_SUPPLEMENT_VERSION_CONFLICT');
  const reported = await tx.processCompletion.aggregate({ where: { stepId: step.id, voidedAt: null }, _sum: { processedQty: true, reportedGoodUnitQty: true } });
  const pending = await pendingProcessReportReservations(tx, step.id);
  if (pending.hasUnmeasured) fail('该工序已有数量口径待核对的申报，请处理原申报后再继续', 'PROCESS_UNMEASURED_SUBMISSION_PENDING');
  const target = obligation ? processSupplementActualRequiredQty(obligation) : processCompletionTargetQuantity(route.workOrder);
  if (parsed.processedQty > Math.max(0, target - (reported._sum.processedQty || 0) - pending.productQty)) fail('本次申报超过工序剩余可报数量（已扣除待处理占用）', 'PROCESS_REPORTED_QTY_EXCEEDS_TARGET');
  if (step.reportQuantityBasis === 'product' && (parsed.processedQty <= 0 || parsed.reportedUnitQty !== parsed.processedQty || parsed.reportedDefectUnitQty !== parsed.defectQty)) fail('产品报工数量必须与实际整套数量一致', 'PROCESS_PRODUCT_REPORT_QUANTITY_MISMATCH');
  if (step.reportQuantityBasis !== 'action' || (step.timeBasis === 'per_unit' && step.unitsPerProduct > 1)) {
    const limit = target * (step.reportQuantityBasis === 'action' ? step.unitsPerProduct : 1) - (reported._sum.reportedGoodUnitQty || 0) - pending.goodUnits;
    if (parsed.reportedUnitQty - parsed.reportedDefectUnitQty > Math.max(0, limit)) fail('本次申报超过剩余可报动作数量', 'PROCESS_REPORTED_UNIT_QTY_EXCEEDS_TARGET');
  }
  if (!obligation && route.reportingPolicy === 'strict_sequence' && (step.status !== 'current' || parsed.processedQty > Math.max(0, step.inputQty - step.processedQty))) fail('严格顺序下前序投入不足，请先完成前序工序', 'PROCESS_STEP_NOT_CURRENT');
  if (obligation && parsed.defectQty > 0) fail('补充工序不改变整套质量分支，请核对不良数量', 'PROCESS_SUPPLEMENT_PRODUCT_DEFECT_NOT_SUPPORTED');
  return { parsed, route, step };
}

async function sourceOptions(tx: Tx, stepId: string, workOrderId: string, workDate: Date, excludeSubmissionId?: string): Promise<ReportRecoverySourceOption[]> {
  const lots = await tx.semiFinishedLot.findMany({ where: { workOrderId, scheduleStatus: { notIn: ['COMPLETED', 'CANCELLED'] },
    steps: { some: { stepId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } } }, include: {
    steps: { where: { stepId }, include: { allocationSteps: { include: { credits: { where: { status: 'ACTIVE' } } } } } },
    allocations: { where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } }, include: { steps: { include: { lotStep: { select: { stepId: true } } } } } },
  } });
  const pending = await pendingProcessReportReservations(tx, stepId, excludeSubmissionId);
  const options: ReportRecoverySourceOption[] = [];
  for (const lot of lots) {
    const requirement = lot.steps[0];
    if (!requirement) continue;
    let allocatedRemaining = 0;
    for (const allocation of lot.allocations) {
      const step = allocation.steps.find(item => item.lotStep.stepId === stepId && item.status !== 'CANCELLED');
      if (!step) continue;
      const rawRemaining = Math.max(0, step.plannedQty - step.completedQty);
      allocatedRemaining += rawRemaining;
      const reserved = pending.rows.filter(item => item.sourceAllocationId === allocation.id).reduce((sum, item) => sum + item.reservedProductQty, 0);
      const remainingQty = Math.max(0, rawRemaining - reserved);
      if (!remainingQty) continue;
      const current = workDate >= allocation.targetWeekStartDate && workDate <= allocation.targetWeekEndDate;
      const future = allocation.targetWeekStartDate > workDate;
      const historical = future && dateKeyFromDatabase(workDate) < chinaTodayDateKey(chinaWeekRange(new Date()).start)
        && chinaTodayDateKey(lot.enteredAt) <= dateKeyFromDatabase(workDate);
      const action = current ? 'USE_ALLOCATION' : historical ? 'HISTORICAL_CONFIRMATION' : future ? 'FUTURE_CONFIRMATION' : 'RESCHEDULE_REMAINING';
      options.push({ key: `allocation:${allocation.id}`, lotId: lot.id, lotNo: lot.lotNo, allocationId: allocation.id,
        targetWeekStartDate: dateKeyFromDatabase(allocation.targetWeekStartDate), targetWeekEndDate: dateKeyFromDatabase(allocation.targetWeekEndDate),
        remainingQty, version: allocation.version, action,
        label: `${lot.lotNo} · ${dateKeyFromDatabase(allocation.targetWeekStartDate)} · 剩余 ${remainingQty} 件${current ? '' : historical ? ' · 确认历史作业，保留原排程' : future ? ' · 需要确认提前续作' : ' · 需要确认本周续作'}` });
    }
    const credited = requirement.allocationSteps.reduce((sum, item) => sum + item.credits.reduce((creditSum, credit) => creditSum + credit.quantity, 0), 0);
    const reserved = pending.rows.filter(item => item.sourceLotId === lot.id && !item.sourceAllocationId).reduce((sum, item) => sum + item.reservedProductQty, 0);
    const unscheduled = Math.max(0, requirement.remainingQty - credited - allocatedRemaining - reserved);
    if (unscheduled > 0) options.push({ key: `lot:${lot.id}`, lotId: lot.id, lotNo: lot.lotNo, allocationId: null,
      targetWeekStartDate: null, targetWeekEndDate: null, remainingQty: unscheduled, version: lot.version,
      action: 'SCHEDULE_REMAINING', label: `${lot.lotNo} · 尚未排周 · 剩余 ${unscheduled} 件` });
  }
  return options;
}

async function createPending(tx: Tx, command: Input, reasonCode: string, message: string, fingerprint: string, result?: ProcessCompletionResult) {
  const replay = await tx.processReportSubmission.findUnique({ where: { idempotencyKey: text(command.idempotencyKey) } });
  if (replay) {
    if (replay.payloadFingerprint !== fingerprint || replay.createdById !== command.userId) fail('此申报编号已经保存了另一组内容，请勿复用编号', 'PROCESS_SUBMISSION_IDEMPOTENCY_CONFLICT');
    return replay;
  }
  const state = result ? null : await assertPendingHardGuards(tx, command);
  const step = state?.step || await tx.workOrderProcessStep.findUniqueOrThrow({ where: { id: text(command.stepId) } });
  const route = state?.route || await tx.workOrderProcessRoute.findUniqueOrThrow({ where: { id: command.routeId } });
  const parsed = state?.parsed || parseProcessCompletionCommand(command);
  const preferred = route.confirmedById ? [route.confirmedById] : [];
  let source = command.source || { kind: parsed.wipAllocationId ? 'WIP' : 'NATIVE', allocationId: parsed.wipAllocationId || undefined };
  if (reasonCode.startsWith('WIP_')) {
    const options = await sourceOptions(tx, step.id, route.workOrderId, parsed.workDate);
    if (!options.length) fail('该工序没有可续作的半成品余额，请核对现有报工数量', 'WIP_REPORT_EXCEEDS_ALLOCATION');
    const selected = options.find(option => source.allocationId ? option.allocationId === source.allocationId : source.lotId ? option.lotId === source.lotId : false);
    // Multiple unresolved batches remain unreserved; resolver must choose, never guess from model name.
    if (source.kind === 'WIP' && (source.lotId || source.allocationId) && !selected) fail('所选半成品批次已失效或没有剩余量，请重新选择来源', 'WIP_ALLOCATION_NOT_REPORTABLE');
    if (selected && parsed.processedQty - parsed.defectQty > selected.remainingQty) fail(`本次申报超过所选来源剩余 ${selected.remainingQty} 件`, 'WIP_REPORT_EXCEEDS_ALLOCATION');
    if (!selected && step.reportQuantityBasis === 'product' && parsed.processedQty - parsed.defectQty > Math.max(...options.map(option => option.remainingQty))) {
      fail('本次数量横跨多个来源，请分别选择每个批次并按该批次余额报工', 'WIP_REPORT_REQUIRES_SPLIT');
    }
    source = { kind: 'WIP', lotId: selected?.lotId, allocationId: selected?.allocationId || undefined };
    if (selected?.action && selected.action !== 'USE_ALLOCATION') reasonCode = 'WIP_WEEK_CONFIRMATION';
  }
  // Product units are known even when a supervisor must still select which WIP lot supplied them.
  // Reserve the global step quantity without guessing a lot; ambiguous action quantities stay unreserved.
  const unambiguous = step.reportQuantityBasis === 'product' || (step.reportQuantityBasis === 'action' && step.timeBasis === 'per_unit' && step.unitsPerProduct > 1);
  const candidates = await chooseAssignees(tx, reasonCode, preferred);
  let assigneeUserIds: string[] = [];
  for (const id of candidates) {
    const actor = await loadActor(tx, id);
    if (actor && await canResolveWorkOrder(tx, actor, reasonCode, route.workOrderId, source.allocationId)) assigneeUserIds.push(id);
  }
  if (!assigneeUserIds.length) {
    const admins = await tx.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE', laborRole: 'ADMIN' }, select: { id: true } });
    assigneeUserIds = admins.map(actor => actor.id);
  }
  if (!assigneeUserIds.length) fail('没有能处理此工单的有效账号，请管理员配置负责人', 'PROCESS_SUBMISSION_ASSIGNEE_REQUIRED');
  const item = await tx.processReportSubmission.create({ data: {
    idempotencyKey: parsed.idempotencyKey, payloadFingerprint: fingerprint, status: 'PENDING', reasonCode,
    workOrderId: route.workOrderId, routeId: route.id, stepId: step.id, workDate: parsed.workDate,
    createdById: command.userId, assigneeUserIds, completionId: result?.completionId || null,
    sourceKind: source.kind, sourceLotId: source.lotId || null, sourceAllocationId: source.allocationId || null,
    reservedProductQty: !result && unambiguous ? parsed.processedQty : 0,
    reservedGoodUnits: !result && unambiguous ? parsed.reportedUnitQty - parsed.reportedDefectUnitQty : 0,
    payload: json({ ...command, source, workDate: parsed.workDateKey }),
    snapshot: json({ routeVersion: route.version, quantityVersion: step.quantityVersion, productTimeProfileVersion: step.productTimeProfileVersion,
      productTimeEntryId: step.productTimeEntryId, processCode: step.processCode, processName: step.processName,
      reportQuantityBasis: step.reportQuantityBasis, reportUnitLabel: step.reportUnitLabel, timeBasis: step.timeBasis,
      unitsPerProduct: step.unitsPerProduct, standardMillisecondsPerUnit: step.standardMillisecondsPerUnit }),
    result: result ? json(result) : undefined, lastError: message,
  } });
  const assigned = await reassignForCurrentRequirements(tx, item, true, false);
  await notifyPending(tx, assigned);
  await createSystemNotification(tx, { eventType: 'PROCESS_REPORT_SUBMISSION_RECEIVED', dedupeKey: `report-submission:${item.id}:received`,
    category: 'SYSTEM', title: '现场报工申报已收到', body: `${reasonLabels[reasonCode]}，已交给处理账号。原申报已保存，请勿重复报工。`,
    targetRoute: `/workspace/reporting-recovery?id=${item.id}`, sourceType, sourceId: item.id, actorId: command.userId, recipientUserIds: [command.userId] });
  return assigned;
}

async function serializable<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 8000, timeout: 30000 }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code) || attempt >= 2) throw error; }
  }
}

async function executeCompletion(tx: Tx, command: Input, recoverySubmissionId?: string, historicalWip?: HistoricalWipReportingAuthorization): Promise<ProcessCompletionResult> {
  if (!command.obligationId) return completeProcessStepInTransaction(tx, command, { recoverySubmissionId, historicalWip });
  const raw = await completeProcessSupplementObligationInTransaction(tx, {
    ...command, obligationId: command.obligationId, expectedVersion: command.expectedObligationVersion,
    publicCode: command.ticketCode, employeeIds: Array.isArray(command.employeeIds) ? command.employeeIds.map(String) : [],
    principalEmployeeId: command.principalEmployeeId ? String(command.principalEmployeeId) : undefined,
    workStartedAt: command.workStartedAt as string | undefined, workEndedAt: command.workEndedAt as string | undefined,
    reportSource: command.reportSource ?? ProcessCompletionSource.SUPPLEMENT_OBLIGATION, recoverySubmissionId,
  }, undefined, { historicalWip });
  const [pool, route] = await Promise.all([
    tx.processLaborPool.findUnique({ where: { completionId: raw.completionId } }),
    tx.workOrderProcessRoute.findUniqueOrThrow({ where: { id: command.routeId }, select: { status: true } }),
  ]);
  return { ...raw, laborPoolId: pool?.id || null, laborPoolPendingStandard: pool?.standardSource === 'pending_standard',
    goodTransferredQty: 0, remainingInputQty: raw.remainingQty, routeCompleted: route.status === 'completed',
    coverageStatus: 'covered', pendingCoverageQty: 0, autoAssignedEmployeeCount: raw.employeeCount,
    autoAssignedLaborMilliseconds: Number(raw.standardLaborMilliseconds) };
}

export async function submitProcessCompletion(command: Input): Promise<SubmitResult> {
  if (command.expectedUserId != null && command.expectedUserId !== command.userId) fail('当前登录账号已变化，请核对账号后重新打开报工页面', 'ACCOUNT_CHANGED');
  if (command.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN) fail('共享终端请使用原 PIN 报工入口', 'PROCESS_SUBMISSION_PIN_UNSUPPORTED', 400);
  if (command.source != null && (!['NATIVE', 'WIP'].includes(command.source.kind)
    || (command.source.kind === 'NATIVE' && (command.source.lotId || command.source.allocationId)))) fail('报工来源参数不完整，请重新选择来源', 'PROCESS_SUBMISSION_SOURCE_INVALID', 400);
  const normalized = { ...command, wipAllocationId: command.source?.kind === 'WIP' ? command.source.allocationId : command.source?.kind === 'NATIVE' ? null : command.wipAllocationId };
  const fingerprint = reportingSubmissionFingerprint(normalized, normalized.source);
  try {
    return await serializable(async tx => {
      if (normalized.source?.kind === 'WIP' && normalized.source.allocationId && normalized.source.lotId) {
        const source = await tx.wipWeekAllocation.findFirst({ where: { id: normalized.source.allocationId,
          lot: { id: normalized.source.lotId, routeId: normalized.routeId } }, select: { id: true } });
        if (!source) fail('所选排程与半成品批次不匹配，请重新选择来源', 'PROCESS_SUBMISSION_SOURCE_INVALID', 400);
      }
      const existing = await tx.processReportSubmission.findUnique({ where: { idempotencyKey: text(command.idempotencyKey) } });
      if (existing) {
        if (existing.createdById !== command.userId || existing.payloadFingerprint !== fingerprint) fail('此申报编号已经用于另一组内容', 'PROCESS_SUBMISSION_IDEMPOTENCY_CONFLICT');
        if (existing.status === 'COMPLETED') {
          const completed = existing.completionId ? await tx.processCompletion.findUnique({ where: { id: existing.completionId }, select: { voidedAt: true } }) : null;
          if (!completed || completed.voidedAt) fail('原报工已撤回，不能重放为成功，请使用新的申报编号', 'PROCESS_COMPLETION_VOIDED');
          return { pending: false as const, data: existing.result as unknown as ProcessCompletionResult };
        }
        if (existing.status === 'CANCELLED') fail('原申报已取消，需要使用新申报编号', 'PROCESS_SUBMISSION_CANCELLED');
        return { pending: true as const, submission: await dto(tx, existing, command.userId) };
      }
      await assertOriginalActor(tx, normalized);
      const priorCompletion = await tx.processCompletion.findUnique({ where: { idempotencyKey: text(command.idempotencyKey) }, select: { id: true } });
      // A lost final-step response is replayed before checking whether the QR route has since closed.
      if (priorCompletion) return { pending: false as const, data: await executeCompletion(tx, normalized) };
      if (command.reportingAccessAllowed === false) fail('当前二维码或工单不允许新报工，可查看原提交回执', 'FIELD_REPORT_READ_ONLY');
      if (normalized.source?.kind === 'WIP' && !normalized.source.allocationId) {
        fail('所选半成品尚未安排到本次生产周，请提交续作确认', 'WIP_ALLOCATION_NOT_REPORTABLE');
      }
      const result = await executeCompletion(tx, normalized);
      if (!result.laborPoolPendingStandard) return { pending: false as const, data: result };
      const item = await createPending(tx, normalized, 'STANDARD_MISSING', '数量已登记，待工艺确认标准后自动计入原作业人员', fingerprint, result);
      return { pending: true as const, submission: await dto(tx, item, command.userId) };
    });
  } catch (error) {
    const reasonCode = reportingSubmissionReason(error);
    if (!command.allowPending || !reasonCode) {
      if (error instanceof WipWarehouseError || error instanceof ProductionControlError || error instanceof ProcessRouteChangeServiceError) throw new ProcessCompletionServiceError(error.message, error.status, error.code);
      throw error;
    }
    return serializable(async tx => {
      const item = await createPending(tx, normalized, reasonCode, errorMessage(error), fingerprint);
      return { pending: true as const, submission: await dto(tx, item, command.userId) };
    });
  }
}

export async function listProcessReportSubmissions(userId: string, options: { status?: string; keyword?: string; limit?: number; offset?: number } = {}) {
  return serializable(async tx => {
    const actor = await loadActor(tx, userId);
    if (!actor) fail('登录账号已失效', 'PROCESS_SUBMISSION_ACTOR_INACTIVE', 401);
    const where: Prisma.ProcessReportSubmissionWhereInput = {
      ...(actor.laborRole !== 'ADMIN' ? { OR: [{ createdById: userId }, { assigneeUserIds: { has: userId } }] } : {}),
      ...(options.status && ['PENDING', 'COMPLETED', 'CANCELLED'].includes(options.status) ? { status: options.status } : {}),
      ...(options.keyword?.trim() ? { AND: [{ OR: [
        { workOrder: { code: { contains: options.keyword.trim(), mode: 'insensitive' as const } } },
        { workOrder: { productName: { contains: options.keyword.trim(), mode: 'insensitive' as const } } },
        { workOrder: { specification: { contains: options.keyword.trim(), mode: 'insensitive' as const } } },
        { step: { processName: { contains: options.keyword.trim(), mode: 'insensitive' as const } } },
        { createdBy: { displayName: { contains: options.keyword.trim(), mode: 'insensitive' as const } } },
      ] }] } : {}),
    };
    const [rows, total] = await Promise.all([tx.processReportSubmission.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, options.limit || 30)), skip: Math.max(0, options.offset || 0) }), tx.processReportSubmission.count({ where })]);
    return { items: await Promise.all(rows.map(row => dto(tx, row, userId))), total };
  });
}

async function previewInTx(tx: Tx, item: ProcessReportSubmission, viewerId: string): Promise<ReportSubmissionPreview> {
  const submission = await dto(tx, item, viewerId);
  const contract = await getProcessStepPublishedContract(tx, { routeId: item.routeId, stepId: item.stepId });
  const current = contract.current || { reportQuantityBasis: submission.reportQuantityBasis, reportUnitLabel: submission.reportUnitLabel, unitsPerProduct: 1, timeBasis: null, standardMillisecondsPerUnit: null };
  const options = await sourceOptions(tx, item.stepId, item.workOrderId, item.workDate, item.id);
  const snapshot = item.snapshot as { reportQuantityBasis?: string; unitsPerProduct?: number };
  const published = contract.published;
  const invalidContract = current.reportQuantityBasis === 'action' && (current.unitsPerProduct <= 1 || current.timeBasis !== 'per_unit');
  const needsRepair = !item.completionId && (item.reasonCode === 'STANDARD_MISMATCH' || invalidContract);
  const effectiveContract = needsRepair && published ? published : current;
  const quantityMappingRequired = !item.completionId && (snapshot.reportQuantityBasis !== effectiveContract.reportQuantityBasis || snapshot.unitsPerProduct !== effectiveContract.unitsPerProduct);
  const order = await tx.workOrder.findUniqueOrThrow({ where: { id: item.workOrderId } });
  const reported = await tx.processCompletion.aggregate({ where: { stepId: item.stepId, voidedAt: null }, _sum: { processedQty: true } });
  const wipSources = await loadReportingWipSources(tx, item.workOrderId, item.id);
  const reservations = await pendingProcessReportReservations(tx, item.stepId, item.id);
  const availableWip = wipSources.reduce((sum, lot) => sum + (lot.steps.find(step => step.stepId === item.stepId)?.remainingQty || 0), 0);
  const unassignedWipReserved = reservations.rows.filter(row => row.sourceKind === 'WIP' && !row.sourceLotId).reduce((sum, row) => sum + row.reservedProductQty, 0);
  const nativeRemaining = Math.max(0, processCompletionTargetQuantity(order) - (reported._sum.processedQty || 0) - reservations.productQty - Math.max(0, availableWip - unassignedWipReserved));
  const needsWip = !item.completionId && (item.sourceKind === 'WIP' || (availableWip > 0
    && (submission.processedQty > nativeRemaining || (needsRepair && quantityMappingRequired && submission.reportedUnitQty > nativeRemaining))));
  const actions: ReportSubmissionPreview['actions'] = [
    ...(needsRepair || quantityMappingRequired ? [{ code: 'REPAIR_STANDARD' as const, label: '核对报工口径' }] : []),
    ...(needsWip ? [{ code: 'CONFIRM_SOURCE' as const, label: '确认半成品来源与续作周次' }] : []),
    ...(item.reasonCode === 'STANDARD_MISSING' || (!effectiveContract.standardMillisecondsPerUnit || effectiveContract.standardMillisecondsPerUnit <= 0)
      ? [{ code: 'RESOLVE_STANDARD' as const, label: '核定标准并计入工时' }] : []),
  ];
  const viewer = await loadActor(tx, viewerId);
  const canResolve = Boolean(viewer && item.status === 'PENDING' && (item.assigneeUserIds.includes(viewerId) || viewer.laborRole === 'ADMIN')
    && await canExecuteActions(tx, viewer, actions, item));
  submission.canResolve = canResolve;
  return { submission, canResolve, routeVersion: contract.routeVersion,
    actions,
    sourceOptions: options, standardPreview: { current, published },
    quantityMappingRequired,
    blockers: needsRepair && !published ? [contract.message] : [],
  };
}

async function canExecuteActions(tx: Tx, actor: Actor, actions: ReportSubmissionPreview['actions'], item: ProcessReportSubmission) {
  if (actions.some(action => action.code === 'REPAIR_STANDARD' || action.code === 'RESOLVE_STANDARD') && !hasCapability(actor.access, 'PROCESS', 'UPDATE')) return false;
  if (actions.some(action => action.code === 'CONFIRM_SOURCE') && !await canResolveWorkOrder(tx, actor, 'WIP_SOURCE_REQUIRED', item.workOrderId, item.sourceAllocationId)) return false;
  return true;
}

async function reassignForCurrentRequirements(tx: Tx, item: ProcessReportSubmission, force = false, notify = true) {
  if (item.status !== 'PENDING') return item;
  const preview = await previewInTx(tx, item, item.createdById);
  if (!force) {
    for (const id of item.assigneeUserIds) {
      const actor = await loadActor(tx, id);
      if (actor && await canExecuteActions(tx, actor, preview.actions, item)) return item;
    }
  }
  const actors = (await tx.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE' }, include: actorInclude })).map(actorSnapshot).filter((actor): actor is Actor => !!actor);
  const capable: Actor[] = [];
  for (const actor of actors) if (await canExecuteActions(tx, actor, preview.actions, item)) capable.push(actor);
  const route = await tx.workOrderProcessRoute.findUniqueOrThrow({ where: { id: item.routeId }, select: { confirmedById: true } });
  const allocation = item.sourceAllocationId ? await tx.wipWeekAllocation.findUnique({ where: { id: item.sourceAllocationId }, select: { scheduledById: true } }) : null;
  const preferred = capable.filter(actor => actor.id === allocation?.scheduledById || actor.id === route.confirmedById);
  const specialists = capable.filter(actor => actor.laborRole !== 'ADMIN');
  const selected = preferred.length ? preferred : specialists.length ? specialists : capable.filter(actor => actor.laborRole === 'ADMIN');
  if (!selected.length) {
    if (force) fail('当前没有可处理这笔申报全部条件的有效账号，请管理员配置处理权限', 'PROCESS_SUBMISSION_ASSIGNEE_REQUIRED');
    return item;
  }
  const assigneeUserIds = selected.map(actor => actor.id);
  if (assigneeUserIds.length === item.assigneeUserIds.length && assigneeUserIds.every(id => item.assigneeUserIds.includes(id))) return item;
  const updated = await tx.processReportSubmission.update({ where: { id: item.id }, data: { assigneeUserIds, version: { increment: 1 } } });
  if (notify) await notifyPending(tx, updated, true);
  await tx.operationLog.create({ data: { userId: null, action: 'reassign_process_report_submission', targetType: sourceType, targetId: item.id,
    detail: { previousAssigneeUserIds: item.assigneeUserIds, assigneeUserIds, reason: '按当前所需处理能力自动转交有效账号' } } });
  return updated;
}

/** Bounded reconciliation for the existing worker and inbox reads; never marks a report completed. */
export async function reconcilePendingReportAssignees(limit = 50) {
  const take = Math.min(100, Math.max(1, limit));
  let ids = await prisma.processReportSubmission.findMany({ where: { status: 'PENDING', ...(reconciliationCursor ? { id: { gt: reconciliationCursor } } : {}) }, orderBy: { id: 'asc' }, take, select: { id: true } });
  if (!ids.length && reconciliationCursor) { reconciliationCursor = undefined; ids = await prisma.processReportSubmission.findMany({ where: { status: 'PENDING' }, orderBy: { id: 'asc' }, take, select: { id: true } }); }
  reconciliationCursor = ids.at(-1)?.id;
  let changed = 0;
  for (const { id } of ids) await serializable(async tx => {
    const item = await tx.processReportSubmission.findUnique({ where: { id } });
    if (!item) return;
    const refreshed = await reassignForCurrentRequirements(tx, item);
    if (refreshed.version !== item.version) changed++;
  });
  return { checked: ids.length, changed };
}
let reconciliationCursor: string | undefined;

export async function previewProcessReportSubmission(id: string, userId: string) {
  return serializable(async tx => { const { item } = await loadVisible(tx, id, userId); const assigned = await reassignForCurrentRequirements(tx, item); return previewInTx(tx, assigned, userId); });
}

function mondayKey(date: Date) {
  const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return dateKeyFromDatabase(copy);
}

async function closeNotifications(tx: Tx, item: ProcessReportSubmission, reason: string) {
  await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType, sourceId: item.id }, completedAt: null },
    data: { completedAt: new Date(), completionKind: 'SOURCE_RESOLVED', completionReason: reason, snoozedUntil: null } });
}

export async function resolveProcessReportSubmission(id: string, userId: string, input: ReportSubmissionResolutionInput) {
  try {
    const result = await serializable(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "process_report_submissions" WHERE "id" = ${id} FOR UPDATE`;
      const { item, user } = await loadVisible(tx, id, userId);
      if (item.status === 'COMPLETED') return dto(tx, item, userId);
      if (item.status !== 'PENDING') fail('该申报已取消', 'PROCESS_SUBMISSION_CANCELLED');
      if (!await canResolveWorkOrder(tx, user, item.reasonCode, item.workOrderId, item.sourceAllocationId) || (!item.assigneeUserIds.includes(userId) && user.laborRole !== 'ADMIN')) fail('当前账号没有这笔申报的处理权限或班组范围不匹配', 'PROCESS_SUBMISSION_RESOLVE_FORBIDDEN', 403);
      if (input.expectedVersion !== item.version) fail('其他人已经更新此申报，请刷新后重新核对', 'PROCESS_SUBMISSION_VERSION_CONFLICT');
      const command = item.payload as unknown as Input;
      let historicalWip: HistoricalWipReportingAuthorization | undefined;
      await assertOriginalActor(tx, command);
      if (!item.completionId && command.ticketCode) {
        const ticket = await tx.workOrderQrTicket.findFirst({ where: { publicCode: command.ticketCode, workOrderId: item.workOrderId, status: 'ACTIVE' }, select: { id: true } });
        if (!ticket) fail('原二维码已撤销或不再属于此工单，请核对原申报身份来源', 'FIELD_REPORT_READ_ONLY');
      }
      const preview = await previewInTx(tx, item, userId);
      if (!await canExecuteActions(tx, user, preview.actions, item)) fail('这笔申报还需要工艺或半成品处理权限，请由已通知的负责人处理', 'PROCESS_SUBMISSION_RESOLVE_FORBIDDEN', 403);
      if (preview.routeVersion !== input.expectedRouteVersion) fail('工艺路线已变化，请刷新预览后重新确认', 'PROCESS_SUBMISSION_PREVIEW_CHANGED');
      if (preview.actions.some(action => action.code === 'RESOLVE_STANDARD') && preview.standardPreview.published && (input.expectedProfileVersion !== preview.standardPreview.published?.productTimeProfileVersion
        || input.expectedEntryId !== preview.standardPreview.published?.productTimeEntryId)) fail('已发布工时版本变化，请重新预览或明确核定数值', 'PROCESS_SUBMISSION_PREVIEW_CHANGED');
      if (preview.actions.some(action => action.code === 'REPAIR_STANDARD')) {
        if (input.expectedProfileVersion !== preview.standardPreview.published?.productTimeProfileVersion
          || input.expectedEntryId !== preview.standardPreview.published?.productTimeEntryId) fail('已发布工时版本变化，请重新预览核对', 'PROCESS_SUBMISSION_PREVIEW_CHANGED');
        const repair = await repairUnreportedProcessStepContract(tx, { routeId: item.routeId, stepId: item.stepId, actorId: userId });
        if (repair.status === 'blocked') fail(repair.message, repair.code);
        if (preview.quantityMappingRequired) {
          const step = await tx.workOrderProcessStep.findUniqueOrThrow({ where: { id: item.stepId } });
          if (!input.confirmQuantityMapping || !Number.isSafeInteger(input.processedQty) || Number(input.processedQty) < 0
            || (step.reportQuantityBasis === 'product' && Number(input.processedQty) === 0)) fail('请勾选数量口径确认，并填写本次实际形成的整套数量；动作报工可为 0 套', 'PROCESS_SUBMISSION_QUANTITY_MAPPING_REQUIRED');
          command.processedQty = input.processedQty;
          command.defectQty = input.defectQty ?? 0;
          if (step.reportQuantityBasis === 'product') { command.reportedUnitQty = command.processedQty; command.reportedDefectUnitQty = command.defectQty; }
          else {
            if (!Number.isSafeInteger(input.reportedUnitQty) || Number(input.reportedUnitQty) <= 0
              || !Number.isSafeInteger(input.reportedDefectUnitQty) || Number(input.reportedDefectUnitQty) < 0
              || Number(input.reportedDefectUnitQty) > Number(input.reportedUnitQty)) fail('请填写本次实际动作数量和动作不良数量，不会按倍率推算', 'PROCESS_SUBMISSION_ACTION_MAPPING_REQUIRED');
            command.reportedUnitQty = input.reportedUnitQty;
            command.reportedDefectUnitQty = input.reportedDefectUnitQty;
          }
        }
      }
      if (preview.actions.some(action => action.code === 'CONFIRM_SOURCE')) {
        const selected = preview.sourceOptions.find(option => option.key === input.sourceKey);
        if (!selected) fail('请选择当前可用的半成品来源', 'PROCESS_SUBMISSION_SOURCE_REQUIRED');
        if (!await canResolveWorkOrder(tx, user, 'WIP_SOURCE_REQUIRED', item.workOrderId, selected.allocationId)) fail('所选来源超出当前账号班组权限', 'PROCESS_SUBMISSION_RESOLVE_FORBIDDEN', 403);
        if (input.sourceVersion !== selected.version) fail('半成品安排或剩余量已变化，请刷新预览', 'WIP_ALLOCATION_CHANGED');
        if (selected.action === 'FUTURE_CONFIRMATION' && !input.confirmAdvanceSchedule) fail('这是未来周安排，请明确确认提前续作，系统不会自动提前', 'WIP_ADVANCE_CONFIRMATION_REQUIRED');
        const common = { actorId: userId, actorName: user.displayName || user.username,
          productionScope: resolveProductionEntityScope(user), targetWeekStartDate: mondayKey(item.workDate),
          reason: `报工申报 ${item.id}：确认真实生产日期所在周续作`, idempotencyKey: `report-recovery:${item.id}:wip` };
        if (selected.action === 'HISTORICAL_CONFIRMATION') {
          if (!input.confirmHistoricalWork || !selected.allocationId) fail('请明确确认这是已发生的历史作业，原剩余排程保持不变', 'WIP_HISTORICAL_CONFIRMATION_REQUIRED');
          historicalWip = { actorId: userId, submissionId: item.id, allocationId: selected.allocationId,
            expectedVersion: selected.version, workDateKey: dateKeyFromDatabase(item.workDate) };
          command.wipAllocationId = selected.allocationId;
          await tx.operationLog.create({ data: { userId, action: 'confirm_historical_wip_report', targetType: sourceType, targetId: item.id,
            detail: json({ allocationId: selected.allocationId, allocationVersion: selected.version, workDate: historicalWip.workDateKey,
              plannedWeekStartDate: selected.targetWeekStartDate, plannedWeekEndDate: selected.targetWeekEndDate,
              processedQty: command.processedQty, reportedUnitQty: command.reportedUnitQty, remainingScheduleRetained: true }) } });
        }
        else if (selected.action === 'USE_ALLOCATION') command.wipAllocationId = selected.allocationId;
        else if (selected.allocationId) {
          const allocation = await rescheduleWipAllocationInTransaction(tx, { ...common, allocationId: selected.allocationId });
          command.wipAllocationId = allocation.id;
        } else {
          const goodProductQty = Number(command.processedQty) - Number(command.defectQty || 0);
          // An action-only operation still needs a scheduled input slice; it does not claim those sets as completed.
          const quantity = goodProductQty > 0 ? goodProductQty : selected.remainingQty;
          if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > selected.remainingQty) fail('实际整套良品数量必须在所选半成品剩余量以内', 'WIP_REPORT_EXCEEDS_ALLOCATION');
          const allocation = await scheduleWipLotInTransaction(tx, { ...common, lotId: selected.lotId, quantity });
          command.wipAllocationId = allocation.id;
        }
      }
      let result: ProcessCompletionResult;
      if (item.completionId) {
        const completion = await tx.processCompletion.findUniqueOrThrow({ where: { id: item.completionId }, include: { laborPool: true } });
        if (completion.voidedAt || !completion.laborPool || completion.laborPool.status === 'VOIDED') fail('原报工已撤回，不能继续计工', 'PROCESS_SUBMISSION_COMPLETION_VOIDED');
        if (completion.laborPool.standardSource === 'pending_standard') {
          const standard = input.standard || preview.standardPreview.published;
          if (!standard?.timeBasis || !Number.isSafeInteger(standard.standardMillisecondsPerUnit) || Number(standard.standardMillisecondsPerUnit) <= 0) fail('请核定有效的标准工时数值', 'PROCESS_SUBMISSION_STANDARD_REQUIRED');
          await resolveProcessLaborPoolStandardInTransaction(tx, { poolId: completion.laborPool.id, expectedVersion: completion.laborPool.version,
            ...standard, reason: `报工申报 ${item.id}：工艺确认标准并继续原报工计工`, userId });
        }
        result = item.result as unknown as ProcessCompletionResult;
      } else {
        const route = await tx.workOrderProcessRoute.findUniqueOrThrow({ where: { id: item.routeId }, select: { version: true } });
        if (command.obligationId) {
          const obligation = await tx.processSupplementObligation.findUniqueOrThrow({ where: { id: command.obligationId }, select: { version: true } });
          command.expectedObligationVersion = obligation.version;
        }
        result = await executeCompletion(tx, { ...command, expectedRouteVersion: route.version }, item.id, historicalWip);
      }
      if (result.laborPoolPendingStandard && !item.completionId) {
        const pendingCompletion = await tx.processCompletion.findUniqueOrThrow({ where: { id: result.completionId }, include: { laborPool: true } });
        const standard = input.standard || preview.standardPreview.published;
        if (standard?.timeBasis && Number(standard.standardMillisecondsPerUnit) > 0 && hasCapability(user.access, 'PROCESS', 'UPDATE') && pendingCompletion.laborPool) {
          await resolveProcessLaborPoolStandardInTransaction(tx, { poolId: pendingCompletion.laborPool.id, expectedVersion: pendingCompletion.laborPool.version,
            ...standard, reason: `报工申报 ${item.id}：核定标准并继续计工`, userId });
        } else {
          const handoff = await tx.processReportSubmission.update({ where: { id: item.id }, data: { reasonCode: 'STANDARD_MISSING', completionId: result.completionId,
            result: json(result), resolution: json(input), reservedProductQty: 0, reservedGoodUnits: 0, version: { increment: 1 },
            lastError: '数量已核销，工时标准待工艺核定；原申报和原作业人员保留，无需重报' } });
          const assigned = await reassignForCurrentRequirements(tx, handoff, true);
          await notifyPending(tx, assigned, true);
          return dto(tx, assigned, userId);
        }
      }
      const completion = await tx.processCompletion.findUniqueOrThrow({ where: { id: result.completionId }, include: { laborPool: true } });
      const pool = completion.laborPool;
      if (completion.voidedAt || (pool && (pool.standardSource === 'pending_standard' || pool.status === 'VOIDED' || pool.remainingStandardLaborMilliseconds > 0n))
        || (!pool && result.laborPoolId !== null)) {
        fail('报工工时尚未全部核销，申报将保持待处理，请核对工时标准和人员分配', 'PROCESS_SUBMISSION_LABOR_NOT_SETTLED');
      }
      const claims = pool ? await tx.processLaborClaim.aggregate({ where: { poolId: pool.id, status: 'ACTIVE' }, _sum: { standardLaborMilliseconds: true }, _count: { id: true } })
        : { _sum: { standardLaborMilliseconds: 0n }, _count: { id: 0 } };
      if (pool && (claims._sum.standardLaborMilliseconds || 0n) !== pool.totalStandardLaborMilliseconds) fail('工时领取与总工时不一致，不能结束待处理', 'PROCESS_SUBMISSION_LABOR_NOT_SETTLED');
      result = { ...result, laborPoolPendingStandard: false, autoAssignedEmployeeCount: claims._count.id,
        autoAssignedLaborMilliseconds: Number(claims._sum.standardLaborMilliseconds || 0n) };
      const completed = await tx.processReportSubmission.update({ where: { id: item.id }, data: { status: 'COMPLETED', completedAt: new Date(),
        completionId: completion.id, result: json(result), resolution: json(input), resolvedById: userId, lastError: null,
        reservedProductQty: 0, reservedGoodUnits: 0, version: { increment: 1 } } });
      await closeNotifications(tx, completed, `已生成有效报工 ${completion.id} 并完成工时入账`);
      await createSystemNotification(tx, { eventType: 'PROCESS_REPORT_SUBMISSION_COMPLETED', dedupeKey: `report-submission:${item.id}:completed`,
        category: 'SYSTEM', title: '原报工已处理完成', body: '原现场申报已完成数量核销与工时入账，无需重新报工。',
        sourceType, sourceId: item.id, targetRoute: `/workspace/reporting-recovery?id=${item.id}`, actorId: userId,
        recipientUserIds: [...new Set([item.createdById, ...item.assigneeUserIds])] });
      await tx.operationLog.create({ data: { userId, action: 'resolve_process_report_submission', targetType: sourceType, targetId: item.id,
        detail: json({ originalActorId: item.createdById, completionId: completion.id, resolution: input }) } });
      return dto(tx, completed, userId);
    });
    return { pending: result.status === 'PENDING', submission: result };
  } catch (error) {
    if (error instanceof ProcessCompletionServiceError && (error.status === 403 || error.status === 404 || error.code === 'PROCESS_SUBMISSION_VERSION_CONFLICT')) throw error;
    return serializable(async tx => {
      const { item, user } = await loadVisible(tx, id, userId);
      if (!await canResolveWorkOrder(tx, user, item.reasonCode, item.workOrderId, item.sourceAllocationId) || (!item.assigneeUserIds.includes(userId) && user.laborRole !== 'ADMIN')) throw error;
      if (item.status === 'COMPLETED') return { pending: false as const, submission: await dto(tx, item, userId) };
      if (item.status === 'CANCELLED') return { pending: false as const, submission: await dto(tx, item, userId) };
      const updated = await tx.processReportSubmission.update({ where: { id }, data: { lastError: errorMessage(error), version: { increment: 1 } } });
      return { pending: true as const, submission: await dto(tx, updated, userId) };
    });
  }
}

export async function cancelProcessReportSubmission(id: string, userId: string, expectedVersion: number) {
  return serializable(async tx => {
    const { item } = await loadVisible(tx, id, userId);
    const view = await dto(tx, item, userId);
    if (!view.canCancel) fail('此申报已有正式报工或当前账号不能取消，请通过报工撤回处理', 'PROCESS_SUBMISSION_CANCEL_FORBIDDEN', 403);
    if (item.version !== expectedVersion) fail('申报已更新，请刷新', 'PROCESS_SUBMISSION_VERSION_CONFLICT');
    const cancelled = await tx.processReportSubmission.update({ where: { id }, data: { status: 'CANCELLED', reservedProductQty: 0, reservedGoodUnits: 0,
      resolvedById: userId, lastError: null, version: { increment: 1 }, resolution: { action: 'CANCEL' } } });
    await closeNotifications(tx, cancelled, '申报已取消并释放待处理数量占用');
    await tx.operationLog.create({ data: { userId, action: 'cancel_process_report_submission', targetType: sourceType, targetId: id,
      detail: { reason: '账号确认取消未入账申报，无需文字说明' } } });
    return dto(tx, cancelled, userId);
  });
}
