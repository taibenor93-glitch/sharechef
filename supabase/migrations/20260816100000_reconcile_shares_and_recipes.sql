-- Repository schema reconciliation (Revision 6). NOT for application to
-- production as change — these structures ALREADY EXIST there (verified
-- 2026-08-16 via read-only schema check). This migration makes the repo match
-- production and is fully idempotent: it no-ops wherever the target state
-- already holds, so applying it anywhere is safe.

-- shares exists in production, but its RLS policies and grants have not yet
-- been captured. Deliberately do NOT create it or change RLS here: enabling RLS
-- without the production policies could break sharing, while creating it with
-- RLS disabled would expose data in a fresh environment. A separate verified
-- baseline migration must capture columns, grants, RLS state, and every policy.
do $$
begin
  if to_regclass('public.shares') is null then
    raise notice 'public.shares is absent; verified shares baseline migration still required';
  end if;
end $$;

-- recipes.user_id: production already has ON DELETE CASCADE (the original repo
-- migration lacked the clause). Converge only when the rule differs.
do $$
declare
  deltype "char";
begin
  select confdeltype into deltype
  from pg_constraint
  where conname = 'recipes_user_id_fkey' and conrelid = 'public.recipes'::regclass;
  if deltype is distinct from 'c' then
    alter table public.recipes drop constraint if exists recipes_user_id_fkey;
    alter table public.recipes
      add constraint recipes_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;
