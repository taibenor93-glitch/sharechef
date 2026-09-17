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
}

/**
 * ShareChef Plus paywall. Shown when the free-plan cook limit is reached.
 * Apple review requirements covered here: price and period, auto-renew
 * disclosure, Restore Purchases, Terms of Use and Privacy Policy links.
 */
export function UpgradeSheet({ limit, userId, onClose, onUnlocked, onNeedSignIn }: Props) {
  const [price, setPrice] = useState<string>('$9.99')
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    getPlusPrice(userId).then((p) => { if (alive && p) setPrice(p.priceString) })
    return () => { alive = false }
  }, [userId])

  async function handleBuy() {
    if (!userId) { onNeedSignIn(); return }
    setBusy('buy'); setNote(null)
    const outcome: PurchaseOutcome = await buyPlus(userId)
    setBusy(null)
    if (outcome === 'purchased') { onUnlocked(); return }
    if (outcome === 'cancelled') return
    if (outcome === 'unavailable') { setNote('Plus is not available on this device yet. Please try again from the iPhone app.'); return }
    setNote('Something went wrong with the purchase. You were not charged. Please try again.')
  }

  async function handleRestore() {
    if (!userId) { onNeedSignIn(); return }
    setBusy('restore'); setNote(null)
    const ok = await restorePlus(userId)
    setBusy(null)
    if (ok) { onUnlocked(); return }
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
          You&apos;ve cooked your {limit} free meals this month
        </h2>
        <p style={{ margin: '0 0 18px', opacity: 0.9, fontSize: 15, lineHeight: 1.5 }}>
          Micheli loved cooking with you. Plus keeps her in your kitchen every
          night: unlimited cooks, her memory of how you like things, and your
          dietary safety always on.
        </p>
        <button
          type="button"
          onClick={handleBuy}
          disabled={busy !== null}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
            background: GOLD, color: '#2D0826', fontSize: 16, fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy === 'buy' ? 'Opening App Store…' : `Get Plus · ${price}/month`}
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
