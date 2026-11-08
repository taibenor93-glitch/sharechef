// Login-expiry tests for writes made during and after a cook.
// Run: node tests/token-expiry.test.mjs
//
// Why this exists (Nov 8 2026): the server kept the user's login token from the
// moment a cook started and used it for every save during the cook. Supabase
// logins last about an hour, so on a long cook every save after that failed with
// 401: resume state, "End session", and Micheli's memory. Nothing was logged.
// The user's identity is verified once, at session start; later writes must not
// depend on a token that can expire mid-recipe, and a failed write must be loud.
//
// No Supabase, no network: the token and service clients are injected fakes.

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

process.env.SC_TEST_NO_LISTEN = '1'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-dummy'
process.env.SUPABASE_URL = ''
process.env.SUPABASE_ANON_KEY = ''
process.env.SUPABASE_SERVICE_KEY = ''
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
process.env.EVENTS_ENABLED = ''
const { __test } = await import('../server.js')

/** A fake Supabase client. `expired` makes every write fail the way an expired JWT does. */
function fakeClient(name, { expired = false } = {}) {
  const writes = []
  return {
    name, writes,
    from(table) {
      return {
        upsert: async (row) => {
          writes.push({ table, row })
          return expired
            ? { data: null, error: { code: 'PGRST301', message: 'JWT expired', status: 401 } }
            : { data: null, error: null }
        },
      }
    },
  }
}

const errors = []
const realError = console.error
console.error = (...a) => { errors.push(a.join(' ')); }

const USER = '11111111-1111-4111-8111-111111111111'
const EXPIRED = 'expired-token'

function world({ service = true } = {}) {
  const tokenSide = fakeClient('token', { expired: true })
  const serviceSide = service ? fakeClient('service') : null
  __test.setDataClients({ token: () => tokenSide, service: () => serviceSide })
  errors.length = 0
  return { tokenSide, serviceSide }
}

// 1. Mid-cook save after the login expired.
{
  const { serviceSide } = world()
  await __test.saveCookState(EXPIRED, USER, [{ who: 'user', text: 'rice' }], 'English')
  const w = serviceSide.writes.find((x) => x.table === 'cook_sessions')
  check('a mid-cook save still lands after the login expires', !!w, `${serviceSide.writes.length} service writes`)
  check('...and it is written for the verified user only', w && w.row.user_id === USER)
}

// 2. "End session" after the login expired: the cook must really close.
{
  const { serviceSide } = world()
  await __test.clearCookState(EXPIRED, USER)
  const w = serviceSide.writes.find((x) => x.table === 'cook_sessions')
  check('ending a cook still closes it after the login expires', !!w && Array.isArray(w.row.lines) && w.row.lines.length === 0)
  check('...for the verified user only', w && w.row.user_id === USER)
}

// 3. Micheli's memory after a long cook.
{
  const { serviceSide } = world()
  await __test.writeMemory(EXPIRED, USER, 'The user cooks for two kids and loves garlic.')
  const w = serviceSide.writes.find((x) => x.table === 'micheli_memory')
  check("Micheli's memory still saves after the login expires", !!w)
  check('...for the verified user only', w && w.row.user_id === USER)
}

// 4. A write that fails is logged, never silent.
{
  world({ service: false })  // no service key configured: only the expired token is left
  await __test.saveCookState(EXPIRED, USER, [{ who: 'user', text: 'rice' }], 'English')
  check('a failed cook save is logged', errors.some((e) => /cook.*save failed/i.test(e) && /JWT expired/.test(e)), errors.join(' | '))
  errors.length = 0
  await __test.clearCookState(EXPIRED, USER)
  check('a failed end-of-cook is logged', errors.some((e) => /cook.*clear failed/i.test(e)), errors.join(' | '))
  errors.length = 0
  await __test.writeMemory(EXPIRED, USER, 'x')
  check('a failed memory save is logged', errors.some((e) => /memory.*failed/i.test(e)), errors.join(' | '))
}

// 5. Without a service key the server falls back to the user's own token.
{
  const { tokenSide } = world({ service: false })
  await __test.saveCookState('fresh-token', USER, [{ who: 'user', text: 'rice' }], 'English')
  check('with no service key, writes still go through the user token', tokenSide.writes.length === 1)
}

// 6. No user id, no write (never an unscoped service write).
{
  const { serviceSide, tokenSide } = world()
  await __test.saveCookState(EXPIRED, null, [{ who: 'user', text: 'rice' }], 'English')
  await __test.clearCookState(EXPIRED, null)
  await __test.writeMemory(EXPIRED, null, 'x')
  check('nothing is written without a verified user id', serviceSide.writes.length === 0 && tokenSide.writes.length === 0)
}

__test.resetDataClients()
console.error = realError
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
