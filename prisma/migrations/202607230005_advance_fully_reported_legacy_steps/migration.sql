-- Legacy manual reporting could leave a current step with its full target already
-- recorded before the quantity-ledger rollout. Those rows have no remaining input,
-- so carry their already-recognized good output forward without creating a second
-- completion or labor pool.

CREATE TEMP TABLE "_hm_legacy_full_current_groups" AS
WITH "step_flags" AS (
    SELECT
        "step".*,
        EXISTS (
            SELECT 1
            FROM "process_executions" AS "execution"
            WHERE "execution"."step_id" = "step"."id"
              AND "execution"."voided_at" IS NULL
        ) AS "has_legacy_execution",
        EXISTS (
            SELECT 1
            FROM "process_completions" AS "completion"
            WHERE "completion"."step_id" = "step"."id"
              AND "completion"."voided_at" IS NULL
        ) AS "has_new_completion"
    FROM "work_order_process_steps" AS "step"
),
"group_state" AS (
    SELECT
        "step"."route_id",
        "step"."sequence_group",
        MIN("step"."good_output_qty") AS "released_qty",
        MIN("step"."released_good_qty") AS "previous_released_qty",
        COUNT(*) FILTER (WHERE "step"."status" = 'current') AS "current_step_count",
        BOOL_AND("step"."status" IN ('current', 'completed')) AS "eligible_statuses",
        BOOL_AND("step"."input_qty" > 0 AND "step"."good_output_qty" >= "step"."input_qty") AS "fully_reported",
        BOOL_AND(
            "step"."status" <> 'current'
            OR ("step"."has_legacy_execution" AND NOT "step"."has_new_completion")
        ) AS "current_steps_are_legacy"
    FROM "step_flags" AS "step"
    GROUP BY "step"."route_id", "step"."sequence_group"
),
"eligible_groups" AS (
    SELECT
        "group_state"."route_id",
        "route"."work_order_id",
        "group_state"."sequence_group",
        "group_state"."released_qty",
        (
            SELECT MIN("next_step"."sequence_group")
            FROM "work_order_process_steps" AS "next_step"
            WHERE "next_step"."route_id" = "group_state"."route_id"
              AND "next_step"."sequence_group" > "group_state"."sequence_group"
        ) AS "next_sequence_group",
        "work_order"."stage" AS "previous_stage",
        ROW_NUMBER() OVER (
            PARTITION BY "group_state"."route_id"
            ORDER BY "group_state"."sequence_group"
        ) AS "route_rank"
    FROM "group_state"
    INNER JOIN "work_order_process_routes" AS "route"
        ON "route"."id" = "group_state"."route_id"
    INNER JOIN "work_orders" AS "work_order"
        ON "work_order"."id" = "route"."work_order_id"
    WHERE "group_state"."current_step_count" > 0
      AND "group_state"."eligible_statuses"
      AND "group_state"."fully_reported"
      AND "group_state"."current_steps_are_legacy"
      AND "group_state"."released_qty" > "group_state"."previous_released_qty"
      AND "route"."status" IN ('confirmed', 'in_progress')
      AND NOT EXISTS (
          SELECT 1
          FROM "work_orders" AS "branch"
          WHERE "branch"."deleted_at" IS NULL
            AND (
                "branch"."parent_work_order_id" = "work_order"."id"
                OR "branch"."root_work_order_id" = "work_order"."id"
            )
            AND "branch"."branch_status" NOT IN ('RESOLVED', 'CANCELLED')
      )
)
SELECT
    "route_id",
    "work_order_id",
    "sequence_group",
    "released_qty",
    "next_sequence_group",
    "previous_stage",
    CASE
        WHEN "next_sequence_group" IS NULL THEN 'completed'
        WHEN EXISTS (
            SELECT 1
            FROM "work_order_process_steps" AS "next_step"
            WHERE "next_step"."route_id" = "eligible_groups"."route_id"
              AND "next_step"."sequence_group" = "eligible_groups"."next_sequence_group"
              AND "next_step"."stage_group" = 'backend'
        ) THEN 'backend'
        ELSE 'frontend'
    END AS "next_stage"
FROM "eligible_groups"
WHERE "route_rank" = 1;

UPDATE "work_order_process_steps" AS "step"
SET
    "status" = 'completed',
    "released_good_qty" = GREATEST("step"."released_good_qty", "eligible"."released_qty"),
    "completed_at" = COALESCE("step"."completed_at", CURRENT_TIMESTAMP),
    "quantity_version" = "step"."quantity_version" + 1,
    "remark" = CASE
        WHEN COALESCE(BTRIM("step"."remark"), '') = '' THEN '历史报工已满量，迁移时自动承接转序'
        ELSE "step"."remark" || '；历史报工已满量，迁移时自动承接转序'
    END,
    "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_legacy_full_current_groups" AS "eligible"
WHERE "step"."route_id" = "eligible"."route_id"
  AND "step"."sequence_group" = "eligible"."sequence_group"
  AND "step"."status" = 'current';

UPDATE "work_order_process_steps" AS "step"
SET
    "input_qty" = GREATEST("step"."input_qty", "eligible"."released_qty"),
    "status" = CASE WHEN "step"."status" = 'pending' THEN 'current' ELSE "step"."status" END,
    "started_at" = CASE
        WHEN "step"."status" = 'pending' THEN COALESCE("step"."started_at", CURRENT_TIMESTAMP)
        ELSE "step"."started_at"
    END,
    "quantity_version" = "step"."quantity_version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_legacy_full_current_groups" AS "eligible"
WHERE "eligible"."next_sequence_group" IS NOT NULL
  AND "step"."route_id" = "eligible"."route_id"
  AND "step"."sequence_group" = "eligible"."next_sequence_group";

UPDATE "work_order_process_routes" AS "route"
SET
    "status" = CASE
        WHEN "eligible"."next_sequence_group" IS NULL THEN 'completed'
        ELSE 'in_progress'
    END,
    "started_at" = COALESCE("route"."started_at", CURRENT_TIMESTAMP),
    "completed_at" = CASE
        WHEN "eligible"."next_sequence_group" IS NULL
            THEN COALESCE("route"."completed_at", CURRENT_TIMESTAMP)
        ELSE NULL
    END,
    "version" = "route"."version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_legacy_full_current_groups" AS "eligible"
WHERE "route"."id" = "eligible"."route_id";

UPDATE "work_orders" AS "work_order"
SET
    "stage" = "eligible"."next_stage",
    "status" = CASE
        WHEN "eligible"."next_sequence_group" IS NULL THEN 'done'
        ELSE 'processing'
    END,
    "progress" = CASE
        WHEN "eligible"."next_sequence_group" IS NULL THEN 100
        ELSE "work_order"."progress"
    END,
    "frontend_transferred_qty" = CASE
        WHEN "eligible"."next_stage" IN ('backend', 'completed')
            THEN GREATEST(COALESCE("work_order"."frontend_transferred_qty", 0), "eligible"."released_qty")
        ELSE "work_order"."frontend_transferred_qty"
    END,
    "completed_qty" = CASE
        WHEN "eligible"."next_sequence_group" IS NULL THEN "eligible"."released_qty"::TEXT
        ELSE "work_order"."completed_qty"
    END,
    "started_at" = COALESCE("work_order"."started_at", CURRENT_TIMESTAMP),
    "completed_at" = CASE
        WHEN "eligible"."next_sequence_group" IS NULL
            THEN COALESCE("work_order"."completed_at", CURRENT_TIMESTAMP)
        ELSE NULL
    END,
    "last_progress_at" = CURRENT_TIMESTAMP,
    "latest_progress_remark" = '历史报工已满量，迁移时自动承接转序',
    "execution_version" = "work_order"."execution_version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_legacy_full_current_groups" AS "eligible"
WHERE "work_order"."id" = "eligible"."work_order_id";

INSERT INTO "process_route_activities" (
    "id",
    "route_id",
    "step_id",
    "action",
    "content",
    "detail",
    "actor_id",
    "created_at"
)
SELECT
    gen_random_uuid()::TEXT,
    "eligible"."route_id",
    NULL,
    'legacy_full_quantity_advanced',
    CASE
        WHEN "eligible"."next_sequence_group" IS NULL
            THEN '历史报工已满量，迁移时自动完成末道工序'
        ELSE '历史报工已满量，迁移时自动承接到下一组工序'
    END,
    jsonb_build_object(
        'sequenceGroup', "eligible"."sequence_group",
        'releasedQty', "eligible"."released_qty",
        'nextSequenceGroup', "eligible"."next_sequence_group",
        'laborPoolCreated', FALSE
    ),
    NULL,
    CURRENT_TIMESTAMP
FROM "_hm_legacy_full_current_groups" AS "eligible";

INSERT INTO "work_order_progress_logs" (
    "id",
    "work_order_id",
    "previous_stage",
    "stage",
    "completed_qty",
    "production_owner",
    "workstation",
    "remark",
    "created_by",
    "created_at"
)
SELECT
    gen_random_uuid()::TEXT,
    "eligible"."work_order_id",
    "eligible"."previous_stage",
    "eligible"."next_stage",
    CASE
        WHEN "eligible"."next_sequence_group" IS NULL THEN "eligible"."released_qty"::TEXT
        ELSE NULL
    END,
    NULL,
    NULL,
    '历史报工已满量，迁移时自动承接转序；不重复生成可领取工时',
    '系统迁移',
    CURRENT_TIMESTAMP
FROM "_hm_legacy_full_current_groups" AS "eligible";

DROP TABLE "_hm_legacy_full_current_groups";
