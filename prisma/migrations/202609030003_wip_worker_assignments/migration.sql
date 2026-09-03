CREATE TABLE "wip_week_allocation_workers" (
    "id" TEXT NOT NULL,
    "allocation_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "active_key" TEXT,
    "assigned_by_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wip_week_allocation_workers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wip_week_allocation_workers_active_key_key"
ON "wip_week_allocation_workers"("active_key");

CREATE INDEX "wip_week_allocation_workers_allocation_id_status_position_idx"
ON "wip_week_allocation_workers"("allocation_id", "status", "position");

CREATE INDEX "wip_week_allocation_workers_employee_id_status_idx"
ON "wip_week_allocation_workers"("employee_id", "status");

CREATE INDEX "wip_week_allocation_workers_assigned_by_id_idx"
ON "wip_week_allocation_workers"("assigned_by_id");

CREATE INDEX "wip_week_allocation_workers_cancelled_by_id_idx"
ON "wip_week_allocation_workers"("cancelled_by_id");

ALTER TABLE "wip_week_allocation_workers"
ADD CONSTRAINT "wip_week_allocation_workers_allocation_id_fkey"
FOREIGN KEY ("allocation_id") REFERENCES "wip_week_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_week_allocation_workers"
ADD CONSTRAINT "wip_week_allocation_workers_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_week_allocation_workers"
ADD CONSTRAINT "wip_week_allocation_workers_assigned_by_id_fkey"
FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_week_allocation_workers"
ADD CONSTRAINT "wip_week_allocation_workers_cancelled_by_id_fkey"
FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
