-- Migration: Add recipe audit trail and badge tracking tables
create table public.recipe_audits (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  version_hash text not null,
  status text not null check (status in (
    'AUDIT_PENDING',
    'AUDIT_PASSED',
    'AUDIT_BLOCKED',
    'AUDIT_NEEDS_REVIEW'
  )),
  risk_flags jsonb not null default '[]'::jsonb,
  required_fixes jsonb not null default '[]'::jsonb,
  suggested_fixes jsonb not null default '[]'::jsonb,
  model_info jsonb,
  created_at timestamptz not null default now()
);

create table public.recipe_badges (
  recipe_id uuid primary key references public.recipes(id) on delete cascade,
  current_badge text not null check (current_badge in (
    'DRAFT',
    'AI_AUDITED',
    'KITCHEN_TESTED',
    'VERIFIED_HUMAN_TESTED',
    'REVOKED'
  )),
  badge_reason text,
  verified_cook_count int not null default 0,
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
