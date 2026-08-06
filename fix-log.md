# ShareChef Fix Log

## 2026-06-14 — Full cook confirmed working

**Branch:** `feat/micheli-realtime-voice`

### Fixes applied
| # | Issue | Fix |
|---|-------|-----|
| 1 | `server.cjs` had ESM `import` in a `.cjs` file | Converted all imports to `require()`, removed `fileURLToPath` shim |
| 2 | Express 5 `app.get('*')` threw PathError at startup | Replaced with `app.use()` catch-all (no path-to-regexp involved) |
| 3 | OpenAI Realtime voice `nova` is TTS-only, not valid for Realtime API | Switched to `shimmer` (soft female) then settled on browser SpeechSynthesis to match Railway |
| 4 | Browser SpeechSynthesis removed by mistake | Restored `speak()`, `speakInOrder()`, greeting `useEffect` in `Home.tsx` |
| 5 | `DEV: Start Voice` button was wired to stub (`debugStartVoice`) + Web Speech API | Rewired to `RealtimeVoice.unlockAudio()` + `connect()` in `App.tsx` |
| 6 | Micheli system prompt used bullet-point structure, locked to English default | Rewrote prompt: voice-first, 2–4 sentences, auto language-detect, no formatting |
| 7 | `.env` missing locally | Created with `OPENAI_API_KEY` |

### Confirmed working
- `node server.js` starts on port 3000, API key ✓ configured
- Frontend built from `dist/`, served by Express
- Voice reads recipe responses aloud via browser SpeechSynthesis
- Behavior matches Railway deployment
