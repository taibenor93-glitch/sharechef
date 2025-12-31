export async function generateRecipe(ingredients: string[]) {
  return `Got it — ${ingredients.join(" and ")}. I'll start your recipe now.`
}
