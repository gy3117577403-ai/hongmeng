-- Link drawing library files back to the production resource file they were synced from.
-- This keeps sync idempotent without duplicating S3 objects.
ALTER TABLE "drawing_library_files" ADD COLUMN "source_resource_file_id" TEXT;

CREATE UNIQUE INDEX "drawing_library_files_source_resource_file_id_key"
ON "drawing_library_files"("source_resource_file_id");

ALTER TABLE "drawing_library_files"
ADD CONSTRAINT "drawing_library_files_source_resource_file_id_fkey"
FOREIGN KEY ("source_resource_file_id")
REFERENCES "resource_files"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
