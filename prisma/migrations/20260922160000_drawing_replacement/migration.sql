ALTER TABLE "drawing_library_items" ADD COLUMN "needs_confirmation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drawing_library_files" ADD COLUMN "retired_for_replacement_at" TIMESTAMP(3), ADD COLUMN "first_uploaded_at" TIMESTAMP(3);
CREATE TABLE "drawing_replacement_jobs" (
 "id" TEXT PRIMARY KEY, "sourceFileId" TEXT NOT NULL UNIQUE, "replacementFileId" TEXT NOT NULL UNIQUE,
 "libraryItemId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL, "reason" TEXT NOT NULL DEFAULT '',
 "objectKeys" JSONB NOT NULL, "syncPending" BOOLEAN NOT NULL DEFAULT true, "purgePending" BOOLEAN NOT NULL DEFAULT true,
 "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "drawing_replacement_jobs_syncPending_retryAt_idx" ON "drawing_replacement_jobs"("syncPending", "retryAt");
CREATE INDEX "drawing_replacement_jobs_purgePending_retryAt_idx" ON "drawing_replacement_jobs"("purgePending", "retryAt");
