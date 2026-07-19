// Recipe response helpers for the /api/recipe/generate endpoint.
// Extracted from server.js so the normalization logic is unit-testable
// independently of the OpenAI call.

/** Parse a value to an integer, returning null when it isn't a finite number. */
export function toInt(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Coerce a raw (untrusted) LLM JSON object into the strict recipe shape the
 * client expects. Missing or wrong-typed fields fall back to safe defaults;
 * tags are capped at 5.
 */
export function normalizeRecipe(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    title: String(r.title || 'A simple dish'),
    description: String(r.description || ''),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String) : [],
    steps: Array.isArray(r.steps) ? r.steps.map(String) : [],
    cook_time_minutes: toInt(r.cook_time_minutes),
    servings: toInt(r.servings),
    tags: Array.isArray(r.tags) ? r.tags.map(String).slice(0, 5) : [],
    tip: String(r.tip || ''),
  }
}
