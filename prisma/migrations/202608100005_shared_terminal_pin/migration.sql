ALTER TYPE "process_completion_source"
  ADD VALUE IF NOT EXISTS 'SHARED_TERMINAL_PIN';

CREATE TABLE "employee_field_report_pin_credentials" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "pin_hash" TEXT NOT NULL,
  "credential_version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reset_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_field_report_pin_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_field_report_pin_credentials_pin_hash_check"
    CHECK ("pin_hash" ~ E'^\\$2[aby]\\$12\\$[./A-Za-z0-9]{53}$'),
  CONSTRAINT "employee_field_report_pin_credentials_version_positive"
    CHECK ("credential_version" > 0),
  CONSTRAINT "employee_field_report_pin_credentials_attempts_nonnegative"
    CHECK ("failed_attempts" >= 0),
  CONSTRAINT "employee_field_report_pin_credentials_reset_time_check"
    CHECK ("reset_at" >= "created_at")
);

CREATE TABLE "field_report_terminals" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "secret_hash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "field_report_terminals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_report_terminals_name_nonempty"
    CHECK (LENGTH(BTRIM("name")) > 0),
  CONSTRAINT "field_report_terminals_secret_hash_check"
    CHECK ("secret_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "field_report_terminals_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "field_report_terminals_attempts_nonnegative"
    CHECK ("failed_attempts" >= 0)
);

CREATE TABLE "field_report_pin_sessions" (
  "id" TEXT NOT NULL,
  "terminal_id" TEXT NOT NULL,
  "credential_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "credential_version" INTEGER NOT NULL,
  "terminal_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "field_report_pin_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_report_pin_sessions_token_hash_check"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "field_report_pin_sessions_credential_version_positive"
    CHECK ("credential_version" > 0),
  CONSTRAINT "field_report_pin_sessions_terminal_version_positive"
    CHECK ("terminal_version" > 0),
  CONSTRAINT "field_report_pin_sessions_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "field_report_pin_sessions_consumed_time_check"
    CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at"),
  CONSTRAINT "field_report_pin_sessions_revoked_time_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

ALTER TABLE "process_completions"
  ADD COLUMN "principal_employee_id" TEXT,
  ADD COLUMN "field_report_terminal_id" TEXT,
  ADD COLUMN "pin_credential_version" INTEGER;

ALTER TABLE "process_completions"
  ADD CONSTRAINT "process_completions_pin_version_positive"
    CHECK ("pin_credential_version" IS NULL OR "pin_credential_version" > 0),
  ADD CONSTRAINT "process_completions_shared_terminal_attribution_check"
    CHECK (
      (
        "report_source"::text = 'SHARED_TERMINAL_PIN'
        AND "principal_employee_id" IS NOT NULL
        AND "field_report_terminal_id" IS NOT NULL
        AND "pin_credential_version" IS NOT NULL
      )
      OR
      (
        "report_source"::text <> 'SHARED_TERMINAL_PIN'
        AND "principal_employee_id" IS NULL
        AND "field_report_terminal_id" IS NULL
        AND "pin_credential_version" IS NULL
      )
    );

CREATE UNIQUE INDEX "employee_field_report_pin_credentials_employee_id_key"
  ON "employee_field_report_pin_credentials"("employee_id");
CREATE INDEX "employee_field_report_pin_credentials_active_lock_idx"
  ON "employee_field_report_pin_credentials"("is_active", "locked_until");
CREATE INDEX "employee_field_report_pin_credentials_reset_by_idx"
  ON "employee_field_report_pin_credentials"("reset_by_id");

CREATE UNIQUE INDEX "field_report_terminals_secret_hash_key"
  ON "field_report_terminals"("secret_hash");
CREATE INDEX "field_report_terminals_is_active_locked_until_idx"
  ON "field_report_terminals"("is_active", "locked_until");
CREATE INDEX "field_report_terminals_created_by_id_idx"
  ON "field_report_terminals"("created_by_id");
CREATE INDEX "field_report_terminals_updated_by_id_idx"
  ON "field_report_terminals"("updated_by_id");

CREATE UNIQUE INDEX "field_report_pin_sessions_token_hash_key"
  ON "field_report_pin_sessions"("token_hash");
CREATE INDEX "field_report_pin_sessions_terminal_id_expires_at_idx"
  ON "field_report_pin_sessions"("terminal_id", "expires_at");
CREATE INDEX "field_report_pin_sessions_credential_id_expires_at_idx"
  ON "field_report_pin_sessions"("credential_id", "expires_at");
CREATE INDEX "field_report_pin_sessions_employee_id_expires_at_idx"
  ON "field_report_pin_sessions"("employee_id", "expires_at");
CREATE INDEX "field_report_pin_sessions_user_id_idx"
  ON "field_report_pin_sessions"("user_id");
CREATE INDEX "field_report_pin_sessions_ticket_id_expires_at_idx"
  ON "field_report_pin_sessions"("ticket_id", "expires_at");
CREATE INDEX "field_report_pin_sessions_expiry_state_idx"
  ON "field_report_pin_sessions"("expires_at", "consumed_at", "revoked_at");

CREATE INDEX "process_completions_principal_employee_id_idx"
  ON "process_completions"("principal_employee_id");
CREATE INDEX "process_completions_field_report_terminal_id_idx"
  ON "process_completions"("field_report_terminal_id");

ALTER TABLE "employee_field_report_pin_credentials"
  ADD CONSTRAINT "employee_field_report_pin_credentials_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_field_report_pin_credentials"
  ADD CONSTRAINT "employee_field_report_pin_credentials_reset_by_id_fkey"
  FOREIGN KEY ("reset_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "field_report_terminals"
  ADD CONSTRAINT "field_report_terminals_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "field_report_terminals"
  ADD CONSTRAINT "field_report_terminals_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "field_report_pin_sessions"
  ADD CONSTRAINT "field_report_pin_sessions_terminal_id_fkey"
  FOREIGN KEY ("terminal_id") REFERENCES "field_report_terminals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "field_report_pin_sessions"
  ADD CONSTRAINT "field_report_pin_sessions_credential_id_fkey"
  FOREIGN KEY ("credential_id") REFERENCES "employee_field_report_pin_credentials"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "field_report_pin_sessions"
  ADD CONSTRAINT "field_report_pin_sessions_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "field_report_pin_sessions"
  ADD CONSTRAINT "field_report_pin_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "field_report_pin_sessions"
  ADD CONSTRAINT "field_report_pin_sessions_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "work_order_qr_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_completions"
  ADD CONSTRAINT "process_completions_principal_employee_id_fkey"
  FOREIGN KEY ("principal_employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_completions"
  ADD CONSTRAINT "process_completions_field_report_terminal_id_fkey"
  FOREIGN KEY ("field_report_terminal_id") REFERENCES "field_report_terminals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
