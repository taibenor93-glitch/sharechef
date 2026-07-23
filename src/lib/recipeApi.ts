// Client for the server recipe generator. Shape maps directly to the `recipes` table.
import { API_BASE } from './apiBase'
export interface GeneratedRecipe {
  title: string
  description: string
  ingredients: string[]
  steps: string[]
  cook_time_minutes: number | null
  servings: number | null
  tags: string[]
  tip: string
}

export async function generateRecipe(
  ingredients: string[],
  language = 'English',
  accessToken?: string | null
): Promise<GeneratedRecipe> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Signed-in users get their dietary rules applied server-side.
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${API_BASE}/api/recipe/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ingredients, language }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`Recipe service error (${res.status}). ${msg}`.trim())
  }
  const data = (await res.json()) as Partial<GeneratedRecipe>
  return {
    title: data.title ?? 'Untitled dish',
    description: data.description ?? '',
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    steps: Array.isArray(data.steps) ? data.steps : [],
    cook_time_minutes: data.cook_time_minutes ?? null,
    servings: data.servings ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    tip: data.tip ?? '',
  }
}
