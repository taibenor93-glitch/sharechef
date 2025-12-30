console.log("ENV URL:", import.meta.env.VITE_SUPABASE_URL ? "OK" : "MISSING")
console.log("ENV KEY:", import.meta.env.VITE_SUPABASE_ANON_KEY ? "OK" : "MISSING")
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // This is intentionally loud for first-time setup.
  // The app will still render, but Supabase operations will fail until env vars are set.
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Create a .env file (see README).')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')


console.log("ENV URL:", import.meta.env.VITE_SUPABASE_URL ? "OK" : "MISSING")