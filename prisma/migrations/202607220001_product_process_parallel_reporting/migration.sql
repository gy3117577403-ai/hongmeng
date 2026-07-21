-- Keep existing product-time records sequential while allowing newly published
-- profiles to group operations that can run in parallel.
ALTER TABLE "product_process_time_entries"
ADD COLUMN "sequence_group" INTEGER NOT NULL DEFAULT 1;

UPDATE "product_process_time_entries"
SET "sequence_group" = "position";

ALTER TABLE "work_order_process_steps"
ADD COLUMN "sequence_group" INTEGER NOT NULL DEFAULT 1;

UPDATE "work_order_process_steps"
SET "sequence_group" = "position";

CREATE INDEX "work_order_process_steps_route_id_sequence_group_status_idx"
ON "work_order_process_steps"("route_id", "sequence_group", "status");
