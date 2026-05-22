# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install deps
npm run dev      # start dev server (http://localhost:5173)
npm run build    # tsc -b && vite build
npm run preview  # serve the production build
```

There are no tests or linters configured.

## Environment

The app requires a `.env` file at the project root. The current `.env` only contains `VITE_OPENAI_API_KEY` but the README and the Supabase client code expect:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Run `supabase/schema.sql` in the Supabase SQL editor before the app can save/load recipes.

## Architecture

React 18 + TypeScript SPA, bundled by Vite, backed by Supabase (Auth + Postgres).

**Entry:** `src/main.tsx` → `<BrowserRouter>` → `src/App.tsx`

**Routing (incomplete):** `App.tsx` currently only registers the `/` route for `HomePage`. The pages `Login`, `Signup`, `SavedList`, and `SavedDetail` exist in `src/pages/` but are **not wired into the router**. `ProtectedRoute` and `useSession` are also built but unused in the active router.

**Data layer:** `src/lib/supabaseClient.ts` is the expected Supabase client import path used by all auth/data pages. The actual file on disk is `src/lib/.supabase.ts` (dot-prefixed, wrong name) — this import will fail. Creating `src/lib/supabaseClient.ts` that exports a `createClient` instance is required for those pages to work.

**Recipe generation:** `src/api/recipe.ts` contains `generateRecipe()`, the function called by `HomePage`. It is currently a **stub** — it returns a canned acknowledgement string in the requested language without calling any AI API. A near-identical copy exists at `src/recipe.ts` (unused, can be deleted). `src/recipe.server.ts` is a stub HTTP handler; it is not connected to any server and is effectively dead code.

**Voice system (`src/voice/`):**
- `tts.ts` — `speak(text, language)`: wraps `SpeechSynthesisUtterance` with voice selection and Hebrew (he-IL) special-casing.
- `speech.ts` — `startListening(onText)`: wraps the `SpeechRecognition` Web API; transcribes speech and fires a callback.
- `yummiGuide.ts` — thin wrapper that guards on `navigator.mediaDevices`; currently just logs "initialized".
- Voice is triggered by the "DEV: Start Voice" button hardcoded in `App.tsx`. It is not surfaced in a user-facing UI yet.

**Validation:** `src/lib/honestRules.ts` — `validateIngredients(list)` enforces the rule: 2 ingredients minimum, 4 maximum. The 4th ingredient is treated as a "pantry add-on" and surfaced separately in the response.

**Gamification:** "Yummi Star" progress is stored in `localStorage` keys `recipe_cooked_count`, `yummi_star_level`, and `yummi_star_unlocked`. Levels unlock at 20 / 50 / 100 cooked recipes. All logic lives in `HomePage`.

**Internationalisation:** Five built-in locale keys (`en`, `es`, `fr`, `it`, `pt`) plus Hebrew (`he`) with special-cased TTS voice selection. Users can enter any BCP 47 tag via a custom input; natural language names (e.g. "Hebrew", "Japanese") are mapped to locale codes via `localeNameMap` in `HomePage`. The selected language is persisted in `localStorage` under `user_language`.

**Styling:** `src/styles.css` with utility classes (`container`, `card`, `stack`, `row`, `grow`, `pill`, `badge`, `h1`, `h2`, `muted`, `primary`, `danger`). `HomePage` uses inline styles; other pages use these utility classes.
