-- Retain the explicitly selected source even for action-only reports that do not yet credit any whole product.
ALTER TABLE "process_completions" ADD COLUMN "reporting_wip_allocation_id" TEXT;
