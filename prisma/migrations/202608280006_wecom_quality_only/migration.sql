-- New process events are in-app only. Do not change SENT history or quality queues.
ALTER TABLE "process_route_change_outbox" ALTER COLUMN "channel" SET DEFAULT 'IN_APP';

-- The new dispatcher first commits the in-app notification, then cancels legacy
-- external delivery. Include exhausted/future retries and interrupted claims.
-- Drain old application instances before upgrading: old binaries still send.
UPDATE "process_route_change_outbox"
SET "status" = 'PENDING', "attempts" = 0, "available_at" = CURRENT_TIMESTAMP,
    "processed_at" = NULL, "updated_at" = CURRENT_TIMESTAMP,
    "last_error" = '通知范围调整：仅质量管理允许企业微信；待补齐站内通知后取消外发'
WHERE "channel" <> 'IN_APP' AND "status" IN ('PENDING', 'FAILED', 'PROCESSING');
