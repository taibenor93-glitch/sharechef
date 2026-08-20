# ShareChef AI

**Status:** LIVE — App Store (iOS) + web on Railway
**Updated:** 2026-08-13 (by Claude session, verified facts)
**GitHub:** https://github.com/taibenor93-glitch/sharechef (branch main, auto-deploys to Railway)
**Web:** sharechef-production.up.railway.app
**App Store:** https://apps.apple.com/app/id6787142176 (LIVE in US; new-app search lag ~1-2 weeks — always share the direct link)

## What It Is
Voice cooking companion. Users talk to Micheli (warm chef persona) who guides one step at a time using only ingredients they have. iOS app = Capacitor wrapper (webDir: dist) around the same React app.

## Current Facts (verified in code 2026-07-14)
- Frontend: React 18 + TS + Vite (src/), NOT vanilla JS
- Backend: server.js (Express, ESM) — Realtime proxy /ws/realtime
- Realtime model: 'gpt-realtime', voice: 'shimmer' (older gpt-4o-realtime retired)
- Recipe generation: gpt-4o via /api/recipe/generate
- Supabase project: ShareChef3 (us-east-1) — auth + recipes + shares tables
- Gamification: Micheli Stars (src/lib/stars.ts) — Commis/Cook/Chef de Partie/Sous Chef/Micheli Chef; count = saved recipes + shares

## Done 2026-07-14
- EU "Trader Status Not Provided" compliance form submitted (unblocks 27 EU stores ~24h)
- Supabase Auth Site URL fixed: was http://localhost:3000 → now https://sharechef-production.up.railway.app (sign-up email links work now)
- NEW: sharing earns stars — shares table (RLS), src/lib/shares.ts, SavedDetail share buttons record shares, Home counts recipes+shares. Deployed, verified live (bundle index-BZFYgEJh.js)
- v1.0.1 (new purple/gold icon) waiting for Apple review
- known-good-values.md ratified: gpt-4o (recipes), gpt-realtime + shimmer (voice), whisper-1 (transcription). Old tts-1/nova retired, noted so it's never reintroduced.

## Done 2026-07-15
- Share buttons: added LinkedIn (real share link), Instagram + TikTok (copy caption + open app) to SavedDetail.tsx and shares.ts ShareChannel type. Deployed, confirmed live by Tai.
- FOUND + FIXED real bug: recipes table was missing `description` and `steps` columns (had old `instructions` column instead) — recipe saving was silently failing for everyone. Ran migration adding description, steps, id default, created_at; dropped NOT NULL on old instructions column. Tai's first saved recipe ("Cheesy Tomato Scramble") confirmed working after fix.
- Voice fix shipped: turn_detection threshold 0.5→0.6, silence_duration_ms 600→1000 in server.js (Micheli was talking over people). Confirmed live via /health.
- Micheli name pronunciation fixed: added to MICHELI_PROMPT identity line — pronounced "mee-SHELL-ee", instructed never to argue about her name.
- Root-caused two scary "app is broken" incidents that were not code bugs: (1) two browser tabs open at once = two live Micheli voice sessions talking over each other; (2) phone was in guest mode, not signed in, so Save redirected to login — not a save failure.
- Tai posted first ShareChef AI launch post on personal Facebook (with Cheesy Tomato Scramble screenshot). Live.
- Reviewed 3 AI-generated marketing videos (WhatsApp uploads) — kids-in-kitchen one is strongest, vertical veggie one has tech-jargon overlay that violates the no-buzzwords rule (needs text swap before use), family-dinner one has best copy but a "ghost" visual some may find off-putting. Removed speech track from vertical video per Tai's request (didn't like the voice), left music-only versions.
- Wrote 5 honest influencer scripts (saved: sharechef-ai-influencer-scripts.md, delivered to Tai) — trimmed 10 draft scripts down to only claims that match the real app (no parent notifications/safety-alert features exist yet, so those 6 scripts are shelved until/unless built).
- Tai has more "touchy" scripts written personally in a previous chat — not yet located/pasted in this session.

## Done 2026-07-18
- iOS v1.1 (build 6) archived, uploaded, and SUBMITTED for App Review (auto-release on approval)
- Found: Info.plist had a local uncommitted hardcoded build number "5" overriding Xcode setting — first archive came out as 1.1 (5); restored to $(CURRENT_PROJECT_VERSION), re-archived as 1.1 (6)
- Export compliance answered: "None of the algorithms mentioned above" (standard HTTPS only)
- Verified new colors ARE in the 1.1 bundle (ios public/ synced today 11:24 AM, before archive)
- Committed c9ba123: ios version bump + new app icon (NOT pushed yet — push triggers Railway redeploy)
- Cleaned stale .git/HEAD.lock (bridge cannot rm; moved to _to_delete/)
- NOTE: App Store Connect requires new Age Ratings social-media questions answered by Sept 7, 2026 (App Information section)

## Done 2026-08-13
- CONFIRMED: repeat-tap voice slowdown fixed (input_audio_buffer.clear in realtimeVoice.ts) — verified by Tai on iPhone
- Shipped + verified: screen wake lock during active cook (realtimeVoice.ts, commit 9d4d09c, deployed to Railway) — screen stays lit, no more 1-min idle disconnect. Server 25s heartbeat already handled Railway idle-close; no server change needed.
- DISCOVERED: forgot password (Login → /reset, commit 5e69279 07-30), Preferences page (/preferences, commit ae3b1e7 07-23), and safe-area top-bar fix (commit 69f7406 08-03) were ALL already built and live on web — but App Store v1.4 bundle was frozen 07-26, predating all three. That was the whole "missing features / hidden buttons" mystery.
- Verified in live Supabase (ShareChef3): profiles has gluten_free, dairy_free, kosher, celiac, allergies columns; server injects them into Micheli's prompt with strict safety language.
- iOS 1.5 (build 10) archived and UPLOADED to App Store Connect: fresh web bundle + iPad support enabled (TARGETED_DEVICE_FAMILY 1,2). Commit f287023.
- Cook-state resume explained: 20-min window by design; End tap on a dead socket is silently lost (wsSend drops it) → stale dish resumes. Fix planned: HTTP fallback to clear cook state. NOT yet built.
- Latent bug spotted, not yet fixed: on reconnect, stale scheduled playback buffers aren't flushed → can overlap with new audio (the "echo"). Only triggers after a page freeze.

## TODO Next (updated 2026-08-13)
1. DONE 8-13: 1.5 submitted for review (build 10 + iPad screenshots). Next: await Apple email ~48h, then verify iPad listing + new description live
2. End-session HTTP fallback (server patch — needs Tai's Go)
3. Flush scheduled playback buffers on reconnect (echo fix, client-side)
4. Tai to verify on live web: forgot-password email flow + preferences safety test (celiac + peanut allergy → ask Micheli for peanut dish, she must refuse)

## TODO Next (older)
1. v1.1 iOS build: bundle new icon + voice/name fix + share buttons + stars for App Store (npx cap sync ios, Xcode archive) — needs Tai at Xcode, go slow
2. Cosmetic: stale error message doesn't clear after a successful recipe save (SavedList/Home) — minor UX polish
3. Check why the iPhone home screen icon shows no app name under it (Tai reported, deferred — screenshot needed to diagnose: home screen vs App Store page)
4. Film a real (non-AI) kitchen video with Micheli for personal/friend audience — trust-builder, higher priority than the AI videos for direct outreach
5. Create a dedicated "ShareChef AI" Facebook Page (separate from Tai's personal profile) once there's more video content to seed it with
6. Send filming brief to 3 couples once Tai's own real video exists as an example
7. User-reported: add quantities + cooking time to voice guidance (roadmap)
8. Chef of the Month: manual pick from shares table monthly
9. Future roadmap idea (not built): parent notifications when child cooks — 6 strong scripts already written for this, waiting on the feature

## Working Rules (Tai's standing rules)
- NEVER change code/config without showing exact change and getting explicit "Go"
- Check every model/voice/env/URL name against known-good-values.md before emitting
- No secrets in chat, files, or commits. .env stays gitignored.
- One step at a time; Tai says DONE between steps; simple non-technical language
- Marketing: emotional copy says "ShareChef"/"Micheli" (no AI buzzwords); discovery copy uses full name "ShareChef AI"; never the word "Michelin"; never "world's first" claims
