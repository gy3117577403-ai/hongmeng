import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS,
  evaluateInternalQualityRiskReadiness,
  InternalQualityRiskError,
  normalizeQualityRiskRelationIds,
  normalizeInternalQualityRiskArchiveRequirements,
  parseInternalQualityRiskInput,
  qualityRiskPurgeEligibleAt,
  resolveArchivedQualityWarning,
  type InternalQualityRiskRecord,
} from '../lib/internal-quality-risks';

const repositoryRoot = resolve(import.meta.dirname, '..');
const migration = readFileSync(
  resolve(repositoryRoot, 'prisma/migrations/202608260002_internal_quality_risk_management/migration.sql'),
  'utf8',
);
const collaborationMigration = readFileSync(
  resolve(repositoryRoot, 'prisma/migrations/202608270001_quality_anomaly_collaboration/migration.sql'),
  'utf8',
);
const flexibleArchiveMigration = readFileSync(
  resolve(repositoryRoot, 'prisma/migrations/202608270002_quality_risk_flexible_archive_preview/migration.sql'),
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
    warningSummary: '同类产品压接高度曾发生超差，作业前必须核验参数',
    requiredAction: '首件确认后方可开工；每小时抽检并留存记录',
    inspectionMethod: '使用数显千分尺测量压接高度',
    inspectionFrequency: '首件 + 每小时 5 件',
    acceptanceCriteria: '压接高度 1.80±0.05mm',
    stopConditions: '出现 1 件不合格立即停线并升级质量部',
    escalationContact: '质量部',
    printPolicy: 'REQUIRED',
    archiveRequirements: DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS,
    severity: 'HIGH',
    issues: [{ issue: { deletedAt: null, isMajorQuality: false, majorApprovals: [] } }],
    workOrders: [{ workOrder: { deletedAt: null } }],
    products: [],
    eightDReports: [],
    revisions: [],
    attachments: [],
    tasks: [],
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

  const incomplete = evaluateInternalQualityRiskReadiness(readinessRecord({
    rootCause: null,
    finalConclusion: null,
    archiveRequirements: { ...DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS, rootCause: 'REQUIRED' },
  }));
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

test('archive evidence follows per-report required, optional and not-applicable policy', () => {
  const missingEvidence = evaluateInternalQualityRiskReadiness(readinessRecord({
    evidenceSummary: null,
    eightDReports: [],
    archiveRequirements: { ...DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS, evidence: 'REQUIRED' },
  }));
  assert.ok(missingEvidence.blockers.some(item => item.code === 'QUALITY_RISK_EVIDENCE_REQUIRED'));

  const eightDBacked = evaluateInternalQualityRiskReadiness(readinessRecord({
    evidenceSummary: null,
    eightDReports: [{ eightDReport: { deletedAt: null } }],
    archiveRequirements: { ...DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS, evidence: 'REQUIRED' },
  }));
  assert.equal(eightDBacked.ready, true);

  const optionalEvidence = evaluateInternalQualityRiskReadiness(readinessRecord({ evidenceSummary: null, eightDReports: [], attachments: [] }));
  assert.equal(optionalEvidence.ready, true);
  assert.ok(optionalEvidence.warnings.some(item => item.code === 'QUALITY_RISK_EVIDENCE_RECOMMENDED'));

  const notApplicableEvidence = evaluateInternalQualityRiskReadiness(readinessRecord({
    evidenceSummary: null,
    eightDReports: [],
    attachments: [],
    archiveRequirements: { ...DEFAULT_INTERNAL_QUALITY_RISK_ARCHIVE_REQUIREMENTS, evidence: 'NOT_APPLICABLE' },
  }));
  assert.equal(notApplicableEvidence.ready, true);
  assert.ok(!notApplicableEvidence.warnings.some(item => item.code.includes('EVIDENCE')));
});

test('archive requirement parser keeps safe defaults and accepts per-field modes', () => {
  const normalized = normalizeInternalQualityRiskArchiveRequirements({
    rootCause: 'required',
    inspectionMethod: 'NOT_APPLICABLE',
    evidence: 'invalid-mode',
  });
  assert.equal(normalized.rootCause, 'REQUIRED');
  assert.equal(normalized.inspectionMethod, 'NOT_APPLICABLE');
  assert.equal(normalized.evidence, 'OPTIONAL');
  assert.equal(normalized.warningSummary, 'OPTIONAL');
});

test('safe draft recycle has no artificial thirty-day waiting period', () => {
  const deletedAt = new Date('2026-08-01T00:00:00.000Z');
  assert.equal(qualityRiskPurgeEligibleAt(deletedAt)?.toISOString(), '2026-08-01T00:00:00.000Z');
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
  assert.match(collaborationMigration, /CREATE TABLE "quality_risk_tasks"/);
  assert.match(collaborationMigration, /CREATE TABLE "quality_risk_attachments"/);
  assert.match(collaborationMigration, /CREATE TABLE "quality_risk_revision_products"/);
  assert.match(collaborationMigration, /CREATE TABLE "quality_risk_revision_attachments"/);
  assert.match(flexibleArchiveMigration, /ADD COLUMN "archive_requirements" JSONB/);
  assert.match(schema, /model InternalQualityRiskRevisionProduct[\s\S]*?@@id\(\[revisionId, drawingLibraryItemId\]\)/);
  assert.match(schema, /model InternalQualityRiskRevisionAttachment[\s\S]*?@@id\(\[revisionId, attachmentId\]\)/);
});

test('published warning content resolves from the immutable revision snapshot while a new draft is edited', () => {
  const source = readinessRecord({
    title: '修订稿标题',
    severity: 'LOW',
    warningSummary: '修订稿尚未发布',
    printPolicy: 'SYSTEM_ONLY',
  });
  const published = resolveArchivedQualityWarning(source, {
    title: '已发布 R1 标题',
    severity: 'CRITICAL',
    warningSummary: '已发布现场警示',
    requiredAction: '首件确认并每小时抽检',
    containmentAction: '隔离旧批次',
    correctiveAction: '锁定设备参数',
    preventiveAction: '换型双人复核',
    printPolicy: 'REQUIRED',
    effectiveFrom: '2026-08-27T00:00:00.000Z',
    effectiveUntil: null,
  });
  assert.equal(published.title, '已发布 R1 标题');
  assert.equal(published.severity, 'CRITICAL');
  assert.equal(published.warningSummary, '已发布现场警示');
  assert.equal(published.printPolicy, 'REQUIRED');
  assert.match(published.controlRequirement || '', /隔离旧批次/);
  assert.equal(published.effectiveUntil, null);
});

test('workbench exposes administrator-only recycle interactions and production warning closure', () => {
  assert.match(workbench, /isAdmin && <button[^>]*disabled=\{saving \|\| selected\.warningState === 'ACTIVE'\}/);
  assert.match(workbench, /撤销产品警示后才可回收异常/);
  assert.match(workbench, /管理员回收规则/);
  assert.match(workbench, /未形成归档和打印历史的记录可立即彻底删除/);
  assert.match(workbench, /确认完整编号/);
  assert.match(workbench, /确认撤销警示/);
  assert.match(workbench, /已撤销的警示不会因恢复自动重发/);
  assert.match(production, /质量预警 \$\{qualityAlertCount\}/);
  assert.match(production, /确认知悉/);
  assert.match(workbench, /同产品新工单首次进入计划或执行时会自动物化警示/);
  assert.match(production, /不会自动暂停生产/);
  assert.match(production, /工单质量问题预警/);
  assert.doesNotMatch(production, /window\.confirm/);
});

test('quality risk workbench removes hidden-header spacing and offers searchable association filters', () => {
  assert.match(workbench, /className="hm-workbench-root hm-cockpit-root internal-risk-shell"/);
  assert.match(workbench, /function SearchableRiskFilter/);
  assert.match(workbench, /role="combobox"/);
  assert.match(workbench, /label="产品"[\s\S]*?searchPlaceholder="搜索规格、品名或客户"/);
  assert.match(workbench, /label="来源问题"[\s\S]*?searchPlaceholder="搜索问题编号、标题或工单"/);
  assert.match(workbench, /label="工单"[\s\S]*?searchPlaceholder="搜索工单号、产品、规格或客户"/);
  assert.match(workbench, /↑↓ 选择 · Enter 确认/);
  assert.match(workbench, /MAX_VISIBLE_FILTER_OPTIONS = 120/);
  assert.doesNotMatch(workbench, /<label>来源问题<select/);
  assert.doesNotMatch(workbench, /<label>工单<select/);
});

test('quality risk workbench exposes staged object-storage upload, flexible archive policy and shared print preview', () => {
  assert.match(workbench, /function stageAttachments/);
  assert.match(workbench, /uploadAttachmentToReport/);
  assert.match(workbench, /multiple type="file"/);
  assert.match(workbench, /image\/jpeg,image\/png,image\/webp,application\/pdf/);
  assert.match(workbench, /保存草稿后自动上传到对象存储/);
  assert.match(workbench, /失败：\$\{item\.error\}/);
  assert.match(workbench, /归档字段要求/);
  assert.match(workbench, /NOT_APPLICABLE/);
  assert.match(workbench, /预览工单附页/);
  assert.match(workbench, /\/print-preview/);
});
