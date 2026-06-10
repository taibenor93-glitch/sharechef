# Memory

## Me
Tai (taibenor93@gmail.com), App Developer, Software Engineer & Entrepreneur. Building and scaling ShareChef AI.

## Projects
| Name | What |
|------|------|
| **ShareChef AI** | AI cooking companion app, deployed on Railway. Chef persona = Micheli. Voice via OpenAI Realtime API. |

→ Details: memory/projects/sharechef-ai.md

## Tech Stack
| Tool | Used for |
|------|----------|
| OpenAI GPT-4o | Chat responses + Realtime voice API |
| OpenAI TTS | Text-to-speech (nova voice, fallback) |
| OpenAI Realtime | Fast WebSocket voice responses (/ws/realtime) |
| Railway | Production hosting (project: bubbly-gentleness) |
| GitHub | taibenor93-glitch/sharechef |
| Node.js + Express | Backend server (src/server.js) |
| Vite + React | Frontend |
| Supabase | Database |

## Key Files
| File | What |
|------|------|
| `src/server.js` | Main server — chat API, TTS, Realtime WS proxy |
| `public/index.html` | Frontend — voice UI for Micheli |
| `.env` | OPENAI_API_KEY (also set in Railway Variables) |

## Preferences
- Direct, no fluff
- Production-grade solutions only
- No bullet points in prose/correspondence
- Fix bugs completely, no duct-tape patches

## Notes
- OpenAI key must be set in Railway Variables AND local .env
- Frontend uses /ws/realtime (WebSocket) for fast voice — NOT /api/chat (slow, 10s)
- Micheli speaks all languages automatically (prompt-based)
- GitHub push requires PAT token: github.com/settings/tokens (repo scope)
