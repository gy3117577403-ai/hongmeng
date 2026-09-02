-- Keep one canonical identity for newly created or renamed process names.
-- Existing rows remain nullable and are claimed lazily so this migration can
-- be applied safely even if historical data contains duplicate display names.
ALTER TABLE "process_definitions" ADD COLUMN "name_key" TEXT;

CREATE UNIQUE INDEX "process_definitions_name_key_key" ON "process_definitions"("name_key");
