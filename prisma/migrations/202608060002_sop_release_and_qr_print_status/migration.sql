CREATE TYPE "work_order_qr_print_status" AS ENUM ('GENERATED', 'CONFIRMED', 'LEGACY_UNVERIFIED');
CREATE TYPE "work_order_qr_print_mode" AS ENUM ('TRAVELER_ONLY', 'TRAVELER_SOP_DUPLEX', 'TRAVELER_SOP_SEPARATE');

ALTER TABLE "work_order_qr_prints"
  ADD COLUMN "status" "work_order_qr_print_status" NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN "mode" "work_order_qr_print_mode" NOT NULL DEFAULT 'TRAVELER_ONLY',
  ADD COLUMN "copies" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "drawing_file_id" TEXT,
  ADD COLUMN "drawing_file_version" TEXT,
  ADD COLUMN "sop_file_id" TEXT,
  ADD COLUMN "sop_file_version" TEXT,
  ADD COLUMN "packet_hash" TEXT,
  ADD COLUMN "reprint_reason" TEXT,
  ADD COLUMN "confirmed_by_id" TEXT,
  ADD COLUMN "confirmed_at" TIMESTAMP(3);

-- Historical rows were created when opening the print preview. They cannot be
-- safely treated as physically printed, so retain them as auditable legacy data.
UPDATE "work_order_qr_prints" SET "status" = 'LEGACY_UNVERIFIED';

ALTER TABLE "work_order_qr_prints"
  ADD CONSTRAINT "work_order_qr_prints_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "work_order_qr_prints_ticket_id_status_confirmed_at_idx"
  ON "work_order_qr_prints"("ticket_id", "status", "confirmed_at");
CREATE INDEX "work_order_qr_prints_confirmed_by_id_idx" ON "work_order_qr_prints"("confirmed_by_id");
CREATE INDEX "work_order_qr_prints_drawing_file_id_idx" ON "work_order_qr_prints"("drawing_file_id");
CREATE INDEX "work_order_qr_prints_sop_file_id_idx" ON "work_order_qr_prints"("sop_file_id");
