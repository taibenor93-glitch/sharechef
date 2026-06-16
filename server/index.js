supabase.from("recipes").insert([
  {
    user_id,
    title: recipe.title,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    cook_time_minutes: recipe.cook_time_minutes,
    servings: recipe.servings,
  },
]).then(({ error }) => {
  if (error) console.error("Supabase insert error:", error);
});