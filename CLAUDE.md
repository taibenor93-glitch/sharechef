# ShareChef – CLAUDE.md

## Project Overview

ShareChef is a recipe-sharing web app built with React 18, TypeScript, Vite, and Supabase. Users enter up to 3 ingredients (plus 1 pantry add-on), get a recipe via a conversational assistant, and can share it to social platforms. The app supports multilingual output and voice input/output via the browser's Web Speech APIs.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript (strict) |
| Bundler | Vite 5 |
| Router | React Router DOM v6 |
| Backend/Auth/DB | Supabase (Auth + Postgres) |
| Voice | Web Speech API (TTS + STT) |
| Styling | Plain CSS utility classes in `src/styles.css` |

## Commands

```bash
npm run dev      # Start Vite dev server (http://localhost:5173)
npm run build    # tsc -b && vite build
npm run preview  # Preview production build
```

No test suite exists yet. TypeScript errors surface via `npm run build`.

## Environment Variables

Create `.env` in the project root:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OPENAI_API_KEY=your_openai_key  # placeholder; not yet wired to AI calls
```

The `.env` currently only contains `VITE_OPENAI_API_KEY`. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be added for auth and saved-recipes features to work.

## Repository Structure

```
src/
  main.tsx                  # Entry: mounts BrowserRouter + App
  App.tsx                   # Root component, route definitions, dev voice button
  styles.css                # Global utility CSS (container, card, stack, row, badge, etc.)

  pages/
    Home.tsx                # Main page: ingredient inputs, recipe chat, social sharing, Yummi Star
    Login.tsx               # Email/password login via Supabase Auth
    Signup.tsx              # Email/password signup via Supabase Auth
    SavedList.tsx           # Paginated list of user's saved recipes with search + sort
    SavedDetail.tsx         # Single recipe detail with delete

  components/
    NavBar.tsx              # Navigation bar (currently a stub)
    ProtectedRoute.tsx      # Auth guard – redirects to /login if no session

  hooks/
    useSession.ts           # Supabase auth session hook (subscribes to auth state changes)

  api/
    recipe.ts               # generateRecipe(): returns localized acknowledgment string (NOT AI yet)

  voice/
    tts.ts                  # speak(text, language): Web Speech Synthesis with voice selection
    speech.ts               # startListening(onText): Web Speech Recognition (Chrome/Edge only)
    yummiGuide.ts           # Helpers for voice readiness checks and initialization

  lib/
    .supabase.ts            # Supabase client singleton (note: dot-prefixed filename)
    honestRules.ts          # validateIngredients(): enforce min 2 / max 4 ingredient rule

  types/
    recipe.ts               # Recipe TypeScript type (mirrors Supabase table)

  recipe.ts                 # DUPLICATE of src/api/recipe.ts — dead code, do not use
  recipe.server.ts          # Unused server handler stub

  src/
    vite-env.d.ts           # Vite env types (incorrectly nested — should be src/vite-env.d.ts)

supabase/
  schema.sql                # Postgres table + RLS policies for recipes table
```

## Known Issues (Technical Debt)

1. **Router is incomplete.** `App.tsx` only registers the `/` route. `Login`, `Signup`, `SavedList`, and `SavedDetail` pages exist but are not wired into `<Routes>`. They cannot be navigated to.

2. **Broken import paths.** `Login.tsx` and `Signup.tsx` import from `'../lib/supabaseClient'`, but the actual file is `src/lib/.supabase.ts`. These pages will fail to compile until this is fixed.

3. **`generateRecipe` is a stub.** `src/api/recipe.ts` returns a localized acknowledgment string, not an actual AI-generated recipe. The OpenAI API key in `.env` is never called.

4. **Duplicate file.** `src/recipe.ts` is identical to `src/api/recipe.ts`. The root-level copy is dead code and should be deleted.

5. **Unused server stub.** `src/recipe.server.ts` is a bare `handleRecipeRequest` function with no runtime use.

6. **Dev button in production tree.** The "DEV: Start Voice" button in `App.tsx` is unstyled and hardcoded with no feature flag. It should be guarded or removed before shipping.

7. **Nested `src/src/` directory.** `src/src/vite-env.d.ts` is in the wrong location.

8. **Supabase client filename.** `src/lib/.supabase.ts` starts with a dot, making it a hidden file on Unix. New imports should still reference the correct path.

## Core Business Rules

All ingredient validation lives in `src/lib/honestRules.ts`:
- Minimum 2 ingredients required
- Maximum 4 ingredients allowed (3 main + 1 pantry add-on)
- A 4th ingredient is treated as a `pantryAddOn` and prepended to the recipe output

## Multilingual System

Language state is stored in `localStorage` under the key `user_language`.

**Supported natively** (dropdown): `en`, `es`, `fr`, `it`, `pt`

**Hebrew** (`he`) has special handling throughout — voice uses `he-IL` locale and prefers the Carmit/Adi system voices.

**Custom language input** accepts BCP-47 codes (e.g., `zh-CN`, `hi-IN`). A `localeNameMap` in `Home.tsx` maps full language names (e.g., `"hebrew"`, `"中文"`) to locale codes.

**i18n pattern:** Each language-sensitive module has a `baseLang(language)` helper that extracts the base code from any locale string (e.g., `"he-IL"` → `"he"`). Copy maps (`copyByLang`, `recipeCopies`) are keyed on the base code and fall back to `"en"`.

## Yummi Star Gamification

Persisted in `localStorage`:

| Key | Value |
|---|---|
| `recipe_cooked_count` | integer, incremented each time Optimize is run |
| `yummi_star_level` | `0`=locked, `1`=20 cooks, `2`=50 cooks, `3`=100 cooks |
| `yummi_star_unlocked` | `"true"` when level ≥ 1 |

A level-up triggers a celebration message and voice announcement in the user's language.

## Metrics (localStorage)

| Key | Incremented by |
|---|---|
| `recipe_view_count` | Every successful `runAssistant()` call |
| `recipe_share_count` | Every `shareRecipe()` call |

## Social Sharing

`shareRecipe(platform, recipeText, lastIngredients, fallbackList)` in `Home.tsx`:
1. Tries `navigator.share()` (Web Share API) first
2. Falls back per platform:
   - `facebook` → `facebook.com/sharer/sharer.php?quote=…`
   - `youtube` → opens `youtube.com/upload`
   - `instagram` / `tiktok` → copies text to clipboard

## Voice System

**TTS (`src/voice/tts.ts`):** `speak(text, language)` returns a Promise. It cancels any pending speech, pads punctuation for natural pacing, selects the best available `SpeechSynthesisVoice` for the locale. Preferred voices: `Samantha`, `Allison`, `Alex`, `Victoria`, `Carmit` (Hebrew), `Adi` (Hebrew).

**STT (`src/voice/speech.ts`):** `startListening(onText)` returns a `SpeechRecognition` instance (call `.start()` on it). Single-shot, non-continuous, `lang: "en-US"` hardcoded. Only works in Chromium browsers.

**`App.tsx` imperative handle:** `HomePage` exposes `setIngredientsFromVoice(items)` and `optimizeWithList(items)` via `forwardRef` + `useImperativeHandle` so the parent can drive the page from the DEV voice button.

## Supabase Schema

`public.recipes` table — see `supabase/schema.sql` for full DDL. Row-Level Security is enabled: users can only CRUD their own rows (`user_id = auth.uid()`).

TypeScript shape (`src/types/recipe.ts`):
```ts
type Recipe = {
  id: string
  user_id: string
  title: string
  description: string | null
  ingredients: string[]
  steps: string[]
  cook_time_minutes: number | null
  servings: number | null
  tags: string[] | null
  created_at: string
}
```

## CSS Conventions

All styling uses plain CSS utility classes from `src/styles.css`. No CSS-in-JS library — inline `style` props are used for one-off overrides in JSX. Key classes:

- `.container` — max-width centered wrapper
- `.card` — white rounded panel with border
- `.stack` — vertical flex column with 12px gap
- `.row` — horizontal flex with wrap
- `.grow` — `flex: 1` with min-width
- `.muted` — gray secondary text
- `.h1`, `.h2` — heading sizes
- `.badge` — pill-shaped tag
- `.pill` — nav/link button style
- `button.primary`, `button.secondary`, `button.danger` — button variants

## Development Conventions

- **TypeScript strict mode** is on. All new code must type-check cleanly.
- **`void` operator** is used on floating promises (`void runAssistant()`) — maintain this pattern.
- **No comment policy** — code is self-documenting; only add comments when a constraint or workaround is non-obvious.
- **Module type** — the project uses `"type": "module"` (ESM throughout).
- **No test runner** is configured; verify changes by running `npm run build` for type errors and `npm run dev` for manual testing.
- **Branch convention** (from git history): feature commits are prefixed by feature area and version, e.g., `Voice v5: ...`, `I18n v2: ...`, `Rewards v1: ...`.

## What to Fix First

When adding new features, resolve these blockers in order:

1. Fix `Login.tsx` and `Signup.tsx` imports (`supabaseClient` → `.supabase`)
2. Register all routes in `App.tsx` (`/login`, `/signup`, `/saved`, `/saved/:id`)
3. Delete `src/recipe.ts` (duplicate)
4. Implement real recipe generation in `src/api/recipe.ts` using the OpenAI key
5. Guard or remove the "DEV: Start Voice" button in `App.tsx`
