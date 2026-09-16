-- Shareable ticket artwork (Section 5). The rendered PNG is cached here so
-- it's generated once per ticket, not on every view/share.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS share_image_url text;

-- Same guarded pattern as 021: the storage schema only exists on a real
-- Supabase project, not the plain Postgres CI applies migrations against.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('ticket-art', 'ticket-art', true)
    ON CONFLICT (id) DO NOTHING;

    EXECUTE 'DROP POLICY IF EXISTS "ticket_art_public_read" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "ticket_art_public_read" ON storage.objects
        FOR SELECT USING (bucket_id = 'ticket-art')
    $policy$;

    -- Written only by the share-image route, which holds the service role —
    -- the same write boundary as event-artwork and gallery in 021.
    EXECUTE 'DROP POLICY IF EXISTS "ticket_art_service_write" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "ticket_art_service_write" ON storage.objects
        FOR ALL
        USING (bucket_id = 'ticket-art' AND auth.role() = 'service_role')
        WITH CHECK (bucket_id = 'ticket-art' AND auth.role() = 'service_role')
    $policy$;
  END IF;
END $$;
