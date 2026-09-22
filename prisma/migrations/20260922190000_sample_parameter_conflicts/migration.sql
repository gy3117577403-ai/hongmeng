CREATE TABLE "connector_parameter_conflicts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_entry_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "library_item_id" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "position_label" TEXT,
  "position_key" TEXT NOT NULL,
  "source_snapshot" JSONB NOT NULL,
  "product_snapshot" JSONB NOT NULL,
  "base_bindings" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "resolution" TEXT,
  "result_binding_id" TEXT,
  "resolved_by_id" TEXT,
  "resolved_by_name" TEXT,
  "resolved_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "connector_parameter_conflicts_source_entry_id_fkey" FOREIGN KEY ("source_entry_id") REFERENCES "sample_data_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "connector_parameter_conflicts_source_entry_id_key" ON "connector_parameter_conflicts"("source_entry_id");
CREATE INDEX "connector_parameter_conflicts_status_created_at_idx" ON "connector_parameter_conflicts"("status", "created_at");
CREATE INDEX "connector_parameter_conflicts_task_id_status_idx" ON "connector_parameter_conflicts"("task_id", "status");
CREATE INDEX "connector_parameter_conflicts_library_item_id_position_key_idx" ON "connector_parameter_conflicts"("library_item_id", "position_key");

ALTER TABLE "connector_parameter_conflicts" ADD CONSTRAINT "connector_parameter_conflicts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
