# ShareChef AI

**Status:** Live on Railway
**GitHub:** https://github.com/taibenor93-glitch/sharechef
**Deployed at:** sharechef-production.up.railway.app

## What It Is
AI-powered cooking companion app. Users speak to Micheli (the AI chef) who guides them through cooking with ingredients they already have.

## Micheli Persona
- Name: Micheli (inspired by Michelin stars, French warmth)
- Voice: nova (OpenAI TTS)
- Responds in whatever language the user speaks
- Short, conversational responses (2-4 sentences max)
- Never tells users to buy ingredients

## Architecture
- Backend: Node.js + Express (src/server.js)
- Frontend: public/index.html (vanilla JS voice UI)
- Two voice paths:
  - /ws/realtime → OpenAI Realtime WebSocket (FAST, ~1s) ← active
  - /api/chat → GPT-4o + TTS sequential calls (SLOW, ~10s) ← fallback only
- Model: gpt-4o-realtime-preview-2024-12-17

## Environment Variables
- OPENAI_API_KEY → set in Railway Variables + local .env

## Deployment
- Platform: Railway (project: bubbly-gentleness, service: sharechef)
- Auto-deploys on push to main branch
- GitHub username: taibenor93-glitch
