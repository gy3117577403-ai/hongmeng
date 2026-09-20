CREATE TABLE "QfPreparation" (
  "libraryItemId" TEXT NOT NULL,
  "bomFileId" TEXT,
  "bomRows" JSONB NOT NULL DEFAULT '[]',
  "bomMapping" JSONB,
  "bomConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "parallelCount" INTEGER NOT NULL DEFAULT 1,
  "spareCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QfPreparation_pkey" PRIMARY KEY ("libraryItemId"),
  CONSTRAINT "QfPreparation_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QfPreparation_bomFileId_fkey" FOREIGN KEY ("bomFileId") REFERENCES "QfBomFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy the latest preparation; never rewrite signed package evidence or print snapshots.
INSERT INTO "QfPreparation" ("libraryItemId", "bomFileId", "bomRows", "bomMapping", "bomConfirmed", "parallelCount", "spareCount", "updatedById", "createdAt", "updatedAt")
SELECT DISTINCT ON ("libraryItemId") "libraryItemId", "bomFileId", "bomRows", "bomMapping", "bomConfirmed", "parallelCount", "spareCount", "createdById", "createdAt", "updatedAt"
FROM "QfPackage" ORDER BY "libraryItemId", "sequence" DESC;
