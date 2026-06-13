import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import OpenAI from 'openai'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app    = express()
const server = createServer(app)
const PORT   = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const CHEF_PROMPT = `You are Micheli, a warm and encouraging personal cooking companion inside ShareChef AI. Your name is Micheli — inspired by the Michelin star tradition of French culinary excellence, but made for everyone at home. You carry a subtle French warmth and elegance in how you speak — refined but never intimidating, like a great chef who makes you feel at ease in the kitchen. IMPORTANT: Micheli is YOUR name. When a user says "Hi Micheli", "Hey Micheli", or "What is your name", you respond as Micheli. Never confuse your name with the user's name. If asked your name, always say "I'm Micheli, your personal cooking companion!"
You speak like a real human chef — warm, confident, friendly, and encouraging. Never robotic.

Your personality:
- You speak to EVERYONE: a tired working mom, a 12-year-old cooking alone, a man trying to impress a date, a student with almost nothing in the fridge.
- You are patient, never judgmental, always positive.
- You guide the user step by step through cooking using ONLY the ingredients they tell you they have.
- You NEVER tell them to buy anything. Ever. Not once.
- Keep responses SHORT and conversational — this is voice. 2–4 sentences max per response.
- Ask one question at a time.
- Use simple language anyone can understand.
- Celebrate small wins ("Perfect! That smells amazing already.")

Start every first conversation by warmly greeting and asking what ingredients they have right now.
As they list ingredients, guide them toward a realistic, simple meal.
Then walk them through cooking it step by step — one step at a time — waiting for them to confirm before moving forward.

IMPORTANT: Always respond in the same language the user is speaking. If they speak Italian, respond in Italian. If they speak Spanish, respond in Spanish. If they speak Japanese, respond in Japanese. Match their language automatically.`

const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17'
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`

// ── REST routes ───────────────────────────────────────────────────────────────

app.post('/api/recipe/generate', async (req, res) => {
  const { ingredients } = req.body
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients array required' })
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' })
  }
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Generate one realistic recipe using ONLY the provided ingredients. Return strict JSON:
{
  "title": "",
  "time": "",
  "difficulty": "Easy" | "Medium" | "Hard",
  "serves": "",
  "ingredients": [],
  "steps": ["Full sentence steps, no numbering"],
  "nutrition": "",
  "tip": "One concise sentence"
}
Never suggest buying additional ingredients.`,
        },
        { role: 'user', content: `Ingredients: ${ingredients.join(', ')}` },
      ],
    })
    res.json(JSON.parse(completion.choices[0].message.content || '{}'))
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

app.post('/chat', async (req, res) => {
  const { messages, model, temperature, max_tokens } = req.body
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 1000,
      }),
    })
    res.status(200).json(await response.json())
  } catch (err) {
    res.status(500).json({ error: 'Chat request failed: ' + err.message })
  }
})

app.get('/token', (_req, res) => res.json({ success: true }))

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', apiKey: Boolean(process.env.OPENAI_API_KEY) })
)

// ── OpenAI Realtime WebSocket proxy ──────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws/realtime' })

wss.on('connection', (browserWs, req) => {
  console.log(`[WS] Browser connected from ${req.socket.remoteAddress}`)

  if (!process.env.OPENAI_API_KEY) {
    browserWs.send(JSON.stringify({ type: 'error', error: { message: 'OPENAI_API_KEY not set on server.' } }))
    browserWs.close(1011, 'Missing API key')
    return
  }

  const openaiWs = new WebSocket(REALTIME_URL, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  })

  let sessionReady = false
  const pending = []

  openaiWs.on('open', () => {
    console.log('[WS] Connected to OpenAI Realtime')
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: CHEF_PROMPT,
        voice: 'nova',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: null,
        temperature: 0.8,
        max_response_output_tokens: 'inf',
      },
    }))
    // Trigger Micheli's opening greeting
    openaiWs.send(JSON.stringify({ type: 'response.create' }))
    sessionReady = true
    for (const msg of pending) {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(msg)
    }
    pending.length = 0
  })

  openaiWs.on('message', (data, isBinary) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data, { binary: isBinary })
  })

  openaiWs.on('error', (err) => {
    console.error('[WS] OpenAI error:', err.message)
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'error', error: { message: `OpenAI error: ${err.message}` } }))
    }
  })

  openaiWs.on('close', (code) => {
    console.log(`[WS] OpenAI closed: ${code}`)
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close(1000)
  })

  browserWs.on('message', (data, isBinary) => {
    if (sessionReady && openaiWs.readyState === WebSocket.OPEN) openaiWs.send(data, { binary: isBinary })
    else pending.push(data)
  })

  browserWs.on('close', (code) => {
    console.log(`[WS] Browser disconnected: ${code}`)
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close(1000)
  })

  browserWs.on('error', (err) => console.error('[WS] Browser error:', err.message))
})

// ── Static (Vite build) ───────────────────────────────────────────────────────

app.use(express.static(join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

server.listen(PORT, () => {
  console.log(`\n  ShareChef AI  →  http://localhost:${PORT}`)
  console.log(`  Realtime WS   →  ws://localhost:${PORT}/ws/realtime`)
  console.log(`  API key       →  ${process.env.OPENAI_API_KEY ? '✓ configured' : '✗ MISSING'}\n`)
})
