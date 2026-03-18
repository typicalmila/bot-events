-- supabase/migrations/001_initial_schema.sql

-- Enums
CREATE TYPE event_category AS ENUM ('marketing','sales','analytics','ai','culture','other');
CREATE TYPE event_format AS ENUM ('online','offline','hybrid');
CREATE TYPE price_type AS ENUM ('free','paid');

-- Events table
CREATE TABLE events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  category         event_category NOT NULL,
  format           event_format NOT NULL,
  price_type       price_type NOT NULL DEFAULT 'free',
  price_amount     int CHECK (price_amount IS NULL OR price_amount >= 0),
  price_currency   text NOT NULL DEFAULT 'RUB' CHECK (price_currency = 'RUB'),
  event_date       timestamptz NOT NULL,
  speakers         text[] DEFAULT '{}',
  url              text NOT NULL,
  cover_image_url  text,
  source           text NOT NULL,
  source_event_id  text NOT NULL,
  is_approved      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_event_id)
);

-- Index for keyset pagination
CREATE INDEX events_date_id_idx ON events (event_date ASC, id ASC)
  WHERE is_approved = true;

-- Saved events
CREATE TABLE saved_events (
  user_id   bigint NOT NULL,
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;

-- events: anyone can read approved future events
CREATE POLICY "events_select" ON events
  FOR SELECT USING (is_approved = true AND event_date >= now());

-- saved_events: user sees/modifies only their own rows
CREATE POLICY "saved_events_select" ON saved_events
  FOR SELECT USING (
    user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::bigint
  );
CREATE POLICY "saved_events_insert" ON saved_events
  FOR INSERT WITH CHECK (
    user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::bigint
  );
CREATE POLICY "saved_events_delete" ON saved_events
  FOR DELETE USING (
    user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::bigint
  );
