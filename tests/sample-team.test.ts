import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cleanSampleColor,
  cleanSampleText,
  deriveSampleDataStatus,
  parseOptionalNonNegativeInteger,
  parseOptionalSampleDate,
  sampleTaskStatusAfterCapture,
  sampleRequestHash,
  sanitizeSampleDraftSection,
  sanitizeSamplePayload,
} from '../lib/sample-team';

test('sample business values are optional and do not require a missing-value reason', () => {
  assert.equal(cleanSampleText('   '), null);
  assert.equal(cleanSampleColor(''), null);
  assert.equal(parseOptionalSampleDate(''), null);
  assert.equal(parseOptionalNonNegativeInteger(''), null);
  assert.deepEqual(sanitizeSamplePayload(undefined), {});
  assert.deepEqual(sanitizeSamplePayload({}), {});
  assert.deepEqual(sanitizeSamplePayload({ remark: '', measurements: [] }), {
    remark: '',
    measurements: [],
  });
});

test('sample payload validation rejects invalid system values without inventing business requirements', () => {
  assert.throws(() => parseOptionalSampleDate('2026-02-30'), /INVALID_SAMPLE_DATE/);
  assert.throws(() => parseOptionalNonNegativeInteger(-1), /INVALID_SAMPLE_NUMBER/);
  assert.throws(
    () => sanitizeSamplePayload({ note: 'x'.repeat(40_001) }),
    /SAMPLE_PAYLOAD_TOO_LARGE/,
  );
});

test('sample task data state is count and review driven rather than completeness driven', () => {
  assert.equal(deriveSampleDataStatus([], []), 'NO_DATA');
  assert.equal(deriveSampleDataStatus([{ reviewStatus: 'DRAFT' }], []), 'COLLECTING');
  assert.equal(deriveSampleDataStatus([{ reviewStatus: 'PENDING' }], []), 'PENDING_REVIEW');
  assert.equal(deriveSampleDataStatus([{ reviewStatus: 'CHANGES_REQUESTED' }], []), 'NEEDS_CHANGES');
  assert.equal(deriveSampleDataStatus([{ reviewStatus: 'APPROVED' }], []), 'PROCESSED');
  assert.equal(deriveSampleDataStatus([{ reviewStatus: 'PUBLISHED' }], []), 'PROCESSED');
  assert.equal(deriveSampleDataStatus([
    { reviewStatus: 'PUBLISHED' },
    { reviewStatus: 'APPROVED', publishedEntityType: 'product_time_draft' },
  ], []), 'PARTIALLY_PUBLISHED');
});

test('capture starts a sample task but never changes a closed task state', () => {
  assert.equal(sampleTaskStatusAfterCapture('PLANNED'), 'IN_PROGRESS');
  assert.equal(sampleTaskStatusAfterCapture('SUBMITTED'), 'SUBMITTED');
  assert.equal(sampleTaskStatusAfterCapture('COMPLETED'), 'COMPLETED');
  assert.equal(sampleTaskStatusAfterCapture('CANCELLED'), 'CANCELLED');
});

test('sample collection and publication stay outside production reporting ledgers', () => {
  const sourceFiles = [
    'app/api/sample-tasks/[id]/entries/route.ts',
    'app/api/sample-tasks/[id]/photos/route.ts',
    'app/api/sample-tasks/[id]/submit/route.ts',
    'app/api/sample-tasks/[id]/review/route.ts',
    'lib/sample-team-publish.ts',
  ];
  const source = sourceFiles.map(path => readFileSync(path, 'utf8')).join('\n');

  assert.doesNotMatch(source, /processCompletion\.(?:create|update|delete)/);
  assert.doesNotMatch(source, /processLaborClaim\.(?:create|update|delete)/);
  assert.doesNotMatch(source, /workOrder\.(?:create|update|delete)/);
  assert.doesNotMatch(source, /productionPlanOrder\.(?:create|update|delete)/);
  assert.match(source, /productTimeProfile/);
  assert.match(source, /status:\s*'draft'/);
});

test('review contract is package-level, optimistic, idempotent, and has exactly three decisions', () => {
  const reviewRoute = readFileSync('app/api/sample-tasks/[id]/review/route.ts', 'utf8');
  assert.match(reviewRoute, /type PackageDecision = 'CONFIRM' \| 'EDIT' \| 'REJECT'/);
  assert.match(reviewRoute, /submissionId/);
  assert.match(reviewRoute, /submissionRevision/);
  assert.match(reviewRoute, /expectedTaskVersion/);
  assert.match(reviewRoute, /decisionMutationId/);
  assert.match(reviewRoute, /cleanSampleText\(body\.comment/);
  assert.doesNotMatch(reviewRoute, /reasonCode|fixedReason|reasonOptions/);
  assert.match(reviewRoute, /sampleDataEntry\.updateMany\(\{\s*where:\s*\{\s*id:\s*entry\.id/);
  assert.match(reviewRoute, /status:\s*'CONFIRMED'/);
  assert.match(reviewRoute, /acceptedSubmissionId:\s*submission\.id/);
  assert.match(reviewRoute, /status:\s*'COMPLETED'/);
});

test('durable sample section drafts validate row shape, limits, and proposed process boundaries', () => {
  const process = sanitizeSampleDraftSection('PROCESS_TIME', {
    rows: [
      { rowId: 'row-1', position: 0, processDefinitionId: null, processName: '新工序', processOrigin: 'PROPOSED', measuredMilliseconds: 12500 },
      { rowId: 'row-2', position: 1, processDefinitionId: null, processName: '', processOrigin: 'PROPOSED', measuredMilliseconds: null },
    ],
  });
  assert.equal((process.rows as Array<Record<string, unknown>>)[0].measuredMilliseconds, 12500);
  assert.throws(() => sanitizeSampleDraftSection('PROCESS_TIME', {
    rows: [{ rowId: 'row-1', position: 0, processDefinitionId: 'master-id', processName: '裁线', processOrigin: 'PROPOSED', measuredMilliseconds: 1000 }],
  }), /INVALID_SAMPLE_PROCESS_REFERENCE/);
  assert.throws(() => sanitizeSampleDraftSection('STRIPPING', {
    rows: Array.from({ length: 51 }, (_, index) => ({ rowId: `row-${index}`, position: index, model: '' })),
  }), /SAMPLE_DRAFT_ROW_LIMIT/);
});

test('sample mutation request hashes are canonical and distinguish changed content', () => {
  const first = sampleRequestHash({ kind: 'NOTICE', payload: { content: '注意压接', severity: 'high' } });
  const reordered = sampleRequestHash({ payload: { severity: 'high', content: '注意压接' }, kind: 'NOTICE' });
  const changed = sampleRequestHash({ kind: 'NOTICE', payload: { content: '注意裁线', severity: 'high' } });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test('P0 sample capture routes enforce submit lock, withdrawal, completion, and candidate mapping contracts', () => {
  const sections = readFileSync('app/api/sample-tasks/[id]/sections/[kind]/route.ts', 'utf8');
  const submit = readFileSync('app/api/sample-tasks/[id]/submit/route.ts', 'utf8');
  const withdraw = readFileSync('app/api/sample-tasks/[id]/withdraw-submission/route.ts', 'utf8');
  const task = readFileSync('app/api/sample-tasks/[id]/route.ts', 'utf8');
  const review = readFileSync('app/api/sample-tasks/[id]/review/route.ts', 'utf8');
  const entry = readFileSync('app/api/sample-tasks/[id]/entries/route.ts', 'utf8');
  const photo = readFileSync('app/api/sample-tasks/[id]/photos/route.ts', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync('prisma/migrations/202609020001_sample_capture_p0_p3/migration.sql', 'utf8');
  const legacyMigration = readFileSync('prisma/migrations/202609020002_sample_capture_legacy_backfill/migration.sql', 'utf8');
  const center = readFileSync('components/SampleTeamCenter.tsx', 'utf8');

  assert.match(sections, /expectedTaskVersion/);
  assert.match(sections, /expectedSectionRevision/);
  assert.match(sections, /SAMPLE_TASK_SUBMITTED/);
  assert.match(submit, /SAMPLE_EMPTY_SUBMISSION/);
  assert.match(submit, /sampleSubmission\.create/);
  assert.match(submit, /taskId_mutationId/);
  assert.match(submit, /\{ id: rowId, kind, draftSectionKind: null, draftRowId: null \}/);
  assert.match(withdraw, /SAMPLE_SUBMISSION_REVIEW_STARTED/);
  assert.match(withdraw, /withdrawalMutationId/);
  assert.match(task, /SAMPLE_TASK_HAS_UNFINISHED_DATA/);
  assert.match(task, /status:\s*'CANCELLED'/);
  assert.match(task, /archivedAt/);
  assert.doesNotMatch(task, /REOPEN/);
  assert.match(task, /confirmNoData/);
  assert.match(review, /processDefinitionId/);
  assert.match(review, /SAMPLE_PACKAGE_NOT_READY/);
  assert.doesNotMatch(review, /create_process_definition_from_sample_review/);
  assert.match(center, /请选择已有正式工序/);
  assert.doesNotMatch(center, /createProcessDefinition/);
  assert.match(entry, /SAMPLE_TASK_SUBMITTED/);
  assert.match(entry, /taskId_clientMutationId/);
  assert.match(entry, /SAMPLE_ENTRY_MUTATION_CONFLICT/);
  assert.match(photo, /SAMPLE_PHOTO_MUTATION_TOMBSTONED/);
  assert.match(photo, /existing\.sha256 !== sha256/);
  assert.match(photo, /Photo append is commutative/);
  assert.doesNotMatch(photo, /fresh\.version !== expectedTaskVersion/);
  assert.match(schema, /model SampleDraftSection/);
  assert.match(schema, /model SampleSubmission/);
  assert.match(schema, /lastSubmittedRevision/);
  assert.match(migration, /CREATE TABLE "sample_draft_sections"/);
  assert.match(migration, /CREATE TABLE "sample_submissions"/);
  assert.match(migration, /"last_submitted_revision" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /"withdrawal_mutation_id" TEXT/);
  assert.match(migration, /sample_entries_draft_row_submission_key/);
  assert.match(legacyMigration, /legacy-sample-submission-/);
  assert.match(legacyMigration, /ON CONFLICT \("task_id", "revision"\) DO NOTHING/);
  assert.match(legacyMigration, /"active_submission_id" = CASE WHEN submission\."status" = 'PENDING'/);
});

test('field-only sample capture context does not expose the employee or product directory', () => {
  const contextRoute = readFileSync('app/api/sample-team/context/route.ts', 'utf8');
  assert.match(contextRoute, /captureOnly/);
  assert.match(contextRoute, /members:\s*\[\],\s*sampleMemberCount:\s*0,\s*products:\s*\[\]/);
});

test('sample migration stores metadata in PostgreSQL and keeps uploaded files in object storage', () => {
  const migration = readFileSync('prisma/migrations/202608170002_sample_team_module/migration.sql', 'utf8');
  const uploadRoute = readFileSync('app/api/sample-tasks/[id]/photos/route.ts', 'utf8');

  assert.match(migration, /CREATE TABLE "sample_tasks"/);
  assert.match(migration, /CREATE TABLE "sample_data_entries"/);
  assert.match(migration, /CREATE TABLE "sample_photos"/);
  assert.match(migration, /"object_key" TEXT NOT NULL/);
  assert.match(migration, /"deleted_at" TIMESTAMP\(3\)/);
  assert.match(uploadRoute, /putObject\(/);
  assert.doesNotMatch(uploadRoute, /writeFile|createWriteStream/);
});

test('mobile sample capture separates durable drafts, submission, withdrawal, and photo retries', () => {
  const component = readFileSync('components/SampleCaptureMobile.tsx', 'utf8');
  const migration = readFileSync('prisma/migrations/202609020001_sample_capture_p0_p3/migration.sql', 'utf8');

  assert.match(component, /保存草稿/);
  assert.match(component, /撤回提交/);
  assert.match(component, /\/sections/);
  assert.match(component, /indexedDB\.open/);
  assert.match(component, /multiple/);
  assert.match(component, /clientMutationId/);
  assert.match(migration, /sample_draft_sections/);
  assert.match(migration, /sample_submissions/);
  assert.match(migration, /"request_hash" TEXT/);
});

test('forced camera normalization emits JPEG bytes for its generated jpg filename', () => {
  const source = readFileSync('lib/image-client.ts', 'utf8');

  assert.match(source, /const outputType = options\.force\s*\? 'image\/jpeg'/);
  assert.match(source, /fileName: readableCameraName\(\)/);
});

test('sample planning workspace uses one compact master-detail surface instead of duplicate empty panels', () => {
  const component = readFileSync('components/SampleTeamCenter.tsx', 'utf8');
  const stylesheet = readFileSync('app/sample-team-workbench.css', 'utf8');

  assert.match(component, /className="sample-team-zero-state"/);
  assert.match(component, /className="sample-team-statusbar"/);
  assert.match(component, /className="sample-detail-tabs"/);
  assert.match(component, /任务概览/);
  assert.match(component, /采集数据/);
  assert.match(component, /过程照片/);
  assert.match(component, /整包审核/);
  assert.match(component, /确认通过/);
  assert.match(component, /编辑资料/);
  assert.match(component, /整包驳回/);
  assert.doesNotMatch(component, /逐项审核/);
  assert.doesNotMatch(component, /className="sample-team-metrics"/);
  assert.doesNotMatch(component, /className="sample-team-toolbar"/);
  assert.match(stylesheet, /grid-template-columns:\s*352px minmax\(0, 1fr\)/);
  assert.match(stylesheet, /\.sample-plan-backdrop \.sample-plan-dialog/);
  assert.match(stylesheet, /main\.sample-team-page\.hm-workbench-root\.hm-workbench-root\s*\{\s*padding-top:\s*0/);
  assert.match(stylesheet, /\.sample-capture-page\s*\{\s*box-sizing:\s*border-box;\s*padding-bottom:\s*88px/);
});

test('pending review summary counts active submission packages rather than child items', () => {
  const listRoute = readFileSync('app/api/sample-tasks/route.ts', 'utf8');
  const serializer = readFileSync('lib/sample-team.ts', 'utf8');

  assert.match(listRoute, /active\.reduce\(\(count, task\) => count \+ task\.counts\.pendingReview, 0\)/);
  assert.match(serializer, /pendingReview:\s*task\.activeSubmission\?\.status === 'PENDING' \? 1 : 0/);
});

test('production, planning, and warehouse share a push-down mass/sample mode drawer', () => {
  const header = readFileSync('components/layout/AppWorkbenchHeader.tsx', 'utf8');
  const drawer = readFileSync('components/layout/ModuleModeDrawer.tsx', 'utf8');
  const foundation = readFileSync('app/styles/hm-workbench-foundation.css', 'utf8');
  const production = readFileSync('components/ProductionExecutionCenter.tsx', 'utf8');
  const planning = readFileSync('components/PlanningCenterShell.tsx', 'utf8');
  const sample = readFileSync('components/SampleTeamCenter.tsx', 'utf8');
  const warehousePage = readFileSync('app/workspace/warehouse/page.tsx', 'utf8');

  assert.match(header, /href: '\/production'.*modeSwitchable: true/);
  assert.match(header, /href: '\/weekly-plan-center'.*modeSwitchable: true/);
  assert.match(header, /href: '\/workspace\/warehouse'.*modeSwitchable: true/);
  assert.match(drawer, /量产与样品共用模块入口/);
  assert.match(foundation, /\.hm-module-mode-drawer\s*\{[^}]*position:\s*relative/s);
  assert.doesNotMatch(foundation, /\.hm-module-mode-drawer\s*\{[^}]*position:\s*(?:fixed|absolute)/s);
  assert.doesNotMatch(production, /sample-module-branch-entry/);
  assert.doesNotMatch(planning, /sample-module-branch-entry/);
  assert.doesNotMatch(sample, /sample-team-branch-tabs/);
  assert.match(warehousePage, /branch === 'samples'.*mode="materials"/s);
  assert.match(sample, /不扣库存、不生成正式领料/);
  assert.match(sample, /kind === 'MATERIAL'/);
});
