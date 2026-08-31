-- 31 Aug 2026. Reconciles a second, independent audit branch
-- (claude/continue-previous-ds4ie6) that diverged early and never merged
-- forward. Most of its findings were already fixed differently and more
-- completely by 017/018; this migration carries the small number of genuinely
-- new, non-overlapping items that survive review. See the merge commit for
-- the full account of what was and was not ported, and why.

-- Every door scan and hub redemption looks a device up by key_hash. On a
-- 200-cover night scanning at two doors, that is the single hottest query
-- against a table that otherwise has no index to serve it.
CREATE INDEX IF NOT EXISTS idx_devices_key_hash ON devices(key_hash);
