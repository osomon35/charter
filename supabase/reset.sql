-- ===========================================================================
-- Charter — full teardown of everything the migrations created.
--
-- Run this to get back to a virgin database. It is the control case: if a user
-- still cannot be created afterwards, nothing in this repo is the cause.
--
-- Also restores the default grants on schema public, which 0001 revoked from
-- anon. That revoke was speculative hardening and is not worth the risk of
-- interfering with Supabase's own internals.
-- ===========================================================================

drop trigger if exists enforce_owner_allowlist on auth.users;
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.profiles cascade;
drop table if exists public.rate_limits cascade;
drop table if exists public.owner_allowlist cascade;

drop function if exists public.enforce_owner_allowlist() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.is_owner() cascade;
drop function if exists public.consume_rate_limit(text, integer, integer) cascade;
drop function if exists public.prune_rate_limits() cascade;

-- Undo the anon revokes from 0001.
alter default privileges in schema public grant all on tables to anon;
alter default privileges in schema public grant all on functions to anon;
alter default privileges in schema public grant all on sequences to anon;
grant usage on schema public to anon, authenticated, service_role;
