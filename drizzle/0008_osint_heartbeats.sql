ALTER TABLE osint_runs ADD COLUMN heartbeat_at timestamptz;

UPDATE osint_runs
SET heartbeat_at = created_at
WHERE heartbeat_at IS NULL;

CREATE INDEX osint_runs_active_heartbeat_idx
  ON osint_runs (heartbeat_at)
  WHERE status IN ('queued', 'running');
