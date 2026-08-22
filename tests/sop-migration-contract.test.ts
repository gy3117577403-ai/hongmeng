import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve('prisma', 'migrations', '202608010001_sop_online_editor', 'migration.sql');
const migration = readFileSync(migrationPath, 'utf8');
const overlayControlMigration = readFileSync(
  path.resolve('prisma', 'migrations', '202608220001_pdf_overlay_control_mode', 'migration.sql'),
  'utf8',
);

test('SOP migration separates mutable revisions from immutable version numbering', () => {
  assert.match(migration, /"version" INTEGER NOT NULL/);
  assert.match(migration, /"revision" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \("version" > 0\)/);
  assert.match(migration, /CHECK \("revision" >= 0\)/);
  assert.match(migration, /UNIQUE INDEX "sop_versions_document_id_version_key"[\s\S]*?\("document_id", "version"\)/);
});
test('SOP migration permits only one active draft while retaining deleted and published history', () => {
  assert.match(
    migration,
    /UNIQUE INDEX "sop_versions_one_active_draft_per_document_idx"[\s\S]*?WHERE "deleted_at" IS NULL AND "status" = 'draft'/,
  );
  assert.match(migration, /CHECK \("status" IN \('draft', 'published'\)\)/);
  assert.match(migration, /"deleted_at" TIMESTAMP\(3\)/);
  assert.match(migration, /"based_on_version_id" TEXT/);
});

test('published online SOP files are traceable without changing manual drawing-library files', () => {
  assert.match(migration, /ADD COLUMN "source_sop_version_id" TEXT/);
  assert.match(migration, /UNIQUE INDEX "drawing_library_files_source_sop_version_id_key"/);
  assert.match(
    migration,
    /FOREIGN KEY \("source_sop_version_id"\) REFERENCES "sop_versions"\("id"\) ON DELETE SET NULL/,
  );
});

test('published PDF overlay versions persist a backward-compatible control mode', () => {
  assert.match(overlayControlMigration, /ALTER TABLE "pdf_overlay_versions"/);
  assert.match(overlayControlMigration, /ADD COLUMN "control_mode" TEXT NOT NULL DEFAULT 'uncontrolled'/);
});
