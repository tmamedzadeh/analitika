CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE TYPE document_status AS ENUM ('queued', 'processing', 'ready', 'failed');
--> statement-breakpoint
CREATE TYPE osint_run_status AS ENUM ('queued', 'running', 'done', 'failed');
--> statement-breakpoint
CREATE TYPE osint_source_type AS ENUM ('media', 'official', 'think_tank', 'other');
--> statement-breakpoint

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  doc_date date,
  tags text[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'az',
  classification text NOT NULL DEFAULT 'open',
  source_reliability char(1) NOT NULL DEFAULT 'F',
  info_credibility smallint NOT NULL DEFAULT 6,
  owner_id text NOT NULL DEFAULT 'admin',
  status document_status NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_classification_check
    CHECK (classification IN ('open', 'secret', 'top_secret', 'special')),
  CONSTRAINT documents_source_reliability_check
    CHECK (source_reliability IN ('A', 'B', 'C', 'D', 'E', 'F')),
  CONSTRAINT documents_info_credibility_check
    CHECK (info_credibility BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE INDEX documents_status_created_idx ON documents (status, created_at);
--> statement-breakpoint
CREATE INDEX documents_doc_date_idx ON documents (doc_date);
--> statement-breakpoint

CREATE TABLE document_acl (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  PRIMARY KEY (document_id, user_id)
);
--> statement-breakpoint

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord integer NOT NULL,
  section_title text NOT NULL DEFAULT '',
  text text NOT NULL,
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  is_table boolean NOT NULL DEFAULT false,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, text)) STORED,
  embedding vector(768),
  embedding_model text NOT NULL,
  CONSTRAINT chunks_document_ord_unique UNIQUE (document_id, ord),
  CONSTRAINT chunks_char_range_check CHECK (char_start <= char_end)
);
--> statement-breakpoint
CREATE INDEX chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX chunks_tsv_gin_idx ON chunks USING gin (tsv);
--> statement-breakpoint
CREATE INDEX chunks_text_trgm_gin_idx ON chunks USING gin (text gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX chunks_document_idx ON chunks (document_id);
--> statement-breakpoint

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  mime text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  caption text
);
--> statement-breakpoint
CREATE INDEX attachments_document_idx ON attachments (document_id);
--> statement-breakpoint

CREATE TABLE info_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  request_date date NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('normal', 'urgent', 'critical')),
  purpose text NOT NULL,
  details text NOT NULL,
  source_reliability char(1) NOT NULL DEFAULT 'F'
    CHECK (source_reliability IN ('A', 'B', 'C', 'D', 'E', 'F')),
  info_credibility smallint NOT NULL DEFAULT 6
    CHECK (info_credibility BETWEEN 1 AND 6),
  note text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'answered', 'rejected')),
  answer_document_id uuid REFERENCES documents(id),
  requester_id text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX info_requests_created_idx ON info_requests (created_at);
--> statement-breakpoint

CREATE TABLE request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES info_requests(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL CHECK (size >= 0)
);
--> statement-breakpoint
CREATE INDEX request_attachments_request_idx ON request_attachments (request_id);
--> statement-breakpoint

CREATE TABLE osint_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  languages text[] NOT NULL DEFAULT '{}',
  period text NOT NULL,
  status osint_run_status NOT NULL DEFAULT 'queued',
  step text NOT NULL DEFAULT 'queued',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  error text,
  cache_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX osint_runs_created_idx ON osint_runs (created_at);
--> statement-breakpoint

CREATE TABLE osint_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES osint_runs(id) ON DELETE CASCADE,
  n integer NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  domain text NOT NULL,
  language text NOT NULL,
  published_at timestamptz,
  source_type osint_source_type NOT NULL DEFAULT 'other',
  summary text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  fetched boolean NOT NULL DEFAULT false,
  CONSTRAINT osint_sources_run_n_unique UNIQUE (run_id, n)
);
--> statement-breakpoint
CREATE INDEX osint_sources_run_idx ON osint_sources (run_id);
--> statement-breakpoint

CREATE TABLE osint_cache (
  cache_key text PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES osint_runs(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX osint_cache_expires_idx ON osint_cache (expires_at);
--> statement-breakpoint

CREATE TABLE query_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  query text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  chunk_ids uuid[] NOT NULL DEFAULT '{}',
  answer text NOT NULL,
  model text NOT NULL,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE eval_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE eval_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_set_id uuid NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
  question text NOT NULL,
  expected_answer text,
  expected_chunk_ids uuid[] NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX eval_questions_set_idx ON eval_questions (eval_set_id);
--> statement-breakpoint

CREATE TABLE eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_set_id uuid NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX eval_runs_set_idx ON eval_runs (eval_set_id);
--> statement-breakpoint

CREATE TABLE eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES eval_questions(id) ON DELETE CASCADE,
  answer text,
  score real,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT eval_results_run_question_unique UNIQUE (run_id, question_id)
);
--> statement-breakpoint
