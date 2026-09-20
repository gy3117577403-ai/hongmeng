ALTER TABLE "QfSettings" ADD COLUMN "technicalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "QfDocumentReturn" (
  "id" TEXT NOT NULL,
  "libraryItemId" TEXT NOT NULL,
  "sourcePackageId" TEXT NOT NULL,
  "submittedPackageId" TEXT,
  "fileId" TEXT,
  "fileSnapshot" JSONB NOT NULL,
  "kind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "location" TEXT NOT NULL DEFAULT '',
  "attachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reviewRole" TEXT NOT NULL,
  "returnedById" TEXT NOT NULL,
  "returnedByName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "responseMode" TEXT,
  "responseText" TEXT NOT NULL DEFAULT '',
  "responseFileId" TEXT,
  "responseAttachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "respondedById" TEXT,
  "respondedByName" TEXT NOT NULL DEFAULT '',
  "respondedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QfDocumentReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QfDocumentReturn_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QfDocumentReturn_sourcePackageId_fkey" FOREIGN KEY ("sourcePackageId") REFERENCES "QfPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QfDocumentReturn_submittedPackageId_fkey" FOREIGN KEY ("submittedPackageId") REFERENCES "QfPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QfDocumentReturn_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "drawing_library_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QfDocumentReturn_responseFileId_fkey" FOREIGN KEY ("responseFileId") REFERENCES "drawing_library_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "QfDocumentReturn_libraryItemId_status_idx" ON "QfDocumentReturn"("libraryItemId", "status");
CREATE INDEX "QfDocumentReturn_submittedPackageId_status_idx" ON "QfDocumentReturn"("submittedPackageId", "status");
CREATE INDEX "QfDocumentReturn_status_createdAt_idx" ON "QfDocumentReturn"("status", "createdAt");

CREATE TABLE "QfReviewAttachment" (
  "id" TEXT NOT NULL,
  "libraryItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QfReviewAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QfReviewAttachment_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QfReviewAttachment_objectKey_key" ON "QfReviewAttachment"("objectKey");
CREATE INDEX "QfReviewAttachment_libraryItemId_createdAt_idx" ON "QfReviewAttachment"("libraryItemId", "createdAt");

-- An old return did not identify a file. Preserve it honestly as a package issue.
-- Only the latest still-returned round is an outstanding task; signed history is untouched.
INSERT INTO "QfDocumentReturn" (
  "id", "libraryItemId", "sourcePackageId", "fileSnapshot", "kind", "reason",
  "reviewRole", "returnedById", "returnedByName", "createdAt", "updatedAt"
)
SELECT 'legacy-return:' || p."id", p."libraryItemId", p."id",
  jsonb_build_object('name', '历史整包退回（未指定文件）', 'version', p."revision", 'drawingFiles', p."drawingFiles", 'sopFiles', p."sopFiles"),
  'package', COALESCE(NULLIF(p."reason", ''), '历史退回未记录详细原因，请核对原审核履历'),
  COALESCE(e."snapshot"->>'reviewRole', 'LEGACY'), COALESCE(e."actorId", p."createdById"),
  COALESCE(e."actorName", '历史审核'), COALESCE(e."createdAt", p."updatedAt"), p."updatedAt"
FROM "QfPackage" p
LEFT JOIN LATERAL (
  SELECT "snapshot", "actorId", "actorName", "createdAt" FROM "QfEvent"
  WHERE "entityType" = 'PACKAGE' AND "entityId" = p."id" AND "action" = 'RETURN'
  ORDER BY "createdAt" DESC LIMIT 1
) e ON TRUE
WHERE p."status" = 'RETURNED' AND NOT EXISTS (
  SELECT 1 FROM "QfPackage" newer WHERE newer."libraryItemId" = p."libraryItemId" AND newer."sequence" > p."sequence"
);
