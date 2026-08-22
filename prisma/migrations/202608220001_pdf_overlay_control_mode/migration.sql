-- Preserve the controlled/uncontrolled classification on each published PDF
-- overlay version. Existing versions remain explicitly uncontrolled.
ALTER TABLE "pdf_overlay_versions"
ADD COLUMN "control_mode" TEXT NOT NULL DEFAULT 'uncontrolled';
