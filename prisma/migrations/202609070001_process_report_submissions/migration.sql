CREATE TABLE "process_report_submissions" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason_code" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "assignee_user_ids" TEXT[] NOT NULL,
  "resolved_by_id" TEXT,
  "completion_id" TEXT,
  "source_kind" TEXT NOT NULL,
  "source_lot_id" TEXT,
  "source_allocation_id" TEXT,
  "reserved_product_qty" INTEGER NOT NULL DEFAULT 0,
  "reserved_good_units" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "resolution" JSONB,
  "result" JSONB,
  "last_error" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "process_report_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_report_submissions_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "process_report_submissions_reserved_check" CHECK ("reserved_product_qty" >= 0 AND "reserved_good_units" >= 0),
  CONSTRAINT "process_report_submissions_completion_check" CHECK ("status" <> 'COMPLETED' OR ("completion_id" IS NOT NULL AND "completed_at" IS NOT NULL)),
  CONSTRAINT "process_report_submissions_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_report_submissions_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_report_submissions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_report_submissions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "process_report_submissions_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "process_report_submissions_completion_id_fkey" FOREIGN KEY ("completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "process_report_submissions_idempotency_key_key" ON "process_report_submissions"("idempotency_key");
CREATE UNIQUE INDEX "process_report_submissions_completion_id_key" ON "process_report_submissions"("completion_id");
CREATE INDEX "process_report_submissions_step_id_status_idx" ON "process_report_submissions"("step_id", "status");
CREATE INDEX "process_report_submissions_created_by_id_status_created_at_idx" ON "process_report_submissions"("created_by_id", "status", "created_at");
CREATE INDEX "process_report_submissions_status_created_at_idx" ON "process_report_submissions"("status", "created_at");
CREATE INDEX "process_report_submissions_source_allocation_id_status_idx" ON "process_report_submissions"("source_allocation_id", "status");
CREATE INDEX "process_report_submissions_assignee_user_ids_idx" ON "process_report_submissions" USING GIN ("assignee_user_ids");
