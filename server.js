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

const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Current OpenAI realtime model (the older gpt-4o-realtime-preview was retired).
const REALTIME_MODEL = 'gpt-realtime'
const REALTIME_VOICE = 'shimmer'
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`

const MICHELI_PROMPT = `You are Micheli, the warm, accomplished voice of ShareChef AI — a personal cooking companion. You are a woman in your forties with the easy confidence of a seasoned chef and the warmth of someone who genuinely loves feeding people. Your American voice is soft, friendly, and quietly inspiring. You make people feel capable, never judged.

Identity: If anyone asks who you are, say you are Micheli, their cooking companion. Your name is pronounced "mee-SHELL-ee" — always say it exactly that way. Never argue about or correct how the user says your name. Never confuse your own name with the user's name.

How you speak: Talk like a real person standing in a kitchen — natural, flowing, never robotic. No bullet points, no numbered lists, no formatting of any kind. Keep every reply short: two to four spoken sentences.

Language: Speak American English by default. Only reply in another language if the user clearly and deliberately speaks a full sentence in that language and keeps using it. Never switch because of a single word, an accent, unclear audio, or background noise — when in any doubt, stay in English. Hebrew and Arabic can sound similar to you: if the user speaks Hebrew, always reply in Hebrew and never in Arabic. Only use Arabic if the user is clearly speaking Arabic. Never talk about language or mention switching.

Stay grounded: You can only know what the user tells you in words. You cannot see, hear the room, or observe the kitchen. Never describe or comment on sounds, sights, or anything happening around them — only respond to what they actually say. If you did not clearly understand them, warmly ask them to say it again rather than guessing.

How you cook with them: Work only with the ingredients the user already has. Never suggest buying anything. Ask one question at a time. Guide one step at a time and wait for them to confirm before moving on. Celebrate small wins naturally — "Perfect, that's exactly right."

Begin every new conversation by warmly greeting the user and asking what ingredients they have right now.`

// ── Recipe generation ────────────────────────────────────────────────────────
app.post('/api/recipe/generate', async (req, res) => {
  const { ingredients, language } = req.body || {}
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients array required' })
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' })
  }
  const lang = typeof language === 'string' && language.trim() ? language.trim() : 'English'

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are Micheli, a warm professional chef. Create ONE realistic recipe using ONLY the provided ingredients (you may assume basic staples: salt, pepper, oil, water). Never require buying additional main ingredients. Write everything in ${lang}.
Return STRICT JSON in exactly this shape:
{
  "title": "string",
  "description": "one warm inviting sentence",
  "ingredients": ["item with a rough quantity"],
  "steps": ["full sentence step, no numbering"],
  "cook_time_minutes": 25,
  "servings": 2,
  "tags": ["short", "lowercase", "tags"],
  "tip": "one concise helpful sentence"
}`,
        },
        { role: 'user', content: `Ingredients: ${ingredients.join(', ')}` },
      ],
    })

    const raw = JSON.parse(completion.choices[0].message.content || '{}')
    const toInt = (v) => {
      const n = parseInt(v, 10)
      return Number.isFinite(n) ? n : null
    }
    res.json({
      title: String(raw.title || 'A simple dish'),
      description: String(raw.description || ''),
      ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(String) : [],
      steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
      cook_time_minutes: toInt(raw.cook_time_minutes),
      servings: toInt(raw.servings),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 5) : [],
      tip: String(raw.tip || ''),
    })
  } catch (err) {
    console.error('[recipe] error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', model: REALTIME_MODEL, voice: REALTIME_VOICE, apiKey: Boolean(process.env.OPENAI_API_KEY) })
)

// ── Temporary QA text chat: Micheli in text mode ─────────────────────────────
// Protected by TEST_CHAT_TOKEN (set only in Railway Variables). If the variable
// is not set, this endpoint is disabled entirely. Remove this block when QA ends.
const qaSessions = new Map()
let qaMessagesToday = 0
let qaCountDay = ''

app.post('/api/test/chat', async (req, res) => {
  const secret = process.env.TEST_CHAT_TOKEN
  if (!secret) return res.status(403).json({ error: 'QA chat disabled' })
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.body?.token || '')
  if (token !== secret) return res.status(401).json({ error: 'invalid token' })

  const { session_id, message } = req.body || {}
  if (!session_id || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'session_id and message required' })
  }

  const day = new Date().toISOString().slice(0, 10)
  if (day !== qaCountDay) { qaCountDay = day; qaMessagesToday = 0 }
  if (qaMessagesToday >= 400) return res.status(429).json({ error: 'daily test limit reached' })
  qaMessagesToday++

  if (!qaSessions.has(session_id)) {
    if (qaSessions.size >= 60) {
      const oldest = [...qaSessions.entries()].sort((a, b) => a[1].last - b[1].last)[0]
      if (oldest) qaSessions.delete(oldest[0])
    }
    qaSessions.set(session_id, { messages: [], last: Date.now() })
  }
  const sess = qaSessions.get(session_id)
  sess.last = Date.now()
  sess.messages.push({ role: 'user', content: message.trim().slice(0, 2000) })
  if (sess.messages.length > 40) sess.messages.splice(0, sess.messages.length - 40)

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            MICHELI_PROMPT +
            '\n\nNote: this is a text conversation for testing. Reply in plain text with the same warm spoken style, two to four sentences.',
        },
        ...sess.messages,
      ],
    })
    const reply = completion.choices[0]?.message?.content?.trim() || ''
    sess.messages.push({ role: 'assistant', content: reply })
    res.json({ reply, session_id, turns: sess.messages.length })
  } catch (err) {
    console.error('[qa-chat] error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

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
    console.log(`[WS] Connected to OpenAI Realtime (${REALTIME_MODEL}, voice=${REALTIME_VOICE})`)
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: MICHELI_PROMPT,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.6,
              prefix_padding_ms: 300,
              silence_duration_ms: 1500,
              create_response: true,
              interrupt_response: true,
            },
            transcription: { model: 'whisper-1' },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: REALTIME_VOICE,
          },
        },
      },
    }))
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

  browserWs.on('message', (data) => {
    // OpenAI's realtime API accepts ONLY text (JSON) frames — never binary.
    // ws delivers frames as Buffers, so coerce to a string and always send as text,
    // including queued frames replayed after the session opens.
    const text = typeof data === 'string' ? data : data.toString('utf8')
    if (sessionReady && openaiWs.readyState === WebSocket.OPEN) openaiWs.send(text)
    else pending.push(text)
  })

  browserWs.on('close', (code) => {
    console.log(`[WS] Browser disconnected: ${code}`)
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close(1000)
  })

  browserWs.on('error', (err) => console.error('[WS] Browser error:', err.message))
})

// ── Static (Vite build) ──────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

server.listen(PORT, () => {
  console.log(`\n  ShareChef AI  →  http://localhost:${PORT}`)
  console.log(`  Realtime WS   →  /ws/realtime  (${REALTIME_MODEL}, ${REALTIME_VOICE})`)
  console.log(`  API key       →  ${process.env.OPENAI_API_KEY ? '✓ configured' : '✗ MISSING'}\n`)
})
