-- ===========================================================================
-- Charter — remove the auth.users triggers
--
-- 0001 put two triggers on auth.users: one rejecting non-allowlisted
-- addresses, one creating the profile row. Both proved fragile — Supabase
-- reports any exception there as the opaque "Database error creating new
-- user", and the role performing the insert needs grants that are easy to get
-- wrong. Net effect: no account could be created at all.
--
-- They are gone. The allowlist is still enforced where it matters:
--   * public.is_owner() backs every RLS policy, so a non-allowlisted account
--     can read and write nothing.
--   * requireOwner() rejects them in the app before any page renders.
--   * signInWithOtp passes shouldCreateUser: false, and signups are disabled
--     in the Supabase dashboard, so there is no self-serve path to an account.
--
-- The profile row is now created by the app on first sign-in instead, which is
-- why profiles gains an insert policy scoped to the user's own row.
-- ===========================================================================

drop trigger if exists enforce_owner_allowlist on auth.users;
drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.enforce_owner_allowlist();
drop function if exists public.handle_new_user();

drop policy if exists "owners insert own profile" on public.profiles;
create policy "owners insert own profile"
  on public.profiles for insert
  to authenticated
  with check (public.is_owner() and id = auth.uid());
