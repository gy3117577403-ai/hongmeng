CREATE TYPE "process_completion_withdrawal_request_status" AS ENUM (
  'PENDING',
  'APPLIED',
  'REJECTED',
  'CANCELLED',
  'BLOCKED',
  'STALE'
);

CREATE TABLE "process_completion_withdrawal_requests" (
  "id" TEXT NOT NULL,
  "completion_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "requester_user_id" TEXT NOT NULL,
  "requester_employee_id" TEXT,
  "category" TEXT NOT NULL DEFAULT 'REPORTING_ERROR',
  "reason" TEXT,
  "status" "process_completion_withdrawal_request_status" NOT NULL DEFAULT 'PENDING',
  "requested_route_version" INTEGER NOT NULL,
  "preview" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "request_idempotency_key" TEXT NOT NULL,
  "resolution_idempotency_key" TEXT,
  "decided_by_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "executed_at" TIMESTAMP(3),
  "result_code" TEXT,
  "result_detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "process_completion_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "process_completion_withdrawal_requests_request_idempotency_key_key"
ON "process_completion_withdrawal_requests"("request_idempotency_key");

CREATE UNIQUE INDEX "process_completion_withdrawal_requests_resolution_idempotency_key_key"
ON "process_completion_withdrawal_requests"("resolution_idempotency_key");

-- A completion can have historical terminal requests, but only one live request.
CREATE UNIQUE INDEX "process_completion_withdrawal_requests_one_pending_per_completion_key"
ON "process_completion_withdrawal_requests"("completion_id")
WHERE "status" = 'PENDING';

CREATE INDEX "process_completion_withdrawal_requests_completion_id_status_idx"
ON "process_completion_withdrawal_requests"("completion_id", "status");

CREATE INDEX "process_completion_withdrawal_requests_requester_user_id_status_created_at_idx"
ON "process_completion_withdrawal_requests"("requester_user_id", "status", "created_at");

CREATE INDEX "process_completion_withdrawal_requests_requester_employee_id_status_created_at_idx"
ON "process_completion_withdrawal_requests"("requester_employee_id", "status", "created_at");

CREATE INDEX "process_completion_withdrawal_requests_route_id_status_created_at_idx"
ON "process_completion_withdrawal_requests"("route_id", "status", "created_at");

CREATE INDEX "process_completion_withdrawal_requests_work_order_id_status_created_at_idx"
ON "process_completion_withdrawal_requests"("work_order_id", "status", "created_at");

CREATE INDEX "process_completion_withdrawal_requests_status_created_at_idx"
ON "process_completion_withdrawal_requests"("status", "created_at");

CREATE INDEX "process_completion_withdrawal_requests_decided_by_id_idx"
ON "process_completion_withdrawal_requests"("decided_by_id");

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_completion_id_fkey"
FOREIGN KEY ("completion_id") REFERENCES "process_completions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_route_id_fkey"
FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_step_id_fkey"
FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_requester_user_id_fkey"
FOREIGN KEY ("requester_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_requester_employee_id_fkey"
FOREIGN KEY ("requester_employee_id") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_completion_withdrawal_requests"
ADD CONSTRAINT "process_completion_withdrawal_requests_decided_by_id_fkey"
FOREIGN KEY ("decided_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
