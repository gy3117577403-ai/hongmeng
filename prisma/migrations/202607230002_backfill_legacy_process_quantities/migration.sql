-- Preserve already-running routes when quantity accounting becomes explicit.
-- Completed legacy steps are treated as fully released; a current legacy step
-- resumes from its non-voided good quantity and keeps the remaining quantity
-- available for the new supervisor-completion flow.

WITH "normalized_route_targets" AS (
    SELECT
        "route"."id" AS "route_id",
        "work_order"."production_target_qty",
        LOWER(
            REGEXP_REPLACE(
                BTRIM(COALESCE("work_order"."uncompleted_qty", '')),
                '[[:space:],，]',
                '',
                'g'
            )
        ) AS "normalized_imported_qty"
    FROM "work_order_process_routes" AS "route"
    INNER JOIN "work_orders" AS "work_order"
        ON "work_order"."id" = "route"."work_order_id"
),
"parsed_route_targets" AS (
    SELECT
        "route_id",
        CASE
            WHEN "production_target_qty" IS NOT NULL
                AND "production_target_qty" > 0
                THEN "production_target_qty"::NUMERIC
            WHEN "normalized_imported_qty" ~ '^[0-9]+(套|件|个|pcs)?$'
                THEN REGEXP_REPLACE(
                    "normalized_imported_qty",
                    '(套|件|个|pcs)$',
                    '',
                    'i'
                )::NUMERIC
            ELSE NULL
        END AS "target_qty"
    FROM "normalized_route_targets"
),
"route_targets" AS (
    SELECT "route_id", "target_qty"::INTEGER AS "target_qty"
    FROM "parsed_route_targets"
    WHERE "target_qty" BETWEEN 1 AND 2147483647
),
"route_first_groups" AS (
    SELECT "route_id", MIN("sequence_group") AS "first_sequence_group"
    FROM "work_order_process_steps"
    GROUP BY "route_id"
),
"legacy_execution_totals" AS (
    SELECT
        "step_id",
        GREATEST(0, COALESCE(SUM("good_qty"), 0)) AS "good_qty"
    FROM "process_executions"
    WHERE "voided_at" IS NULL
    GROUP BY "step_id"
),
"step_backfill" AS (
    SELECT
        "step"."id" AS "step_id",
        "step"."status",
        "step"."sequence_group",
        "target"."target_qty",
        "first_group"."first_sequence_group",
        COALESCE("execution"."good_qty", 0) AS "legacy_good_qty"
    FROM "work_order_process_steps" AS "step"
    INNER JOIN "route_targets" AS "target"
        ON "target"."route_id" = "step"."route_id"
    INNER JOIN "route_first_groups" AS "first_group"
        ON "first_group"."route_id" = "step"."route_id"
    LEFT JOIN "legacy_execution_totals" AS "execution"
        ON "execution"."step_id" = "step"."id"
)
UPDATE "work_order_process_steps" AS "step"
SET
    "input_qty" = CASE
        WHEN "backfill"."status" IN ('current', 'completed')
            OR "backfill"."sequence_group" = "backfill"."first_sequence_group"
            THEN "backfill"."target_qty"
        ELSE 0
    END,
    "processed_qty" = CASE
        WHEN "backfill"."status" = 'completed' THEN "backfill"."target_qty"
        WHEN "backfill"."status" = 'current' THEN LEAST(
            "backfill"."target_qty"::BIGINT,
            "backfill"."legacy_good_qty"
        )::INTEGER
        ELSE 0
    END,
    "good_output_qty" = CASE
        WHEN "backfill"."status" = 'completed' THEN "backfill"."target_qty"
        WHEN "backfill"."status" = 'current' THEN LEAST(
            "backfill"."target_qty"::BIGINT,
            "backfill"."legacy_good_qty"
        )::INTEGER
        ELSE 0
    END,
    "released_good_qty" = CASE
        WHEN "backfill"."status" = 'completed' THEN "backfill"."target_qty"
        ELSE 0
    END,
    "quantity_version" = CASE
        WHEN "backfill"."status" IN ('current', 'completed')
            OR "backfill"."sequence_group" = "backfill"."first_sequence_group"
            THEN 1
        ELSE 0
    END
FROM "step_backfill" AS "backfill"
WHERE "step"."id" = "backfill"."step_id";
