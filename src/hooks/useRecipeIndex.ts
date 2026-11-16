import { useEffect } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabaseClient'
import { onRecipesChanged, syncRecipeIndex } from '../lib/recipeIndex'
import type { RecipeIndexSink } from '../lib/recipeIndex'

// Native side: ios/App/App/AppIntents/RecipeIndexPlugin.swift
const RecipeIndexNative = registerPlugin<RecipeIndexSink>('RecipeIndex')

async function loadSavedRecipes(userId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, description, ingredients, tags, cook_time_minutes')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return data
}

/**
 * Keeps the iPhone's copy of the signed-in user's saved recipes current, so
 * Siri can find them (iOS 27.3+). Refreshes on sign-in, whenever a recipe is
 * saved or deleted, and when the app comes back to the front. Signing out
 * empties it. Pass `undefined` while the sign-in state is still loading.
 *
 * All the behaviour lives in src/lib/recipeIndex.ts, covered by
 * tests/recipe-index.test.mjs. Outside the iPhone app this does nothing.
 */
export function useRecipeIndex(userId: string | null | undefined): void {
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    if (userId === undefined) return // sign-in state not known yet
    const sync = () => { void syncRecipeIndex(RecipeIndexNative, userId, loadSavedRecipes) }
    sync()
    if (!userId) return
    const offChanged = onRecipesChanged(sync)
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      offChanged()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId])
}
