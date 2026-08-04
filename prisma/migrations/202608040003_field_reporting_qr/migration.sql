CREATE TYPE "process_completion_source" AS ENUM ('DESKTOP', 'QR_MOBILE');
CREATE TYPE "work_order_qr_ticket_status" AS ENUM ('ACTIVE', 'REVOKED');

ALTER TABLE "process_completions"
  ADD COLUMN "report_source" "process_completion_source" NOT NULL DEFAULT 'DESKTOP';

CREATE TABLE "work_order_qr_tickets" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "work_order_id" TEXT NOT NULL,
  "public_code" TEXT NOT NULL,
  "status" "work_order_qr_ticket_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" TEXT,
  "last_scanned_at" TIMESTAMP(3),
  "scan_count" INTEGER NOT NULL DEFAULT 0,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_qr_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_qr_prints" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "ticket_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "route_version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "printed_by_id" TEXT,
  "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_qr_prints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_order_qr_tickets_work_order_id_key"
  ON "work_order_qr_tickets"("work_order_id");
CREATE UNIQUE INDEX "work_order_qr_tickets_public_code_key"
  ON "work_order_qr_tickets"("public_code");
CREATE INDEX "work_order_qr_tickets_status_idx"
  ON "work_order_qr_tickets"("status");
CREATE INDEX "work_order_qr_tickets_created_by_id_idx"
  ON "work_order_qr_tickets"("created_by_id");
CREATE INDEX "work_order_qr_tickets_last_scanned_at_idx"
  ON "work_order_qr_tickets"("last_scanned_at");
CREATE INDEX "work_order_qr_prints_ticket_id_printed_at_idx"
  ON "work_order_qr_prints"("ticket_id", "printed_at");
CREATE INDEX "work_order_qr_prints_route_id_route_version_idx"
  ON "work_order_qr_prints"("route_id", "route_version");
CREATE INDEX "work_order_qr_prints_printed_by_id_idx"
  ON "work_order_qr_prints"("printed_by_id");

ALTER TABLE "work_order_qr_tickets"
  ADD CONSTRAINT "work_order_qr_tickets_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_qr_tickets"
  ADD CONSTRAINT "work_order_qr_tickets_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_qr_prints"
  ADD CONSTRAINT "work_order_qr_prints_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "work_order_qr_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_qr_prints"
  ADD CONSTRAINT "work_order_qr_prints_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_qr_prints"
  ADD CONSTRAINT "work_order_qr_prints_printed_by_id_fkey"
  FOREIGN KEY ("printed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
