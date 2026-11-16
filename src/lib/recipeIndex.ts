// Siri AI (iOS 27.3+): the saved recipes Siri can find.
//
// Recipes live in Supabase and only this web app can read them. So the web app
// hands the signed-in user's saved recipes to the iPhone, which keeps a small
// copy and puts it in Spotlight's semantic index.
//
// iPhone side: ios/App/App/AppIntents/ (RecipeIndexPlugin.swift receives the
// list; RecipeEntity.swift and RecipeIntents.swift are what Siri uses).
//
// PRIVACY: only what Siri needs to find a recipe leaves this file: its id,
// title, short description, ingredients, tags and cook time. No steps, no
// photo, no account id. It stays on the phone, and it is emptied on sign-out.

export const RECIPE_INDEX_MAX_RECIPES = 500
export const RECIPE_INDEX_MAX_TITLE = 120
export const RECIPE_INDEX_MAX_SUMMARY = 300
export const RECIPE_INDEX_MAX_ITEMS = 40
export const RECIPE_INDEX_MAX_ITEM_LENGTH = 80

/** One recipe as the iPhone stores it (StoredRecipe in RecipeStore.swift). */
export type IndexedRecipe = {
  id: string
  title: string
  summary: string
  ingredients: string[]
  tags: string[]
  cookTimeMinutes: number | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const t = text(item, RECIPE_INDEX_MAX_ITEM_LENGTH)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= RECIPE_INDEX_MAX_ITEMS) break
  }
  return out
}

/**
 * Turn database rows into the list handed to the iPhone. Rows without a real
 * id or a title are skipped; nothing here throws.
 */
export function toIndexedRecipes(rows: unknown): IndexedRecipe[] {
  if (!Array.isArray(rows)) return []
  const out: IndexedRecipe[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.toLowerCase() : ''
    const title = text(r.title, RECIPE_INDEX_MAX_TITLE)
    if (!UUID_RE.test(id) || !title || seen.has(id)) continue
    seen.add(id)
    const minutes = r.cook_time_minutes
    out.push({
      id,
      title,
      summary: text(r.description, RECIPE_INDEX_MAX_SUMMARY),
      ingredients: list(r.ingredients),
      tags: list(r.tags),
      cookTimeMinutes:
        typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0 && minutes <= 24 * 60 ? minutes : null,
    })
    if (out.length >= RECIPE_INDEX_MAX_RECIPES) break
  }
  return out
}

// ── "A recipe was saved or deleted" ──────────────────────────────────────────
// The screens that change recipes call notifyRecipesChanged(); the sync hook
// (hooks/useRecipeIndex.ts) listens and refreshes the iPhone's copy.

const CHANGED_EVENT = 'sc-recipes-changed'

export function notifyRecipesChanged(): void {
  try {
    window.dispatchEvent(new Event(CHANGED_EVENT))
  } catch {
    /* no window (tests) */
  }
}

export function onRecipesChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener)
  return () => window.removeEventListener(CHANGED_EVENT, listener)
}

// ── Wiring ───────────────────────────────────────────────────────────────────
// Kept out of the React hook so a fake plugin can drive it in tests
// (tests/recipe-index.test.mjs).

/** The slice of the native RecipeIndex plugin we use. */
export interface RecipeIndexSink {
  sync(options: { json: string }): Promise<{ indexed: number }>
  clear(): Promise<{ indexed: number }>
}

/**
 * Bring the iPhone's copy in line with the account: the user's saved recipes
 * when signed in, nothing when signed out. Never throws. Resolves to the number
 * of recipes handed over, or null when nothing was sent (load failed, or an
 * older app build with no plugin).
 */
export async function syncRecipeIndex(
  sink: RecipeIndexSink,
  userId: string | null,
  loadRows: (userId: string) => Promise<unknown>,
): Promise<number | null> {
  try {
    if (!userId) {
      await sink.clear()
      return 0
    }
    const recipes = toIndexedRecipes(await loadRows(userId))
    await sink.sync({ json: JSON.stringify(recipes) })
    return recipes.length
  } catch {
    // A failed load must not wipe a good copy, so nothing is sent.
    return null
  }
}
