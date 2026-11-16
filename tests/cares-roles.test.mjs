// Micheli Cares one-role tests. Run: node tests/cares-roles.test.mjs
//
// An account is the parent or the teen, never both. On Nov 14 2026 a linked
// parent made a teen code on their own phone and no check-in could arrive.
// These tests pin down which buttons each account is offered.
// The same rule is enforced in the database: tests/sql/micheli-cares-one-role.test.sql
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled-cares-roles/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(
  `npx tsc src/lib/caresRoles.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --strict --skipLibCheck`,
  { stdio: 'inherit' }
)
const { caresRolesHeld, caresRoleChoices, caresRoleBlockedReason } =
  await import(pathToFileURL(`${OUT}caresRoles.js`).href)

const results = []
function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  results.push(a === e)
  console.log(`${a === e ? 'PASS' : 'FAIL'}  ${name}${a === e ? '' : ` — got ${a}, expected ${e}`}`)
}

const ME = 'me'
const asParent = { parentId: ME, teenId: 'kid' }
const asTeen = { parentId: 'mom', teenId: ME }
const others = { parentId: 'a', teenId: 'b' }

eq('no links: both roles offered', caresRoleChoices([], ME), ['parent', 'teen'])
eq('only other people\'s links: both offered', caresRoleChoices([others], ME), ['parent', 'teen'])
eq('a parent is offered parent only', caresRoleChoices([asParent], ME), ['parent'])
eq('a parent of two teens: still parent only',
  caresRoleChoices([asParent, { parentId: ME, teenId: 'kid2' }], ME), ['parent'])
eq('a teen is offered teen only', caresRoleChoices([asTeen], ME), ['teen'])
eq('an account holding both is offered neither', caresRoleChoices([asParent, asTeen], ME), [])

eq('roles held: none', caresRolesHeld([], ME), [])
eq('roles held: parent', caresRolesHeld([asParent], ME), ['parent'])
eq('roles held: both', caresRolesHeld([asTeen, asParent], ME), ['parent', 'teen'])

eq('a new account may be the teen', caresRoleBlockedReason([], ME, 'teen'), null)
eq('a new account may be the parent', caresRoleBlockedReason([], ME, 'parent'), null)
eq('a parent may connect another teen', caresRoleBlockedReason([asParent], ME, 'parent'), null)
eq('a teen may connect another parent', caresRoleBlockedReason([asTeen], ME, 'teen'), null)
const p = caresRoleBlockedReason([asParent], ME, 'teen')
eq('a parent may not make a teen code', typeof p === 'string' && p.includes('teen’s phone'), true)
const t = caresRoleBlockedReason([asTeen], ME, 'parent')
eq('a teen may not redeem as a parent', typeof t === 'string' && t.includes('parent’s phone'), true)

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
