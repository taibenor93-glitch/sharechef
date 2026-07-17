import { Link } from 'react-router-dom'

export function AboutPage() {
  return (
    <div className="container stack">
      <div>
        <div className="eyebrow">Our story</div>
        <h1 className="page-title">Every kitchen deserves a chef.</h1>
        <p className="page-sub">
          ShareChef was built by one person, one late night at a time.
        </p>
      </div>

      <div className="card stack">
        <p>
          A year ago, our founder Tai had a simple thought standing in front of an
          open fridge: what if anyone could cook a real dinner with whatever is
          already in there? No shopping trips, no recipes to scroll through, no
          stress. Just a warm voice guiding you, like a friend standing beside
          you at the stove.
        </p>
        <p>
          That voice became <strong>Micheli</strong>, a personal chef who listens
          to what you have, builds a meal around it, and walks you through every
          step out loud, hands free. She never judges, never asks you to buy
          anything, and she celebrates with you when it works.
        </p>
        <p>
          ShareChef was built independently. No company, no team. We
          believe a personal chef shouldn&apos;t be a luxury. Every family, every
          student, every busy parent staring at the fridge at 7pm deserves one.
        </p>
        <p>
          We&apos;re just getting started. Save your favorite recipes, share your
          creations, earn Micheli Stars, and grow from Commis all the way to
          Micheli Chef.
        </p>
      </div>

      <div className="row" style={{ justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/" className="btn btn-primary">Cook with Micheli</Link>
        <Link to="/faq" className="btn btn-ghost">Read the FAQ</Link>
        <Link to="/pricing" className="btn btn-ghost">Pricing</Link>
      </div>
    </div>
  )
}
