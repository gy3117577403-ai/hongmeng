-- Link quantity reversals to the exact movement they offset. Existing
-- completion, movement, and labor facts remain unchanged.
ALTER TABLE "process_quantity_movements"
  ADD COLUMN "reversal_of_id" TEXT;

CREATE INDEX "process_quantity_movements_reversal_of_id_idx"
  ON "process_quantity_movements"("reversal_of_id");

ALTER TABLE "process_quantity_movements"
  ADD CONSTRAINT "process_quantity_movements_reversal_of_id_fkey"
  FOREIGN KEY ("reversal_of_id") REFERENCES "process_quantity_movements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
