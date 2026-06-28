import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

const GUEST_KEY = 'sharechef_guest'

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
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
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
