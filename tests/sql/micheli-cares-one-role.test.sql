-- Micheli Cares one-role rule, tested against a real Postgres.
--
-- Needs a throwaway database with an auth schema stub (auth.users, auth.uid()
-- reading request.jwt.claim.sub), then both migrations:
--   supabase/migrations/20261109120000_micheli_cares.sql
--   supabase/migrations/20261116120000_micheli_cares_one_role.sql
-- Run: psql -v ON_ERROR_STOP=1 -d <db> -f tests/sql/micheli-cares-one-role.test.sql
-- Prints PASS/FAIL per check and stops with an error if any check fails.
--
-- People: P parent, T teen, T2 second teen, P2 second parent, X bystander.

create temp table results (n serial, name text, pass boolean, detail text);

create or replace function pg_temp.as_user(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', p::text, false) $$;

-- Runs `sql` as user `who`. expect_error null: must succeed. Otherwise the
-- error text must contain expect_error.
create or replace function pg_temp.check(name text, who uuid, sql text, expect_error text) returns void
language plpgsql as $$
declare
  got text;
begin
  perform pg_temp.as_user(who);
  begin
    execute sql;
    if expect_error is null then
      insert into results(name, pass, detail) values (name, true, 'ok');
    else
      insert into results(name, pass, detail) values (name, false, 'succeeded, expected error: ' || expect_error);
    end if;
  exception when others then
    got := sqlerrm;
    if expect_error is not null and position(expect_error in got) > 0 then
      insert into results(name, pass, detail) values (name, true, got);
    else
      insert into results(name, pass, detail) values (name, false, 'error: ' || got);
    end if;
  end;
end $$;

create or replace function pg_temp.expect(name text, cond boolean, detail text) returns void
language sql as $$ insert into results(name, pass, detail) values (name, coalesce(cond, false), detail) $$;

do $$
declare
  P  uuid := '00000000-0000-4000-8000-00000000000a';
  T  uuid := '00000000-0000-4000-8000-00000000000b';
  T2 uuid := '00000000-0000-4000-8000-00000000000c';
  P2 uuid := '00000000-0000-4000-8000-00000000000d';
  X  uuid := '00000000-0000-4000-8000-00000000000e';
  name text;
begin
  -- A fresh account picks a role freely.
  perform pg_temp.check('a new teen can make a code', T,
    format($q$insert into public.cares_link_codes values (%L, 'TEENAA', 'Tai', now() + interval '10 minutes')$q$, T), null);

  perform pg_temp.as_user(P);
  name := public.cares_redeem_code('teenaa');
  perform pg_temp.expect('a new parent redeems the code', name = 'Tai', coalesce(name, 'null'));
  perform pg_temp.expect('...which links parent to teen',
    exists (select 1 from public.cares_links where parent_id = P and teen_id = T), '');
  perform pg_temp.expect('...and uses the code up',
    not exists (select 1 from public.cares_link_codes where teen_id = T), '');

  -- Rule 1: a parent cannot make a teen code. This is the Nov 14 mistake.
  perform pg_temp.check('a linked parent cannot make a teen code', P,
    format($q$insert into public.cares_link_codes values (%L, 'PARENT', 'Mom', now() + interval '10 minutes')$q$, P),
    'gets check-ins as the parent');
  perform pg_temp.expect('...and no code was stored',
    not exists (select 1 from public.cares_link_codes where teen_id = P), '');

  -- A parent can still connect a second teen.
  perform pg_temp.check('a second teen can make a code', T2,
    format($q$insert into public.cares_link_codes values (%L, 'TEENBB', 'Sam', now() + interval '10 minutes')$q$, T2), null);
  perform pg_temp.as_user(P);
  name := public.cares_redeem_code('TEENBB');
  perform pg_temp.expect('a parent can connect a second teen', name = 'Sam', coalesce(name, 'null'));

  -- Rule 2: a teen cannot become someone's parent.
  perform pg_temp.check('a third account makes a code', X,
    format($q$insert into public.cares_link_codes values (%L, 'XCODE2', 'Lee', now() + interval '10 minutes')$q$, X), null);
  perform pg_temp.check('a linked teen cannot redeem a code as a parent', T,
    $q$select public.cares_redeem_code('XCODE2')$q$, 'connected as the teen');
  perform pg_temp.expect('...and no link was made',
    not exists (select 1 from public.cares_links where parent_id = T), '');
  perform pg_temp.expect('...and the code is still there for the right parent',
    exists (select 1 from public.cares_link_codes where code = 'XCODE2'), '');

  -- A teen can still refresh their code and connect a second parent.
  perform pg_temp.check('a linked teen can make a fresh code', T,
    format($q$insert into public.cares_link_codes values (%L, 'TEENCC', 'Tai', now() + interval '10 minutes')
              on conflict (teen_id) do update set code = excluded.code, expires_at = excluded.expires_at$q$, T), null);
  perform pg_temp.as_user(P2);
  name := public.cares_redeem_code('TEENCC');
  perform pg_temp.expect('a teen can connect a second parent', name = 'Tai', coalesce(name, 'null'));

  -- Rule 3: a code already sitting on a parent's account (made before this
  -- rule) cannot be redeemed. Simulated by skipping the new trigger once.
  alter table public.cares_link_codes disable trigger cares_codes_one_role;
  insert into public.cares_link_codes values (P, 'OLDPAR', 'Mom', now() + interval '10 minutes');
  alter table public.cares_link_codes enable trigger cares_codes_one_role;
  perform pg_temp.check('an old code made on a parent account cannot be redeemed', X,
    $q$select public.cares_redeem_code('OLDPAR')$q$, 'made on a parent''s account');
  perform pg_temp.expect('...and no link was made',
    not exists (select 1 from public.cares_links where teen_id = P), '');

  -- The rules from the first migration still hold.
  perform pg_temp.check('a teen still cannot redeem their own code', X,
    $q$select public.cares_redeem_code('XCODE2')$q$, 'not your own');
  perform pg_temp.as_user(X);
  insert into public.cares_link_codes values (X, 'XCODE3', 'Lee', now() - interval '1 minute')
    on conflict (teen_id) do update set code = excluded.code, expires_at = excluded.expires_at;
  perform pg_temp.as_user(P2);
  perform pg_temp.expect('an expired code still returns nothing',
    public.cares_redeem_code('XCODE3') is null, '');
  perform pg_temp.expect('a wrong code still returns nothing',
    public.cares_redeem_code('ZZZZZZ') is null, '');
  perform pg_temp.check('signed out still cannot redeem', null,
    $q$select public.cares_redeem_code('XCODE3')$q$, 'sign in required');

  -- Existing links are untouched by the migration.
  perform pg_temp.expect('every link made in this test is still there',
    (select count(*) from public.cares_links) = 3, (select count(*) from public.cares_links)::text);
end $$;

select case when pass then 'PASS' else 'FAIL' end || '  ' || name || case when pass then '' else ' — ' || detail end
from results order by n;

select (select count(*) from results where pass) || '/' || (select count(*) from results) || ' passed' as summary;

do $$ begin
  if exists (select 1 from results where not pass) then
    raise exception 'one-role tests failed';
  end if;
end $$;
