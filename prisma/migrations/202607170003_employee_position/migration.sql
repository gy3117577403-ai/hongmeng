-- Keep job position separate from the existing team assignment.
ALTER TABLE "employees"
ADD COLUMN "position" TEXT;

CREATE INDEX "employees_position_idx" ON "employees"("position");
