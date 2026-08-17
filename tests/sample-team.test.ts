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
  assert.equal(sampleTaskStatusAfterCapture('SUBMITTED'), 'IN_PROGRESS');
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

test('review contract is item-level, optimistic, and supports free-form optional comments', () => {
  const reviewRoute = readFileSync('app/api/sample-tasks/[id]/review/route.ts', 'utf8');
  assert.match(reviewRoute, /itemType/);
  assert.match(reviewRoute, /itemId/);
  assert.match(reviewRoute, /expectedVersion/);
  assert.match(reviewRoute, /cleanSampleText\(body\.comment/);
  assert.doesNotMatch(reviewRoute, /reasonCode|fixedReason|reasonOptions/);
  assert.doesNotMatch(reviewRoute, /updateMany\(\{\s*where:\s*\{\s*taskId/);
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

test('sample planning workspace uses one compact master-detail surface instead of duplicate empty panels', () => {
  const component = readFileSync('components/SampleTeamCenter.tsx', 'utf8');
  const stylesheet = readFileSync('app/sample-team-workbench.css', 'utf8');

  assert.match(component, /className="sample-team-zero-state"/);
  assert.match(component, /className="sample-team-statusbar"/);
  assert.match(component, /className="sample-detail-tabs"/);
  assert.match(component, /任务概览/);
  assert.match(component, /采集数据/);
  assert.match(component, /过程照片/);
  assert.match(component, /逐项审核/);
  assert.doesNotMatch(component, /className="sample-team-metrics"/);
  assert.doesNotMatch(component, /className="sample-team-toolbar"/);
  assert.match(stylesheet, /grid-template-columns:\s*352px minmax\(0, 1fr\)/);
  assert.match(stylesheet, /\.sample-plan-backdrop \.sample-plan-dialog/);
  assert.match(stylesheet, /main\.sample-team-page\.hm-workbench-root\.hm-workbench-root\s*\{\s*padding-top:\s*0/);
  assert.match(stylesheet, /\.sample-capture-page\s*\{\s*box-sizing:\s*border-box;\s*padding-bottom:\s*88px/);
});

test('pending review summary counts review items rather than tasks', () => {
  const listRoute = readFileSync('app/api/sample-tasks/route.ts', 'utf8');

  assert.match(listRoute, /active\.reduce\(\(count, task\) => count \+ task\.counts\.pendingReview, 0\)/);
});
