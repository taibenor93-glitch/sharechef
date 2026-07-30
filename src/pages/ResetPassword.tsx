import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// The emailed reset link must land on the web app (not the native shell), so the
// redirect is the production web URL, not window.location.origin.
const RESET_REDIRECT = 'https://sharechef-production.up.railway.app/reset'

export function ResetPasswordPage() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'request' | 'update'>('request')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    // Arriving from the emailed recovery link, supabase-js parses the URL and
    // fires PASSWORD_RECOVERY — switch this page to "set a new password" mode.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('update')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const sendLink = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT })
    setBusy(false)
    if (error) return setError(error.message)
    setNotice(
      "Check your email for a reset link. It opens in your browser — set a new password there, then come back and sign in."
    )
  }

  const updatePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 6) return setError('Password must be at least 6 characters.')
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    setNotice('Your password has been updated. Redirecting you to sign in…')
    setTimeout(() => nav('/login', { replace: true }), 1600)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div className="auth-hero">
          <div className="auth-logo"><span className="brand-dot" /> ShareChef</div>
          <div className="spacer" />
          <div className="auth-title">
            {mode === 'update' ? 'Set a new password' : 'Reset your password'}
          </div>
          <div className="auth-sub">
            {mode === 'update'
              ? 'Choose a new password for your account.'
              : "Enter your email and we'll send you a reset link."}
          </div>
        </div>

        {mode === 'update' ? (
          <form className="card stack" onSubmit={updatePassword}>
            <div className="field">
              <label className="label">New password</label>
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
            {error && <div className="alert alert-error">{error}</div>}
            {notice && <div className="alert alert-ok">{notice}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        ) : (
          <form className="card stack" onSubmit={sendLink}>
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
            {error && <div className="alert alert-error">{error}</div>}
            {notice && <div className="alert alert-ok">{notice}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-alt">
          Remembered it? <Link to="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}
