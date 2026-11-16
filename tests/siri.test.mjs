// Siri handoff tests. Run: node tests/siri.test.mjs
//
// Two things reach the app from Siri: "start a cook" and "these ingredients".
// The ingredients are whatever Siri heard, so parseSiriIngredients() must turn
// any text at all into plain food words and nothing else. These tests also
// cover the inbox (a request is used once and expires) and the wiring to the
// native plugin, driven by a fake plugin.
//
// Compiles the real source; no React, no Capacitor, no simulator.
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled-siri/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(
  `npx tsc src/lib/siri.ts ` +
  `--outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --strict --skipLibCheck`,
  { stdio: 'inherit' }
)

const {
  parseSiriIngredients, parseSiriAction, createSiriInbox, startSiriRouting,
  SIRI_MAX_INGREDIENTS, SIRI_MAX_INGREDIENT_LENGTH, SIRI_ACTION_TTL_MS,
} = await import(pathToFileURL(`${OUT}siri.js`).href)

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

// ── What Siri heard → ingredients ────────────────────────────────────────────
{
  eq('"chicken and rice"', parseSiriIngredients('chicken and rice'), ['chicken', 'rice'])
  eq('commas and a final "and"', parseSiriIngredients('Eggs, spinach, and feta'), ['eggs', 'spinach', 'feta'])
  eq('an ampersand splits too', parseSiriIngredients('beans & rice'), ['beans', 'rice'])
  eq('"plus" splits too', parseSiriIngredients('pasta plus tomatoes'), ['pasta', 'tomatoes'])
  eq('one ingredient', parseSiriIngredients('salmon'), ['salmon'])
  eq('two-word ingredients stay whole', parseSiriIngredients('olive oil and sweet potato'), ['olive oil', 'sweet potato'])
  eq('"and" inside a word does not split', parseSiriIngredients('candy and almonds'), ['candy', 'almonds'])
  eq('filler words are dropped', parseSiriIngredients('some chicken and a lemon and the rice'), ['chicken', 'lemon', 'rice'])
  eq('repeats are dropped', parseSiriIngredients('rice, Rice and RICE'), ['rice'])
  eq('extra spaces are tolerated', parseSiriIngredients('   chicken    and   rice  '), ['chicken', 'rice'])
  eq('amounts are kept', parseSiriIngredients('2 eggs and 1 onion'), ['2 eggs', '1 onion'])
  eq('accents survive', parseSiriIngredients('jalapeño and crème fraîche'), ['jalapeño', 'crème fraîche'])
  eq('hyphens and apostrophes survive', parseSiriIngredients("self-rising flour and baker's yeast"), ['self-rising flour', "baker's yeast"])
  eq('Siri punctuation is dropped', parseSiriIngredients('Chicken and rice.'), ['chicken', 'rice'])
}

// ── Anything that is not food words ──────────────────────────────────────────
{
  eq('empty text', parseSiriIngredients(''), [])
  eq('only separators', parseSiriIngredients(' , and & '), [])
  eq('not a string: undefined', parseSiriIngredients(undefined), [])
  eq('not a string: number', parseSiriIngredients(42), [])
  eq('not a string: object', parseSiriIngredients({ ingredients: 'rice' }), [])
  eq('a bare number is not an ingredient', parseSiriIngredients('2 and 3'), [])
  eq('markup is flattened to words', parseSiriIngredients('<script>alert(1)</script>'), ['script alert 1 script'])
  check('...and no angle bracket, slash or paren ever survives',
    !/[<>/()\\"`${}]/.test(parseSiriIngredients('<img src=x onerror="a()"> and `${x}` \\ rice').join(' ')))
  check('a link cannot survive as a link',
    !parseSiriIngredients('https://evil.example/x?y=1 and rice').join(' ').includes('://'))

  const many = Array.from({ length: 40 }, (_, i) => `food${String.fromCharCode(97 + (i % 26))}${i}`).join(', ')
  eq('the list is capped', parseSiriIngredients(many).length, SIRI_MAX_INGREDIENTS)
  eq('an over-long item is dropped, the rest kept',
    parseSiriIngredients(`${'x'.repeat(SIRI_MAX_INGREDIENT_LENGTH + 1)}, rice`), ['rice'])
  eq('a huge input is handled', parseSiriIngredients('rice and '.repeat(5000)), ['rice'])
  eq('a word cut off at the length limit is not an ingredient',
    parseSiriIngredients(`${'rice and '.repeat(33)}broccoli`), ['rice'])
}

// ── What the native plugin hands over → a request ────────────────────────────
{
  eq('cook', parseSiriAction({ action: 'cook' }), { kind: 'cook' })
  eq('cook ignores stray ingredients', parseSiriAction({ action: 'cook', ingredients: 'rice' }), { kind: 'cook' })
  eq('make with ingredients',
    parseSiriAction({ action: 'make', ingredients: 'chicken and rice' }),
    { kind: 'make', ingredients: ['chicken', 'rice'] })
  eq('make with nothing usable does nothing', parseSiriAction({ action: 'make', ingredients: '...' }), null)
  eq('make with no ingredients does nothing', parseSiriAction({ action: 'make' }), null)
  eq('nothing waiting ({})', parseSiriAction({}), null)
  eq('an unknown request does nothing', parseSiriAction({ action: 'delete-account' }), null)
  eq('the action is matched exactly', parseSiriAction({ action: 'COOK' }), null)
  eq('null', parseSiriAction(null), null)

  // Siri AI: open one saved recipe. The id ends up in a route, so only a real
  // UUID may pass.
  const ID = '51f047bb-df02-41d4-b73b-3bec5849f4dd'
  eq('recipe with a UUID', parseSiriAction({ action: 'recipe', recipeId: ID }), { kind: 'recipe', id: ID })
  eq('an uppercase UUID is normalised', parseSiriAction({ action: 'recipe', recipeId: ID.toUpperCase() }), { kind: 'recipe', id: ID })
  eq('recipe with no id does nothing', parseSiriAction({ action: 'recipe' }), null)
  eq('a path is not an id', parseSiriAction({ action: 'recipe', recipeId: '../preferences' }), null)
  eq('an id with a path tacked on is refused', parseSiriAction({ action: 'recipe', recipeId: `${ID}/../../preferences` }), null)
  eq('an id with a query tacked on is refused', parseSiriAction({ action: 'recipe', recipeId: `${ID}?x=1` }), null)
  eq('a non-string id is refused', parseSiriAction({ action: 'recipe', recipeId: 42 }), null)
  eq('a string', parseSiriAction('cook'), null)
}

// ── Inbox: used once, and it expires ─────────────────────────────────────────
{
  let t = 1_000
  const inbox = createSiriInbox(() => t)
  eq('an empty inbox gives nothing', inbox.take(), null)

  let pings = 0
  const off = inbox.subscribe(() => { pings += 1 })
  inbox.put({ kind: 'cook' })
  eq('a new request notifies the screen', pings, 1)
  eq('...and is handed over', inbox.take(), { kind: 'cook' })
  eq('...exactly once', inbox.take(), null)

  inbox.put({ kind: 'cook' })
  inbox.put({ kind: 'make', ingredients: ['rice'] })
  eq('a newer request replaces an older one', inbox.take(), { kind: 'make', ingredients: ['rice'] })

  inbox.put({ kind: 'cook' })
  t += SIRI_ACTION_TTL_MS
  eq('a request is still good at the time limit', inbox.take(), { kind: 'cook' })

  inbox.put({ kind: 'cook' })
  t += SIRI_ACTION_TTL_MS + 1
  eq('a stale request is dropped', inbox.take(), null)
  eq('...and stays dropped', inbox.take(), null)

  eq('every request notified the screen', pings, 5)
  off()
  inbox.put({ kind: 'cook' })
  eq('an unsubscribed screen hears nothing more', pings, 5)
}

// ── Wiring to the native plugin ──────────────────────────────────────────────
const tick = () => new Promise((r) => setTimeout(r, 0))

function fakePlugin({ listenerFails = false, takeFails = false } = {}) {
  const fake = {
    queue: [],
    listeners: [],
    removed: 0,
    takes: 0,
    async addListener(eventName, fn) {
      if (listenerFails) throw new Error('unimplemented')
      fake.listeners.push({ eventName, fn })
      return { remove: () => { fake.removed += 1 } }
    },
    async takePending() {
      fake.takes += 1
      if (takeFails) throw new Error('unimplemented')
      return fake.queue.shift() ?? {}
    },
    siri(request) {
      fake.queue.push(request)
      for (const l of fake.listeners) l.fn()
    },
  }
  return fake
}

// Siri asked while the app was closed.
{
  const plugin = fakePlugin()
  plugin.queue.push({ action: 'cook' })
  const got = []
  startSiriRouting(plugin, (a) => got.push(a))
  await tick()
  eq('a cold-start request is delivered once', got, [{ kind: 'cook' }])
}

// Siri asked while the app was open.
{
  const plugin = fakePlugin()
  const got = []
  startSiriRouting(plugin, (a) => got.push(a))
  await tick()
  check('a running app subscribes to siriAction',
    plugin.listeners.length === 1 && plugin.listeners[0].eventName === 'siriAction')
  eq('a plain launch delivers nothing', got.length, 0)

  plugin.siri({ action: 'make', ingredients: 'chicken and rice' })
  await tick()
  eq('a request while running is delivered', got, [{ kind: 'make', ingredients: ['chicken', 'rice'] }])

  plugin.siri({ action: 'nonsense' })
  await tick()
  eq('an unknown request is not delivered', got.length, 1)
}

// Cleanup detaches, and a late answer is ignored.
{
  const plugin = fakePlugin()
  const got = []
  const stop = startSiriRouting(plugin, (a) => got.push(a))
  await tick()
  stop()
  eq('cleanup removes the listener', plugin.removed, 1)
  plugin.siri({ action: 'cook' })
  await tick()
  eq('nothing is delivered after cleanup', got.length, 0)

  const late = fakePlugin()
  late.queue.push({ action: 'cook' })
  const gotLate = []
  const stopLate = startSiriRouting(late, (a) => gotLate.push(a))
  stopLate() // before the plugin has answered
  await tick()
  eq('a request that lands after cleanup is ignored', gotLate.length, 0)
  eq('...and the late listener is removed', late.removed, 1)
}

// An older app build or a browser: no plugin at all.
{
  const plugin = fakePlugin({ listenerFails: true, takeFails: true })
  const got = []
  let threw = null
  try {
    startSiriRouting(plugin, (a) => got.push(a))
    await tick()
    await tick()
  } catch (e) {
    threw = e
  }
  check('a missing plugin is survivable', threw === null, String(threw))
  eq('...and delivers nothing', got.length, 0)
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
