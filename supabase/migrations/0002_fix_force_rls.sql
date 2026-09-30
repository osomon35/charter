-- ===========================================================================
-- Charter — fix: FORCE ROW LEVEL SECURITY blocked the internal triggers
--
-- 0001 set "force row level security" on three tables. FORCE makes RLS apply
-- to the table owner as well, which broke the two SECURITY DEFINER functions
-- that run as that owner and are the only things allowed to write these rows:
--
--   * handle_new_user() inserts into profiles      -> user creation failed
--     ("Database error creating new user")
--   * consume_rate_limit() inserts into rate_limits -> login would have
--     failed closed with "temporarily unavailable"
--
-- Dropping FORCE restores the normal Postgres rule: the owner bypasses RLS,
-- every other role (anon, authenticated) is still fully subject to it. The
-- policies from 0001 are unchanged, so nothing is loosened for API callers.
-- ===========================================================================

alter table public.profiles         no force row level security;
alter table public.rate_limits      no force row level security;
alter table public.owner_allowlist  no force row level security;

-- RLS itself stays on, deny-by-default, for all API roles.
alter table public.profiles         enable row level security;
alter table public.rate_limits      enable row level security;
alter table public.owner_allowlist  enable row level security;
