-- Content-management layer: venue-wide settings and flyer/gallery storage.
-- Section 4 of the venue OS brief — right now an event can only be created
-- by writing into the database directly. This migration adds the data side;
-- the admin screens and API routes that read/write it are Next.js code.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Venue-wide settings — one row per tenant, not per event
-- ─────────────────────────────────────────────────────────────────────────────
-- Distinct from events/ticket_types: this is the venue's standing info,
-- editable without a deploy. Default pricing here is a starting point for a
-- new event's ticket types (still overridable per event) and, later, the
-- live display value on public pages before any event-specific override
-- exists — both read this one row rather than a hardcoded frontend value.
CREATE TABLE IF NOT EXISTS venue_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL UNIQUE REFERENCES tenants(id),
  default_gate_price_pesewas  bigint NOT NULL DEFAULT 5000 CHECK (default_gate_price_pesewas >= 0),
  default_table_price_pesewas bigint NOT NULL DEFAULT 200000 CHECK (default_table_price_pesewas >= 0),
  contact_whatsapp        text,
  contact_email           text,
  contact_address         text,
  tagline                 text,
  -- Free-form so new platforms (TikTok, Threads, ...) don't need a migration.
  -- Shape: {"instagram": "https://...", "twitter": "https://...", ...}
  social_links            jsonb NOT NULL DEFAULT '{}',
  updated_by              uuid REFERENCES users(id),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE venue_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON venue_settings FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Flyer/artwork and gallery storage
-- ─────────────────────────────────────────────────────────────────────────────
-- The storage schema only exists on a real Supabase project, not on the
-- plain Postgres CI runs its migrations against (see ENGINEERS.md/CI) — this
-- block is a no-op there and takes effect on `supabase db push` against the
-- actual project.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('event-artwork', 'event-artwork', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO storage.buckets (id, name, public)
    VALUES ('gallery', 'gallery', true)
    ON CONFLICT (id) DO NOTHING;

    -- Public read (the bucket is public, so this is belt-and-braces), and
    -- writes restricted to service_role — the anon/authenticated keys never
    -- touch storage directly; every upload goes through a Next.js API route
    -- holding the service role, same as every other write in this app.
    EXECUTE 'DROP POLICY IF EXISTS "event_artwork_public_read" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "event_artwork_public_read" ON storage.objects
        FOR SELECT USING (bucket_id IN ('event-artwork', 'gallery'))
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "event_artwork_service_write" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "event_artwork_service_write" ON storage.objects
        FOR ALL
        USING (bucket_id IN ('event-artwork', 'gallery') AND auth.role() = 'service_role')
        WITH CHECK (bucket_id IN ('event-artwork', 'gallery') AND auth.role() = 'service_role')
    $policy$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Public-facing photo gallery — admin-managed, same storage pattern
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gallery_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  url           text NOT NULL,
  caption       text,
  sort_order    int NOT NULL DEFAULT 0,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gallery_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gallery_photos FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_gallery_photos_tenant ON gallery_photos (tenant_id, sort_order);
