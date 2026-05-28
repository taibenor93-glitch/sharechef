import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import OpenAI from 'openai';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/generate', async (req, res) => {
  const { ingredients } = req.body;

  if (!ingredients || ingredients.trim() === '') {
    return res.status(400).json({ error: 'No ingredients provided.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are ShareChef AI, a personal kitchen assistant. Generate one realistic weeknight recipe using ONLY the ingredients the user provides. Never suggest additional purchases.

Respond ONLY in this exact JSON format:
{
  "title": "Recipe Title",
  "time": "25 minutes",
  "difficulty": "Easy",
  "serves": "2–4",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "steps": ["Full sentence step with no number prefix", "Next step as a full sentence"],
  "nutrition": "Approx. 450 calories, 35g protein",
  "tip": "One practical sentence that elevates the dish"
}

Rules:
- difficulty must be exactly one of: "Easy", "Medium", or "Hard"
- steps must NOT include "Step 1:", "Step 2:" or any numeric prefix — write each as a plain sentence
- tip must be a single concise sentence`
        },
        {
          role: 'user',
          content: `I have these ingredients: ${ingredients}. What can I make?`
        }
      ],
      response_format: { type: 'json_object' }
    });

    const recipe = JSON.parse(completion.choices[0].message.content);
    res.json(recipe);

  } catch (error) {
    console.error('OpenAI error:', error.message);
    res.status(500).json({ error: 'Failed to generate recipe.' });
  }
});

export default router;
