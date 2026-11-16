---
name: cook-saved-recipe
description: Finds a recipe the user saved in ShareChef and opens it so they can cook it with Micheli. Use when the user wants to cook, make, or pull up one of their own saved recipes.
---
Use this when the user wants to cook something they already saved in ShareChef.

1. Search first. Call the find saved recipe tool with the dish name, ingredient, or tag the user mentioned. If they gave nothing to search for, ask what they feel like cooking before searching.
2. Look at how many recipes came back.
   - None: say that nothing saved matches, and offer to search again with a different word. Do not open anything.
   - One: say its name and continue to step 3.
   - Several: read out up to three names and ask which one. Wait for the answer.
3. Open the chosen recipe with the cook saved recipe tool. This brings ShareChef to the front on that recipe.

Rules:
- Only use recipes returned by the find saved recipe tool. Never invent a recipe, an ingredient, or a cooking step.
- Never open a recipe the user did not pick or confirm.
- The user may have celiac disease, a food allergy, or keep kosher. Do not suggest swapping or adding ingredients. ShareChef handles that inside the app.
- You cannot see the stove. Do not say anything about whether it is on or off.
