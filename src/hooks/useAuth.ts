import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

const GUEST_KEY = 'sharechef_guest'
const PENDING_PROFILE_KEY = 'sharechef_pending_profile'

export interface PendingProfile {
  glutenFree: boolean
  dairyFree: boolean
  kosher: boolean
  celiac: boolean
  allergies: string[]
}

/** Called from Signup.tsx to hold the chosen dietary answers until a real session exists. */
export function stashPendingProfile(data: PendingProfile): void {
  try {
    localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(data))
  } catch {
    /* ignore storage errors */
  }
}

/** Creates a profiles row for this user if one doesn't exist yet, using any stashed
 *  signup answers (or defaults if none are found — e.g. confirmed on another device). */
async function ensureProfile(userId: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (selErr || existing) return

  let pending: Partial<PendingProfile> = {}
  try {
    const raw = localStorage.getItem(PENDING_PROFILE_KEY)
    if (raw) pending = JSON.parse(raw)
  } catch {
    /* ignore parse errors */
  }

  await supabase.from('profiles').insert({
    id: userId,
    gluten_free: pending.glutenFree ?? false,
    dairy_free: pending.dairyFree ?? false,
    kosher: pending.kosher ?? false,
    celiac: pending.celiac ?? false,
    allergies: pending.allergies ?? [],
  })

  try {
    localStorage.removeItem(PENDING_PROFILE_KEY)
  } catch {
    /* ignore storage errors */
  }
}

/** Turn guest mode on/off and notify all useAuth listeners. */
export function setGuest(on: boolean): void {
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    /* ignore storage errors */
  }
  window.dispatchEvent(new Event('sc-auth'))
}

function readGuest(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [guest, setGuestState] = useState<boolean>(readGuest)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session ?? null)
      setLoading(false)
      if (data.session?.user?.id) ensureProfile(data.session.user.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
      if (s?.user?.id) ensureProfile(s.user.id)
    })

    const onGuest = () => setGuestState(readGuest())
    window.addEventListener('sc-auth', onGuest)
    window.addEventListener('storage', onGuest)

    return () => {
      alive = false
      sub.subscription.unsubscribe()
      window.removeEventListener('sc-auth', onGuest)
      window.removeEventListener('storage', onGuest)
    }
  }, [])

  return {
    session,
    guest,
    loading,
    authed: !!session || guest,
    userId: session?.user.id ?? null,
  }
}
