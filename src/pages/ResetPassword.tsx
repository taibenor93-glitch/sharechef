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
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    // Arriving from the emailed recovery link, supabase-js parses the URL and
    // fires PASSWORD_RECOVERY. That can happen before this component mounts, so
    // also check on mount for a session the recovery link already established —
    // if one exists, we're here to set a new password.
    // The account email is kept so the page can say whose password is changing:
    // password managers and stale sessions otherwise make it look like a
    // different account is being reset.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setAccountEmail(data.session.user.email ?? null)
        setMode('update')
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Keep the email through the post-save sign-out so the confirmation still
      // names the account; "Not you?" clears it explicitly.
      if (session) setAccountEmail(session.user.email ?? null)
      if (event === 'PASSWORD_RECOVERY') setMode('update')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // "Not you?": drop the current session and go back to requesting a link, so a
  // password is never set on an account the person didn't mean to change.
  const switchAccount = async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setAccountEmail(null)
    setPassword('')
    setConfirmPassword('')
    setError(null)
    setNotice(null)
    setMode('request')
  }

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
    if (password !== confirmPassword) return setError('Passwords do not match. Please retype them.')
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    // The recovery link signed this browser in. Without signing out here, /login
    // sees that session and bounces straight to home, so the person never
    // actually uses (or proves) the new password. Local scope only: other
    // devices stay signed in.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setBusy(false)
    setNotice('Your password has been updated. Sign in with your new password…')
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
              ? accountEmail
                ? <>Choose a new password for <strong>{accountEmail}</strong>.</>
                : 'Choose a new password for your account.'
              : "Enter your email and we'll send you a reset link."}
          </div>
        </div>

        {mode === 'update' ? (
          <form className="card stack" onSubmit={updatePassword}>
            {accountEmail && (
              <div className="field">
                <label className="label">Account</label>
                {/* Read-only username field: tells password managers which
                    account this new password belongs to. */}
                <input
                  type="email"
                  name="username"
                  value={accountEmail}
                  autoComplete="username"
                  readOnly
                  aria-readonly="true"
                />
                <div className="auth-alt" style={{ textAlign: 'left' }}>
                  Not you?{' '}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '2px 8px', fontSize: 13 }}
                    onClick={switchAccount}
                  >
                    Reset a different account
                  </button>
                </div>
              </div>
            )}
            <div className="field">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="label">New password</label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '2px 8px', fontSize: 13 }}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈 Hide' : '👁 Show'}
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="field">
              <label className="label">Confirm new password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Type it again"
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
