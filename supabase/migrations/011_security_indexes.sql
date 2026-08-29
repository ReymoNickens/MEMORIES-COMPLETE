-- Missing indexes identified in security audit

-- ticket_access: token_hash lookups on every ticket page load were full table scans
CREATE INDEX IF NOT EXISTS idx_ticket_access_token_hash ON ticket_access(token_hash);

-- devices: key_hash lookup on every door scan was a full table scan
CREATE INDEX IF NOT EXISTS idx_devices_key_hash ON devices(key_hash) WHERE revoked_at IS NULL;

-- organiser_submissions: listing by organiser_id was a full table scan
CREATE INDEX IF NOT EXISTS idx_org_submissions_organiser ON organiser_submissions(organiser_id, tenant_id);

-- shifts: prevent two concurrent open shifts for the same tenant
-- A partial unique index enforces at most one row with closed_at IS NULL per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_tenant
  ON shifts(tenant_id)
  WHERE closed_at IS NULL;
