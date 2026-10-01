-- ===========================================================================
-- Charter — remove the folder system
--
-- Folders were built in 0002 and used in Phase 6. They are being removed because
-- the interaction they existed for — dragging a contract into one — never worked
-- reliably enough to be worth keeping, and views plus tags cover the same need
-- without a tree to maintain.
--
-- OPTIONAL. The app no longer references these objects, so leaving them in place
-- costs nothing but tidiness. Run it only if you want the schema clean, and only
-- once you are sure nothing in a folder matters — dropping the column discards
-- which folder each contract was in.
-- ===========================================================================

alter table public.contracts drop column if exists folder_id;

drop table if exists public.folders cascade;

drop function if exists public.folders_no_cycle() cascade;

notify pgrst, 'reload schema';
