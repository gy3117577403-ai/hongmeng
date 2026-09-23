-- Independent mobile read access; existing account grants are unchanged.
ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'SAMPLE_LIBRARY_READER';
