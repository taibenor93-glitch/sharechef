export async function handleRecipeRequest(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const { ingredients } = await req.json()

  return Response.json({
    text: `Recipe test: ${ingredients.join(", ")}`,
  })
}
