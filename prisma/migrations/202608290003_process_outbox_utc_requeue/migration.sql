-- Prisma DateTime columns are stored as TIMESTAMP WITHOUT TIME ZONE. Convert
-- the database clock to a UTC wall-clock value before persisting it so a
-- non-UTC PostgreSQL session cannot postpone a supposedly immediate retry.
UPDATE "process_route_change_outbox"
SET "available_at" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    "updated_at" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
WHERE "channel" <> 'IN_APP'
  AND "status" = 'PENDING'
  AND "attempts" = 0
  AND "last_error" = '通知范围调整：仅质量管理允许企业微信；待补齐站内通知后取消外发';
