ALTER TABLE "sample_tasks"
ADD COLUMN "last_submission_mutation_id" TEXT;

ALTER TABLE "sample_data_entries"
ADD COLUMN "client_mutation_id" TEXT;

ALTER TABLE "sample_photos"
ADD COLUMN "linked_entry_id" TEXT,
ADD COLUMN "client_mutation_id" TEXT;

CREATE UNIQUE INDEX "sample_data_entries_task_id_client_mutation_id_key"
ON "sample_data_entries"("task_id", "client_mutation_id");

CREATE UNIQUE INDEX "sample_photos_task_id_client_mutation_id_key"
ON "sample_photos"("task_id", "client_mutation_id");

CREATE INDEX "sample_photos_linked_entry_id_idx"
ON "sample_photos"("linked_entry_id");

ALTER TABLE "sample_photos"
ADD CONSTRAINT "sample_photos_linked_entry_id_fkey"
FOREIGN KEY ("linked_entry_id") REFERENCES "sample_data_entries"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "resource_categories" ("id", "name", "code", "sort_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, '样品工序与工时', 'sample_process_time', 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '样品半成品', 'sample_semi_finished', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '样品异常参考', 'sample_exception', 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;
