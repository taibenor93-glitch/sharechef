import { supabase } from './supabaseClient'

export type ShareChannel = 'native' | 'whatsapp' | 'x' | 'facebook' | 'copy' | 'linkedin' | 'instagram' | 'tiktok'

// Record a share for the signed-in user. Guests earn nothing (returns false).
export async function recordShare(
  channel: ShareChannel,
  recipeId?: string | null
): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser()
    const userId = data.user?.id
    if (!userId) return false
    const { error } = await supabase.from('shares').insert({
      user_id: userId,
      recipe_id: recipeId ?? null,
      channel,
    })
    return !error
  } catch {
    return false
  }
}

// Total shares for a user — counts toward Micheli Stars.
export async function countShares(userId: string): Promise<number> {
  const { count } = await supabase
    .from('shares')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}
