CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT rate_limits_count_nonnegative CHECK (count >= 0)
);

CREATE INDEX rate_limits_window_start_idx ON rate_limits (window_start);

WITH ranked_active_runs AS (
  SELECT id,
         row_number() OVER (PARTITION BY cache_key ORDER BY created_at, id) AS rank
  FROM osint_runs
  WHERE cache_key IS NOT NULL AND status IN ('queued', 'running')
)
UPDATE osint_runs
SET status = 'failed',
    step = 'failed',
    error = 'Duplicate active OSINT request closed during migration',
    finished_at = now()
WHERE id IN (SELECT id FROM ranked_active_runs WHERE rank > 1);

CREATE UNIQUE INDEX osint_runs_active_cache_key_unique_idx
  ON osint_runs (cache_key)
  WHERE cache_key IS NOT NULL AND status IN ('queued', 'running');
