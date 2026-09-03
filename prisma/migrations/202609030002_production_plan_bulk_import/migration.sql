CREATE TABLE "production_plan_import_batches" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "preview_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "source_file_name" TEXT NOT NULL,
    "source_sheet_name" TEXT,
    "source_file_hash" TEXT NOT NULL,
    "target_week_start_date" TIMESTAMP(3) NOT NULL,
    "target_week_end_date" TIMESTAMP(3) NOT NULL,
    "preview_data" JSONB NOT NULL,
    "decisions" JSONB,
    "result_data" JSONB,
    "error_message" TEXT,
    "created_by_id" TEXT,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_plan_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_plan_import_batches_request_id_key"
ON "production_plan_import_batches"("request_id");

CREATE INDEX "production_plan_import_batches_preview_token_idx"
ON "production_plan_import_batches"("preview_token");

CREATE INDEX "production_plan_import_batches_status_created_at_idx"
ON "production_plan_import_batches"("status", "created_at");

CREATE INDEX "production_plan_import_batches_target_week_start_date_created_at_idx"
ON "production_plan_import_batches"("target_week_start_date", "created_at");

CREATE INDEX "production_plan_import_batches_created_by_id_created_at_idx"
ON "production_plan_import_batches"("created_by_id", "created_at");

ALTER TABLE "production_plan_import_batches"
ADD CONSTRAINT "production_plan_import_batches_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
