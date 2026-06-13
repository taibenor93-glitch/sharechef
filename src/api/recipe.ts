export interface RecipeResult {
  title: string
  time: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  serves: string
  ingredients: string[]
  steps: string[]
  nutrition: string
  tip: string
}

function formatRecipe(r: RecipeResult): string {
  const lines: string[] = [
    r.title,
    `${r.difficulty} · ${r.time} · Serves ${r.serves}`,
    '',
    r.ingredients.map((i) => `• ${i}`).join('\n'),
    '',
    r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    `Tip: ${r.tip}`,
  ]
  return lines.join('\n')
}

export async function generateRecipe(ingredients: string[], _language = 'en'): Promise<string> {
  try {
    const res = await fetch('/api/recipe/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients }),
    })
    if (!res.ok) throw new Error(`Server error ${res.status}`)
    const recipe = (await res.json()) as RecipeResult
    return formatRecipe(recipe)
  } catch (err) {
    console.error('[recipe] generation failed:', err)
    return `Here's a simple idea with ${ingredients.join(', ')} — I'll guide you through it step by step.`
  }
}
