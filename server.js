import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }
  const { messages, model, temperature, max_tokens } = req.body;
  try {
    const systemMessage = {
  role: "system",
  content: "You are Micheli, a calm guided cooking assistant. Give one step at a time. Wait for the user before continuing. Never rush."
};
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [systemMessage, ...messages],
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 1000
      })
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Chat request failed: " + error.message });
  }
});

app.get("/token", async (_req, res) => {
  res.status(200).json({ success: true });
});


app.use(express.static(path.resolve('dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'));
});

app.listen(PORT, () => {
  console.error(`✅ Server running on http://localhost:${PORT}`);
  console.error(`✅ Using OpenAI API for chat`);
});
