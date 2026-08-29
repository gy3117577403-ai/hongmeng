ALTER TABLE "system_notification_recipients"
ADD COLUMN "snoozed_until" TIMESTAMP(3);

CREATE INDEX "system_notification_recipients_user_id_snoozed_until_created_idx"
ON "system_notification_recipients"("user_id", "snoozed_until", "created_at");
