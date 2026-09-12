ALTER TABLE "material_library_photos"
 ADD COLUMN "deleted_by_name" TEXT,
 ADD COLUMN "deleted_reason" TEXT,
 ADD COLUMN "client_mutation_id" TEXT,
 ADD COLUMN "thumbnail_key" TEXT,
 ADD COLUMN "thumbnail_size" INTEGER,
 ADD COLUMN "preview_key" TEXT,
 ADD COLUMN "preview_size" INTEGER,
 ADD COLUMN "media_status" TEXT NOT NULL DEFAULT 'PENDING',
 ADD COLUMN "media_attempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "media_next_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "media_lease" TEXT,
 ADD COLUMN "media_lease_until" TIMESTAMP(3),
 ADD COLUMN "media_error" TEXT;
CREATE UNIQUE INDEX "material_library_photos_session_id_client_mutation_id_key" ON "material_library_photos"("session_id", "client_mutation_id");
CREATE INDEX "material_library_photos_media_status_media_next_at_idx" ON "material_library_photos"("media_status", "media_next_at");
