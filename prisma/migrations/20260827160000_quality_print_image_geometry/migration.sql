-- Dimensions describe the displayed (EXIF-oriented) original. Original S3 bytes are unchanged.
ALTER TABLE "quality_risk_attachments"
  ADD COLUMN "image_width" INTEGER,
  ADD COLUMN "image_height" INTEGER,
  ADD COLUMN "image_orientation" INTEGER,
  ADD COLUMN "print_group" TEXT;
ALTER TABLE "quality_risk_attachments" ADD CONSTRAINT "quality_image_dimensions_valid"
  CHECK (("image_width" IS NULL AND "image_height" IS NULL) OR
    ("image_width" IS NOT NULL AND "image_height" IS NOT NULL AND "image_width" > 0 AND "image_height" > 0));
ALTER TABLE "quality_risk_attachments" ADD CONSTRAINT "quality_image_orientation_valid"
  CHECK ("image_orientation" IS NULL OR "image_orientation" BETWEEN 1 AND 8);
