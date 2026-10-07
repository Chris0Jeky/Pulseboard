/** Named-operation v1 query. Receipt time chooses membership; sequence chooses pairing.
 * Collapse equal sequences before looking ahead: a terminal at a start's sequence
 * cannot resolve it, nor the previous start. Repeated starts remain open attempts.
 * Conflicting terminals at one sequence use storage order as a deterministic tie
 * break, not as proof of client chronology. All unconsumed terminal events remain
 * counted, including terminal-only releases. No event identities leave this query.
 */
export function operationQuery(db, operation, start, end) {
  return db.prepare(`WITH moments AS (
    SELECT project,session,route,release,seq,
      SUM(CASE WHEN event=? THEN 1 ELSE 0 END) AS starts,
      MIN(CASE WHEN event=? THEN rowid END) AS completed_row,
      MIN(CASE WHEN event=? THEN rowid END) AS failed_row,
      SUM(CASE WHEN event=? THEN 1 ELSE 0 END) AS completed_events,
      SUM(CASE WHEN event=? THEN 1 ELSE 0 END) AS failed_events
    FROM events WHERE project=? AND received>=? AND received<? AND event IN (?,?,?)
    GROUP BY project,session,route,release,seq
  ), kinds AS (
    SELECT *,CASE WHEN starts>0 THEN 'start'
      WHEN completed_row IS NOT NULL AND (failed_row IS NULL OR completed_row<failed_row)
      THEN 'completed' ELSE 'failed' END AS kind FROM moments
  ), following AS (
    SELECT *,LEAD(kind) OVER sequence_window AS next_kind,
      MAX(starts) OVER (sequence_window ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS later_start
    FROM kinds WINDOW sequence_window AS (PARTITION BY project,session,route,release ORDER BY seq)
  ), paired AS (
    SELECT *,
      CASE WHEN starts>0 AND next_kind='completed' THEN 1 ELSE 0 END AS paired_completed,
      CASE WHEN starts>0 AND next_kind='failed' THEN 1 ELSE 0 END AS paired_failed
    FROM following
  ) SELECT release,SUM(starts) AS attempts,
    SUM(paired_completed) AS completed,
    SUM(paired_failed) AS failed,
    SUM(starts-paired_completed-paired_failed) AS open,
    SUM(CASE WHEN starts>0 THEN starts-1+CASE
      WHEN later_start>0 AND (next_kind IS NULL OR next_kind!='completed') THEN 1 ELSE 0 END
      ELSE 0 END) AS retries,
    SUM(completed_events)-SUM(paired_completed) AS unmatched_completed,
    SUM(failed_events)-SUM(paired_failed) AS unmatched_failed
    FROM paired GROUP BY release ORDER BY release`)
    .bind(operation.started, operation.completed, operation.failed, operation.completed, operation.failed,
      operation.project, start, end, operation.started, operation.completed, operation.failed);
}
