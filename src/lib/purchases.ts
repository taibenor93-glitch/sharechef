// ShareChef Plus purchases (Apple in-app subscription via RevenueCat).
//
// Native iOS only. On the web build every call is a safe no-op that reports
// "not available", so the paywall can render the same everywhere.
//
// Source of truth for "is this user on Plus" is the server (profiles.plan),
// which re-checks RevenueCat on every /api/plus/sync call. The client only
// triggers the purchase and then asks the server to sync.

import { Capacitor } from '@capacitor/core'
import { supabase } from './supabaseClient'
import { API_BASE } from './apiBase'

// Public SDK key. Safe to ship in the client (it can only read this user's own
// purchases). The secret key never leaves RevenueCat's dashboard.
const RC_PUBLIC_KEY = 'appl_GyazTyXgyVjKUwepwiTFyMXEIVp'
export const PLUS_PRODUCT_ID = 'com.sharechef.app.plus.monthly'
export const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
export const PRIVACY_URL = 'https://sharechef-production.up.railway.app/privacy.html'

export type PlusPrice = { priceString: string; period: string } | null
/**
 * 'purchased'  Apple took the payment AND Plus is active.
 * 'pending'    Apple took the payment, but the entitlement is not visible yet
 *              (RevenueCat or our own server lagged). NEVER tell this user they
 *              were not charged — they were.
 * 'cancelled'  The user dismissed Apple's sheet. No payment, no error.
 * 'unavailable' Purchases can't run here at all (web build, product not live).
 * 'error'      The purchase failed before payment. Nothing was charged.
 */
export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled' | 'unavailable' | 'error'
/** Restore result, kept distinct: "nothing to restore" is not the same as "can't check". */
export type RestoreOutcome = 'restored' | 'none' | 'unavailable'

let configuredFor: string | null = null

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

// Loaded lazily so the web bundle never touches the native plugin.
async function sdk() {
  const mod = await import('@revenuecat/purchases-capacitor')
  return mod
}

/** Configure once per signed-in user. Safe to call repeatedly. */
export async function configurePurchases(userId: string): Promise<boolean> {
  if (!isNative() || !userId) return false
  if (configuredFor === userId) return true
  try {
    const { Purchases } = await sdk()
    await Purchases.configure({ apiKey: RC_PUBLIC_KEY, appUserID: userId })
    configuredFor = userId
    return true
  } catch (err) {
    console.error('[plus] configure failed', err)
    return false
  }
}

/** Store price for the paywall. Null when unavailable (web, offline, not yet approved). */
export async function getPlusPrice(userId: string): Promise<PlusPrice> {
  if (!(await configurePurchases(userId))) return null
  try {
    const { Purchases } = await sdk()
    const { products } = await Purchases.getProducts({ productIdentifiers: [PLUS_PRODUCT_ID] })
    const p = products.find((x) => x.identifier === PLUS_PRODUCT_ID)
    if (!p) return null
    return { priceString: p.priceString, period: 'month' }
  } catch (err) {
    console.error('[plus] price lookup failed', err)
    return null
  }
}

function hasPlus(customerInfo: { entitlements: { active: Record<string, unknown> }; activeSubscriptions: string[] }): boolean {
  if (customerInfo.activeSubscriptions?.includes(PLUS_PRODUCT_ID)) return true
  return Object.keys(customerInfo.entitlements?.active ?? {}).length > 0
}

/**
 * Runs the Apple purchase sheet, then makes the server record the plan.
 *
 * The hard rule here: once `purchaseStoreProduct` RESOLVES, Apple has taken the
 * money. Everything after that point is our bookkeeping catching up, and a
 * failure in it must never be reported to the user as a failed purchase.
 */
export async function buyPlus(userId: string): Promise<PurchaseOutcome> {
  if (!(await configurePurchases(userId))) return 'unavailable'
  let charged = false
  try {
    const { Purchases } = await sdk()
    const { products } = await Purchases.getProducts({ productIdentifiers: [PLUS_PRODUCT_ID] })
    const product = products.find((x) => x.identifier === PLUS_PRODUCT_ID)
    if (!product) return 'unavailable'
    const result = await Purchases.purchaseStoreProduct({ product })
    charged = true
    // The server is the gate, so its answer is the one that matters. Retry it:
    // one blip in the billing lookup would otherwise drop a paying customer
    // straight back onto the paywall they just paid to get past.
    const plan = await syncPlusWithServer({ retries: 3 })
    if (plan === 'plus') return 'purchased'
    // Server couldn't confirm. Fall back to what Apple/RevenueCat told the
    // device; if that agrees, the cook can start and the server will catch up.
    if (hasPlus(result.customerInfo)) return 'purchased'
    return 'pending'
  } catch (err) {
    if (charged) {
      // Thrown after payment (sync or entitlement read). Payment still stands.
      console.error('[plus] post-purchase bookkeeping failed', err)
      return 'pending'
    }
    const code = (err as { code?: string })?.code
    try {
      const { PURCHASES_ERROR_CODE } = await sdk()
      if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled'
    } catch { /* fall through */ }
    console.error('[plus] purchase failed', err)
    return 'error'
  }
}

/** Apple requires a visible Restore button. */
export async function restorePlus(userId: string): Promise<RestoreOutcome> {
  if (!(await configurePurchases(userId))) return 'unavailable'
  try {
    const { Purchases } = await sdk()
    const { customerInfo } = await Purchases.restorePurchases()
    const plan = await syncPlusWithServer({ retries: 2 })
    return plan === 'plus' || hasPlus(customerInfo) ? 'restored' : 'none'
  } catch (err) {
    console.error('[plus] restore failed', err)
    return 'unavailable'
  }
}

/**
 * Server re-checks RevenueCat and writes profiles.plan. Returns the plan, or
 * null when the server could not confirm (network, billing lookup, or the plan
 * write itself failing — the server only reports a plan it actually stored).
 */
export async function syncPlusWithServer(opts: { retries?: number } = {}): Promise<'free' | 'plus' | null> {
  const attempts = Math.max(1, (opts.retries ?? 0) + 1)
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700 * i))
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return null
      const res = await fetch(`${API_BASE}/api/plus/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) return null // signed out: retrying cannot help
      if (!res.ok) continue
      const body = (await res.json()) as { plan?: string }
      return body.plan === 'plus' ? 'plus' : 'free'
    } catch (err) {
      console.error('[plus] sync failed', err)
    }
  }
  return null
}

/** Where the user manages or cancels the subscription (Apple's own screen). */
export const MANAGE_SUBSCRIPTION_URL = 'https://apps.apple.com/account/subscriptions'
