-- Read-only aggregate audit before/after manual #112 cleanup. No row timestamps leave this query.
WITH checked AS (
  SELECT n, received,
    (typeof(received) != 'integer'
      OR received < 0 OR received > 253402300799999
      OR day IS NOT date(received / 1000, 'unixepoch')) AS invalid
  FROM statistics
)
SELECT (SELECT version FROM schema_version WHERE id = 1) AS schemaVersion,
  COUNT(*) AS totalRows,
  COALESCE(SUM(n), 0) AS totalCount,
  COALESCE(SUM(invalid), 0) AS invalidRows,
  COALESCE(SUM(CASE WHEN invalid = 0
    AND received != CAST(received / 86400000 AS INTEGER) * 86400000 THEN 1 ELSE 0 END), 0) AS preciseRows
FROM checked;
