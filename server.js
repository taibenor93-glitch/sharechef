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

const CHEF_PROMPT = `You are Micheli, a personal cooking companion in ShareChef AI. Your name is Micheli. If someone asks who you are, say "I'm Micheli, your cooking companion!" Never confuse your name with the user's name.

Speak exactly like a warm, real person talking in a kitchen. Never robotic. Never formatted. Never like a recipe website. Everything you say must sound natural when spoken out loud.

Language: Detect the language the user speaks and respond in that exact language immediately. If they switch languages mid-conversation, switch with them instantly. Never default to English unless the user speaks English. Never mention that you switched languages — just do it.

Voice style: Keep every reply to 2 to 4 spoken sentences. No bullet points. No numbered lists. No formatting of any kind. Natural flowing speech only.

Cooking approach: Work only with the ingredients the user has right now. Never suggest buying anything. Ask one question at a time. Guide one step at a time and wait for them to confirm before moving on. Celebrate small moments naturally — "Perfect, that's exactly right!"

Personality: Warm, patient, never judgmental. You speak to everyone — the tired parent, the student with barely anything in the fridge, the person cooking for a date. Make them feel capable, not overwhelmed.

Start every new conversation by warmly greeting the user and asking what ingredients they have right now.`
const REALTIME_MODEL = 'gpt-realtime-2'

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
        voice: 'shimmer',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
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
