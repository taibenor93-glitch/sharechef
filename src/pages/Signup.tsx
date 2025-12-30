import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)

    const { error } = await supabase.auth.signUp({ email, password })
    setBusy(false)

    if (error) return setError(error.message)

    setMessage('Signup successful. If email confirmation is enabled, check your inbox and confirm, then log in.')
  }

  return (
    <div className="container">
      <div className="card stack" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div>
          <div className="h1">Signup</div>
          <div className="muted">Create your account.</div>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <div className="stack">
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Email</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Password</div>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Create a password (10+ chars recommended)" />
            </div>
          </div>

          {error && <div className="card" style={{ borderColor: '#ffd4d4', background: '#fff5f5' }}>{error}</div>}
          {message && <div className="card" style={{ borderColor: '#d6f5d6', background: '#f3fff3' }}>{message}</div>}

          <button className="primary" disabled={busy} type="submit">{busy ? 'Creating…' : 'Sign Up'}</button>
        </form>

        <div className="muted" style={{ fontSize: 13 }}>
          Already have an account? <Link to="/login" style={{ textDecoration: 'underline' }}>Login</Link>
        </div>
      </div>
    </div>
  )
}
