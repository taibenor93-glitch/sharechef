import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { stashPendingProfile } from '../hooks/useAuth'
import { track } from '../lib/events'

export function SignupPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [glutenFree, setGlutenFree] = useState(false)
  const [dairyFree, setDairyFree] = useState(false)
  const [kosher, setKosher] = useState(false)
  const [celiac, setCeliac] = useState(false)
  const [allergiesDraft, setAllergiesDraft] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    const allergies = allergiesDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    stashPendingProfile({ glutenFree, dairyFree, kosher, celiac, allergies })

    const { data, error } = await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) return setError(error.message)
    track('account_created', undefined, data.session?.access_token ?? null)
    if (data.session) {
      nav('/', { replace: true })
    } else {
      setNotice('Account created. Check your email to confirm, then sign in.')
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div className="auth-hero">
          <div className="auth-logo"><span className="brand-dot" /> ShareChef</div>
          <div className="spacer" />
          <div className="auth-title">Create your kitchen</div>
          <div className="auth-sub">Save recipes and earn your Micheli Star.</div>
        </div>

        <form className="card stack" onSubmit={onSubmit}>
          <div className="field">
            <label className="label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          <div className="field">
            <label className="label">Dietary preferences (optional)</label>
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
            <label className="label">Allergies (optional)</label>
            <input
              value={allergiesDraft}
              onChange={(e) => setAllergiesDraft(e.target.value)}
              placeholder="e.g. peanuts, shellfish"
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {notice && <div className="alert alert-ok">{notice}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <div className="auth-alt">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
