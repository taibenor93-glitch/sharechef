// Recipe index tests (Siri AI). Run: node tests/recipe-index.test.mjs
//
// The web app hands the signed-in user's saved recipes to the iPhone so Siri
// can find them. These tests pin down two promises:
//   1. Only the few fields Siri needs leave the web app, cleaned and capped.
//   2. Signing out empties the iPhone's copy, and a failed load never wipes a
//      good copy or sends a half-loaded one.
//
// Compiles the real source; no React, no Capacitor, no simulator.
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled-recipe-index/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(
  `npx tsc src/lib/recipeIndex.ts ` +
  `--outDir ${OUT} --module esnext --target es2020 --lib es2020,dom --moduleResolution bundler --strict --skipLibCheck`,
  { stdio: 'inherit' }
)

const {
  toIndexedRecipes, syncRecipeIndex,
  RECIPE_INDEX_MAX_RECIPES, RECIPE_INDEX_MAX_TITLE, RECIPE_INDEX_MAX_SUMMARY,
  RECIPE_INDEX_MAX_ITEMS, RECIPE_INDEX_MAX_ITEM_LENGTH,
} = await import(pathToFileURL(`${OUT}recipeIndex.js`).href)

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `got ${a}, expected ${e}`)
}

const ID_A = '51f047bb-df02-41d4-b73b-3bec5849f4dd'
const ID_B = '82c55010-de68-4f28-a757-fe17b105ff31'
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// A full database row, as Supabase returns it.
const row = {
  id: ID_A,
  user_id: '2d148b2d-9318-4a46-88ff-e89f2181ac93',
  title: '  Lemon   Chicken ',
  description: 'Bright and quick.',
  ingredients: ['chicken thighs', 'lemon', 'lemon', ' garlic '],
  steps: ['Sear the chicken.', 'Add lemon.'],
  cook_time_minutes: 25,
  servings: 4,
  tags: ['gluten-free', 'weeknight'],
  photo_path: 'photos/abc.jpg',
  nutrition: '400 kcal',
  created_at: '2026-11-14T18:27:43Z',
}

// ── What leaves the web app ──────────────────────────────────────────────────
{
  const [r] = toIndexedRecipes([row])
  eq('one row becomes one recipe', toIndexedRecipes([row]).length, 1)
  eq('only the six fields Siri needs are kept',
    Object.keys(r).sort().join(','), 'cookTimeMinutes,id,ingredients,summary,tags,title')
  check('steps, photo, nutrition and the account id never leave',
    !JSON.stringify(r).match(/Sear|photos\/|kcal|2d148b2d/))
  eq('the title is tidied', r.title, 'Lemon Chicken')
  eq('the description becomes the summary', r.summary, 'Bright and quick.')
  eq('ingredients are trimmed and repeats dropped', r.ingredients, ['chicken thighs', 'lemon', 'garlic'])
  eq('tags are kept', r.tags, ['gluten-free', 'weeknight'])
  eq('cook time is kept', r.cookTimeMinutes, 25)
}

// ── Rows that are missing things ─────────────────────────────────────────────
{
  const [bare] = toIndexedRecipes([{ id: ID_A, title: 'Toast' }])
  eq('a bare recipe still indexes',
    bare, { id: ID_A, title: 'Toast', summary: '', ingredients: [], tags: [], cookTimeMinutes: null })
  const [nulls] = toIndexedRecipes([{ id: ID_A, title: 'Toast', description: null, tags: null, cook_time_minutes: null }])
  eq('database nulls are handled',
    nulls, { id: ID_A, title: 'Toast', summary: '', ingredients: [], tags: [], cookTimeMinutes: null })
  eq('an uppercase id is normalised', toIndexedRecipes([{ id: ID_A.toUpperCase(), title: 'Toast' }])[0].id, ID_A)

  eq('no title: skipped', toIndexedRecipes([{ id: ID_A, title: '   ' }]), [])
  eq('no id: skipped', toIndexedRecipes([{ title: 'Toast' }]), [])
  eq('an id that is not a UUID: skipped', toIndexedRecipes([{ id: '../preferences', title: 'Toast' }]), [])
  eq('the same recipe twice is indexed once',
    toIndexedRecipes([{ id: ID_A, title: 'One' }, { id: ID_A, title: 'Two' }]).map((r) => r.title), ['One'])
  eq('a bad row does not lose the good ones',
    toIndexedRecipes([null, 'x', { id: ID_A, title: 'A' }, 7, { id: ID_B, title: 'B' }]).map((r) => r.title), ['A', 'B'])

  eq('a zero cook time is dropped', toIndexedRecipes([{ id: ID_A, title: 'T', cook_time_minutes: 0 }])[0].cookTimeMinutes, null)
  eq('a negative cook time is dropped', toIndexedRecipes([{ id: ID_A, title: 'T', cook_time_minutes: -5 }])[0].cookTimeMinutes, null)
  eq('a text cook time is dropped', toIndexedRecipes([{ id: ID_A, title: 'T', cook_time_minutes: '25' }])[0].cookTimeMinutes, null)
  eq('an absurd cook time is dropped', toIndexedRecipes([{ id: ID_A, title: 'T', cook_time_minutes: 99999 }])[0].cookTimeMinutes, null)
  eq('ingredients that are not a list are dropped', toIndexedRecipes([{ id: ID_A, title: 'T', ingredients: 'rice' }])[0].ingredients, [])
  eq('non-text ingredients are dropped', toIndexedRecipes([{ id: ID_A, title: 'T', ingredients: ['rice', 3, null, {}] }])[0].ingredients, ['rice'])
}

// ── Not a list at all ────────────────────────────────────────────────────────
{
  eq('null', toIndexedRecipes(null), [])
  eq('undefined', toIndexedRecipes(undefined), [])
  eq('an object', toIndexedRecipes({ id: ID_A, title: 'T' }), [])
  eq('an empty list', toIndexedRecipes([]), [])
}

// ── Size caps ────────────────────────────────────────────────────────────────
{
  const many = Array.from({ length: RECIPE_INDEX_MAX_RECIPES + 50 }, (_, i) => ({ id: uuid(i), title: `Dish ${i}` }))
  eq('the number of recipes is capped', toIndexedRecipes(many).length, RECIPE_INDEX_MAX_RECIPES)
  eq('...keeping the first ones (newest first)', toIndexedRecipes(many)[0].title, 'Dish 0')

  const [big] = toIndexedRecipes([{
    id: ID_A,
    title: 'T'.repeat(1000),
    description: 'D'.repeat(5000),
    ingredients: Array.from({ length: 200 }, (_, i) => `item ${i} ${'x'.repeat(500)}`),
    tags: Array.from({ length: 200 }, (_, i) => `tag${i}`),
  }])
  eq('the title is capped', big.title.length, RECIPE_INDEX_MAX_TITLE)
  eq('the summary is capped', big.summary.length, RECIPE_INDEX_MAX_SUMMARY)
  eq('the ingredient count is capped', big.ingredients.length, RECIPE_INDEX_MAX_ITEMS)
  check('each ingredient is capped', big.ingredients.every((i) => i.length <= RECIPE_INDEX_MAX_ITEM_LENGTH))
  eq('the tag count is capped', big.tags.length, RECIPE_INDEX_MAX_ITEMS)
}

// ── Sync: signed in, signed out, and failures ────────────────────────────────
function fakeSink({ fails = false } = {}) {
  const sink = {
    synced: [],
    cleared: 0,
    async sync({ json }) {
      if (fails) throw new Error('unimplemented')
      sink.synced.push(JSON.parse(json))
      return { indexed: sink.synced.at(-1).length }
    },
    async clear() {
      if (fails) throw new Error('unimplemented')
      sink.cleared += 1
      return { indexed: 0 }
    },
  }
  return sink
}

{
  const sink = fakeSink()
  const asked = []
  const n = await syncRecipeIndex(sink, 'user-1', async (id) => { asked.push(id); return [row, { id: ID_B, title: 'Rice Bowl' }] })
  eq('signed in: the recipes are handed over', n, 2)
  eq('...loaded for that user', asked, ['user-1'])
  eq('...as one clean list', sink.synced[0].map((r) => r.title), ['Lemon Chicken', 'Rice Bowl'])
  eq('...and nothing is cleared', sink.cleared, 0)
}

{
  const sink = fakeSink()
  let loaded = 0
  const n = await syncRecipeIndex(sink, null, async () => { loaded += 1; return [row] })
  eq('signed out: the copy is emptied', sink.cleared, 1)
  eq('...nothing is loaded', loaded, 0)
  eq('...and nothing is handed over', sink.synced.length, 0)
  eq('...reported as zero', n, 0)
}

{
  const sink = fakeSink()
  const n = await syncRecipeIndex(sink, 'user-1', async () => [])
  eq('signed in with no recipes: an empty list is handed over', sink.synced, [[]])
  eq('...reported as zero', n, 0)
}

{
  const sink = fakeSink()
  let threw = null
  let n
  try {
    n = await syncRecipeIndex(sink, 'user-1', async () => { throw new Error('offline') })
  } catch (e) {
    threw = e
  }
  check('a failed load is survivable', threw === null, String(threw))
  eq('...and sends nothing, so a good copy is not wiped', sink.synced.length + sink.cleared, 0)
  eq('...reported as not sent', n, null)
}

{
  const sink = fakeSink({ fails: true })
  let threw = null
  let a
  let b
  try {
    a = await syncRecipeIndex(sink, 'user-1', async () => [row])
    b = await syncRecipeIndex(sink, null, async () => [row])
  } catch (e) {
    threw = e
  }
  check('an older app build with no plugin is survivable', threw === null, String(threw))
  eq('...reported as not sent', [a, b], [null, null])
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
