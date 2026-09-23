-- Existing grants remain unchanged. A module plan is adopted only on explicit save.
ALTER TYPE "AccessProfileKey" ADD VALUE IF NOT EXISTS 'MODULE_ACCESS';
