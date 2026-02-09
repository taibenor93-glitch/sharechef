-- Migration: Add recipe_verifications table for human verification
create table public.recipe_verifications (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id text not null,
  verification_type text not null check (verification_type in ('COOKED_AND_CONFIRMED')),
  photo_url text not null,
  exif_verified boolean not null default false,
  checklist jsonb not null default '[]'::jsonb,
  rating_taste int,
  rating_clarity int,
  notes text,
  created_at timestamptz not null default now()
);
