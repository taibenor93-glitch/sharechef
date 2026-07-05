# ShareChef Known-Good Values Registry

This is the single source of truth for the exact names ShareChef depends on.
The `sharechef-safe-execution` skill checks every model name, voice, env var,
Supabase identifier, deploy URL, repo path, and persona/file name against this
file before emitting code or config. If a name isn't here, it is treated as
unverified — Claude stops and asks rather than guessing.

Tai owns this file. When a value changes (e.g. OpenAI ships a new model and Tai
adopts it), update the entry here first, then use it.

> Provenance note: the values below were seeded from prior ShareChef sessions and
> should be ratified by Tai. Anything Tai has not confirmed is marked CONFIRM.

## AI provider and models

| Purpose            | Canonical value | Status  |
|--------------------|-----------------|---------|
| Provider           | OpenAI          | confirm |
| Chat model         | gpt-4o          | confirm |
| Text-to-speech     | tts-1           | confirm |
| TTS voice          | nova            | confirm |

Note: Gemini was abandoned. Do not reintroduce Gemini model strings.

## Environment variables

| Name                | Used by             | Notes                                  |
|---------------------|---------------------|----------------------------------------|
| OPENAI_API_KEY      | Express server      | server-side only                       |
| VITE_OPENAI_API_KEY | Vite client build   | needs the VITE_ prefix to be exposed   |

Both are set in local `.env` / `server/.env` AND in Railway Variables. A key that
exists in one place but not the other is a classic ShareChef failure — verify both.
Never place a real key value in this file, in code, in a diff, or in chat.

## Supabase

| Field    | Value      | Status  |
|----------|------------|---------|
| Project  | ShareChef3 | confirm |
| Region   | us-east-1  | confirm |
| Purpose  | auth + database | confirm |

## Deployment (Railway)

| Field            | Value                                  | Status  |
|------------------|----------------------------------------|---------|
| Production URL   | sharechef-production.up.railway.app    | confirm |

## Source control

| Field | Value                          | Status  |
|-------|--------------------------------|---------|
| Repo  | taibenor93-glitch/sharechef.git | confirm |

`.env` must stay in `.gitignore`. Do not change that.

## Persona and naming

| Field            | Canonical value | Status  |
|------------------|-----------------|---------|
| AI persona       | Micheli         | confirm |
| Guide file       | micheliGuide.ts | confirm |

All "Yummi" references were removed. Any surviving "Yummi" string is a bug, not a
valid name — flag it rather than reproducing it. `yummiGuide.ts` was renamed to
`micheliGuide.ts`.

## Gamification

| Field        | Value                                   | Status  |
|--------------|-----------------------------------------|---------|
| System name  | Micheli Star                            | confirm |
| Tiers        | Commis → … → Micheli Chef (five tiers)  | confirm |

## Stack (for context, not name-checking)

React 18 + TypeScript + Vite frontend, co-located Express backend, Supabase for
auth/database, Railway for production deploy.
