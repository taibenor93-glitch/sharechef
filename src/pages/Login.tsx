import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { setGuest } from '../hooks/useAuth'

export function LoginPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setError(error.message)
    nav('/', { replace: true })
  }

  const continueAsGuest = () => {
    setGuest(true)
    nav('/', { replace: true })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div className="auth-hero">
          <div className="auth-logo"><span className="brand-dot" /> ShareChef</div>
          <div className="spacer" />
          <div className="auth-title">Welcome back</div>
          <div className="auth-sub">Sign in to cook with Micheli.</div>
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
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="or-divider"><span>or</span></div>

          <button type="button" className="btn btn-ghost btn-block" onClick={continueAsGuest}>
            Continue as guest
          </button>
          <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
            Cook and talk to Micheli right away. Create an account anytime to save recipes.
          </div>
        </form>

        <div className="auth-alt">
          New to ShareChef? <Link to="/signup">Create an account</Link>
        </div>

        <a
          className="app-store-badge"
          href="https://apps.apple.com/us/app/sharechef-ai/id6787142176"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Download ShareChef AI on the App Store"
        >
          <img src="/app-store-badge.svg" alt="Download on the App Store" width="140" height="47" />
        </a>

        <div
          className="muted"
          style={{ display: 'flex', gap: 18, justifyContent: 'center', fontSize: 13, marginTop: 14 }}
        >
          <Link to="/about">About</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/pricing">Pricing</Link>
        </div>
      </div>
    </div>
  )
}
