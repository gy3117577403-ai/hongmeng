CREATE TABLE "sample_task_import_batches" (
  "id" TEXT NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "source_file_name" TEXT,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "created_task_count" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sample_task_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sample_task_import_batches_mutation_id_key"
  ON "sample_task_import_batches"("mutation_id");

CREATE INDEX "sample_task_import_batches_created_at_idx"
  ON "sample_task_import_batches"("created_at");

CREATE INDEX "sample_task_import_batches_created_by_id_created_at_idx"
  ON "sample_task_import_batches"("created_by_id", "created_at");
