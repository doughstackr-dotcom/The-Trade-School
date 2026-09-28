-- Profiles: signed-in users may change only their display name.
--
-- 20260927180000_accounts_and_billing.sql left the table-wide UPDATE privilege that Supabase
-- grants to `authenticated` by default, so the "Users update their own profile" policy let a
-- user rewrite every column of their own row (id, created_at, updated_at), not just the
-- name. Replace it with a column-level grant; the RLS policy (own row only) stays as is.
-- updated_at keeps working: the BEFORE UPDATE trigger sets it, and column privileges are
-- checked only for the columns named in the UPDATE statement.

revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
