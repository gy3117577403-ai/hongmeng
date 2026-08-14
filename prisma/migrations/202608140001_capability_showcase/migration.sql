CREATE TABLE "capability_showcase_sites" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL DEFAULT 'default',
  "draft_revision" INTEGER NOT NULL DEFAULT 1,
  "draft" JSONB NOT NULL,
  "published_revision" INTEGER,
  "published_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "capability_showcase_sites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capability_showcase_publications" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capability_showcase_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capability_showcase_media" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "display_name" TEXT,
  "mime_type" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "alt_text" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "capability_showcase_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capability_showcase_shares" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "last_accessed_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capability_showcase_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capability_showcase_sites_key_key" ON "capability_showcase_sites"("key");
CREATE UNIQUE INDEX "capability_showcase_publications_site_id_revision_key" ON "capability_showcase_publications"("site_id", "revision");
CREATE INDEX "capability_showcase_publications_site_id_created_at_idx" ON "capability_showcase_publications"("site_id", "created_at");
CREATE UNIQUE INDEX "capability_showcase_media_object_key_key" ON "capability_showcase_media"("object_key");
CREATE INDEX "capability_showcase_media_site_id_deleted_at_created_at_idx" ON "capability_showcase_media"("site_id", "deleted_at", "created_at");
CREATE UNIQUE INDEX "capability_showcase_shares_token_hash_key" ON "capability_showcase_shares"("token_hash");
CREATE INDEX "capability_showcase_shares_site_id_revoked_at_created_at_idx" ON "capability_showcase_shares"("site_id", "revoked_at", "created_at");
CREATE INDEX "capability_showcase_shares_expires_at_idx" ON "capability_showcase_shares"("expires_at");

ALTER TABLE "capability_showcase_publications"
  ADD CONSTRAINT "capability_showcase_publications_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "capability_showcase_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capability_showcase_media"
  ADD CONSTRAINT "capability_showcase_media_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "capability_showcase_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capability_showcase_shares"
  ADD CONSTRAINT "capability_showcase_shares_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "capability_showcase_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
