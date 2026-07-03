-- Production stability safeguards for v1.12.0-rc.1.
-- Only additive changes: new audit tables, optional import batch linkage, and indexes.

CREATE TABLE IF NOT EXISTS "connector_parameter_import_batches" (
  "id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "file_name" TEXT,
  "total_rows" INTEGER NOT NULL,
  "ready_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "invalid_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "inserted_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_strategy" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolled_back_at" TIMESTAMP(3),
  "rolled_back_by" TEXT,
  "summary_json" JSONB,

  CONSTRAINT "connector_parameter_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "data_change_snapshots" (
  "id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before_json" JSONB,
  "after_json" JSONB,
  "changed_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "data_change_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "connector_parameters"
  ADD COLUMN IF NOT EXISTS "import_batch_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connector_parameters_import_batch_id_fkey'
  ) THEN
    ALTER TABLE "connector_parameters"
      ADD CONSTRAINT "connector_parameters_import_batch_id_fkey"
      FOREIGN KEY ("import_batch_id")
      REFERENCES "connector_parameter_import_batches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_work_orders_code" ON "work_orders"("code");
CREATE INDEX IF NOT EXISTS "idx_work_orders_product_name" ON "work_orders"("product_name");
CREATE INDEX IF NOT EXISTS "idx_work_orders_customer_name" ON "work_orders"("customer_name");
CREATE INDEX IF NOT EXISTS "idx_work_orders_stage" ON "work_orders"("stage");
CREATE INDEX IF NOT EXISTS "idx_work_orders_priority" ON "work_orders"("priority");
CREATE INDEX IF NOT EXISTS "idx_work_orders_planned_at" ON "work_orders"("planned_at");
CREATE INDEX IF NOT EXISTS "idx_work_orders_deleted_at" ON "work_orders"("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_work_orders_created_at" ON "work_orders"("created_at");

CREATE INDEX IF NOT EXISTS "idx_resource_files_work_order_id" ON "resource_files"("work_order_id");
CREATE INDEX IF NOT EXISTS "idx_resource_files_category_id" ON "resource_files"("category_id");
CREATE INDEX IF NOT EXISTS "idx_resource_files_deleted_at" ON "resource_files"("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_resource_files_created_at" ON "resource_files"("created_at");
CREATE INDEX IF NOT EXISTS "idx_resource_files_version" ON "resource_files"("version");

CREATE INDEX IF NOT EXISTS "idx_connector_parameters_model" ON "connector_parameters"("model");
CREATE INDEX IF NOT EXISTS "idx_connector_parameters_deleted_at" ON "connector_parameters"("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_connector_parameters_is_highlighted" ON "connector_parameters"("is_highlighted");
CREATE INDEX IF NOT EXISTS "idx_connector_parameters_row_no" ON "connector_parameters"("row_no");
CREATE INDEX IF NOT EXISTS "idx_connector_parameters_created_at" ON "connector_parameters"("created_at");
CREATE INDEX IF NOT EXISTS "idx_connector_parameters_import_batch_id" ON "connector_parameters"("import_batch_id");

CREATE INDEX IF NOT EXISTS "idx_connector_import_batches_created_at" ON "connector_parameter_import_batches"("created_at");
CREATE INDEX IF NOT EXISTS "idx_connector_import_batches_rolled_back_at" ON "connector_parameter_import_batches"("rolled_back_at");

CREATE INDEX IF NOT EXISTS "idx_operation_logs_created_at" ON "operation_logs"("created_at");
CREATE INDEX IF NOT EXISTS "idx_operation_logs_action" ON "operation_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_operation_logs_user_id" ON "operation_logs"("user_id");

CREATE INDEX IF NOT EXISTS "idx_data_change_snapshots_entity" ON "data_change_snapshots"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_data_change_snapshots_action" ON "data_change_snapshots"("action");
CREATE INDEX IF NOT EXISTS "idx_data_change_snapshots_created_at" ON "data_change_snapshots"("created_at");
