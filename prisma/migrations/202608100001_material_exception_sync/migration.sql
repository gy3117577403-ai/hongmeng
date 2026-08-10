CREATE TYPE "warehouse_exception_case_status" AS ENUM (
  'OPEN',
  'RESOLVED',
  'CANCELLED'
);

CREATE TABLE "warehouse_material_exception_cases" (
  "id" TEXT NOT NULL,
  "warehouse_task_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "warehouse_exception_case_status" NOT NULL DEFAULT 'OPEN',
  "exception_type" TEXT NOT NULL,
  "exception_note" TEXT NOT NULL,
  "week_start_date" TIMESTAMP(3),
  "week_end_date" TIMESTAMP(3),
  "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reported_by_id" TEXT,
  "expected_arrival_at" TIMESTAMP(3),
  "expected_arrival_by_id" TEXT,
  "expected_arrival_updated_at" TIMESTAMP(3),
  "actual_arrival_at" TIMESTAMP(3),
  "actual_arrival_by_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" TEXT,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_material_exception_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_material_exception_cases_warehouse_task_id_sequence_key"
ON "warehouse_material_exception_cases"("warehouse_task_id", "sequence");

CREATE INDEX "warehouse_material_exception_cases_warehouse_task_id_status_idx"
ON "warehouse_material_exception_cases"("warehouse_task_id", "status");

CREATE INDEX "warehouse_material_exception_cases_status_expected_arrival_at_idx"
ON "warehouse_material_exception_cases"("status", "expected_arrival_at");

CREATE INDEX "warehouse_material_exception_cases_week_start_date_status_idx"
ON "warehouse_material_exception_cases"("week_start_date", "status");

CREATE INDEX "warehouse_material_exception_cases_resolved_at_idx"
ON "warehouse_material_exception_cases"("resolved_at");

ALTER TABLE "warehouse_material_exception_cases"
ADD CONSTRAINT "warehouse_material_exception_cases_warehouse_task_id_fkey"
FOREIGN KEY ("warehouse_task_id") REFERENCES "warehouse_material_tasks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "warehouse_material_exception_cases"
ADD CONSTRAINT "warehouse_material_exception_cases_reported_by_id_fkey"
FOREIGN KEY ("reported_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouse_material_exception_cases"
ADD CONSTRAINT "warehouse_material_exception_cases_expected_by_id_fkey"
FOREIGN KEY ("expected_arrival_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouse_material_exception_cases"
ADD CONSTRAINT "warehouse_material_exception_cases_arrived_by_id_fkey"
FOREIGN KEY ("actual_arrival_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouse_material_exception_cases"
ADD CONSTRAINT "warehouse_material_exception_cases_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_follow_up_tasks"
ADD COLUMN "warehouse_exception_id" TEXT;

-- Preserve every existing follow-up as a stable exception event before changing
-- the old one-follow-up-per-work-order relationship.
INSERT INTO "warehouse_material_exception_cases" (
  "id",
  "warehouse_task_id",
  "sequence",
  "status",
  "exception_type",
  "exception_note",
  "week_start_date",
  "week_end_date",
  "reported_at",
  "reported_by_id",
  "expected_arrival_at",
  "expected_arrival_by_id",
  "expected_arrival_updated_at",
  "actual_arrival_at",
  "actual_arrival_by_id",
  "resolved_at",
  "resolved_by_id",
  "resolution_note",
  "created_at",
  "updated_at"
)
SELECT
  'wmec-' || md5(follow_up."id"),
  follow_up."warehouse_task_id",
  1,
  CASE
    WHEN follow_up."status" = 'RESOLVED' THEN 'RESOLVED'::"warehouse_exception_case_status"
    WHEN follow_up."status" = 'CANCELLED' THEN 'CANCELLED'::"warehouse_exception_case_status"
    ELSE 'OPEN'::"warehouse_exception_case_status"
  END,
  COALESCE(material_task."exception_type", 'shortage'),
  COALESCE(NULLIF(material_task."exception_note", ''), NULLIF(follow_up."latest_progress", ''), '历史物料异常'),
  work_order."week_start_date",
  work_order."week_end_date",
  follow_up."created_at",
  follow_up."created_by_id",
  follow_up."expected_at",
  CASE WHEN follow_up."expected_at" IS NOT NULL THEN COALESCE(follow_up."owner_id", follow_up."created_by_id") END,
  CASE WHEN follow_up."expected_at" IS NOT NULL THEN COALESCE(follow_up."last_followed_at", follow_up."updated_at") END,
  CASE WHEN follow_up."status" IN ('WAITING_WAREHOUSE', 'RESOLVED') THEN COALESCE(follow_up."last_followed_at", follow_up."resolved_at") END,
  CASE WHEN follow_up."status" IN ('WAITING_WAREHOUSE', 'RESOLVED') THEN COALESCE(follow_up."owner_id", follow_up."resolved_by_id") END,
  follow_up."resolved_at",
  follow_up."resolved_by_id",
  CASE WHEN follow_up."status" IN ('RESOLVED', 'CANCELLED') THEN follow_up."latest_progress" END,
  follow_up."created_at",
  follow_up."updated_at"
FROM "material_follow_up_tasks" follow_up
JOIN "warehouse_material_tasks" material_task ON material_task."id" = follow_up."warehouse_task_id"
JOIN "work_orders" work_order ON work_order."id" = material_task."work_order_id";

UPDATE "material_follow_up_tasks"
SET "warehouse_exception_id" = 'wmec-' || md5("id");

-- Backfill active warehouse exceptions that predate the follow-up module or were
-- created by legacy data paths. This is idempotent at the event level.
INSERT INTO "warehouse_material_exception_cases" (
  "id",
  "warehouse_task_id",
  "sequence",
  "status",
  "exception_type",
  "exception_note",
  "week_start_date",
  "week_end_date",
  "reported_at",
  "reported_by_id",
  "expected_arrival_at",
  "created_at",
  "updated_at"
)
SELECT
  'wmec-active-' || md5(material_task."id" || ':' || material_task."version"::TEXT),
  material_task."id",
  COALESCE((
    SELECT MAX(existing_case."sequence") + 1
    FROM "warehouse_material_exception_cases" existing_case
    WHERE existing_case."warehouse_task_id" = material_task."id"
  ), 1),
  'OPEN'::"warehouse_exception_case_status",
  COALESCE(material_task."exception_type", 'other'),
  COALESCE(NULLIF(material_task."exception_note", ''), '待补充异常说明'),
  work_order."week_start_date",
  work_order."week_end_date",
  material_task."updated_at",
  material_task."updated_by_id",
  material_task."expected_at",
  material_task."updated_at",
  material_task."updated_at"
FROM "warehouse_material_tasks" material_task
JOIN "work_orders" work_order ON work_order."id" = material_task."work_order_id"
WHERE material_task."status" = 'exception'
  AND NOT EXISTS (
    SELECT 1
    FROM "warehouse_material_exception_cases" existing_case
    WHERE existing_case."warehouse_task_id" = material_task."id"
      AND existing_case."status" = 'OPEN'
  );

DROP INDEX "material_follow_up_tasks_warehouse_task_id_key";

CREATE INDEX "material_follow_up_tasks_warehouse_task_id_idx"
ON "material_follow_up_tasks"("warehouse_task_id");

-- Every open warehouse exception must immediately be visible in material
-- follow-up, including non-shortage material exceptions.
INSERT INTO "material_follow_up_tasks" (
  "id",
  "warehouse_task_id",
  "warehouse_exception_id",
  "status",
  "created_by_id",
  "latest_progress",
  "expected_at",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  'mfu-' || md5(exception_case."id"),
  exception_case."warehouse_task_id",
  exception_case."id",
  'PENDING'::"material_follow_up_status",
  exception_case."reported_by_id",
  exception_case."exception_note",
  exception_case."expected_arrival_at",
  0,
  exception_case."reported_at",
  exception_case."updated_at"
FROM "warehouse_material_exception_cases" exception_case
WHERE exception_case."status" = 'OPEN'
  AND NOT EXISTS (
    SELECT 1
    FROM "material_follow_up_tasks" follow_up
    WHERE follow_up."warehouse_exception_id" = exception_case."id"
  );

INSERT INTO "material_follow_up_activities" (
  "id",
  "task_id",
  "action",
  "from_status",
  "to_status",
  "content",
  "actor_id",
  "created_at"
)
SELECT
  'mfua-' || md5(follow_up."id"),
  follow_up."id",
  'legacy_exception_backfilled',
  NULL,
  follow_up."status",
  '系统已补齐历史仓库异常',
  follow_up."created_by_id",
  follow_up."created_at"
FROM "material_follow_up_tasks" follow_up
WHERE follow_up."id" LIKE 'mfu-%'
  AND NOT EXISTS (
    SELECT 1
    FROM "material_follow_up_activities" activity
    WHERE activity."task_id" = follow_up."id"
  );

UPDATE "warehouse_material_tasks" material_task
SET "expected_at" = follow_up."expected_at",
    "updated_at" = CURRENT_TIMESTAMP
FROM "material_follow_up_tasks" follow_up
JOIN "warehouse_material_exception_cases" exception_case
  ON exception_case."id" = follow_up."warehouse_exception_id"
WHERE material_task."id" = follow_up."warehouse_task_id"
  AND exception_case."status" = 'OPEN';

ALTER TABLE "material_follow_up_tasks"
ALTER COLUMN "warehouse_exception_id" SET NOT NULL;

CREATE UNIQUE INDEX "material_follow_up_tasks_warehouse_exception_id_key"
ON "material_follow_up_tasks"("warehouse_exception_id");

ALTER TABLE "material_follow_up_tasks"
ADD CONSTRAINT "material_follow_up_tasks_warehouse_exception_id_fkey"
FOREIGN KEY ("warehouse_exception_id") REFERENCES "warehouse_material_exception_cases"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
