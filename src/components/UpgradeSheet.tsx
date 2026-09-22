import { useEffect, useState } from 'react'
import { buyPlus, getPlusPrice, restorePlus, PRIVACY_URL, TERMS_URL } from '../lib/purchases'
import type { PurchaseOutcome } from '../lib/purchases'

const GOLD = '#E4B357'

type Props = {
  used: number
  limit: number
  /** Signed-in Supabase user id. Null for guests (they are sent to sign in). */
  userId: string | null
  onClose: () => void
  /** Called after a successful purchase or restore, so the caller can retry the cook. */
  onUnlocked: () => void
  /** Guests need an account before buying. */
  onNeedSignIn: () => void
  /** Optional headline override (e.g. when opened from the Pricing page, not the limit). */
  headline?: string
}

/**
 * ShareChef Plus paywall. Shown when the free-plan cook limit is reached.
 * Apple review requirements covered here: price and period, auto-renew
 * disclosure, Restore Purchases, Terms of Use and Privacy Policy links.
 */
export function UpgradeSheet({ limit, userId, onClose, onUnlocked, onNeedSignIn, headline }: Props) {
  const [price, setPrice] = useState<string>('$9.99')
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Whether the App Store actually handed us the product. A failed lookup used
  // to look identical to a successful one, because `price` falls back to a
  // hardcoded string — so the button stayed lit and buying it did nothing.
  const [product, setProduct] = useState<'checking' | 'ready' | 'unavailable'>('checking')

  useEffect(() => {
    if (!userId) return
    let alive = true
    getPlusPrice(userId).then((p) => {
      if (!alive) return
      if (p) { setPrice(p.priceString); setProduct('ready'); return }
      setProduct('unavailable')
      setNote('We could not load ShareChef Plus from the App Store. Please check your connection and try again in a moment.')
    })
    return () => { alive = false }
  }, [userId])

  async function handleBuy() {
    if (!userId) { onNeedSignIn(); return }
    setBusy('buy'); setNote(null)
    const outcome: PurchaseOutcome = await buyPlus(userId)
    setBusy(null)
    if (outcome === 'purchased') { onUnlocked(); return }
    if (outcome === 'cancelled') return
    if (outcome === 'unavailable') {
      setNote('ShareChef Plus is not available to buy right now. Please try again in a few minutes.')
      return
    }
    if (outcome === 'pending') {
      // Apple took the payment; only our record of it is behind. Saying
      // "you were not charged" here would be a lie to a paying customer.
      setNote('Your purchase went through. It is taking a moment to activate — tap Restore Purchases in a minute and you are all set.')
      return
    }
    setNote('The purchase did not go through and you were not charged. Please try again.')
  }

  async function handleRestore() {
    if (!userId) { onNeedSignIn(); return }
    setBusy('restore'); setNote(null)
    const outcome = await restorePlus(userId)
    setBusy(null)
    if (outcome === 'restored') { onUnlocked(); return }
    if (outcome === 'unavailable') {
      setNote('We could not reach the App Store to check. Please check your connection and try again.')
      return
    }
    setNote('No ShareChef Plus subscription found for this Apple ID.')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ShareChef Plus"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(20, 4, 17, 0.72)', padding: 16,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 420, borderRadius: 18, padding: '28px 24px',
          background: '#2D0826', border: `1px solid ${GOLD}`,
          color: '#F6EDF3', textAlign: 'center',
        }}
      >
        <div style={{ color: GOLD, letterSpacing: 2, fontSize: 12, marginBottom: 10 }}>SHARECHEF PLUS</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 22, lineHeight: 1.25 }}>
          {headline ?? <>You&apos;ve cooked your {limit} free meals this month</>}
        </h2>
        <p style={{ margin: '0 0 18px', opacity: 0.9, fontSize: 15, lineHeight: 1.5 }}>
          Micheli loved cooking with you. Plus keeps her in your kitchen every
          night: unlimited cooks, her memory of how you like things, and your
          dietary safety always on.
        </p>
        <button
          type="button"
          onClick={handleBuy}
          disabled={busy !== null || product === 'unavailable'}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
            background: GOLD, color: '#2D0826', fontSize: 16, fontWeight: 700,
            cursor: busy ? 'wait' : product === 'unavailable' ? 'not-allowed' : 'pointer',
            opacity: busy || product === 'unavailable' ? 0.55 : 1,
          }}
        >
          {busy === 'buy'
            ? 'Opening App Store…'
            : product === 'unavailable'
              ? 'Plus is unavailable right now'
              : `Get Plus · ${price}/month`}
        </button>
        {!userId && (
          <p style={{ margin: '10px 0 0', fontSize: 13, opacity: 0.8 }}>
            Sign in first so Plus follows you on every device.
          </p>
        )}
        {note && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#F3C6C6' }}>{note}</p>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={busy !== null}
          style={{
            marginTop: 12, background: 'none', border: 'none', color: '#F6EDF3',
            opacity: 0.75, fontSize: 14, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Not tonight
        </button>
        <p style={{ margin: '14px 0 0', fontSize: 12, opacity: 0.6, lineHeight: 1.5 }}>
          Your free plan stays. Free cooks reset on the 1st.
          <br />
          {price} per month, billed to your Apple ID. Renews automatically until
          cancelled in your App Store settings, at least 24 hours before the end
          of the current period.
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.7 }}>
          <button
            type="button"
            onClick={handleRestore}
            disabled={busy !== null}
            style={{ background: 'none', border: 'none', color: GOLD, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            {busy === 'restore' ? 'Restoring…' : 'Restore Purchases'}
          </button>
          {' · '}
          <a href={TERMS_URL} target="_blank" rel="noreferrer" style={{ color: GOLD }}>Terms of Use</a>
          {' · '}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={{ color: GOLD }}>Privacy Policy</a>
        </p>
      </div>
    </div>
  )
}
