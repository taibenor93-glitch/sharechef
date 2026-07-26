import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[ShareChef] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.')
}

// On iPhone/iPad the app used to keep the login in WKWebView localStorage,
// which iOS is free to purge — logins silently evaporated and every voice
// session ran as a guest. Native builds now store the session in Capacitor
// Preferences (backed by iOS UserDefaults), which survives restarts, app
// updates, and storage cleanups. The website keeps default browser storage.
const nativeStorage = {
  getItem: async (key: string): Promise<string | null> =>
    (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string): Promise<void> => {
    await Preferences.set({ key, value })
  },
  removeItem: async (key: string): Promise<void> => {
    await Preferences.remove({ key })
  },
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: Capacitor.isNativePlatform()
    ? { storage: nativeStorage, persistSession: true, autoRefreshToken: true }
    : undefined,
})
