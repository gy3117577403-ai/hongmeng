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
  assert.match(component, /canManageWip && !readOnly && displayStage !== "completed" && order\.productionPlanBatchId && order\.processRoute/);
  assert.match(component, /href=\{`\/workspace\/wip\?batchId=\$\{encodeURIComponent\(order\.productionPlanBatchId\)\}`\}/);
  assert.match(component, />转入半成品仓<\/Link>/);
});

test('production week header separates plan batches from actual current and carryover work orders', () => {
  const component = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  const service = readFileSync(resolve(repositoryRoot, 'lib/production-execution.ts'), 'utf8');

  assert.match(service, /summaryCarryoverByOrder[\s\S]*?loadProductionCarryoverMetadata/);
  assert.match(service, /nativeCurrent:\s*Math\.max\(0, summaryRootOrders\.length - summaryCarryoverByOrder\.size\)/);
  assert.match(service, /carryover:\s*summaryCarryoverByOrder\.size/);
  assert.match(component, /本周计划 <b>/);
  assert.match(component, /执行\{summary\.executionCountBreakdown\.nativeCurrent\}\+\{summary\.executionCountBreakdown\.carryover\}=\{summary\.executionCountBreakdown\.total\}/);
  assert.match(component, /执行合计 \$\{summary\.executionCountBreakdown\.total\}/);
  assert.match(component, /refreshSignature=\{scope === 'current'[\s\S]*?summary\?\.executionCountBreakdown\?\.total/);
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
