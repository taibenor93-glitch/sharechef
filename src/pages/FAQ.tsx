import { Link } from 'react-router-dom'

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is ShareChef?',
    a: 'ShareChef is a voice cooking companion. You talk to Micheli, your personal chef: tell her what ingredients you have, and she guides you through a real meal step by step, out loud, hands free.',
  },
  {
    q: 'Is ShareChef free?',
    a: 'Yes — during our launch, everything is free for our founding families. Paid plans (Pro and Family) are coming later with extra features, and the heart of ShareChef will always have a free plan.',
  },
  {
    q: 'Do I need to plan meals or find recipes first?',
    a: 'No. That is the whole point. Open your fridge, tell Micheli what you see, and she builds the meal around what you already have. No scrolling, no shopping list.',
  },
  {
    q: 'Which devices does it work on?',
    a: 'iPhone: download ShareChef AI from the App Store. Android and computers: use the web app in your browser — same Micheli, no installation needed.',
  },
  {
    q: 'Micheli cannot hear me — what do I do?',
    a: 'Check your microphone permission. On iPhone: Settings → ShareChef AI → Microphone → On. In a browser: tap Allow when the site asks for your microphone, then refresh. Micheli cannot cook with you if she cannot hear you.',
  },
  {
    q: 'What are Micheli Stars?',
    a: 'Our chef ladder. Saving recipes and sharing your creations earns you Micheli Stars, and you climb the ranks: Commis, Cook, Chef de Partie, Sous Chef, and finally Micheli Chef. Each month our top chef is featured as Chef of the Month.',
  },
  {
    q: 'Is it safe for kids and beginners?',
    a: 'Micheli guides one small step at a time and waits for you before moving on — built for first-time cooks. As with any cooking, an adult should decide what is age-appropriate in their own kitchen.',
  },
  {
    q: 'How do I share feedback or get help?',
    a: 'We read everything. Reach out through our social pages, or leave a review on the App Store — early feedback shapes what we build next.',
  },
]

export function FAQPage() {
  return (
    <div className="container stack">
      <div>
        <div className="eyebrow">Help</div>
        <h1 className="page-title">Frequently asked questions</h1>
        <p className="page-sub">Everything people ask us about cooking with Micheli.</p>
      </div>

      {FAQS.map((f) => (
        <div className="card-soft" key={f.q}>
          <div className="section-title">{f.q}</div>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)' }}>{f.a}</p>
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
        <Link to="/" className="btn btn-primary">Start cooking</Link>
        <Link to="/about" className="btn btn-ghost">About us</Link>
      </div>
    </div>
  )
}
