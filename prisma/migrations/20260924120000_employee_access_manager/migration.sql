-- Explicit delegated account administration. No existing employee receives this automatically.
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'EMPLOYEE_ACCESS_MANAGER';
