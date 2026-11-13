import type { Recipe } from '../types/recipe'

// The App Store page for ShareChef AI (Apple ID 6787142176).
export const APP_STORE_LINK = 'https://apps.apple.com/app/sharechef-ai/id6787142176'

// The text that travels with a shared recipe photo. Plain text only: it has to
// read the same in Messages, Notes, a caption, or the clipboard.
export function recipeShareText(recipe: Pick<Recipe, 'title' | 'ingredients' | 'steps' | 'nutrition'>): string {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : []
  const steps = Array.isArray(recipe.steps) ? recipe.steps : []
  return [
    recipe.title,
    'From my cook with Micheli',
    '',
    'Ingredients:',
    '',
    ...ingredients.map((i) => `* ${i}`),
    '',
    'Steps:',
    '',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    ...(recipe.nutrition ? [`🥗 Nutrition (per serving, estimate): ${recipe.nutrition}`, ''] : []),
    `Get ShareChef AI on the App Store: ${APP_STORE_LINK}`,
  ].join('\n')
}
