-- Repository schema reconciliation (Revision 6). NOT for application to
-- production as change — these structures ALREADY EXIST there (verified
-- 2026-08-16 via read-only schema check). This migration makes the repo match
-- production and is fully idempotent: it no-ops wherever the target state
-- already holds, so applying it anywhere is safe.

-- shares: existed in production without a repo migration. Captured 1:1.
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id text,
  channel text not null default 'native',
  created_at timestamptz not null default now()
);

alter table public.shares enable row level security;

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
