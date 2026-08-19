-- Functional access profiles are additive. Existing department, production,
-- administrator and field-report grants retain their behavior.
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'DRAWING_LIBRARY_READER';
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'DRAWING_LIBRARY_EDITOR';
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'REPORT_PEOPLE_READER';
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'QUALITY_REVIEWER';

-- PostgreSQL cannot safely use freshly-added enum values in the same
-- transaction on all supported server versions. Account backfill is performed
-- by the following migration, after this enum migration commits.
