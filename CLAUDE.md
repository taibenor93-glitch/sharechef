# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ShareChef AI is a voice-first cooking companion web app. Users speak to "Micheli" — an AI chef persona — who responds in real-time via the OpenAI Realtime API. The app is stateless: no database, no sessions, no build step.

## Commands

```bash
# Development (auto-restarts on file changes, requires Node v18.11+)
npm run dev

# Production
npm start
```

There are no tests, no linter, and no build step. The server runs directly with `node src/server.js`.

**Required environment variable**: `OPENAI_API_KEY` in a `.env` file at the project root.

To test the REST endpoint manually:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What can I make with eggs and cheese?"}'
```

## Architecture

### Dual communication paths

The backend (`src/server.js`) exposes two distinct paths for AI interaction:

1. **WebSocket proxy** (`/ws/realtime`) — The primary voice path. The server opens a WebSocket connection to `wss://api.openai.com/v1/realtime` and forwards raw messages bidirectionally between browser and OpenAI. The `CHEF_PROMPT` system prompt is injected once during the `session.update` handshake.

2. **REST endpoint** (`POST /api/chat`) — A secondary text/TTS path. Calls `gpt-4o` for a text response, then pipes it through `tts-1` with the "nova" voice, streaming back base64-encoded PCM audio.

### Frontend audio pipeline (`public/index.html`)

All audio logic lives in the single-page app (~879 lines of vanilla JS):

- **Capture**: `getUserMedia()` → `AudioWorklet` (`public/audio-processor.js`) → Float32→Int16 PCM conversion → base64-encoded chunks sent over WebSocket
- **VAD**: Client-side RMS-based silence detection (`SILENCE_THRESHOLD = 0.01`, `SILENCE_DURATION = 400ms`) triggers speech-end without a server round-trip
- **Playback**: Incoming `response.audio.delta` events carry base64 PCM chunks that are queued and decoded through `AudioContext`

The Worklet processor (`audio-processor.js`) runs in a separate thread to avoid blocking the main thread during capture.

### Micheli chef persona

The `CHEF_PROMPT` constant in `src/server.js` defines the entire persona. Key constraints encoded there:
- Never suggest buying ingredients — work only with what the user has
- Auto-detect user language and respond in that language
- Warm, encouraging, non-judgmental tone for all skill levels

### Recipe generation route (`src/routes/recipe.js`)

`POST /api/recipe/generate` accepts `{ ingredients: string[] }` and returns structured JSON via OpenAI's JSON schema response format. The schema enforces difficulty values (`"Easy" | "Medium" | "Hard"`), step formatting (plain sentences, no "Step N:" prefixes), and a single-sentence tip field.

### Deployment

Deployed to Railway.app via `railway.json`. The Nixpacks builder skips the build step (`"buildCommand": "echo skip"`) and starts with `npm start`. No environment variables are committed — set `OPENAI_API_KEY` in the Railway dashboard.

## OpenAI models in use

| Purpose | Model |
|---|---|
| Realtime voice | `gpt-4o-realtime-preview-2024-12-17` |
| Text chat (REST) | `gpt-4o` |
| TTS (REST) | `tts-1` (voice: `nova`) |
