import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { usePageMeta } from '../hooks/usePageMeta'
import { useAuth } from '../hooks/useAuth'
import { UpgradeSheet } from '../components/UpgradeSheet'
import { restorePlus, MANAGE_SUBSCRIPTION_URL } from '../lib/purchases'

interface Plan {
  name: string
  price: string
  tag: string
  features: string[]
  highlight?: boolean
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    tag: 'Stays free',
    features: [
      '3 cooks with Micheli every month',
      'Voice guided, hands free',
      'Recipes from your own ingredients',
      'Save and share your creations',
    ],
  },
  {
    name: 'ShareChef Plus',
    price: '$9.99/mo',
    tag: 'Unlimited',
    highlight: true,
    features: [
      'Unlimited cooks with Micheli',
      'Everything in Free',
      'Micheli remembers how you like things',
      'Dietary safety always on',
      'Cancel anytime in your App Store settings',
    ],
  },
]

export function PricingPage() {
  const nav = useNavigate()
  const { userId } = useAuth()
  const isNative = Capacitor.isNativePlatform()
  const [showPaywall, setShowPaywall] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)

  // A button labelled "Restore purchases" has to restore purchases. It used to
  // open the buy sheet instead, which is exactly the thing App Review flags.
  async function handleRestore() {
    if (!userId) { nav('/login'); return }
    setRestoring(true); setRestoreNote(null)
    const outcome = await restorePlus(userId)
    setRestoring(false)
    if (outcome === 'restored') { setRestoreNote('ShareChef Plus is active again. Enjoy.'); return }
    if (outcome === 'unavailable') {
      setRestoreNote('We could not reach the App Store to check. Please check your connection and try again.')
      return
    }
    setRestoreNote('No ShareChef Plus subscription found for this Apple ID.')
  }
  usePageMeta(
    'ShareChef Pricing: Free plan and ShareChef Plus',
    'ShareChef has a free plan that stays: 3 cooks with Micheli a month. ShareChef Plus is $9.99 a month for unlimited cooks.'
  )
  return (
    <div className="container stack">
      <div>
        <div className="eyebrow">Pricing</div>
        <h1 className="page-title">Simple plans, honest promise.</h1>
        <p className="page-sub">
          Three cooks a month with Micheli, free, for as long as ShareChef exists.
          Cooking every night? Plus takes the limit off.
        </p>
      </div>

      <div className="grid">
        {PLANS.map((p) => (
          <div className={p.highlight ? 'card stack recipe-card' : 'card stack'} key={p.name}>
            <div>
              <div className="eyebrow">{p.tag}</div>
              <div className="recipe-title" style={{ marginTop: 4 }}>{p.name}</div>
              <div className="page-sub" style={{ marginTop: 2, fontSize: 26, fontFamily: 'var(--display)' }}>
                {p.price}
              </div>
            </div>
            <ul style={{ margin: 0 }}>
              {p.features.map((f) => (
                <li key={f} style={{ color: 'var(--ink-soft)', marginBottom: 7 }}>{f}</li>
              ))}
            </ul>
            {p.highlight && isNative && (
              <button type="button" className="btn btn-primary" onClick={() => setShowPaywall(true)}>
                Get Plus, {p.price}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="card-soft" style={{ textAlign: 'center' }}>
        <div className="section-title">Start with the free plan</div>
        <p style={{ color: 'var(--ink-soft)', margin: '6px 0 14px' }}>
          {isNative
            ? 'Plus is billed through your Apple ID and renews monthly until you cancel.'
            : 'Plus is bought inside the iPhone app, billed through your Apple ID, and renews monthly until you cancel.'}
        </p>
        <Link to="/" className="btn btn-primary">Start cooking</Link>
        {isNative && (
          <div style={{ marginTop: 10, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="link-btn" onClick={handleRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Restore purchases'}
            </button>
            {/* Apple's own screen — the only place a subscription can actually
                be changed or cancelled. Required to be findable in the app. */}
            <a href={MANAGE_SUBSCRIPTION_URL} target="_blank" rel="noreferrer" className="link-btn">
              Manage subscription
            </a>
          </div>
        )}
        {restoreNote && (
          <p style={{ color: 'var(--ink-soft)', margin: '10px 0 0', fontSize: 13 }}>{restoreNote}</p>
        )}
      </div>

      {showPaywall && (
        <UpgradeSheet
          used={0}
          limit={3}
          userId={userId}
          headline="Cook with Micheli every night"
          onClose={() => setShowPaywall(false)}
          onUnlocked={() => { setShowPaywall(false); nav('/') }}
          onNeedSignIn={() => { setShowPaywall(false); nav('/login') }}
        />
      )}
    </div>
  )
}
