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
- ADHD — TOP RULE: keep replies SHORT. One thing at a time. Max 1 short paragraph, then stop. Never stack multiple asks in one message.
- Direct, no fluff
- Production-grade solutions only
- No bullet points in prose/correspondence
- Fix bugs completely, no duct-tape patches

## Notes
- OpenAI key must be set in Railway Variables AND local .env
- Frontend uses /ws/realtime (WebSocket) for fast voice — NOT /api/chat (slow, 10s)
- Micheli speaks all languages automatically (prompt-based)
- GitHub push requires PAT token: github.com/settings/tokens (repo scope)

## Deletion Rule
NEVER delete anything without Tai's explicit permission for that specific deletion.

- Applies to: files, folders, git lock files (including .git/index.lock),
  dependencies, node_modules, package-lock.json, temporary and scratch files
  (including ones you created), and database records.
- Applies to indirect removal and overwriting too: rm, git clean,
  git reset --hard, git checkout -- <path>, npm ci, cleanup scripts, build steps
  that wipe an output folder, and redirects that overwrite an existing file.
- Folder access permission is NOT deletion permission. Neither is an earlier
  approval for a different deletion. Each deletion needs its own yes.
- Before any deletion: list the exact paths or records, say why it is needed and
  what is lost if it is wrong, then stop and wait.
- If a tool deletes automatically as a side effect, do not run it. Explain first.
- A blocked task is better than a removed file. Say you are blocked and hold.
