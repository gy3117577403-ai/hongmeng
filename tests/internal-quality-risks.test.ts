import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  evaluateInternalQualityRiskReadiness,
  InternalQualityRiskError,
  normalizeQualityRiskRelationIds,
  parseInternalQualityRiskInput,
  qualityRiskPurgeEligibleAt,
  type InternalQualityRiskRecord,
} from '../lib/internal-quality-risks';

const repositoryRoot = resolve(import.meta.dirname, '..');
const migration = readFileSync(
  resolve(repositoryRoot, 'prisma/migrations/202608260002_internal_quality_risk_management/migration.sql'),
  'utf8',
);
const schema = readFileSync(resolve(repositoryRoot, 'prisma/schema.prisma'), 'utf8');
const workbench = readFileSync(resolve(repositoryRoot, 'components/InternalQualityRiskShell.tsx'), 'utf8');
const production = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');

function readinessRecord(overrides: Record<string, unknown> = {}): InternalQualityRiskRecord {
  return {
    defectPhenomenon: '端子压接后拉脱力不足',
    occurrenceCause: '压接高度参数偏离标准',
    escapeCause: '首件确认未记录拉脱力',
    rootCause: '设备换型参数未受控',
    containmentAction: '隔离在制品并全检',
    correctiveAction: '锁定参数并增加首件确认',
    verificationResult: '连续三批抽检合格',
    finalConclusion: '措施有效，可按控制要求恢复生产',
    evidenceSummary: '拉脱力记录和现场照片已核对',
    preventiveAction: '换型后强制复核参数',
    severity: 'HIGH',
    issues: [{ issue: { deletedAt: null, isMajorQuality: false, majorApprovals: [] } }],
    workOrders: [{ workOrder: { deletedAt: null } }],
    products: [],
    eightDReports: [],
    revisions: [],
    ...overrides,
  } as unknown as InternalQualityRiskRecord;
}

test('internal quality risk parser normalizes content, dates and many-to-many relations', () => {
  const parsed = parseInternalQualityRiskInput({
    reportNo: ' IQR-20260826-001 ',
    title: '  压接拉脱力重大异常  ',
    severity: 'critical',
    occurrenceDate: '2026-08-26',
    effectiveFrom: '2026-08-27',
    effectiveUntil: '2026-09-30',
    rootCause: '第一行\r\n第二行',
    issueIds: ['issue-a', ' issue-a ', 'issue-b'],
    workOrderIds: JSON.stringify(['order-a', 'order-a', 'order-b']),
    productIds: 'product-a, product-b, product-a',
  });

  assert.equal(parsed.reportNo, 'IQR-20260826-001');
  assert.equal(parsed.title, '压接拉脱力重大异常');
  assert.equal(parsed.severity, 'CRITICAL');
  assert.equal(parsed.rootCause, '第一行\n第二行');
  assert.equal(parsed.occurrenceDate?.toISOString(), '2026-08-25T16:00:00.000Z');
  assert.deepEqual(parsed.issueIds, ['issue-a', 'issue-b']);
  assert.deepEqual(parsed.workOrderIds, ['order-a', 'order-b']);
  assert.deepEqual(parsed.productIds, ['product-a', 'product-b']);
});

test('internal quality risk parser rejects invalid level, date range and relation overflow', () => {
  assert.throws(
    () => parseInternalQualityRiskInput({ reportNo: 'IQR-1', title: '异常', severity: 'urgent' }),
    (error: unknown) => error instanceof InternalQualityRiskError && error.message === '风险等级不正确',
  );
  assert.throws(
    () => parseInternalQualityRiskInput({ reportNo: 'IQR-1', title: '异常', effectiveFrom: '2026-09-01', effectiveUntil: '2026-08-01' }),
    (error: unknown) => error instanceof InternalQualityRiskError && error.message.includes('不能早于'),
  );
  assert.throws(
    () => normalizeQualityRiskRelationIds(Array.from({ length: 301 }, (_, index) => `id-${index}`)),
    (error: unknown) => error instanceof InternalQualityRiskError && error.message.includes('最多 300'),
  );
});

test('archive gate requires complete causes, conclusions, active impact and major approval', () => {
  const ready = evaluateInternalQualityRiskReadiness(readinessRecord());
  assert.equal(ready.ready, true);
  assert.equal(ready.alertCount, 1);

  const incomplete = evaluateInternalQualityRiskReadiness(readinessRecord({ rootCause: null, finalConclusion: null }));
  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.blockers.some(item => item.code === 'QUALITY_RISK_ROOT_CAUSE_REQUIRED'));
  assert.ok(incomplete.blockers.some(item => item.code === 'QUALITY_RISK_CONCLUSION_REQUIRED'));

  const deletedImpact = evaluateInternalQualityRiskReadiness(readinessRecord({
    workOrders: [{ workOrder: { deletedAt: new Date() } }],
    products: [],
  }));
  assert.ok(deletedImpact.blockers.some(item => item.code === 'QUALITY_RISK_IMPACT_REQUIRED'));

  const majorWithoutApproval = evaluateInternalQualityRiskReadiness(readinessRecord({
    issues: [{ issue: { deletedAt: null, isMajorQuality: true, majorApprovals: [{ status: 'PENDING' }] } }],
  }));
  assert.ok(majorWithoutApproval.blockers.some(item => item.code === 'QUALITY_RISK_MAJOR_APPROVAL_REQUIRED'));
});

test('high and critical risks require evidence summary or an associated 8D archive', () => {
  const missingEvidence = evaluateInternalQualityRiskReadiness(readinessRecord({ evidenceSummary: null, eightDReports: [] }));
  assert.ok(missingEvidence.blockers.some(item => item.code === 'QUALITY_RISK_EVIDENCE_REQUIRED'));

  const eightDBacked = evaluateInternalQualityRiskReadiness(readinessRecord({
    evidenceSummary: null,
    eightDReports: [{ eightDReport: { deletedAt: null } }],
  }));
  assert.equal(eightDBacked.ready, true);
});

test('recycle retention is exactly thirty days before irreversible deletion eligibility', () => {
  const deletedAt = new Date('2026-08-01T00:00:00.000Z');
  assert.equal(qualityRiskPurgeEligibleAt(deletedAt)?.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(qualityRiskPurgeEligibleAt(null), null);
});

test('migration persists report associations, immutable revisions and work-order alerts', () => {
  assert.match(migration, /CREATE TABLE "quality_risk_reports"/);
  assert.match(migration, /CREATE TABLE "quality_risk_revisions"/);
  assert.match(migration, /CREATE TABLE "quality_risk_issues"/);
  assert.match(migration, /PRIMARY KEY \("report_id", "issue_id"\)/);
  assert.match(migration, /CREATE TABLE "quality_risk_work_orders"/);
  assert.match(migration, /PRIMARY KEY \("report_id", "work_order_id"\)/);
  assert.match(migration, /CREATE TABLE "quality_risk_products"/);
  assert.match(migration, /CREATE TABLE "quality_risk_8d_reports"/);
  assert.match(migration, /CREATE TABLE "work_order_quality_alerts"/);
  assert.match(migration, /CREATE TABLE "work_order_quality_alert_acknowledgements"/);
  assert.match(migration, /quality_risk_reports_effective_range_check/);
  assert.match(schema, /model InternalQualityRiskRevision[\s\S]*?snapshot\s+Json/);
  assert.match(schema, /model WorkOrderQualityAlertAcknowledgement[\s\S]*?@@unique\(\[alertId, acknowledgedById\]\)/);
});

test('workbench exposes administrator-only recycle interactions and production warning closure', () => {
  assert.match(workbench, /isAdmin && <button[^>]*title="移入回收站"/);
  assert.match(workbench, /管理员回收规则/);
  assert.match(workbench, /满30天且无活动预警后才可彻底删除/);
  assert.match(workbench, /请输入完整编号确认/);
  assert.match(workbench, /移入回收站并撤销预警/);
  assert.match(workbench, /恢复时会按有效归档版本重建/);
  assert.match(production, /质量预警 \$\{qualityAlertCount\}/);
  assert.match(production, /确认知悉/);
  assert.match(production, /同产品历史风险待确认/);
  assert.match(production, /不会自动暂停生产/);
  assert.match(production, /aria-label="确认同步质量预警"/);
  assert.match(production, /确认并同步/);
  assert.doesNotMatch(production, /window\.confirm/);
});
