-- Manual data-only maintenance for #112. NOT an automatic schema migration.
-- Deploy the day-precision writer first; read STATISTICS_PRECISION.md before use.
-- Invalid dates/types or an unexpected schema marker make the whole update a no-op.
UPDATE statistics
SET received = CAST(received / 86400000 AS INTEGER) * 86400000
WHERE received != CAST(received / 86400000 AS INTEGER) * 86400000
  AND EXISTS (SELECT 1 FROM schema_version WHERE id = 1 AND version = 5)
  AND NOT EXISTS (
    SELECT 1 FROM statistics
    WHERE typeof(received) != 'integer'
      OR received < 0 OR received > 253402300799999
      OR day IS NOT date(received / 1000, 'unixepoch')
  );
