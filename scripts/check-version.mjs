// Release gate: package.json version (analytics app_version source) must match
// the iOS marketing version before archiving a release build.
// Run: node scripts/check-version.mjs   (exit 1 on mismatch)
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const pbx = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8')
const marketing = [...pbx.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((m) => m[1])

const pkgMM = pkg.version.split('.').slice(0, 2).join('.') // compare major.minor
const ok = marketing.length > 0 && marketing.every((v) => v.split('.').slice(0, 2).join('.') === pkgMM)

console.log(`package.json version: ${pkg.version}`)
console.log(`iOS MARKETING_VERSION: ${[...new Set(marketing)].join(', ') || 'NOT FOUND'}`)
if (!ok) {
  console.error('MISMATCH: bump package.json and/or Xcode MARKETING_VERSION so analytics app_version matches the released build.')
  process.exit(1)
}
console.log('OK: analytics version matches the iOS marketing version.')
