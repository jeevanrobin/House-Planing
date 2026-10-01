-- =====================================================================
--  AI Plot Planner — PostgreSQL schema
--  Target: PostgreSQL 16+. Designed for 100k+ users.
--  Run: psql "$DATABASE_URL" -f db/schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------- enums -----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE auth_provider AS ENUM ('email', 'google');
  CREATE TYPE user_role     AS ENUM ('user', 'architect', 'admin');
  CREATE TYPE plan_tier      AS ENUM ('free', 'pro', 'enterprise');
  CREATE TYPE sub_status     AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete');
  CREATE TYPE pay_status     AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
  CREATE TYPE export_format  AS ENUM ('pdf', 'png', 'svg', 'dxf');
  CREATE TYPE export_status  AS ENUM ('queued', 'processing', 'ready', 'failed');
  CREATE TYPE gen_status      AS ENUM ('queued', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- users -----------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           CITEXT UNIQUE NOT NULL,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash   TEXT,                       -- null for OAuth-only accounts
  provider        auth_provider NOT NULL DEFAULT 'email',
  google_sub      TEXT UNIQUE,                -- Google subject id
  full_name       TEXT,
  avatar_url      TEXT,
  role            user_role NOT NULL DEFAULT 'user',
  locale          TEXT NOT NULL DEFAULT 'en',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role);

-- One-time passwords for email/login verification
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  email       CITEXT NOT NULL,
  code_hash   TEXT NOT NULL,                  -- store a hash, never the raw OTP
  purpose     TEXT NOT NULL DEFAULT 'login',  -- login | verify_email | reset
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_email ON otp_codes(email, purpose);

-- Refresh-token rotation / session tracking for JWT auth
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  user_agent  TEXT,
  ip          INET,
  revoked_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- ---------- subscriptions & billing -----------------------------------
CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier                plan_tier NOT NULL DEFAULT 'free',
  status              sub_status NOT NULL DEFAULT 'active',
  provider_customer_id TEXT,                  -- Stripe/Razorpay customer id
  provider_sub_id     TEXT,
  seats               INT NOT NULL DEFAULT 1,
  current_period_end  TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_sub_user_active ON subscriptions(user_id) WHERE status IN ('active','trialing');

CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount_cents  BIGINT NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'INR',
  status        pay_status NOT NULL DEFAULT 'pending',
  provider      TEXT NOT NULL DEFAULT 'stripe',
  provider_payment_id TEXT,
  invoice_url   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_user ON payments(user_id, created_at DESC);

-- ---------- projects --------------------------------------------------
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  is_archived   BOOLEAN NOT NULL DEFAULT FALSE,
  share_token   TEXT UNIQUE,                  -- for public/share links
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_user ON projects(user_id, updated_at DESC);

-- ---------- plot data -------------------------------------------------
CREATE TABLE plots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- GeoJSON polygon of the boundary as drawn on the map
  boundary      JSONB NOT NULL,
  area_sqft     DOUBLE PRECISION NOT NULL,
  area_sqm      DOUBLE PRECISION NOT NULL,
  perimeter_m   DOUBLE PRECISION NOT NULL,
  length_m      DOUBLE PRECISION,
  width_m       DOUBLE PRECISION,
  facing        TEXT,                          -- facing_direction: N, NE, E, ...
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT,
  place_id      TEXT,                          -- Google Places id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_plots_project ON plots(project_id);
CREATE INDEX idx_plots_user ON plots(user_id);

-- ---------- requirements + floor plans (versioned) -------------------
CREATE TABLE requirements (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  payload       JSONB NOT NULL,                -- full Requirements object
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE floor_plans (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES requirements(id) ON DELETE SET NULL,
  version       INT NOT NULL DEFAULT 1,
  is_current    BOOLEAN NOT NULL DEFAULT TRUE,
  -- complete PlanResult (rooms, doors, windows, metrics) as produced by the engine
  data          JSONB NOT NULL,
  vastu_score   SMALLINT,
  built_up_sqm  DOUBLE PRECISION,
  carpet_sqm    DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_plans_project ON floor_plans(project_id, version DESC);
CREATE UNIQUE INDEX idx_plans_current ON floor_plans(project_id) WHERE is_current;

-- ---------- AI generations (audit + async jobs) ----------------------
CREATE TABLE ai_generations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  status        gen_status NOT NULL DEFAULT 'queued',
  engine        TEXT NOT NULL DEFAULT 'geometric-v1',
  input         JSONB NOT NULL,
  output        JSONB,
  duration_ms   INT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gen_user ON ai_generations(user_id, created_at DESC);

-- ---------- exports ---------------------------------------------------
CREATE TABLE exports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  floor_plan_id UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  format        export_format NOT NULL,
  status        export_status NOT NULL DEFAULT 'queued',
  file_url      TEXT,                          -- S3/CDN object url
  file_bytes    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exports_user ON exports(user_id, created_at DESC);

-- ---------- usage metering (for plan limits & analytics) -------------
CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                 -- generation | export | project_create
  quantity      INT NOT NULL DEFAULT 1,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_user_time ON usage_events(user_id, created_at);

-- ---------- updated_at trigger ---------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','subscriptions','projects'] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
  END LOOP;
END $$;
