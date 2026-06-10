import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post("/api/recipe", async (req, res) => {
  try {
    const { ingredients, user_id } = req.body;

    if (!ingredients) {
      return res.status(400).json({ error: "Missing ingredients" });
    }

    const prompt = `
Create a recipe using ONLY these ingredients:
${ingredients.join(", ")}

Return STRICT JSON:
{
  "title": "",
  "ingredients": [],
  "instructions": "",
  "cook_time_minutes": 0,
  "servings": 0
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0].message.content;

    let recipe;
    try {
      const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
      recipe = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: "AI returned invalid JSON", raw: text });
    }

    const { data, error } = await supabase.from("recipes").insert([
      {
        user_id,
        title: recipe.title,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        cook_time_minutes: recipe.cook_time_minutes,
        servings: recipe.servings,
      },
    ]);

    if (error) return res.status(500).json(error);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
