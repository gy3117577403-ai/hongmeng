CREATE TYPE "production_planning_role" AS ENUM (
  'WORKSHOP_SUPERVISOR',
  'TEAM_LEADER',
  'MEMBER'
);

CREATE TYPE "daily_production_plan_status" AS ENUM (
  'DRAFT',
  'NEEDS_REVIEW',
  'CONFIRMED',
  'IN_PROGRESS',
  'ARCHIVED',
  'CANCELLED'
);

CREATE TYPE "daily_process_task_status" AS ENUM (
  'UNPLANNED',
  'WAITING_UPSTREAM',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'PENDING_CARRY_OVER',
  'CARRIED_OVER',
  'NEEDS_REVIEW',
  'CANCELLED'
);

CREATE TYPE "daily_task_assignment_status" AS ENUM (
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "daily_cross_team_request_status" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "production_teams" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legacy_team_name" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "production_teams_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_teams_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "production_planning_memberships" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "team_id" TEXT,
  "role" "production_planning_role" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
  "effective_to" DATE,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "production_planning_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_planning_memberships_dates_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "production_planning_memberships_team_scope_check"
    CHECK (
      ("role" = 'WORKSHOP_SUPERVISOR' AND "team_id" IS NULL)
      OR ("role" <> 'WORKSHOP_SUPERVISOR' AND "team_id" IS NOT NULL)
    ),
  CONSTRAINT "production_planning_memberships_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "daily_organization_mutations" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "result_version" INTEGER NOT NULL,
  "result_data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_organization_mutations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_organization_mutations_result_version_check" CHECK ("result_version" >= 0),
  CONSTRAINT "daily_organization_mutations_action_check" CHECK (char_length(btrim("action")) > 0),
  CONSTRAINT "daily_organization_mutations_target_check"
    CHECK (char_length(btrim("target_type")) > 0 AND char_length(btrim("target_id")) > 0)
);

CREATE TABLE "daily_production_plans" (
  "id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "shift_code" TEXT NOT NULL DEFAULT 'DAY',
  "team_id" TEXT NOT NULL,
  "status" "daily_production_plan_status" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_production_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_production_plans_shift_code_check"
    CHECK (char_length(btrim("shift_code")) > 0),
  CONSTRAINT "daily_production_plans_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "daily_process_tasks" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "shift_code" TEXT NOT NULL,
  "production_plan_batch_id" TEXT,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "route_version" INTEGER NOT NULL,
  "process_code" TEXT NOT NULL,
  "process_name" TEXT NOT NULL,
  "stage_group" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "sequence_group" INTEGER NOT NULL,
  "standard_source" TEXT NOT NULL,
  "time_basis" TEXT NOT NULL,
  "unit_label" TEXT NOT NULL,
  "standard_milliseconds_per_unit" INTEGER NOT NULL,
  "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
  "units_per_product" INTEGER NOT NULL DEFAULT 1,
  "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
  "product_time_profile_id" TEXT,
  "product_time_profile_version" INTEGER,
  "planned_qty" INTEGER NOT NULL,
  "available_qty" INTEGER NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "priority_reason" TEXT,
  "risk_warnings" JSONB,
  "status" "daily_process_task_status" NOT NULL DEFAULT 'UNPLANNED',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "carry_over_from_task_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_process_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_process_tasks_shift_code_check"
    CHECK (char_length(btrim("shift_code")) > 0),
  CONSTRAINT "daily_process_tasks_quantity_check"
    CHECK (
      "planned_qty" >= 0
      AND "available_qty" >= 0
      AND "available_qty" <= "planned_qty"
    ),
  CONSTRAINT "daily_process_tasks_time_check"
    CHECK (
      "standard_milliseconds_per_unit" >= 0
      AND "setup_milliseconds" >= 0
      AND "units_per_product" > 0
      AND "time_basis" IN ('per_unit', 'per_batch')
    ),
  CONSTRAINT "daily_process_tasks_route_version_check" CHECK ("route_version" >= 0),
  CONSTRAINT "daily_process_tasks_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "daily_task_assignments" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "assigned_team_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "planned_standard_milliseconds" BIGINT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "regular_start_at" TIMESTAMP(3),
  "regular_end_at" TIMESTAMP(3),
  "overtime_start_at" TIMESTAMP(3),
  "overtime_end_at" TIMESTAMP(3),
  "status" "daily_task_assignment_status" NOT NULL DEFAULT 'PLANNED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT NOT NULL,
  "assigned_by_id" TEXT NOT NULL,
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_task_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_task_assignments_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "daily_task_assignments_time_check"
    CHECK ("planned_standard_milliseconds" >= 0),
  CONSTRAINT "daily_task_assignments_regular_interval_check"
    CHECK (
      ("regular_start_at" IS NULL AND "regular_end_at" IS NULL)
      OR (
        "regular_start_at" IS NOT NULL
        AND "regular_end_at" IS NOT NULL
        AND "regular_end_at" > "regular_start_at"
      )
    ),
  CONSTRAINT "daily_task_assignments_overtime_interval_check"
    CHECK (
      ("overtime_start_at" IS NULL AND "overtime_end_at" IS NULL)
      OR (
        "overtime_start_at" IS NOT NULL
        AND "overtime_end_at" IS NOT NULL
        AND "overtime_end_at" > "overtime_start_at"
      )
    ),
  CONSTRAINT "daily_task_assignments_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "daily_capacity_overrides" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "regular_milliseconds" INTEGER NOT NULL DEFAULT 28800000,
  "overtime_start_at" TIMESTAMP(3),
  "overtime_end_at" TIMESTAMP(3),
  "overtime_milliseconds" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "set_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_capacity_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_capacity_overrides_capacity_check"
    CHECK ("regular_milliseconds" >= 0 AND "overtime_milliseconds" >= 0),
  CONSTRAINT "daily_capacity_overrides_overtime_interval_check"
    CHECK (
      ("overtime_start_at" IS NULL AND "overtime_end_at" IS NULL)
      OR (
        "overtime_start_at" IS NOT NULL
        AND "overtime_end_at" IS NOT NULL
        AND "overtime_end_at" > "overtime_start_at"
      )
    ),
  CONSTRAINT "daily_capacity_overrides_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "daily_plan_revisions" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "task_id" TEXT,
  "assignment_id" TEXT,
  "action" TEXT NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "reason" TEXT,
  "actor_id" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "idempotency_scope" TEXT,
  "request_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_plan_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_plan_revisions_action_check" CHECK (char_length(btrim("action")) > 0)
);

CREATE TABLE "daily_cross_team_requests" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "requesting_team_id" TEXT NOT NULL,
  "target_team_id" TEXT NOT NULL,
  "employee_id" TEXT,
  "quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "daily_cross_team_request_status" NOT NULL DEFAULT 'PENDING',
  "requested_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_cross_team_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_cross_team_requests_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "daily_cross_team_requests_distinct_teams_check"
    CHECK ("requesting_team_id" <> "target_team_id"),
  CONSTRAINT "daily_cross_team_requests_reason_check" CHECK (char_length(btrim("reason")) > 0),
  CONSTRAINT "daily_cross_team_requests_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "production_teams_code_key" ON "production_teams"("code");
CREATE UNIQUE INDEX "production_teams_name_key" ON "production_teams"("name");
CREATE UNIQUE INDEX "production_teams_legacy_team_name_key" ON "production_teams"("legacy_team_name");
CREATE INDEX "production_teams_is_active_sort_order_idx" ON "production_teams"("is_active", "sort_order");

CREATE UNIQUE INDEX "production_planning_memberships_employee_id_role_scope_key_key"
  ON "production_planning_memberships"("employee_id", "role", "scope_key");
CREATE INDEX "production_planning_memberships_team_id_role_is_active_idx"
  ON "production_planning_memberships"("team_id", "role", "is_active");
CREATE INDEX "production_planning_memberships_employee_id_is_active_idx"
  ON "production_planning_memberships"("employee_id", "is_active");
CREATE INDEX "production_planning_memberships_effective_from_effective_to_idx"
  ON "production_planning_memberships"("effective_from", "effective_to");

CREATE UNIQUE INDEX "daily_organization_mutations_idempotency_key_key"
  ON "daily_organization_mutations"("idempotency_key");
CREATE INDEX "daily_org_mutations_target_created_idx"
  ON "daily_organization_mutations"("target_type", "target_id", "created_at");
CREATE INDEX "daily_organization_mutations_actor_id_created_at_idx"
  ON "daily_organization_mutations"("actor_id", "created_at");

CREATE UNIQUE INDEX "daily_production_plans_idempotency_key_key"
  ON "daily_production_plans"("idempotency_key");
CREATE UNIQUE INDEX "daily_production_plans_work_date_shift_code_team_id_key"
  ON "daily_production_plans"("work_date", "shift_code", "team_id");
CREATE INDEX "daily_production_plans_work_date_status_idx"
  ON "daily_production_plans"("work_date", "status");
CREATE INDEX "daily_production_plans_team_id_work_date_idx"
  ON "daily_production_plans"("team_id", "work_date");
CREATE INDEX "daily_production_plans_confirmed_by_id_idx"
  ON "daily_production_plans"("confirmed_by_id");

CREATE UNIQUE INDEX "daily_process_tasks_plan_id_step_id_key"
  ON "daily_process_tasks"("plan_id", "step_id");
CREATE UNIQUE INDEX "daily_process_tasks_active_step_work_date_shift_code_key"
  ON "daily_process_tasks"("step_id", "work_date", "shift_code")
  WHERE "status" <> 'CANCELLED';
CREATE INDEX "daily_process_tasks_work_date_shift_code_status_idx"
  ON "daily_process_tasks"("work_date", "shift_code", "status");
CREATE INDEX "daily_process_tasks_plan_id_status_sort_order_idx"
  ON "daily_process_tasks"("plan_id", "status", "sort_order");
CREATE INDEX "daily_process_tasks_work_order_id_status_idx"
  ON "daily_process_tasks"("work_order_id", "status");
CREATE INDEX "daily_process_tasks_route_id_route_version_idx"
  ON "daily_process_tasks"("route_id", "route_version");
CREATE INDEX "daily_process_tasks_step_id_idx" ON "daily_process_tasks"("step_id");
CREATE INDEX "daily_process_tasks_production_plan_batch_id_idx"
  ON "daily_process_tasks"("production_plan_batch_id");
CREATE INDEX "daily_process_tasks_carry_over_from_task_id_idx"
  ON "daily_process_tasks"("carry_over_from_task_id");

CREATE UNIQUE INDEX "daily_task_assignments_idempotency_key_key"
  ON "daily_task_assignments"("idempotency_key");
CREATE INDEX "daily_task_assignments_task_id_status_idx"
  ON "daily_task_assignments"("task_id", "status");
CREATE INDEX "daily_task_assignments_employee_id_status_idx"
  ON "daily_task_assignments"("employee_id", "status");
CREATE INDEX "daily_task_assignments_assigned_team_id_status_idx"
  ON "daily_task_assignments"("assigned_team_id", "status");
CREATE INDEX "daily_task_assignments_assigned_by_id_idx"
  ON "daily_task_assignments"("assigned_by_id");

CREATE UNIQUE INDEX "daily_capacity_overrides_plan_id_employee_id_key"
  ON "daily_capacity_overrides"("plan_id", "employee_id");
CREATE INDEX "daily_capacity_overrides_employee_id_idx"
  ON "daily_capacity_overrides"("employee_id");
CREATE INDEX "daily_capacity_overrides_set_by_id_idx"
  ON "daily_capacity_overrides"("set_by_id");

CREATE UNIQUE INDEX "daily_plan_revisions_idempotency_key_key"
  ON "daily_plan_revisions"("idempotency_key");
CREATE INDEX "daily_plan_revisions_plan_id_created_at_idx"
  ON "daily_plan_revisions"("plan_id", "created_at");
CREATE INDEX "daily_plan_revisions_task_id_created_at_idx"
  ON "daily_plan_revisions"("task_id", "created_at");
CREATE INDEX "daily_plan_revisions_assignment_id_idx"
  ON "daily_plan_revisions"("assignment_id");
CREATE INDEX "daily_plan_revisions_actor_id_idx"
  ON "daily_plan_revisions"("actor_id");
CREATE INDEX "daily_plan_revisions_action_created_at_idx"
  ON "daily_plan_revisions"("action", "created_at");

CREATE UNIQUE INDEX "daily_cross_team_requests_idempotency_key_key"
  ON "daily_cross_team_requests"("idempotency_key");
CREATE INDEX "daily_cross_team_requests_task_id_status_idx"
  ON "daily_cross_team_requests"("task_id", "status");
CREATE INDEX "daily_cross_team_requests_requesting_team_id_status_idx"
  ON "daily_cross_team_requests"("requesting_team_id", "status");
CREATE INDEX "daily_cross_team_requests_target_team_id_status_idx"
  ON "daily_cross_team_requests"("target_team_id", "status");
CREATE INDEX "daily_cross_team_requests_employee_id_idx"
  ON "daily_cross_team_requests"("employee_id");
CREATE INDEX "daily_cross_team_requests_requested_by_id_idx"
  ON "daily_cross_team_requests"("requested_by_id");
CREATE INDEX "daily_cross_team_requests_reviewed_by_id_idx"
  ON "daily_cross_team_requests"("reviewed_by_id");

ALTER TABLE "production_planning_memberships"
  ADD CONSTRAINT "production_planning_memberships_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_planning_memberships"
  ADD CONSTRAINT "production_planning_memberships_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "production_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_production_plans"
  ADD CONSTRAINT "daily_production_plans_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "production_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_production_plans"
  ADD CONSTRAINT "daily_production_plans_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_production_plans"
  ADD CONSTRAINT "daily_production_plans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_production_plans"
  ADD CONSTRAINT "daily_production_plans_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_process_tasks"
  ADD CONSTRAINT "daily_process_tasks_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "daily_production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_process_tasks"
  ADD CONSTRAINT "daily_process_tasks_production_plan_batch_id_fkey"
  FOREIGN KEY ("production_plan_batch_id") REFERENCES "production_plan_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_process_tasks"
  ADD CONSTRAINT "daily_process_tasks_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_process_tasks"
  ADD CONSTRAINT "daily_process_tasks_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_process_tasks"
  ADD CONSTRAINT "daily_process_tasks_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_process_tasks"
  ADD CONSTRAINT "daily_process_tasks_carry_over_from_task_id_fkey"
  FOREIGN KEY ("carry_over_from_task_id") REFERENCES "daily_process_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_task_assignments"
  ADD CONSTRAINT "daily_task_assignments_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "daily_process_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_task_assignments"
  ADD CONSTRAINT "daily_task_assignments_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_task_assignments"
  ADD CONSTRAINT "daily_task_assignments_assigned_team_id_fkey"
  FOREIGN KEY ("assigned_team_id") REFERENCES "production_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_task_assignments"
  ADD CONSTRAINT "daily_task_assignments_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_capacity_overrides"
  ADD CONSTRAINT "daily_capacity_overrides_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "daily_production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_capacity_overrides"
  ADD CONSTRAINT "daily_capacity_overrides_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_capacity_overrides"
  ADD CONSTRAINT "daily_capacity_overrides_set_by_id_fkey"
  FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_plan_revisions"
  ADD CONSTRAINT "daily_plan_revisions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "daily_production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_plan_revisions"
  ADD CONSTRAINT "daily_plan_revisions_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "daily_process_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_plan_revisions"
  ADD CONSTRAINT "daily_plan_revisions_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "daily_task_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_plan_revisions"
  ADD CONSTRAINT "daily_plan_revisions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_cross_team_requests"
  ADD CONSTRAINT "daily_cross_team_requests_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "daily_process_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_cross_team_requests"
  ADD CONSTRAINT "daily_cross_team_requests_requesting_team_id_fkey"
  FOREIGN KEY ("requesting_team_id") REFERENCES "production_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_cross_team_requests"
  ADD CONSTRAINT "daily_cross_team_requests_target_team_id_fkey"
  FOREIGN KEY ("target_team_id") REFERENCES "production_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_cross_team_requests"
  ADD CONSTRAINT "daily_cross_team_requests_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_cross_team_requests"
  ADD CONSTRAINT "daily_cross_team_requests_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_cross_team_requests"
  ADD CONSTRAINT "daily_cross_team_requests_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bootstrap teams only from active production employees with an exact,
-- non-empty Employee.team value. Team values are not trimmed or normalized.
-- Supervisors and team leaders must still be configured explicitly; no role
-- inference is performed by this migration.
WITH exact_team_values AS (
  SELECT DISTINCT "team"
  FROM "employees"
  WHERE "is_active" = true
    AND "department" = '生产部'
    AND "team" IS NOT NULL
    AND btrim("team") <> ''
), team_ids AS (
  SELECT
    "team",
    md5('production-team:' || "team") AS digest
  FROM exact_team_values
)
INSERT INTO "production_teams" (
  "id", "code", "name", "legacy_team_name", "is_active", "sort_order", "version", "created_at", "updated_at"
)
SELECT
  substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-' || substr(digest, 13, 4) || '-' || substr(digest, 17, 4) || '-' || substr(digest, 21, 12),
  'LEGACY_' || upper(substr(md5("team"), 1, 12)),
  "team",
  "team",
  true,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM team_ids
ON CONFLICT ("legacy_team_name") DO NOTHING;

WITH member_rows AS (
  SELECT
    employee."id" AS employee_id,
    team."id" AS team_id,
    md5('production-membership:' || employee."id" || ':' || team."id") AS digest
  FROM "employees" employee
  INNER JOIN "production_teams" team
    ON team."legacy_team_name" = employee."team"
  WHERE employee."is_active" = true
    AND employee."department" = '生产部'
    AND employee."team" IS NOT NULL
    AND btrim(employee."team") <> ''
)
INSERT INTO "production_planning_memberships" (
  "id", "employee_id", "team_id", "role", "scope_key", "is_active", "effective_from", "version", "created_at", "updated_at"
)
SELECT
  substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-' || substr(digest, 13, 4) || '-' || substr(digest, 17, 4) || '-' || substr(digest, 21, 12),
  employee_id,
  team_id,
  'MEMBER'::"production_planning_role",
  team_id,
  true,
  CURRENT_DATE,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM member_rows
ON CONFLICT ("employee_id", "role", "scope_key") DO NOTHING;
