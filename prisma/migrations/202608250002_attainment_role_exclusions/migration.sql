-- Supervisors, team leaders and reserve trainees remain in attendance, but
-- are not eligible for the production employee attainment matrix.
UPDATE "employees"
SET
  "attainment_eligible" = FALSE,
  "attainment_factor_basis_points" = 0,
  "attainment_stream" = 'excluded'
WHERE (COALESCE("position", '') || ' ' || COALESCE("team", '')) ~ '(主管|组长|储备生)';
