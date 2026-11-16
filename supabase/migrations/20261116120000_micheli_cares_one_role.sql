-- Micheli Cares: one role per account.
--
-- An account is either the parent (gets check-ins) or the teen (cooks), never
-- both. On Nov 14 2026 a linked parent made a teen code on their own phone, and
-- no check-in could arrive because the code belonged to the wrong account.
--
-- The app hides the wrong button (src/lib/caresRoles.ts), but app versions
-- already on people's phones still show it. These rules hold for every version.
--
-- Safe to run more than once. It changes no existing rows and removes none.
--
--   1. An account that is already a parent cannot make a teen code.
--   2. An account that is already a teen cannot redeem a code as a parent.
--   3. A code made by an account that is a parent cannot be redeemed.
--
-- The messages are shown to the person as written, so they say what to do.

-- ── 1. A parent cannot make a teen code ─────────────────────────────────────
-- A trigger rather than a policy, so the app shows this sentence instead of a
-- generic "row-level security" error. SECURITY DEFINER only to read the links
-- table; it writes nothing.
create or replace function public.cares_codes_one_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.cares_links where parent_id = new.teen_id) then
    raise exception 'This account gets check-ins as the parent. Make the code on your teen''s phone, signed in to your teen''s own account.';
  end if;
  return new;
end;
$$;

revoke all on function public.cares_codes_one_role() from public;
revoke execute on function public.cares_codes_one_role() from anon, authenticated;

drop trigger if exists cares_codes_one_role on public.cares_link_codes;
create trigger cares_codes_one_role
before insert or update on public.cares_link_codes
for each row execute function public.cares_codes_one_role();

-- ── 2 and 3. Redeem a code (called by the parent's app) ─────────────────────
-- Same function as 20261109120000_micheli_cares.sql, with the two role checks
-- added. Returns the teen's first name on success, null for a wrong or expired
-- code. A code works once: it is removed as soon as it links.
create or replace function public.cares_redeem_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid := auth.uid();
  v_row public.cares_link_codes%rowtype;
begin
  if v_parent is null then
    raise exception 'sign in required';
  end if;

  select * into v_row
  from public.cares_link_codes
  where code = upper(trim(p_code)) and expires_at > now()
  for update;

  if not found then
    return null;
  end if;

  if v_row.teen_id = v_parent then
    raise exception 'use this code on your parent''s phone, not your own';
  end if;

  -- The person typing the code is already someone's teen.
  if exists (select 1 from public.cares_links where teen_id = v_parent) then
    raise exception 'This account is connected as the teen. Type the code on your parent''s phone, signed in to their own account.';
  end if;

  -- The code was made on an account that is already a parent (a code from
  -- before this rule, or from an older app version).
  if exists (select 1 from public.cares_links where parent_id = v_row.teen_id) then
    raise exception 'That code was made on a parent''s account. Ask your teen to make a new code on their own phone, signed in to their own account.';
  end if;

  insert into public.cares_links (parent_id, teen_id, teen_name)
  values (v_parent, v_row.teen_id, v_row.teen_name)
  on conflict (parent_id, teen_id) do update set teen_name = excluded.teen_name;

  delete from public.cares_link_codes where teen_id = v_row.teen_id;

  return v_row.teen_name;
end;
$$;

revoke all on function public.cares_redeem_code(text) from public;
revoke execute on function public.cares_redeem_code(text) from anon;
grant execute on function public.cares_redeem_code(text) to authenticated;
