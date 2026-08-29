ALTER TABLE "system_notification_recipients"
ADD COLUMN "completed_at" TIMESTAMP(3),
ADD COLUMN "completion_kind" TEXT,
ADD COLUMN "completion_reason" TEXT;

CREATE INDEX "system_notification_recipients_user_id_completed_at_created_idx"
ON "system_notification_recipients"("user_id", "completed_at", "created_at");

-- Backfill only ledger-proven lifecycle facts. Core route stages are compared
-- using the durable business outbox creation time, never notification delivery
-- time. Unknown/FAILED events and rows without a matching outbox remain
-- pending. Supplement progress/fulfillment completes only itself, so multiple
-- obligations under one change can never archive one another here.
WITH "evidenced_process_notifications" AS (
  SELECT
    "notification"."id",
    CASE
      WHEN "notification"."event_type" IN (
        'PROCESS_ROUTE_CHANGE_REJECTED',
        'PROCESS_ROUTE_CHANGE_ACTIVATED'
      ) THEN '历史工艺通知已处于明确终态'
      WHEN "notification"."event_type" IN (
        'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED',
        'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED'
      ) THEN '历史补充工序通知属于纯进度或完成留痕'
      ELSE '历史工艺通知已被可证明的后续阶段取代'
    END AS "reason"
  FROM "system_notifications" AS "notification"
  LEFT JOIN "process_route_change_outbox" AS "origin_outbox"
    ON "notification"."dedupe_key" = 'route-change:' || "origin_outbox"."dedupe_key"
  WHERE "notification"."source_type" = 'process_route_change'
    AND "notification"."source_id" IS NOT NULL
    AND (
      "notification"."event_type" IN (
        'PROCESS_ROUTE_CHANGE_REJECTED',
        'PROCESS_ROUTE_CHANGE_ACTIVATED',
        'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED',
        'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED'
      )
      OR (
        "notification"."event_type" IN (
          'PROCESS_ROUTE_CHANGE_SUBMITTED',
          'PROCESS_ROUTE_CHANGE_APPROVED',
          'PROCESS_ROUTE_CHANGE_REEVALUATED'
        )
        AND "origin_outbox"."id" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "process_route_change_outbox" AS "later_outbox"
          WHERE "later_outbox"."change_id" = "origin_outbox"."change_id"
            AND "later_outbox"."event_type" IN (
              'PROCESS_ROUTE_CHANGE_SUBMITTED',
              'PROCESS_ROUTE_CHANGE_APPROVED',
              'PROCESS_ROUTE_CHANGE_REJECTED',
              'PROCESS_ROUTE_CHANGE_REEVALUATED',
              'PROCESS_ROUTE_CHANGE_ACTIVATED'
            )
            AND "later_outbox"."created_at" > "origin_outbox"."created_at"
        )
      )
    )
)
UPDATE "system_notification_recipients" AS "recipient"
SET
  "completed_at" = COALESCE("recipient"."completed_at", CURRENT_TIMESTAMP),
  "completion_kind" = 'SYSTEM_RECONCILED',
  "completion_reason" = "evidenced"."reason",
  "read_at" = COALESCE("recipient"."read_at", CURRENT_TIMESTAMP),
  "snoozed_until" = NULL
FROM "evidenced_process_notifications" AS "evidenced"
WHERE "recipient"."notification_id" = "evidenced"."id";
