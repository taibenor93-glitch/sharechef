# ShareChef – Saved Recipes v1 (Code Version)

This is a code-based version of the app (React + TypeScript + Supabase) so you are NOT dependent on Lovable editing access.

## What works
- Email/password signup + login (Supabase Auth)
- Protected routes (redirect to /login)
- Save mock recipe on Home
- /saved list with search + sort
- /saved/:id detail with Delete/Unsave

## 1) Create Supabase project (free tier is fine)
In Supabase:
- Create a new project
- Get:
  - Project URL
  - Anon public key

## 2) Create the database table + RLS
In Supabase SQL Editor, run the SQL in `supabase/schema.sql`.

## 3) Configure local environment
Create a `.env` file in the project root:

VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

## 4) Run locally
Install and run:

npm install
npm run dev

Open the local URL it prints (usually http://localhost:5173).

## Notes
- The Home page uses a mock recipe and checks "already saved" by recipe title.
- Search in /saved is client-side (it filters what was fetched).
