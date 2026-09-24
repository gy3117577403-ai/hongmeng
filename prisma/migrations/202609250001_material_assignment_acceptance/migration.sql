-- Historical progress is preserved. Do not invent acceptance dates for old tasks.
ALTER TABLE "material_follow_up_tasks"
  ADD COLUMN "assigned_at" TIMESTAMP(3),
  ADD COLUMN "accepted_at" TIMESTAMP(3);
