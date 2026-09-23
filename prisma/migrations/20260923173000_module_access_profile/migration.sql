-- Existing grants remain unchanged. A module plan is adopted only on explicit save.
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'MODULE_ACCESS';
