# ShareChef – CLAUDE.md

This document gives AI assistants (Claude Code and others) the context needed to work effectively in this codebase.

---

## Project Overview

**ShareChef** is a recipe assistant web app. The user enters up to 3 ingredients (plus an optional pantry add-on) and the app generates a recipe confirmation message, reads it aloud via TTS, and lets the user share it to social platforms. A separate set of pages handles authentication and saved recipes via Supabase.

The app is built for **Replit** deployment but can run locally with `npm run dev`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 + TypeScript (strict mode) |
| Bundler | Vite 5 |
| Router | React Router DOM v6 |
| Backend/DB | Supabase (Postgres + Auth + RLS) |
| Voice (STT) | Web Speech API (`webkitSpeechRecognition`) |
| Voice (TTS) | Web Speech Synthesis API |
| Deployment | Replit (port 3000, `npm install && npm run dev -- --host`) |

No server-side framework — this is a fully client-side SPA calling Supabase directly.

---

## Directory Structure

```
sharechef/
├── index.html              # Vite entry point
├── vite.config.js          # Vite config (React plugin only)
├── tsconfig.json           # TypeScript config (strict, ESNext, jsx: react-jsx)
├── package.json            # Scripts: dev, build, preview
├── .env                    # Local env vars (not committed)
├── .replit                 # Replit run config
├── replit.nix              # Nix channel for Replit
├── supabase/
│   └── schema.sql          # Postgres table + RLS policies (run once in Supabase SQL Editor)
└── src/
    ├── main.tsx            # ReactDOM.createRoot + BrowserRouter
    ├── App.tsx             # Root component — NavBar + Routes (currently only "/" wired)
    ├── styles.css          # Global CSS utility classes
    ├── recipe.ts           # Duplicate of src/api/recipe.ts (not imported anywhere active)
    ├── recipe.server.ts    # Stub server handler (not wired anywhere)
    ├── api/
    │   └── recipe.ts       # generateRecipe() — template-based, no AI call yet
    ├── components/
    │   ├── NavBar.tsx      # Placeholder ("NAV WORKS") — not yet implemented
    │   └── ProtectedRoute.tsx  # Redirects to /login if no session
    ├── hooks/
    │   └── useSession.ts   # Supabase auth session hook
    ├── lib/
    │   ├── .supabase.ts    # Supabase client (hidden file — dot prefix)
    │   └── honestRules.ts  # validateIngredients() — min 2, max 4 ingredients
    ├── pages/
    │   ├── Home.tsx        # Main page: ingredients form, chat, TTS, sharing, Yummi Stars
    │   ├── Login.tsx       # Email/password login via Supabase auth
    │   ├── Signup.tsx      # Email/password signup via Supabase auth
    │   ├── SavedList.tsx   # /saved — client-side search+sort, Supabase fetch
    │   └── SavedDetail.tsx # /saved/:id — recipe detail + delete
    ├── types/
    │   └── recipe.ts       # Recipe type definition
    ├── voice/
    │   ├── speech.ts       # startListening() — Web Speech API STT
    │   ├── tts.ts          # speak() — Web Speech Synthesis with voice selection
    │   └── yummiGuide.ts   # startYummiGuide() / isVoiceSupported() / debugStartVoice()
    └── src/
        └── vite-env.d.ts   # Misplaced — should be at src/vite-env.d.ts
```

---

## Known Issues / Architectural Gaps

These are things you MUST know before making changes:

### 1. Broken Supabase client import
Pages import `'../lib/supabaseClient'` but the actual file is `src/lib/.supabase.ts` (dotfile). There is **no `src/lib/supabaseClient.ts`**. The auth pages (Login, Signup, SavedList, SavedDetail) and `useSession` hook will not compile until either:
- The file is renamed from `.supabase.ts` to `supabaseClient.ts`, or
- The imports are updated to point to `.supabase` (requires Vite/TS support for dotfile imports).

### 2. Auth routes not wired in the router
`App.tsx` only defines `<Route path="/" element={<HomePage ref={homeRef} />} />`. The pages `Login.tsx`, `Signup.tsx`, `SavedList.tsx`, and `SavedDetail.tsx` exist but are **not connected** to any `<Route>`. The `ProtectedRoute` component is defined but unused.

### 3. OpenAI key present but unused
`.env` contains `VITE_OPENAI_API_KEY` but `src/api/recipe.ts` uses hardcoded language templates — no API call is made. OpenAI integration is planned but not implemented.

### 4. Duplicate recipe module
`src/recipe.ts` is an exact copy of `src/api/recipe.ts`. Only `src/api/recipe.ts` is imported (by `Home.tsx`). `src/recipe.ts` is dead code.

### 5. DEV-only voice button in App.tsx
`App.tsx` renders a `<button>DEV: Start Voice</button>` directly in the root component. This should be removed or moved behind a dev-only flag before production.

### 6. Misplaced vite-env.d.ts
`src/src/vite-env.d.ts` is inside a nested `src/src/` directory. It should be at `src/vite-env.d.ts`.

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes (for auth/saved) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes (for auth/saved) | Supabase anon public key |
| `VITE_OPENAI_API_KEY` | Planned | Future AI recipe generation |

Create a `.env` file in the project root. Never commit it.

---

## Development Commands

```bash
npm install       # Install dependencies
npm run dev       # Start Vite dev server (http://localhost:5173)
npm run build     # TypeScript check + Vite production build
npm run preview   # Serve the production build locally
```

On Replit, the run command is: `npm install --silent && npm run dev -- --host --port ${PORT}` (port 3000).

---

## Database

### Schema
Single table: `public.recipes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `user_id` | `uuid` | FK → `auth.users(id)` |
| `title` | `text` | Required |
| `description` | `text` | Optional |
| `ingredients` | `jsonb` | Array of strings |
| `steps` | `jsonb` | Array of strings |
| `cook_time_minutes` | `int` | Optional |
| `servings` | `int` | Optional |
| `tags` | `text[]` | Optional |
| `created_at` | `timestamptz` | Auto-set |

### RLS Policies
Row-level security is enabled. All four policies (`select`, `insert`, `update`, `delete`) check `user_id = auth.uid()` — users can only access their own rows.

### Setup
Run `supabase/schema.sql` once in the Supabase SQL Editor. It is idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`).

---

## Core Business Logic

### Ingredient Validation (`src/lib/honestRules.ts`)
- Minimum 2 ingredients required
- Maximum 4 total (3 main + 1 pantry add-on)
- The 4th ingredient is treated as a "pantry add-on" and announced separately

### Recipe Generation (`src/api/recipe.ts`)
Currently template-based, not AI-powered. Returns a localized confirmation string like _"Got it — eggs and rice. I'll start your recipe now."_ Supports: `en`, `es`, `fr`, `it`, `pt`, `he`. Defaults to `en` for unknown locales.

### Yummi Stars Gamification (`src/pages/Home.tsx`)
Progress stored in `localStorage`:
- `recipe_cooked_count` — incremented each time the user runs the assistant
- `yummi_star_level` — 0 (locked), 1 (20+ cooks), 2 (50+), 3 (100+)
- `yummi_star_unlocked` — `"true"` when level > 0

### Language / i18n
- Supported natively: `en`, `es`, `fr`, `it`, `pt` (dropdown)
- Also supported in TTS/copy: `he` (Hebrew)
- Custom locale input: accepts BCP-47 codes like `zh-CN`, `hi-IN`
- Language stored in `localStorage` as `user_language`
- `localeNameMap` in `Home.tsx` maps natural-language names (e.g., "Hebrew", "עברית") to locale codes

### Text-to-Speech (`src/voice/tts.ts`)
- Uses `window.speechSynthesis`
- Voice selection: prefers "Samantha", "Allison", "Alex", etc.
- Hebrew gets special handling: forces `he-IL` locale and prefers Carmit/Adi voices
- Text is pre-processed for natural pacing (adds spaces after punctuation)
- Rate: 0.8 (slower than default)

### Speech-to-Text (`src/voice/speech.ts`)
- Uses `window.SpeechRecognition` / `window.webkitSpeechRecognition`
- Single-shot, non-continuous, no interim results
- Currently hardcoded to `lang: "en-US"` regardless of user language setting

---

## Component Reference

### `Home.tsx` (main page)
- `forwardRef` — exposes `HomePageHandle` so `App.tsx` can trigger voice flow
- `runAssistant(listOverride?, rawUserText?)` — core function: validates → generates → speaks → updates Yummi Stars
- `ingredients` state: `{ one, two, three }` — three separate inputs that get normalized into a flat list
- Chat panel: a simple `messages` array, not connected to any LLM

### `useSession` hook
Returns `{ session, loading }`. Uses `supabase.auth.getSession()` and `onAuthStateChange`. Note the import bug (see Known Issues #1).

### `ProtectedRoute`
Wraps children in session guard. Unused until routes are wired (see Known Issues #2).

---

## Code Conventions

- **TypeScript strict mode** — no `any` unless absolutely necessary (existing violations use explicit `as any`)
- **No test suite** — there is no test infrastructure
- **No linter configured** — no ESLint/Prettier config files; the codebase uses consistent 2-space indentation
- **ESM modules** — `"type": "module"` in `package.json`; use `import`/`export` throughout
- **No CSS framework** — styles.css contains utility classes (`.container`, `.card`, `.stack`, `.row`, `.badge`, `.pill`, `.primary`, `.danger`, `.muted`, `.h1`, `.h2`, `.grow`)
- **Inline styles** for one-off overrides in JSX
- **`void` prefix** for floating async calls in event handlers (e.g., `void runAssistant()`)
- **No comments** in source files (conventions, not just implementation gaps)

---

## What to Work On Next (Priority Areas)

1. **Fix the Supabase client import** — rename `.supabase.ts` → `supabaseClient.ts` and verify build passes
2. **Wire the auth routes** — add Login, Signup, SavedList, SavedDetail routes to `App.tsx`
3. **Implement OpenAI recipe generation** — replace template strings in `src/api/recipe.ts` with a real API call using `VITE_OPENAI_API_KEY`
4. **Implement NavBar** — replace the placeholder stub with actual navigation links
5. **Remove DEV voice button** from `App.tsx` root or put it behind `import.meta.env.DEV`
6. **Clean up dead code** — remove `src/recipe.ts` (duplicate) and `src/recipe.server.ts` (unused stub)
7. **Fix STT language** — `speech.ts` ignores `userLanguage`; should pass the current locale to `recognition.lang`
