import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('portal menu lets the selected action run before it closes', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/PortalMenu.tsx'), 'utf8');
  assert.match(source, /style=\{style\}\s+onClick=\{handleMenuClick\}/);
  assert.doesNotMatch(source, /onClickCapture=\{handleMenuClick\}/);
});

test('logout clears the session even when audit logging is unavailable', () => {
  const source = readFileSync(resolve(repositoryRoot, 'app/api/auth/logout/route.ts'), 'utf8');
  assert.match(source, /catch \(error\)[\s\S]*logout audit failed/);
  assert.match(source, /response\.cookies\.set\(SESSION_COOKIE/);
  assert.match(source, /maxAge:\s*0/);
});

test('abnormal-time approval is one click while rejection still requires a reason', () => {
  const workbench = readFileSync(resolve(repositoryRoot, 'components/AbnormalTimeWorkbench.tsx'), 'utf8');
  const attendance = readFileSync(resolve(repositoryRoot, 'components/AttendanceManagementShell.tsx'), 'utf8');
  const reviewService = readFileSync(resolve(repositoryRoot, 'lib/abnormal-time-review-service.ts'), 'utf8');

  assert.match(workbench, /async function approve\(event: AbnormalTimeEventDTO\)/);
  assert.match(workbench, /decision:\s*'confirmed',[\s\S]*expectedVersion:\s*event\.version/);
  assert.match(workbench, /onClick=\{\(\) => void approve\(event\)\}[\s\S]*同意/);
  assert.match(workbench, /驳回时请填写审核说明/);
  assert.doesNotMatch(workbench, /审核时长（分钟）/);
  assert.match(attendance, /decision === 'rejected'[\s\S]*window\.prompt\('请输入驳回原因'\)[\s\S]*:\s*''/);
  assert.match(reviewService, /approvedDurationMilliseconds:\s*input\.decision === 'confirmed'[\s\S]*existing\.durationMilliseconds/);
  assert.match(reviewService, /const employeeExempt = input\.decision === 'confirmed'/);
});

test('abnormal-time entry is duration-only and review has no interval overlap gate', () => {
  const attendance = readFileSync(resolve(repositoryRoot, 'components/AttendanceManagementShell.tsx'), 'utf8');
  const fieldReport = readFileSync(resolve(repositoryRoot, 'components/FieldReportMobile.tsx'), 'utf8');
  const reviewService = readFileSync(resolve(repositoryRoot, 'lib/abnormal-time-review-service.ts'), 'utf8');

  assert.doesNotMatch(attendance, /datetime-local/);
  assert.doesNotMatch(fieldReport, /datetime-local|max="1200"/);
  assert.match(attendance, /异常时长（分钟）/);
  assert.match(fieldReport, /异常时长 <b>必填<\/b>/);
  assert.doesNotMatch(reviewService, /attendanceRecord|processExecution|startedAt|endedAt/);
});

test('production reassignment presents business process information instead of internal plan ids', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const dialogStart = source.indexOf('function ProductionReassignmentDialog');
  const dialogEnd = source.indexOf('function ProcessCompletionDialog', dialogStart);
  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart);
  const dialog = source.slice(dialogStart, dialogEnd);

  assert.doesNotMatch(dialog, /task\.workOrder\.code/);
  assert.match(dialog, /String\(task\.position\)\.padStart\(2, '0'\)/);
  assert.match(dialog, /task\.processName/);
  assert.match(dialog, /production-reassignment-task-crew/);
  assert.match(dialog, /production-reassignment-crew-preview/);
  assert.match(dialog, /件次/);
});

test('production reassignment uses one modal scroll surface and a single-column task list', () => {
  const source = readFileSync(resolve(repositoryRoot, 'app/production/production-workbench.css'), 'utf8');
  assert.match(source, /\.production-reassignment-dialog \.production-arrangement-dialog-body\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(source, /\.production-reassignment-task-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(source, /\.production-reassignment-employee-grid\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/);
});

test('production execution exposes a permission-guarded WIP transfer preview', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');

  assert.match(service, /productionPlanBatch:\s*\{[\s\S]*?id:\s*true,[\s\S]*?deletedAt:\s*true/);
  assert.match(service, /productionPlanBatchId:\s*order\.productionPlanBatch\?\.deletedAt[\s\S]*?order\.productionPlanBatch\?\.id \|\| null/);
  assert.match(component, /canManageWipWarehouse\(user\)/);
  assert.match(component, /canManageWip && !readOnly && !isWipContinuation && !isFullyMovedOutSource && displayStage !== "completed" && order\.productionPlanBatchId && order\.processRoute/);
  assert.match(component, /href=\{`\/workspace\/wip\?batchId=\$\{encodeURIComponent\(order\.productionPlanBatchId\)\}`\}/);
  assert.match(component, />转入半成品仓<\/Link>/);
});

test('production week header separates plan batches from actual current and carryover work orders', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');

  assert.match(service, /summaryCarryoverByOrder[\s\S]*?loadProductionCarryoverMetadata/);
  assert.match(service, /nativeCurrent:\s*Math\.max\(0, summaryRootOrders\.length - summaryCarryoverByOrder\.size\)/);
  assert.match(service, /carryover:\s*summaryCarryoverByOrder\.size/);
  assert.match(component, /本周正常 <b>/);
  assert.match(component, /normalBatchCount/);
  assert.match(component, /wipTaskCount/);
  assert.match(component, /totalExecutionCount/);
  assert.match(component, /\+半成品/);
  assert.match(component, /执行\{summary\.executionCountBreakdown\.nativeCurrent\}\+遗留\{summary\.executionCountBreakdown\.carryover\}\+半成品\{summary\.executionCountBreakdown\.wipContinuation\}=\{summary\.executionCountBreakdown\.total\}/);
  assert.match(component, /执行合计 \$\{summary\.executionCountBreakdown\.total\}/);
  assert.match(component, /refreshSignature=\{scope === 'current'[\s\S]*?summary\?\.executionCountBreakdown\?\.total/);
});

test('production execution defaults to weekly plan attainment and exposes separate quantity and WIP-labor calculations', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');

  assert.match(service, /const \[nativeOrders, weekWipContinuations, wipPlanMetrics\] = await Promise\.all/);
  assert.match(service, /input\.includeSummary && input\.week\.weekStart[\s\S]*?loadWipWeekLaborMetrics\(input\.week\.weekStart\)/);
  assert.match(service, /summary:\s*\{[\s\S]*?wipPlanMetrics,[\s\S]*?executionCountBreakdown/);
  assert.match(component, /pageParams\.set\('includeSummary', '1'\)/, 'the initial board request must include WIP metrics');
  assert.match(component, /subscribeProductionDataInvalidations[\s\S]*?productionBoardCache\.clear\(\)[\s\S]*?setRefreshToken\(value => value \+ 1\)/, 'WIP invalidation must force the summary-bearing first page to refetch');
  assert.match(component, /percentage:\s*summary\?\.planTotals\.percentage \?\? null/);
  assert.match(component, /周计划达成率/);
  assert.match(component, /计划数量达成率/);
  assert.match(component, /有效标准工时完成率/);
  assert.match(component, /已完成有效标准工时 ÷ 有效计划标准工时/);
  assert.match(component, /reclassifiedFromNativeMilliseconds/);
  assert.match(component, /targetWipCompletedMilliseconds/);
});

test('standalone production summary suppresses the same fully-owned WIP native target as the board', () => {
  const service = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');
  const summaryStart = service.indexOf('export async function summarizeProduction(');
  const summaryEnd = service.indexOf('export async function loadProductionOrderById', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  const summaryImplementation = service.slice(summaryStart, summaryEnd);
  assert.match(summaryImplementation, /loadedOrders\.filter\(order => !shouldSuppressNativeOrderForWipTarget\(\{/);
  assert.match(summaryImplementation, /sourceLots:\s*sourceLotsByWorkOrder\.get\(order\.id\) \|\| \[\]/);
  assert.match(summaryImplementation, /continuations:\s*continuationsByWorkOrder\.get\(order\.id\) \|\| \[\]/);
});

test('WIP rescheduling uses an interactive impact modal and exposes target-week result links', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/WipWarehouseShell.tsx'), 'utf8');
  const css = readFileSync(resolve(repositoryRoot, 'app/workspace/wip/wip-workbench.css'), 'utf8');

  assert.doesNotMatch(component, /window\.prompt/);
  assert.match(component, /data-testid="wip-reschedule-dialog"/);
  assert.match(component, /当前有效安排/);
  assert.match(component, /核对迁移影响/);
  assert.match(component, /已完成数量、报工记录、员工工时和原始工艺路线全部保留/);
  assert.match(component, /查看生产执行/);
  assert.match(component, /查看计划中心/);
  assert.match(css, /\.wip-reschedule-weeks[\s\S]*grid-template-columns:/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.wip-reschedule-modal/);
  assert.doesNotMatch(component, /data\.weeks\.slice\(0, 5\)/);
  assert.match(component, /data\.weeks\.map\(week/);
});

test('WIP mobile reporting uses Chinese source choices and target-week worker assignments', () => {
  const mobile = readFileSync(resolve(repositoryRoot, 'components/FieldReportMobile.tsx'), 'utf8');
  const warehouse = readFileSync(resolve(repositoryRoot, 'components/WipWarehouseShell.tsx'), 'utf8');
  const production = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/wip-warehouse.ts'), 'utf8');
  const migration = readFileSync(resolve(repositoryRoot, 'prisma/migrations/202609030003_wip_worker_assignments/migration.sql'), 'utf8');

  assert.match(mobile, /<strong>报工来源<\/strong>/);
  assert.match(mobile, /原订单未转出数量/);
  assert.match(mobile, /半成品批次 \{allocation\.lotNo\}/);
  assert.doesNotMatch(mobile, /半成品批次（报半成品时必须明确选择）/);
  assert.match(warehouse, /action:\s*'assign_workers'/);
  assert.match(warehouse, /保存人员安排/);
  assert.match(production, /production-wip-worker-summary/);
  assert.match(production, /wipContinuation\.workers/);
  assert.match(service, /eventType:\s*'ASSIGN_WORKERS'/);
  assert.match(migration, /CREATE TABLE "wip_week_allocation_workers"/);
});

test('WIP continuation is projected into planning, production execution and process reporting', () => {
  const planningApi = readFileSync(resolve(repositoryRoot, 'app/api/planning/orders/route.ts'), 'utf8');
  const planningUi = readFileSync(resolve(repositoryRoot, 'components/PlanningCenterShell.tsx'), 'utf8');
  const productionService = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');
  const continuationService = readFileSync(resolve(repositoryRoot, 'lib/wip-continuations.ts'), 'utf8');
  const productionUi = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');

  assert.match(planningApi, /loadWipContinuations/);
  assert.match(planningApi, /wipContinuations:\s*visibleWipContinuations/);
  assert.match(planningUi, /className="planning-wip-branch"/);
  assert.doesNotMatch(planningUi, /className="planning-wip-lane"/);
  assert.match(productionService, /serializeWipExecutionOrder/);
  assert.match(productionService, /includeSupersededHistory:\s*true/);
  assert.match(productionService, /wipMovedOutContinuations/);
  assert.match(productionService, /wipMovedOutSummary/);
  assert.match(continuationService, /canonicalWipWeekDate/);
  assert.match(continuationService, /status:\s*WipWeekAllocationStatus\.SUPERSEDED/);
  assert.match(productionUi, /is-wip-moved-out-source/);
  assert.match(productionUi, /isWipHistoricalContinuation/);
  assert.match(productionUi, /selectPrimaryWipMovedOutTarget\(movedOutTargets\)/);
  assert.match(productionUi, /primaryMovedOutTargetHasRemaining \? '查看续作' : '查看历史'/);
  assert.match(productionUi, /data-wip-allocation-id=\{wipContinuation\?\.allocationId/);
  assert.match(productionUi, /wipAllocationId:\s*completionOrder\.wipContinuation\?\.allocationId/);
  assert.match(productionUi, /activeSteps=\{completionOrder\.wipContinuation[\s\S]*?filter\(step/);
  assert.match(productionUi, /wipTargetStartsInFuture[\s\S]*?目标周开始后可扫码或在此报工/);
  assert.match(productionUi, /半成品续作/);
});

test('WIP correction is reversible only through guarded unschedule and source-order return flows', () => {
  const api = readFileSync(resolve(repositoryRoot, 'app/api/wip/route.ts'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/wip-warehouse.ts'), 'utf8');
  const component = readFileSync(resolve(repositoryRoot, 'components/WipWarehouseShell.tsx'), 'utf8');

  for (const action of ['preview_unschedule', 'unschedule', 'preview_return_to_order', 'return_to_order']) {
    assert.match(api, new RegExp(`action === '${action}'`));
  }
  assert.match(service, /WIP_UNSCHEDULE_HAS_PROGRESS/);
  assert.match(service, /WIP_RETURN_HAS_PROGRESS/);
  assert.match(service, /WIP_PHYSICAL_RETURN_REQUIRED/);
  assert.match(service, /completedFactsPreserved:\s*true/);
  assert.match(service, /reportingFactsPreserved:\s*true/);
  assert.match(service, /laborFactsPreserved:\s*true/);
  assert.match(component, /撤销周安排/);
  assert.match(component, /撤销转仓并回归原订单/);
  assert.match(component, /我已确认实物退回原订单流转位置/);
});

test('cancelled WIP branches stay auditable but are absent from the active workbench', () => {
  const service = readFileSync(resolve(repositoryRoot, 'lib/wip-warehouse.ts'), 'utf8');
  const warehouseUi = readFileSync(resolve(repositoryRoot, 'components/WipWarehouseShell.tsx'), 'utf8');
  const planningUi = readFileSync(resolve(repositoryRoot, 'components/PlanningCenterShell.tsx'), 'utf8');
  const productionUi = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');

  assert.match(service, /scheduleStatus:\s*\{ not: SemiFinishedScheduleStatus\.CANCELLED \}/);
  assert.match(warehouseUi, /publishProductionDataInvalidation\(\{ kind: 'wip-returned'/);
  assert.match(planningUi, /subscribeProductionDataInvalidations[\s\S]*?invalidation\.kind\.startsWith\('wip-'\)/);
  assert.match(productionUi, /productionRefreshPendingRef[\s\S]*?setRefreshToken\(value => value \+ 1\)/);
});

test('WIP execution rows keep a purple entity identity after generic zebra and hover rules', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const css = readFileSync(resolve(repositoryRoot, 'app/production/production-workbench.css'), 'utf8');
  const tokens = readFileSync(resolve(repositoryRoot, 'app/styles/hm-design-tokens.css'), 'utf8');
  const genericRowIndex = css.lastIndexOf('.hm-production-workbench .production-dispatch-row:nth-child(even)');
  const purpleRowIndex = css.lastIndexOf('.hm-production-workbench .production-dispatch-row.is-wip-continuation:nth-child(even)');

  assert.ok(purpleRowIndex > genericRowIndex);
  assert.match(tokens, /--hm-color-entity-wip:\s*#6d28d9/);
  assert.match(css, /is-wip-continuation:focus-within[\s\S]*?--hm-color-entity-wip-soft-hover/);
  assert.match(component, /来源周 \{wipContinuation\.sourceWeekStartDate\.slice\(5\)\} → 目标周 \{wipContinuation\.targetWeekStartDate\.slice\(5\)\}/);
  assert.match(component, /setTargetWipAllocationId/);
  assert.match(component, /is-deep-link-target/);
});

test('current production keeps preparation and SOP-validation orders visible with warning badges', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');

  assert.match(service, /releaseState:\s*\{\s*in:\s*\['active', 'preparation'\]\s*\}/);
  assert.match(service, /planReleaseState:\s*order\.productionPlanBatch/);
  assert.match(service, /sopStage:\s*order\.drawingLibraryItem\?\.sopDocument/);
  assert.match(component, /order\.planReleaseState === 'preparation'[\s\S]*?本周预备/);
  assert.match(component, /order\.sopStage === 'validating'[\s\S]*?SOP验证中/);
  assert.match(component, /!order\.documentCategoryCodes\.includes\('sop'\)[\s\S]*?SOP待补/);
});

test('SOP validation remains an audit warning and no longer blocks automatic or manual release', () => {
  const planningService = readFileSync(resolve(repositoryRoot, 'lib/production-planning.ts'), 'utf8');
  const planningUi = readFileSync(resolve(repositoryRoot, 'components/PlanningCenterShell.tsx'), 'utf8');
  const createBatchRoute = readFileSync(resolve(repositoryRoot, 'app/api/planning/orders/[id]/batches/route.ts'), 'utf8');
  const updateBatchRoute = readFileSync(resolve(repositoryRoot, 'app/api/planning/batches/[id]/route.ts'), 'utf8');
  const releaseRoute = readFileSync(resolve(repositoryRoot, 'app/api/planning/release/commit/route.ts'), 'utf8');
  const autoReleaseStart = planningService.indexOf('export async function automaticallyReleaseProductionPlanBatch');
  const autoReleaseEnd = planningService.indexOf('/**', autoReleaseStart);
  const automaticRelease = planningService.slice(autoReleaseStart, autoReleaseEnd);

  assert.ok(autoReleaseStart >= 0 && autoReleaseEnd > autoReleaseStart);
  assert.doesNotMatch(automaticRelease, /confirmSopValidation|validatingSopCount[^\n]*return null/);
  for (const route of [createBatchRoute, updateBatchRoute, releaseRoute]) {
    assert.doesNotMatch(route, /PLAN_SOP_VALIDATION_CONFIRMATION_REQUIRED|confirmSopValidation/);
  }
  assert.match(planningService, /warnings\.push\(`SOP处于验证中/);
  assert.match(planningUi, /SOP 验证中，不阻断进入生产执行/);
  assert.match(planningUi, /保留验证提示并同步/);
  assert.doesNotMatch(planningUi, /releasePreview\.validatingSopCount > 0 && !releaseSopConfirmed/);
});
