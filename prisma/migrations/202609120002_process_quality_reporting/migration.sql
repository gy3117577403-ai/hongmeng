ALTER TABLE "process_completions" ADD COLUMN "quality_report" JSONB;
ALTER TABLE "quality_data_records"
  ADD COLUMN "source_completion_id" TEXT,
  ADD COLUMN "report_snapshot" JSONB,
  ADD COLUMN "responsibility_status" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "responsibility" JSONB;
CREATE UNIQUE INDEX "quality_data_records_source_completion_id_key" ON "quality_data_records"("source_completion_id");
CREATE INDEX "quality_data_responsibility_idx" ON "quality_data_records"("responsibility_status", "deleted_at", "inspected_at");
ALTER TABLE "quality_data_records" ADD CONSTRAINT "quality_data_records_source_completion_id_fkey"
  FOREIGN KEY ("source_completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE TABLE "process_quality_evidence" (
  "id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "record_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "process_quality_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_quality_evidence_route_fkey" FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_quality_evidence_step_fkey" FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_quality_evidence_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_quality_evidence_record_fkey" FOREIGN KEY ("record_id") REFERENCES "quality_data_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "process_quality_evidence_object_key_key" ON "process_quality_evidence"("object_key");
CREATE UNIQUE INDEX "process_quality_evidence_created_by_id_idempotency_key_key" ON "process_quality_evidence"("created_by_id", "idempotency_key");
CREATE INDEX "process_quality_evidence_route_id_step_id_created_by_id_idx" ON "process_quality_evidence"("route_id", "step_id", "created_by_id");
CREATE INDEX "process_quality_evidence_record_id_created_at_idx" ON "process_quality_evidence"("record_id", "created_at");
