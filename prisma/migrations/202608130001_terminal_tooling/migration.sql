CREATE TYPE "terminal_tooling_setup_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TYPE "terminal_tooling_blade_position" AS ENUM ('UPPER_OUTER', 'UPPER_INNER', 'LOWER_OUTER', 'LOWER_INNER');

CREATE TABLE "terminal_tooling_terminals" (
  "id" TEXT NOT NULL,
  "specification" TEXT NOT NULL,
  "manufacturer" TEXT,
  "normalized_key" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "wire_range" TEXT,
  "material" TEXT,
  "plating" TEXT,
  "remark" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "lock_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_terminals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_blades" (
  "id" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "manufacturer" TEXT,
  "normalized_key" TEXT NOT NULL,
  "compatible_positions" "terminal_tooling_blade_position"[] NOT NULL DEFAULT ARRAY[]::"terminal_tooling_blade_position"[],
  "specification" TEXT,
  "dimension_a" DECIMAL(10,3),
  "dimension_b" DECIMAL(10,3),
  "dimension_unit" TEXT DEFAULT 'mm',
  "material" TEXT,
  "hardness" TEXT,
  "remark" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "lock_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_blades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_suppliers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "website" TEXT,
  "contact_name" TEXT,
  "phone" TEXT,
  "remark" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_terminal_supplies" (
  "id" TEXT NOT NULL,
  "terminal_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "supplier_sku" TEXT,
  "product_url" TEXT,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terminal_tooling_terminal_supplies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_blade_supplies" (
  "id" TEXT NOT NULL,
  "blade_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "supplier_sku" TEXT,
  "product_url" TEXT,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terminal_tooling_blade_supplies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_setups" (
  "id" TEXT NOT NULL,
  "terminal_id" TEXT NOT NULL,
  "name" TEXT,
  "wire_range" TEXT,
  "equipment" TEXT,
  "mold" TEXT,
  "context_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "terminal_tooling_setup_status" NOT NULL DEFAULT 'DRAFT',
  "remark" TEXT,
  "lock_version" INTEGER NOT NULL DEFAULT 1,
  "published_at" TIMESTAMP(3),
  "published_by" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_setups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_setup_positions" (
  "id" TEXT NOT NULL,
  "setup_id" TEXT NOT NULL,
  "position" "terminal_tooling_blade_position" NOT NULL,
  "blade_id" TEXT NOT NULL,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_setup_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_tags" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "normalized_key" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_tooling_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminal_tooling_setup_tags" (
  "setup_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  CONSTRAINT "terminal_tooling_setup_tags_pkey" PRIMARY KEY ("setup_id", "tag_id")
);

CREATE UNIQUE INDEX "terminal_tooling_terminals_normalized_key_key" ON "terminal_tooling_terminals"("normalized_key");
CREATE INDEX "terminal_tooling_terminals_specification_idx" ON "terminal_tooling_terminals"("specification");
CREATE INDEX "terminal_tooling_terminals_manufacturer_idx" ON "terminal_tooling_terminals"("manufacturer");
CREATE INDEX "terminal_tooling_terminals_is_active_idx" ON "terminal_tooling_terminals"("is_active");
CREATE INDEX "terminal_tooling_terminals_updated_at_idx" ON "terminal_tooling_terminals"("updated_at");

CREATE UNIQUE INDEX "terminal_tooling_blades_normalized_key_key" ON "terminal_tooling_blades"("normalized_key");
CREATE INDEX "terminal_tooling_blades_model_idx" ON "terminal_tooling_blades"("model");
CREATE INDEX "terminal_tooling_blades_manufacturer_idx" ON "terminal_tooling_blades"("manufacturer");
CREATE INDEX "terminal_tooling_blades_is_active_idx" ON "terminal_tooling_blades"("is_active");
CREATE INDEX "terminal_tooling_blades_updated_at_idx" ON "terminal_tooling_blades"("updated_at");

CREATE UNIQUE INDEX "terminal_tooling_suppliers_normalized_name_key" ON "terminal_tooling_suppliers"("normalized_name");
CREATE INDEX "terminal_tooling_suppliers_name_idx" ON "terminal_tooling_suppliers"("name");
CREATE INDEX "terminal_tooling_suppliers_is_active_idx" ON "terminal_tooling_suppliers"("is_active");

CREATE INDEX "terminal_tooling_terminal_supplies_terminal_id_idx" ON "terminal_tooling_terminal_supplies"("terminal_id");
CREATE INDEX "terminal_tooling_terminal_supplies_supplier_id_idx" ON "terminal_tooling_terminal_supplies"("supplier_id");
CREATE INDEX "terminal_tooling_blade_supplies_blade_id_idx" ON "terminal_tooling_blade_supplies"("blade_id");
CREATE INDEX "terminal_tooling_blade_supplies_supplier_id_idx" ON "terminal_tooling_blade_supplies"("supplier_id");

CREATE UNIQUE INDEX "terminal_tooling_setups_terminal_id_context_key_version_key" ON "terminal_tooling_setups"("terminal_id", "context_key", "version");
CREATE INDEX "terminal_tooling_setups_terminal_id_status_idx" ON "terminal_tooling_setups"("terminal_id", "status");
CREATE INDEX "terminal_tooling_setups_context_key_idx" ON "terminal_tooling_setups"("context_key");
CREATE INDEX "terminal_tooling_setups_status_updated_at_idx" ON "terminal_tooling_setups"("status", "updated_at");

CREATE UNIQUE INDEX "terminal_tooling_setup_positions_setup_id_position_key" ON "terminal_tooling_setup_positions"("setup_id", "position");
CREATE INDEX "terminal_tooling_setup_positions_blade_id_idx" ON "terminal_tooling_setup_positions"("blade_id");

CREATE UNIQUE INDEX "terminal_tooling_tags_normalized_key_key" ON "terminal_tooling_tags"("normalized_key");
CREATE INDEX "terminal_tooling_tags_label_idx" ON "terminal_tooling_tags"("label");
CREATE INDEX "terminal_tooling_tags_is_active_idx" ON "terminal_tooling_tags"("is_active");
CREATE INDEX "terminal_tooling_setup_tags_tag_id_idx" ON "terminal_tooling_setup_tags"("tag_id");

ALTER TABLE "terminal_tooling_terminal_supplies" ADD CONSTRAINT "terminal_tooling_terminal_supplies_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal_tooling_terminals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_terminal_supplies" ADD CONSTRAINT "terminal_tooling_terminal_supplies_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "terminal_tooling_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_blade_supplies" ADD CONSTRAINT "terminal_tooling_blade_supplies_blade_id_fkey" FOREIGN KEY ("blade_id") REFERENCES "terminal_tooling_blades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_blade_supplies" ADD CONSTRAINT "terminal_tooling_blade_supplies_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "terminal_tooling_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_setups" ADD CONSTRAINT "terminal_tooling_setups_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal_tooling_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_setup_positions" ADD CONSTRAINT "terminal_tooling_setup_positions_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "terminal_tooling_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_setup_positions" ADD CONSTRAINT "terminal_tooling_setup_positions_blade_id_fkey" FOREIGN KEY ("blade_id") REFERENCES "terminal_tooling_blades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_setup_tags" ADD CONSTRAINT "terminal_tooling_setup_tags_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "terminal_tooling_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_tooling_setup_tags" ADD CONSTRAINT "terminal_tooling_setup_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "terminal_tooling_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
