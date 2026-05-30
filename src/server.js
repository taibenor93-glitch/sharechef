import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';
import recipeRouter from './routes/recipe.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app    = express();
const server = createServer(app);

const PORT           = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ── Chef persona (shared by /api/chat and the WS proxy) ───────────────────────

const CHEF_PROMPT = `You are Chef AI, the warm and encouraging personal cooking companion inside ShareChef AI.
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
Then walk them through cooking it step by step — one step at a time — waiting for them to confirm before moving forward.`;

const REALTIME_MODEL = 'gpt-4o-realtime-preview';
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// ── REST routes ───────────────────────────────────────────────────────────────

app.use('/api/recipe', recipeRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'ShareChef AI server is running',
    apiKeyConfigured: Boolean(OPENAI_API_KEY),
  });
});

// ── POST /api/chat ────────────────────────────────────────────────────────────
//
// Body:    { messages: [{role, content}][], systemPrompt?: string }
// Returns: { text: string, audio: string }  (audio = base64 MP3)
//

app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  }

  try {
    // 1. Get chef response from GPT-4o
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 200,
      temperature: 0.85,
      messages: [
        { role: 'system', content: systemPrompt || CHEF_PROMPT },
        ...messages,
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';

    if (!text) {
      return res.status(500).json({ error: 'Empty response from GPT-4o.' });
    }

    // 2. Convert to speech via OpenAI TTS — tts-1, nova voice
    const ttsResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      response_format: 'mp3',
    });

    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    console.log(`[/api/chat] OK — ${text.length} chars · ${Math.round(audioBuffer.byteLength / 1024)}kb audio`);

    return res.json({ text, audio: audioBase64 });

  } catch (err) {
    console.error('[/api/chat] Error:', err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
});

// ── GPT-4o Realtime WebSocket proxy ──────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws/realtime' });

wss.on('connection', (browserWs, req) => {
  console.log(`[WS] Browser connected from ${req.socket.remoteAddress}`);

  if (!OPENAI_API_KEY) {
    browserWs.send(JSON.stringify({
      type: 'error',
      error: { message: 'OPENAI_API_KEY is not set on the server.' },
    }));
    browserWs.close(1011, 'Missing API key');
    return;
  }

  const openaiWs = new WebSocket(REALTIME_URL, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });

  let sessionReady = false;
  const pending    = [];

  openaiWs.on('open', () => {
    console.log('[WS] Connected to OpenAI Realtime API');
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
    }));

    openaiWs.send(JSON.stringify({ type: 'response.create' }));
    sessionReady = true;
    for (const msg of pending) {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(msg);
    }
    pending.length = 0;
  });

  openaiWs.on('message', (data, isBinary) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data, { binary: isBinary });
  });

  openaiWs.on('error', (err) => {
    console.error('[WS] OpenAI error:', err.message);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'error', error: { message: `OpenAI error: ${err.message}` } }));
    }
  });

  openaiWs.on('close', (code) => {
    console.log(`[WS] OpenAI closed: ${code}`);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close(1000);
  });

  browserWs.on('message', (data, isBinary) => {
    if (sessionReady && openaiWs.readyState === WebSocket.OPEN) openaiWs.send(data, { binary: isBinary });
    else pending.push(data);
  });

  browserWs.on('close', (code) => {
    console.log(`[WS] Browser disconnected: ${code}`);
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close(1000);
  });

  browserWs.on('error', (err) => console.error('[WS] Browser error:', err.message));
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  ShareChef AI  →  http://localhost:${PORT}`);
  console.log(`  Chat API      →  POST http://localhost:${PORT}/api/chat`);
  console.log(`  Realtime WS   →  ws://localhost:${PORT}/ws/realtime`);
  console.log(`  API key       →  ${OPENAI_API_KEY ? '✓ configured' : '✗ MISSING — add to .env'}\n`);
});
