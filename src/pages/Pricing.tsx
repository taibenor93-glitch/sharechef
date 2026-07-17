import { Link } from 'react-router-dom'

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
    tag: 'Forever',
    features: [
      'Cook with Micheli, voice guided',
      'Recipes from your own ingredients',
      'Save your favorite recipes',
      'Share your creations',
    ],
  },
  {
    name: 'Pro',
    price: '$4.99/mo',
    tag: 'Coming soon',
    highlight: true,
    features: [
      'Everything in Free',
      'Unlimited saved recipes',
      'Full Micheli Stars progression',
      'Early access to new features',
    ],
  },
  {
    name: 'Family',
    price: '$9.99/mo',
    tag: 'Coming soon',
    features: [
      'Everything in Pro',
      'Peace-of-mind notifications for parents',
      'Multiple family profiles',
      'Priority support',
    ],
  },
]

export function PricingPage() {
  return (
    <div className="container stack">
      <div>
        <div className="eyebrow">Pricing</div>
        <h1 className="page-title">Simple plans, honest promise.</h1>
        <p className="page-sub">
          During launch, everything is free for our founding families, and the
          heart of ShareChef will always have a free plan.
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
          </div>
        ))}
      </div>

      <div className="card-soft" style={{ textAlign: 'center' }}>
        <div className="section-title">Founding families offer</div>
        <p style={{ color: 'var(--ink-soft)', margin: '6px 0 14px' }}>
          Join now, while everything is free. Early members shape what we build next.
        </p>
        <Link to="/" className="btn btn-primary">Start cooking free</Link>
      </div>
    </div>
  )
}
