-- Content/branding parity pass (Section 9) against the legacy marketing
-- site. Its "Book Your Event" pitch is a public, no-login form — anyone
-- producing a night can propose one without first being handed a staff
-- account. The ported organiser pipeline (organiser_submissions,
-- /api/organiser/submissions) only ever accepted a submission from an
-- authenticated 'organiser'/'owner'/'manager' staff session, which is a
-- real functional gap versus what the legacy site actually does, not just
-- a copy/branding difference — closed here rather than left behind.
--
-- Reuses the existing review/settlement pipeline (one inbox, not a second
-- "leads" table an owner has to remember to also check) by making
-- organiser_id optional and giving a walk-in submitter somewhere to leave
-- contact details, since they have no user row for reviewed_by/host_name
-- lookups to fall back on.
ALTER TABLE organiser_submissions ALTER COLUMN organiser_id DROP NOT NULL;
ALTER TABLE organiser_submissions ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE organiser_submissions ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE organiser_submissions ADD COLUMN IF NOT EXISTS contact_instagram text;

ALTER TABLE organiser_submissions DROP CONSTRAINT IF EXISTS organiser_submissions_contact_check;
ALTER TABLE organiser_submissions ADD CONSTRAINT organiser_submissions_contact_check
  CHECK (organiser_id IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL);
