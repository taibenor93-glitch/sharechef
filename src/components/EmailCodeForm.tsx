import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

// Sign in or sign up with a one-time code sent by email. No password.
// Needs the Supabase "Magic Link" (and "Confirm signup") email templates to
// include {{ .Token }} so the email carries the code.
type Props = {
  mode: 'signin' | 'signup'
  /** Extra fields shown on the email step (e.g. dietary preferences on signup). */
  children?: ReactNode
  /** Runs right before the code is sent (e.g. stash signup answers). */
  onBeforeSend?: () => void
  onSignedIn: (session: Session | null) => void
}

const RESEND_SECONDS = 60

export function EmailCodeForm({ mode, children, onBeforeSend, onSignedIn }: Props) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const sendCode = async () => {
    const address = email.trim().toLowerCase()
    if (!address) return
    setBusy(true)
    setError(null)
    onBeforeSend?.()
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: mode === 'signup' },
    })
    setBusy(false)
    if (error) {
      if (mode === 'signin' && /signup|not found|not allowed/i.test(error.message)) {
        return setError('There is no ShareChef account with this email yet. Tap "Create an account" below.')
      }
      if (/rate|seconds|too many/i.test(error.message)) {
        return setError('A code was just sent. Please wait a minute, then try again.')
      }
      return setError(error.message)
    }
    setEmail(address)
    setCode('')
    setStep('code')
    setWait(RESEND_SECONDS)
  }

  const onSubmitEmail = (e: FormEvent) => {
    e.preventDefault()
    void sendCode()
  }

  const onSubmitCode = async (e: FormEvent) => {
    e.preventDefault()
    const token = code.replace(/\s/g, '')
    if (!token) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    setBusy(false)
    if (error) {
      return setError(
        /expired|invalid/i.test(error.message)
          ? 'That code did not work or has expired. Tap "Send a new code" and use the newest email.'
          : error.message
      )
    }
    onSignedIn(data.session ?? null)
  }

  if (step === 'code') {
    return (
      <form className="card stack" onSubmit={onSubmitCode}>
        <div className="muted" style={{ fontSize: 14 }}>
          We sent a code to <strong>{email}</strong>. Check your inbox (and spam), then type it here.
        </div>
        <div className="field">
          <label className="label">Code from your email</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={10}
            required
            autoFocus
          />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Checking…' : mode === 'signup' ? 'Create my account' : 'Sign in'}
        </button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="link-btn"
            onClick={() => { setStep('email'); setError(null) }}
          >
            Use a different email
          </button>
          <button type="button" className="link-btn" disabled={busy || wait > 0} onClick={() => void sendCode()}>
            {wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmitEmail}>
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
      {children}
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Sending…' : 'Email me a code'}
      </button>
      <div className="muted" style={{ fontSize: 13, textAlign: 'center' }}>
        No password needed. We email you a code each time you sign in.
      </div>
    </form>
  )
}
