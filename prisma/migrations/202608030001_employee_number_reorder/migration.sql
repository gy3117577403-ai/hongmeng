CREATE TABLE "employee_number_reorder_batches" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "roster_fingerprint" TEXT NOT NULL,
  "start_number" INTEGER NOT NULL DEFAULT 1,
  "employee_count" INTEGER NOT NULL,
  "existing_count" INTEGER NOT NULL,
  "created_count" INTEGER NOT NULL,
  "changed_count" INTEGER NOT NULL,
  "previous_next_value" INTEGER NOT NULL,
  "next_value" INTEGER NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_number_reorder_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_number_reorder_batches_counts_check" CHECK (
    "start_number" > 0
    AND "employee_count" > 0
    AND "existing_count" >= 0
    AND "created_count" >= 0
    AND "changed_count" >= 0
    AND "existing_count" + "created_count" = "employee_count"
    AND "previous_next_value" > 0
    AND "next_value" > 0
  )
);

CREATE TABLE "employee_number_reorder_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "old_employee_no" TEXT,
  "new_employee_no" TEXT NOT NULL,
  "was_created" BOOLEAN NOT NULL DEFAULT false,
  "employee_data" JSONB NOT NULL,

  CONSTRAINT "employee_number_reorder_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_number_reorder_items_sequence_check" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "employee_number_reorder_batches_idempotency_key_key"
  ON "employee_number_reorder_batches"("idempotency_key");
CREATE INDEX "employee_number_reorder_batches_created_at_idx"
  ON "employee_number_reorder_batches"("created_at");
CREATE INDEX "employee_number_reorder_batches_created_by_id_created_at_idx"
  ON "employee_number_reorder_batches"("created_by_id", "created_at");

CREATE UNIQUE INDEX "employee_number_reorder_items_batch_id_sequence_key"
  ON "employee_number_reorder_items"("batch_id", "sequence");
CREATE UNIQUE INDEX "employee_number_reorder_items_batch_id_employee_id_key"
  ON "employee_number_reorder_items"("batch_id", "employee_id");
CREATE INDEX "employee_number_reorder_items_employee_id_idx"
  ON "employee_number_reorder_items"("employee_id");
CREATE INDEX "employee_number_reorder_items_new_employee_no_idx"
  ON "employee_number_reorder_items"("new_employee_no");

ALTER TABLE "employee_number_reorder_batches"
  ADD CONSTRAINT "employee_number_reorder_batches_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_number_reorder_items"
  ADD CONSTRAINT "employee_number_reorder_items_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "employee_number_reorder_batches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_number_reorder_items"
  ADD CONSTRAINT "employee_number_reorder_items_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
