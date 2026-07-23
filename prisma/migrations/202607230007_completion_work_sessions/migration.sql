ALTER TABLE "process_completions"
ADD COLUMN "work_started_at" TIMESTAMP(3),
ADD COLUMN "work_ended_at" TIMESTAMP(3),
ADD COLUMN "team" TEXT,
ADD COLUMN "workstation" TEXT,
ADD COLUMN "remark" TEXT;

CREATE TABLE "process_completion_participants" (
    "id" TEXT NOT NULL,
    "completion_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_completion_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "process_completion_participants_completion_id_employee_id_key"
ON "process_completion_participants"("completion_id", "employee_id");

CREATE INDEX "process_completion_participants_employee_id_created_at_idx"
ON "process_completion_participants"("employee_id", "created_at");

ALTER TABLE "process_completion_participants"
ADD CONSTRAINT "process_completion_participants_completion_id_fkey"
FOREIGN KEY ("completion_id") REFERENCES "process_completions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_completion_participants"
ADD CONSTRAINT "process_completion_participants_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
