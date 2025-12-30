import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export function LoginPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)

    if (error) return setError(error.message)

    nav('/', { replace: true })
  }

  return (
    <div className="container">
      <div className="card stack" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div>
          <div className="h1">Login</div>
          <div className="muted">Use your email + password.</div>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <div className="stack">
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Email</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Password</div>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Your password" />
            </div>
          </div>

          {error && <div className="card" style={{ borderColor: '#ffd4d4', background: '#fff5f5' }}>{error}</div>}

          <button className="primary" disabled={busy} type="submit">{busy ? 'Logging in…' : 'Login'}</button>
        </form>

        <div className="muted" style={{ fontSize: 13 }}>
          No account? <Link to="/signup" style={{ textDecoration: 'underline' }}>Sign up</Link>
        </div>
      </div>
    </div>
  )
}
