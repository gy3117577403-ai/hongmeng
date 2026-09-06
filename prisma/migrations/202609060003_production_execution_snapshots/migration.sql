CREATE TABLE "production_execution_snapshots" (
  "id" TEXT NOT NULL,
  "query_key" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "row_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_execution_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "production_execution_snapshots_expires_at_idx" ON "production_execution_snapshots"("expires_at");
CREATE TABLE "production_execution_snapshot_rows" (
  "snapshot_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "production_execution_snapshot_rows_pkey" PRIMARY KEY ("snapshot_id", "ordinal"),
  CONSTRAINT "production_execution_snapshot_rows_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "production_execution_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
