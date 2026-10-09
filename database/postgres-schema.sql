-- Prospector database blueprint (NOT YET APPLIED)
-- Private backend-only schema. Existing runtime still uses SQLite.
BEGIN;
CREATE SCHEMA IF NOT EXISTS prospector;
REVOKE ALL ON SCHEMA prospector FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA prospector TO service_role;
CREATE TABLE IF NOT EXISTS prospector.leads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business text NOT NULL,
 name text, instagram text UNIQUE, phone text UNIQUE, city text, segment text,
 website text, website_status text NOT NULL DEFAULT 'UNCERTAIN',
 stage text NOT NULL DEFAULT 'DISCOVERED', contact_permission boolean NOT NULL DEFAULT false,
 source text, notes text, created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.lead_origins(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid NOT NULL REFERENCES prospector.leads(id), source text NOT NULL,
 identity text NOT NULL, verified boolean NOT NULL DEFAULT false,
 details jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(lead_id,source,identity));
CREATE TABLE IF NOT EXISTS prospector.threads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid UNIQUE NOT NULL REFERENCES prospector.leads(id),
 jid text UNIQUE, manual_takeover boolean NOT NULL DEFAULT false,
 unread_count integer NOT NULL DEFAULT 0, last_message_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL REFERENCES prospector.threads(id),
 provider_id text UNIQUE, direction text NOT NULL, type text NOT NULL,
 body text, status text NOT NULL, media_id uuid, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS messages_thread_idx ON prospector.messages(thread_id,at DESC);
CREATE TABLE IF NOT EXISTS prospector.workflows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 is_default boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 steps jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS only_one_default_workflow ON prospector.workflows(is_default) WHERE is_default=true;
CREATE TABLE IF NOT EXISTS prospector.executions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid NOT NULL UNIQUE REFERENCES prospector.leads(id),
 workflow_id uuid NOT NULL REFERENCES prospector.workflows(id), version integer NOT NULL,
 steps jsonb NOT NULL, next_step integer NOT NULL DEFAULT 0,
 state text NOT NULL, wake_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid NOT NULL REFERENCES prospector.leads(id),
 execution_id uuid REFERENCES prospector.executions(id), step_index integer,
 type text NOT NULL, text text, media_id uuid, idempotency_key text NOT NULL UNIQUE,
 status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), error text);
CREATE INDEX IF NOT EXISTS jobs_pending_idx ON prospector.jobs(status,created_at);
CREATE TABLE IF NOT EXISTS prospector.initial_contacts(
 lead_id uuid PRIMARY KEY REFERENCES prospector.leads(id),
 phone text UNIQUE NOT NULL, status text NOT NULL, job_id uuid UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.suppressions(
 phone text PRIMARY KEY, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.media(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL, kind text NOT NULL, mime text NOT NULL,
 storage_path text NOT NULL, bytes bigint NOT NULL, duration numeric,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.meetings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid NOT NULL REFERENCES prospector.leads(id),
 start_at timestamptz NOT NULL, notes text, status text NOT NULL DEFAULT 'SCHEDULED',
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.settings(key text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prospector.discoveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 query text NOT NULL, found integer NOT NULL,
 status text NOT NULL, details jsonb, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS prospector.audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid REFERENCES prospector.leads(id),
 at timestamptz NOT NULL DEFAULT now(), action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb);
DO $block$
DECLARE t record;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='prospector' LOOP
   EXECUTE format('ALTER TABLE prospector.%I ENABLE ROW LEVEL SECURITY',t.tablename);
   EXECUTE format('REVOKE ALL ON TABLE prospector.%I FROM PUBLIC, anon, authenticated',t.tablename);
   EXECUTE format('GRANT ALL ON TABLE prospector.%I TO service_role',t.tablename);
 END LOOP;
END $block$;
COMMIT;
