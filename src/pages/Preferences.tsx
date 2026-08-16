import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { API_BASE } from '../lib/apiBase'
import {
  purgeAccountLocal,
  resumeAnalyticsAfterFailedDeletion,
  suspendAnalyticsForAccountDeletion,
} from '../lib/events'
import { resetIdentity } from '../lib/session'

export function PreferencesPage() {
  const { userId, session } = useAuth()
  const navigate = useNavigate()

  // ── Account deletion (Revision 6) ──────────────────────────────────────────
  // Password re-entry goes ONLY to Supabase auth (signInWithPassword) — never
  // to the ShareChef server. The server requires the verified JWT's password
  // authentication-method timestamp to fall inside a narrow window.
  const [delStep, setDelStep] = useState<'closed' | 'form' | 'working' | 'done'>('closed')
  const [delPassword, setDelPassword] = useState('')
  const [delConfirmed, setDelConfirmed] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)

  const onDeleteAccount = async () => {
    if (!userId || delStep === 'working') return
    const email = session?.user?.email
    if (!email) { setDelError('Could not read your account email. Sign out and back in, then try again.'); return }
    setDelError(null)
    setDelStep('working')
    try {
      // 1) Fresh password sign-in — proves possession of the password and gives
      //    a token the server accepts as genuinely recent. Password → Supabase only.
      const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: delPassword,
      })
      if (signInError || !signIn?.session?.access_token) {
        setDelError('Password incorrect. Nothing was deleted.')
        setDelStep('form')
        return
      }
      // Stop and drain analytics before the server purges this installation.
      // Otherwise an already-running delivery could land after the purge.
      await suspendAnalyticsForAccountDeletion()
      // 2) Server-side permanent deletion, account derived from the token only.
      let res: Response | null = null
      try {
        res = await fetch(`${API_BASE}/api/account/delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${signIn.session.access_token}`,
          },
          body: '{}',
        })
      } catch { res = null }
      if (!res) {
        // The request may have completed even though its response was lost.
        // Retire local identifiers and sign out rather than risk resurrecting
        // pre-deletion analytics. If the account still exists, the user can
        // sign back in and retry safely.
        await purgeAccountLocal(userId)
        await resetIdentity()
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        navigate('/login', { replace: true, state: { message: 'We could not confirm the deletion. Sign in again to verify your account status.' } })
        return
      }
      if (!res.ok) {
        resumeAnalyticsAfterFailedDeletion()
        setDelError(
          res?.status === 429
            ? 'Too many attempts. Please wait an hour and try again.'
            : 'The server could not complete the deletion. Your account was NOT deleted — please try again.'
        )
        setDelStep('form')
        return
      }
      // 3) Server confirmed. Erase the local session IMMEDIATELY — the old JWT
      //    can remain technically valid until it expires, so nothing here may
      //    keep using it. Then rotate the installation identity.
      await purgeAccountLocal(userId)
      await resetIdentity()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      setDelPassword('')
      setDelStep('done')
      setTimeout(() => navigate('/login', { replace: true }), 2200)
    } catch {
      setDelError('Something went wrong. Your account may not have been deleted — please try again.')
      setDelStep('form')
    }
  }

  const [glutenFree, setGlutenFree] = useState(false)
  const [dairyFree, setDairyFree] = useState(false)
  const [kosher, setKosher] = useState(false)
  const [celiac, setCeliac] = useState(false)
  const [allergiesDraft, setAllergiesDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    let alive = true
    supabase
      .from('profiles')
      .select('gluten_free, dairy_free, kosher, celiac, allergies')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (!error && data) {
          setGlutenFree(!!data.gluten_free)
          setDairyFree(!!data.dairy_free)
          setKosher(!!data.kosher)
          setCeliac(!!data.celiac)
          setAllergiesDraft(Array.isArray(data.allergies) ? data.allergies.join(', ') : '')
        }
        setLoading(false)
      })
    return () => { alive = false }
  }, [userId])

  const onSave = async () => {
    if (!userId) return
    setSaveState('saving')
    setError(null)
    const allergies = allergiesDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      gluten_free: glutenFree,
      dairy_free: dairyFree,
      kosher,
      celiac,
      allergies,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setError(error.message)
      setSaveState('idle')
      return
    }
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 2000)
  }

  if (!userId) {
    return (
      <div className="container stack">
        <h1 className="page-title">Culinary preferences</h1>
        <div className="card">
          <p className="muted">Sign in to set your dietary preferences — Micheli will remember them every time you cook together.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container stack">
      <div className="hero-head">
        <h1 className="page-title">Culinary preferences</h1>
        <p className="page-sub" style={{ margin: '10px auto 0' }}>
          Micheli follows these every time she cooks with you — no need to remind her.
        </p>
      </div>

      <div className="card stack">
        {loading ? (
          <p className="muted">Loading your preferences…</p>
        ) : (
          <>
            <div className="field">
              <label className="label">Dietary restrictions</label>
              <div className="stack" style={{ gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={glutenFree} onChange={(e) => setGlutenFree(e.target.checked)} />
                  Gluten-free
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={dairyFree} onChange={(e) => setDairyFree(e.target.checked)} />
                  Dairy-free
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={kosher} onChange={(e) => setKosher(e.target.checked)} />
                  Kosher
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={celiac} onChange={(e) => setCeliac(e.target.checked)} />
                  Celiac
                </label>
              </div>
            </div>

            <div className="field">
              <label className="label">Allergies</label>
              <input
                value={allergiesDraft}
                onChange={(e) => setAllergiesDraft(e.target.value)}
                placeholder="e.g. peanuts, shellfish"
              />
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Separate with commas. Micheli treats every allergy as serious.
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save preferences'}
            </button>
          </>
        )}
      </div>

      <div className="card stack" style={{ borderColor: 'rgba(220, 80, 80, 0.45)' }}>
        <div className="field">
          <label className="label" style={{ color: '#d97070' }}>Delete account</label>
          {delStep === 'done' ? (
            <p className="muted">
              Your account and all associated data have been permanently deleted. Thank you for cooking with Micheli. ❤️
            </p>
          ) : delStep === 'closed' ? (
            <>
              <p className="muted" style={{ fontSize: 14 }}>
                Permanently delete your ShareChef account and everything attached to it.
              </p>
              <button type="button" className="btn btn-ghost" style={{ color: '#d97070' }} onClick={() => setDelStep('form')}>
                Delete my account…
              </button>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 14 }}>
                This permanently deletes your account, saved recipes, Micheli's memory of you, cooking
                sessions, shares, and associated usage analytics. This cannot be undone.
              </p>
              <input
                type="password"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
                placeholder="Enter your password to confirm"
                autoComplete="current-password"
                disabled={delStep === 'working'}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={delConfirmed}
                  onChange={(e) => setDelConfirmed(e.target.checked)}
                  disabled={delStep === 'working'}
                />
                I understand this permanently deletes everything and cannot be undone.
              </label>
              {delError && <div className="alert alert-error">{delError}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: '#b84a4a' }}
                  onClick={onDeleteAccount}
                  disabled={delStep === 'working' || !delPassword || !delConfirmed}
                >
                  {delStep === 'working' ? 'Deleting…' : 'Permanently delete my account'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setDelStep('closed'); setDelPassword(''); setDelConfirmed(false); setDelError(null) }}
                  disabled={delStep === 'working'}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
