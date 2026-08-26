import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  assertMaterialUploadLinkActive,
  createMaterialUploadCode,
  hashMaterialUploadCode,
  materialItemCreateData,
  materialItemUpdateData,
  materialSessionDraftData,
  materialUploadCapturePath,
  MaterialLibraryError,
  parseMaterialUploadCode,
  verifyMaterialUploadCode,
} from '../lib/material-library';

process.env.SESSION_SECRET ||= 'material-library-test-secret-2026';

const repositoryRoot = resolve(import.meta.dirname, '..');
const migration = readFileSync(resolve(repositoryRoot, 'prisma/migrations/202608260003_material_library_photo_archive/migration.sql'), 'utf8');
const supplierMigration = readFileSync(resolve(repositoryRoot, 'prisma/migrations/202608260004_material_library_supplier_variants/migration.sql'), 'utf8');
const schema = readFileSync(resolve(repositoryRoot, 'prisma/schema.prisma'), 'utf8');
const desktop = readFileSync(resolve(repositoryRoot, 'components/MaterialLibraryWorkbench.tsx'), 'utf8');
const mobile = readFileSync(resolve(repositoryRoot, 'components/MaterialLibraryMobileCapture.tsx'), 'utf8');
const scanRoute = readFileSync(resolve(repositoryRoot, 'app/api/material-library/scan/[code]/route.ts'), 'utf8');

test('temporary and permanent material QR codes are signed, opaque and tamper evident', () => {
  const input = { id: randomUUID(), generation: 1, materialItemId: randomUUID(), mode: 'TEMPORARY' as const };
  const code = createMaterialUploadCode(input);
  const parsed = parseMaterialUploadCode(code);
  assert.equal(parsed.id, input.id);
  assert.equal(parsed.generation, 1);
  assert.equal(verifyMaterialUploadCode({ ...input, code, tokenHash: hashMaterialUploadCode(code) }), true);
  assert.equal(materialUploadCapturePath(input), `/material-upload/${encodeURIComponent(code)}`);
  assert.doesNotMatch(code, new RegExp(input.materialItemId));

  const tampered = `${code.slice(0, -1)}${code.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyMaterialUploadCode({ ...input, code: tampered, tokenHash: hashMaterialUploadCode(code) }), false);
});

test('temporary QR expiry is enforced while permanent QR has no expiry requirement', () => {
  assert.doesNotThrow(() => assertMaterialUploadLinkActive({ status: 'ACTIVE', mode: 'TEMPORARY', expiresAt: new Date(Date.now() + 60_000) }));
  assert.throws(
    () => assertMaterialUploadLinkActive({ status: 'ACTIVE', mode: 'TEMPORARY', expiresAt: new Date(Date.now() - 1) }),
    (error: unknown) => error instanceof MaterialLibraryError && error.code === 'MATERIAL_UPLOAD_LINK_EXPIRED',
  );
  assert.doesNotThrow(() => assertMaterialUploadLinkActive({ status: 'ACTIVE', mode: 'PERMANENT', expiresAt: null }));
  assert.throws(
    () => assertMaterialUploadLinkActive({ status: 'REVOKED', mode: 'PERMANENT', expiresAt: null }),
    (error: unknown) => error instanceof MaterialLibraryError && error.code === 'MATERIAL_UPLOAD_LINK_REVOKED',
  );
});

test('material input normalizes codes and requires an explanation for warnings', () => {
  const item = materialItemUpdateData({ categoryId: 'category-1', code: ' t-001 ', name: ' 端子 ', warningState: 'NONE' });
  assert.equal(item.code, 'T-001');
  assert.equal(item.name, '端子');
  assert.throws(
    () => materialSessionDraftData({ categoryId: 'category-1', warningState: 'DEFECT', warningNote: '' }),
    (error: unknown) => error instanceof MaterialLibraryError && error.code === 'MATERIAL_WARNING_NOTE_REQUIRED',
  );
  const draft = materialSessionDraftData({ categoryId: 'category-1', warningState: 'ATTENTION', warningNote: '镀层色差' });
  assert.equal(draft.draftWarningState, 'ATTENTION');
  assert.equal(draft.draftWarningNote, '镀层色差');
  const created = materialItemCreateData({ categoryId: 'category-1', name: '6.3mm 连接端子', supplierName: '上海华翔' });
  assert.equal(created.name, '6.3mm 连接端子');
  assert.equal(created.supplierName, '上海华翔');
});

test('material library persists S3 metadata, sessions and soft deletion without local file paths', () => {
  assert.match(migration, /CREATE TABLE "material_library_categories"/);
  assert.match(migration, /CREATE TABLE "material_library_items"/);
  assert.match(migration, /CREATE TABLE "material_library_upload_links"/);
  assert.match(migration, /CREATE TABLE "material_library_capture_sessions"/);
  assert.match(migration, /CREATE TABLE "material_library_photos"/);
  assert.match(migration, /"object_key" TEXT NOT NULL/);
  assert.match(migration, /"deleted_at" TIMESTAMP\(3\)/);
  assert.match(migration, /material_library_capture_sessions_one_active_per_item_idx[\s\S]*?\("material_item_id"\)[\s\S]*?WHERE "status" = 'ACTIVE'/);
  assert.match(schema, /model MaterialLibraryPhoto[\s\S]*?objectKey\s+String[\s\S]*?deletedAt\s+DateTime\?/);
  assert.match(supplierMigration, /CREATE SEQUENCE IF NOT EXISTS "material_library_code_seq"/);
  assert.match(supplierMigration, /CREATE TABLE "material_library_supplier_variants"/);
  assert.match(supplierMigration, /CREATE TABLE "material_library_specification_documents"/);
  assert.match(supplierMigration, /material_library_supplier_variants_one_primary_idx/);
  assert.match(supplierMigration, /material_library_specification_documents_one_current_idx/);
  assert.match(schema, /model MaterialLibrarySupplierVariant[\s\S]*?specificationFiles\s+MaterialLibrarySpecificationDocument\[\]/);
  assert.match(schema, /model MaterialLibrarySpecificationDocument[\s\S]*?objectKey\s+String[\s\S]*?deletedAt\s+DateTime\?/);
  assert.doesNotMatch(schema, /model MaterialLibraryPhoto[\s\S]*?localPath/);
  assert.match(scanRoute, /pg_advisory_xact_lock/);
  assert.match(scanRoute, /TransactionIsolationLevel\.ReadCommitted/);
  assert.match(scanRoute, /draftBatchNumber: null/);
  assert.match(scanRoute, /draftWarningState: MaterialLibraryWarningState\.NONE/);
  assert.match(scanRoute, /draftWarningNote: null/);
  assert.match(scanRoute, /draftNotes: null/);
});

test('version 3 UI includes both QR modes, immediate photo upload, preview and archive controls', () => {
  assert.match(desktop, /手机拍照录入/);
  assert.match(desktop, /TEMPORARY/);
  assert.match(desktop, /PERMANENT/);
  assert.match(desktop, /每 1\.6 秒同步一次手机端照片/);
  assert.match(desktop, /确认归档/);
  assert.match(desktop, /capture-preview.*is-fullscreen/);
  assert.match(desktop, /退出全屏/);
  assert.doesNotMatch(desktop, /requestFullscreen/);
  assert.match(desktop, /MaterialEvidenceViewer/);
  assert.match(desktop, /供应商规格书/);
  assert.match(desktop, /MaterialCodePlate/);
  assert.match(desktop, /来料记录/);
  assert.match(mobile, /capture="environment"/);
  assert.match(mobile, /照片会立即上传/);
  assert.match(mobile, /从相册选择/);
  assert.match(mobile, /原图直接写入 S3 兼容对象存储/);
  assert.match(mobile, /历史风险警示/);
  assert.match(mobile, /2_400/);
  assert.doesNotMatch(`${desktop}\n${mobile}`, /AI识别|AI 识别结果|自动识别型号/);
});
