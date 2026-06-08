import dotenv from "dotenv";
import express from "express";
import cors from "cors";

console.log = () => {};

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const app = express();
const PORT = 3000;

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
  })
);
app.use(express.json());

app.post("/chat", async (req, res) => {
  const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("YOUR") || apiKey.includes("your-")) {
    return res.status(500).json({
      error:
        "Missing/placeholder Gemini API key. Set VITE_GEMINI_API_KEY in .env.local and restart the server.",
    });
  }

  try {
    // Convert OpenAI format to Gemini format
    const { messages, model, temperature, max_tokens } = req.body;
    
    // Convert messages to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Use Gemini API
    const geminiModel = model?.includes('gpt-4') ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: contents,
          generationConfig: {
            temperature: temperature || 0.7,
            maxOutputTokens: max_tokens || 1000,
          }
        }),
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || "Gemini API request failed" 
      });
    }

    // Convert Gemini response to OpenAI format
    const openAIFormat = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: geminiModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };

    res.status(200).json(openAIFormat);
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Chat request failed: " + error.message });
  }
});

app.get("/token", async (_req, res) => {
  // For Gemini Live, the token is handled directly in the frontend
  // This endpoint returns a success response for compatibility
  res.status(200).json({ 
    message: "Using Gemini Live - no token needed from server",
    success: true 
  });
});

const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.error(`✅ Server running on http://localhost:${PORT}`);
  console.error(`✅ Using Gemini API for chat`);
});