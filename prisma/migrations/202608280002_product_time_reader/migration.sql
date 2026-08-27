-- A separate enum migration commits before the named grant backfill uses it.
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'PRODUCT_TIME_READER';
