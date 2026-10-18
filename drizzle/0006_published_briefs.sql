UPDATE daily_briefs
SET status = 'published',
    published_at = COALESCE(published_at, updated_at, created_at),
    index_status = CASE WHEN index_status = 'ready' THEN 'ready' ELSE 'queued' END,
    updated_at = now();

ALTER TABLE daily_briefs
  ALTER COLUMN status SET DEFAULT 'published';

ALTER TABLE daily_briefs
  DROP CONSTRAINT daily_briefs_status_check;

ALTER TABLE daily_briefs
  ADD CONSTRAINT daily_briefs_status_check CHECK (status = 'published');
