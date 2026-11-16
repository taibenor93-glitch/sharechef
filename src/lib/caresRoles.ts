// Micheli Cares: one role per account.
//
// An account is either the parent (gets check-ins) or the teen (cooks). It is
// never both. On Nov 14 2026 a linked parent tapped "I'm the teen" on their own
// phone, made a code there, and no check-in could ever arrive: the code belonged
// to the wrong account. So once an account has a role, the other one is not
// offered.
//
// The database enforces the same rule for every app version
// (supabase/migrations/20261116120000_micheli_cares_one_role.sql). This file
// is what the screen uses to decide which buttons to show.

export type CaresRole = 'parent' | 'teen'

type LinkLike = { parentId: string; teenId: string }

/** The roles this account already holds, from its links. */
export function caresRolesHeld(links: readonly LinkLike[], userId: string): CaresRole[] {
  const held: CaresRole[] = []
  if (links.some((l) => l.parentId === userId)) held.push('parent')
  if (links.some((l) => l.teenId === userId)) held.push('teen')
  return held
}

/**
 * The buttons to offer.
 *   no links yet      → both: the account picks its role
 *   already a parent  → "I'm the parent" only (to connect another teen)
 *   already a teen    → "I'm the teen" only (to connect another parent)
 *   somehow both      → neither, until one link is removed
 */
export function caresRoleChoices(links: readonly LinkLike[], userId: string): CaresRole[] {
  const held = caresRolesHeld(links, userId)
  if (held.length === 0) return ['parent', 'teen']
  if (held.length === 1) return held
  return []
}

/**
 * Why this account may not take `role`, in words for the person holding the
 * phone. Null when it may.
 */
export function caresRoleBlockedReason(links: readonly LinkLike[], userId: string, role: CaresRole): string | null {
  const held = caresRolesHeld(links, userId)
  if (role === 'teen' && held.includes('parent')) {
    return 'This account gets check-ins as the parent. Make the code on your teen’s phone, signed in to your teen’s own account.'
  }
  if (role === 'parent' && held.includes('teen')) {
    return 'This account is connected as the teen. Type the code on your parent’s phone, signed in to their own account.'
  }
  return null
}
