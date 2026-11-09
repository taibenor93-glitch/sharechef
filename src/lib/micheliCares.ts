// Micheli Cares: parent check-ins when a teen cooks with Micheli.
// Database: supabase/migrations/20261109120000_micheli_cares.sql
// iPhone side: ios/App/App/MicheliCaresPlugin.swift
// Server side: micheli-cares.js (sends the check-ins)
import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from './supabaseClient'

interface MicheliCaresPlugin {
  register(): Promise<{ granted: boolean; token?: string }>
  status(): Promise<{ permission: 'granted' | 'denied' | 'notDetermined' }>
}

const MicheliCaresNative = registerPlugin<MicheliCaresPlugin>('MicheliCares')

export type CaresLink = {
  parentId: string
  teenId: string
  teenName: string
}

/** Check-ins arrive as iPhone/iPad notifications, so the parent side needs the app. */
export function canReceiveCheckIns(): boolean {
  return Capacitor.getPlatform() === 'ios'
}

// No I, O, 0 or 1, so a code read aloud across the kitchen is never misheard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_MINUTES = 10

function randomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  // 256 is a multiple of 32, so every letter is equally likely.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/** Teen side: make a fresh 6-character code the parent types in. */
export async function createLinkCode(teenId: string, teenName: string): Promise<{ code: string; expiresAt: Date }> {
  const name = teenName.trim().slice(0, 40)
  if (!name) throw new Error('Add your first name first.')
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode()
    const expiresAt = new Date(Date.now() + CODE_MINUTES * 60 * 1000)
    const { error } = await supabase
      .from('cares_link_codes')
      .upsert({ teen_id: teenId, code, teen_name: name, expires_at: expiresAt.toISOString() })
    if (!error) return { code, expiresAt }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message)
    // Another teen holds that exact code right now: try a new one.
  }
  throw new Error('Could not make a code. Please try again.')
}

/** Parent side: type the teen's code. Returns the teen's name, or null if wrong/expired. */
export async function redeemLinkCode(code: string): Promise<string | null> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length !== 6) return null
  const { data, error } = await supabase.rpc('cares_redeem_code', { p_code: clean })
  if (error) throw new Error(error.message)
  return typeof data === 'string' && data ? data : null
}

/** Everyone this account is connected to, as parent or as teen. */
export async function listLinks(): Promise<CaresLink[]> {
  const { data, error } = await supabase.from('cares_links').select('parent_id, teen_id, teen_name')
  if (error) throw new Error(error.message)
  return (data || []).map((r: any) => ({ parentId: r.parent_id, teenId: r.teen_id, teenName: r.teen_name }))
}

export async function removeLink(link: CaresLink): Promise<void> {
  const { error } = await supabase
    .from('cares_links')
    .delete()
    .eq('parent_id', link.parentId)
    .eq('teen_id', link.teenId)
  if (error) throw new Error(error.message)
}

/** Parent side: ask iOS for permission, then save this phone's push address. */
export async function turnOnCheckInsOnThisPhone(userId: string): Promise<'on' | 'denied'> {
  if (!canReceiveCheckIns()) throw new Error('Check-ins arrive on iPhone and iPad.')
  const result = await MicheliCaresNative.register()
  if (!result.granted || !result.token) return 'denied'
  const { error } = await supabase
    .from('cares_push_tokens')
    .upsert({ user_id: userId, token: result.token, platform: 'ios', updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  return 'on'
}

/** Parent side: has this phone already been turned on? */
export async function checkInsPermission(): Promise<'granted' | 'denied' | 'notDetermined' | 'unsupported'> {
  if (!canReceiveCheckIns()) return 'unsupported'
  try {
    const { permission } = await MicheliCaresNative.status()
    return permission
  } catch {
    return 'unsupported' // older app build without the plugin
  }
}
