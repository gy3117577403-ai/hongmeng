CREATE TYPE "major_quality_approval_status" AS ENUM (
  'PENDING_QUALITY_REVIEW',
  'PENDING_GM_APPROVAL',
  'APPROVED',
  'QUALITY_RETURNED',
  'GM_RETURNED',
  'CANCELLED'
);

ALTER TABLE "issues"
  ADD COLUMN "is_major_quality" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "major_quality_reason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_version_nonnegative" CHECK ("version" >= 0),
  ADD CONSTRAINT "issues_major_quality_check" CHECK (
    NOT "is_major_quality"
    OR (
      "type" = 'quality'
      AND "major_quality_reason" IS NOT NULL
      AND LENGTH(BTRIM("major_quality_reason")) > 0
    )
  );

CREATE TABLE "system_notifications" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'SYSTEM',
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "title" TEXT NOT NULL,
  "body" TEXT,
  "target_route" TEXT,
  "source_type" TEXT,
  "source_id" TEXT,
  "actor_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),

  CONSTRAINT "system_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "system_notifications_event_type_nonempty" CHECK (LENGTH(BTRIM("event_type")) > 0),
  CONSTRAINT "system_notifications_dedupe_key_nonempty" CHECK (LENGTH(BTRIM("dedupe_key")) > 0),
  CONSTRAINT "system_notifications_title_nonempty" CHECK (LENGTH(BTRIM("title")) > 0),
  CONSTRAINT "system_notifications_category_check" CHECK ("category" IN ('SYSTEM', 'ACCOUNT', 'TODO', 'APPROVAL')),
  CONSTRAINT "system_notifications_priority_check" CHECK ("priority" IN ('NORMAL', 'HIGH', 'URGENT')),
  CONSTRAINT "system_notifications_target_route_check" CHECK (
    "target_route" IS NULL
    OR (
      LEFT("target_route", 1) = '/'
      AND LEFT("target_route", 2) <> '//'
      AND POSITION(CHR(92) IN "target_route") = 0
      AND POSITION(E'\n' IN "target_route") = 0
      AND POSITION(E'\r' IN "target_route") = 0
    )
  ),
  CONSTRAINT "system_notifications_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at")
);

CREATE TABLE "system_notification_recipients" (
  "notification_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_notification_recipients_pkey" PRIMARY KEY ("notification_id", "user_id")
);

CREATE TABLE "issue_major_approvals" (
  "id" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "status" "major_quality_approval_status" NOT NULL DEFAULT 'PENDING_QUALITY_REVIEW',
  "version" INTEGER NOT NULL DEFAULT 0,
  "issue_version" INTEGER NOT NULL,
  "issue_snapshot" JSONB NOT NULL,
  "submitted_by_id" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "quality_reviewed_by_id" TEXT,
  "quality_reviewed_at" TIMESTAMP(3),
  "quality_review_note" TEXT,
  "final_reviewed_by_id" TEXT,
  "final_reviewed_at" TIMESTAMP(3),
  "final_review_note" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "issue_major_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issue_major_approvals_round_positive" CHECK ("round" > 0),
  CONSTRAINT "issue_major_approvals_version_nonnegative" CHECK ("version" >= 0),
  CONSTRAINT "issue_major_approvals_issue_version_nonnegative" CHECK ("issue_version" >= 0)
);

CREATE TABLE "issue_major_approval_events" (
  "id" TEXT NOT NULL,
  "approval_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" "major_quality_approval_status",
  "to_status" "major_quality_approval_status",
  "note" TEXT,
  "actor_id" TEXT,
  "actor_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "issue_major_approval_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issue_major_approval_events_action_nonempty" CHECK (LENGTH(BTRIM("action")) > 0),
  CONSTRAINT "issue_major_approval_events_actor_name_nonempty" CHECK (LENGTH(BTRIM("actor_name")) > 0)
);

CREATE UNIQUE INDEX "system_notifications_dedupe_key_key" ON "system_notifications"("dedupe_key");
CREATE INDEX "system_notifications_category_created_at_idx" ON "system_notifications"("category", "created_at");
CREATE INDEX "system_notifications_source_type_source_id_idx" ON "system_notifications"("source_type", "source_id");
CREATE INDEX "system_notifications_actor_id_idx" ON "system_notifications"("actor_id");
CREATE INDEX "system_notifications_expires_at_idx" ON "system_notifications"("expires_at");
CREATE INDEX "system_notification_recipients_user_id_read_at_created_at_idx" ON "system_notification_recipients"("user_id", "read_at", "created_at");
CREATE INDEX "system_notification_recipients_user_id_created_at_idx" ON "system_notification_recipients"("user_id", "created_at");
CREATE UNIQUE INDEX "issue_major_approvals_issue_id_round_key" ON "issue_major_approvals"("issue_id", "round");
CREATE INDEX "issue_major_approvals_status_updated_at_idx" ON "issue_major_approvals"("status", "updated_at");
CREATE INDEX "issue_major_approvals_submitted_by_id_idx" ON "issue_major_approvals"("submitted_by_id");
CREATE INDEX "issue_major_approvals_quality_reviewed_by_id_idx" ON "issue_major_approvals"("quality_reviewed_by_id");
CREATE INDEX "issue_major_approvals_final_reviewed_by_id_idx" ON "issue_major_approvals"("final_reviewed_by_id");
CREATE INDEX "issue_major_approval_events_approval_id_created_at_idx" ON "issue_major_approval_events"("approval_id", "created_at");
CREATE INDEX "issue_major_approval_events_actor_id_idx" ON "issue_major_approval_events"("actor_id");

ALTER TABLE "system_notifications"
  ADD CONSTRAINT "system_notifications_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "system_notification_recipients"
  ADD CONSTRAINT "system_notification_recipients_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "system_notifications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "system_notification_recipients"
  ADD CONSTRAINT "system_notification_recipients_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_major_approvals"
  ADD CONSTRAINT "issue_major_approvals_issue_id_fkey"
  FOREIGN KEY ("issue_id") REFERENCES "issues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_major_approvals"
  ADD CONSTRAINT "issue_major_approvals_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_major_approvals"
  ADD CONSTRAINT "issue_major_approvals_quality_reviewed_by_id_fkey"
  FOREIGN KEY ("quality_reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_major_approvals"
  ADD CONSTRAINT "issue_major_approvals_final_reviewed_by_id_fkey"
  FOREIGN KEY ("final_reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_major_approval_events"
  ADD CONSTRAINT "issue_major_approval_events_approval_id_fkey"
  FOREIGN KEY ("approval_id") REFERENCES "issue_major_approvals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_major_approval_events"
  ADD CONSTRAINT "issue_major_approval_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
