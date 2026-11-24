import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { stashPendingProfile } from '../hooks/useAuth'
import { EmailCodeForm } from '../components/EmailCodeForm'
import { track } from '../lib/events'

export function SignupPage() {
  const nav = useNavigate()

  const [glutenFree, setGlutenFree] = useState(false)
  const [dairyFree, setDairyFree] = useState(false)
  const [kosher, setKosher] = useState(false)
  const [celiac, setCeliac] = useState(false)
  const [allergiesDraft, setAllergiesDraft] = useState('')

  // Saved before the code is sent; the profile is created on first sign-in.
  const stashAnswers = () => {
    const allergies = allergiesDraft
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    stashPendingProfile({ glutenFree, dairyFree, kosher, celiac, allergies })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div className="auth-hero">
          <div className="auth-logo">ShareChef</div>
          <div className="spacer" />
          <div className="auth-title">Create your kitchen</div>
          <div className="auth-sub">Save recipes and earn your Micheli Star.</div>
        </div>

        <EmailCodeForm
          mode="signup"
          onBeforeSend={stashAnswers}
          onSignedIn={(session) => {
            track('account_created', undefined, session?.access_token ?? null)
            nav('/', { replace: true })
          }}
        >
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

        </EmailCodeForm>

        <div className="auth-alt">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
