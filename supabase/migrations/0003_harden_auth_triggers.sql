-- ===========================================================================
-- Charter — harden the auth.users triggers
--
-- Supabase reports any exception raised during a user insert as the opaque
-- "Database error creating new user", which makes these triggers hard to
-- debug. Two changes:
--
--   1. supabase_auth_admin (the role that performs the insert) is granted
--      what it needs to reach the trigger functions at all. Without schema
--      USAGE and EXECUTE it fails before either function runs.
--   2. handle_new_user() no longer aborts the transaction. A missing profile
--      row is recoverable — requireOwner() falls back to the JWT email — so
--      failing to create one must never stop an account being created.
--
-- The allowlist trigger stays fatal. Rejecting the insert is its whole job.
-- ===========================================================================

grant usage on schema public to supabase_auth_admin;
grant execute on function public.enforce_owner_allowlist() to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    insert into public.profiles (id, email, full_name)
    values (
      new.id,
      lower(new.email),
      nullif(new.raw_user_meta_data ->> 'full_name', '')
    )
    on conflict (id) do nothing;
  exception when others then
    -- Visible in Supabase → Logs → Postgres, but not fatal.
    raise warning 'charter: profile creation failed for % (%): %',
      new.id, sqlstate, sqlerrm;
  end;
  return new;
end;
$$;
