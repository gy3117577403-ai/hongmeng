ALTER TABLE "terminal_tooling_blades" ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "terminal_tooling_blade_specs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "blade_id" TEXT NOT NULL,
  "position" "terminal_tooling_blade_position" NOT NULL,
  "specification" TEXT,
  "dimension_a" DECIMAL(10,3),
  "dimension_b" DECIMAL(10,3),
  "dimension_unit" TEXT DEFAULT 'mm',
  "material" TEXT,
  "hardness" TEXT,
  "remark" TEXT,
  "needs_review" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_blade_specs_blade_id_fkey" FOREIGN KEY ("blade_id") REFERENCES "terminal_tooling_blades"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "terminal_tooling_blade_specs_blade_id_position_key" ON "terminal_tooling_blade_specs"("blade_id", "position");
CREATE INDEX "terminal_tooling_blade_specs_specification_idx" ON "terminal_tooling_blade_specs"("specification");

CREATE TABLE "terminal_tooling_blade_spec_supplies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spec_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "supplier_sku" TEXT,
  "product_url" TEXT,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terminal_tooling_blade_spec_supplies_spec_id_fkey" FOREIGN KEY ("spec_id") REFERENCES "terminal_tooling_blade_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "terminal_tooling_blade_spec_supplies_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "terminal_tooling_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "terminal_tooling_blade_spec_supplies_spec_id_idx" ON "terminal_tooling_blade_spec_supplies"("spec_id");
CREATE INDEX "terminal_tooling_blade_spec_supplies_supplier_id_idx" ON "terminal_tooling_blade_spec_supplies"("supplier_id");

-- Preserve the original record and setup foreign keys. Only declared positions
-- inherit legacy values; a multi-position shared specification is unconfirmed.
INSERT INTO "terminal_tooling_blade_specs"
  ("id", "blade_id", "position", "specification", "dimension_a", "dimension_b", "dimension_unit", "material", "hardness", "needs_review", "created_at", "updated_at")
SELECT 'legacy_' || md5(b."id" || ':' || p::text), b."id", p,
  b."specification", b."dimension_a", b."dimension_b", b."dimension_unit", b."material", b."hardness",
  cardinality(b."compatible_positions") <> 1 OR coalesce(trim(b."specification"), '') = '', b."created_at", b."updated_at"
FROM "terminal_tooling_blades" b CROSS JOIN LATERAL unnest(b."compatible_positions") p
ON CONFLICT ("blade_id", "position") DO NOTHING;

INSERT INTO "terminal_tooling_blade_spec_supplies"
  ("id", "spec_id", "supplier_id", "supplier_sku", "product_url", "remark", "created_at")
SELECT 'legacy_' || md5(s."id" || ':' || ps."id"), ps."id", s."supplier_id", s."supplier_sku", s."product_url", s."remark", s."created_at"
FROM "terminal_tooling_blade_supplies" s JOIN "terminal_tooling_blade_specs" ps ON ps."blade_id" = s."blade_id";
