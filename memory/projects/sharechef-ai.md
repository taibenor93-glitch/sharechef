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

- IDEA (2026-08-20, Tai): 'Give people time when they cook' — Micheli as timekeeper. Candidates: total time up front, per-step durations, and/or Micheli tracks minutes and speaks up when a step is done (zero-touch timer). Scope not yet chosen.

## SESSION STATE — 2026-08-23 night (read this first tomorrow morning)
Yesterday (Sun Aug 23) recap, all verified:
- D3 "MOM MATH" campaign video posted ~8 PM to 5 placements: TikTok, SC IG, SC FB, personal IG (founder caption), personal FB. File: marketing/day3-mom-math/DRAFT-day3-mom-math.mp4. Captions in same folder. 24h numbers due today.
- Streak 4-for-4 (D1 fridge-rescue, D2 Shabbat meatballs "She guides. Step by step.", D3 mom-math). "Too tired" draft RETIRED (looks like D1's cook — Tai caught it). BBQ-daughter clip DROPPED by Tai ruling (shows food, not product).
- Content law from Tai, locked: sell the SOLUTION not food. 3 hooks every video: mom's heart (kids eat healthy) + money saved (real math) + someone takes dinner over. Every video: what-if hook → 4s real app demo → dollar number → one CTA. Each video pays off its own tease (no pure teasers — 12 followers, strangers see ONE video).
- Next content: 7-day "what if I told you" series, one audience/day (mom, college student, ...), rolling into launch. Draft the 7 hooks WITH Tai. Avatar session wanted (Tai will speak daily; AI avatar decision pending — his ban on fake food stands, avatar of HIMSELF is acceptable to him now).
- PH launch locked: Monday Aug 31. PH profile tai_benor now has activity (3 genuine comments+upvotes: Aximote, KanaSensei, Plask). PENDING from Tai: names from the 80-contact WhatsApp list who actually USED the app. Daily: 10 min genuine PH commenting.
- DEPLOYED last night (b6a19eb..63fafdd, verified live): full-recipe sharing (WhatsApp/copy/native + IG/TikTok/**YouTube new** caption-copy), nutrition estimate back on generated recipes (display-only, no DB column yet — migration pending), Show/Hide password on Login/Signup/Reset. Web only — iPhones wait for next App Store build.
- Tai's 5 bug reports: 3 not reproducible on web (create-account, saving, share buttons all work — verified by cooking+saving+deleting a test recipe live). Suspect his iPhone runs a stale build or guest session → iOS parity is the next technical fight. 2 were real and are FIXED (nutrition, show-password).
- Repo cleanup requested by Tai ("delete duplicates/junk") — NOT done, needs itemized list + his approval first. Candidates: server.js.pre-profile-fix.bak, _to_delete/, SHARECHEF-*.zip/patches, icon-backup, old audit MDs.
- Vision note (Tai, important): ShareChef's founding idea = users sharing their creations with each other and showing themselves cooking. Post-launch mission: real user-to-user sharing (public recipe pages). Launch story: "coming soon: share your creations."
- Tai's standing rules active: never suggest rest/tomorrow (he decides when), ONE action at a time + wait for DONE, chronological order, no fabrication, no recreating existing assets, nothing deleted/deployed without his Go (deploy pre-approved ONLY for last night's train, now spent). Timeline header on every reply. Simple words, short replies.
- Morning queue, in order: (1) pull 24h numbers on all 5 D3 placements + drop-off seconds → append D3 log line in SPRINT-30-DAY.md; (2) draft 7 what-if hooks with Tai; (3) PH: get the "who used the app" names; (4) iOS stale-build check (App Store version vs 1.5/1.6); (5) repo cleanup list for approval.
- LATE UPDATE 2026-08-23 ~21:15: iOS mystery SOLVED. 1.5 was approved+auto-released Aug 14 (ASC history verified); Tai's iPhone has it and is signed in. Saving works on iPhone. "Missing share buttons" = discoverability: share row only appears after opening a recipe inside My recipes — Tai found it. Nutrition on iPhone arrives with 1.6. UX TODO for 1.6: show share row (or a Share nudge) right on the freshly created/saved recipe card, not only inside SavedDetail — founders and users both missed it. 1.6 build this week (Tue/Wed target): tonight's web fixes + confirm-password + share-row discoverability.
- 2026-08-23 21:20: Tai confirmed with iPhone screenshots: saved recipe (Cheesy Tomato Frittata) with full Share row working on iOS 1.5. Tai wants these real app screens FEATURED in tomorrow's content ("something we have to show") — the recipe card + Share this creation row are demo material for the what-if videos and PH gallery.
- 2026-08-24 (Mon night) STATE: D4 posted at 5 PM by Tai (what-if fridge video) — 5-for-5 streak. Mom Math 13h numbers: IG 296 (97.3% non-follower) + FB 223 = 519 views, 0 interactions (pattern: reach OK, zero conversion; Aug 27 checkpoint looms). D5/D6/D7 videos + captions PRE-BUILT in marketing/ (day5-time fridge-stare, day6-heart 3PM-school, day7-teen) — Tai posts 5-7 PM daily, no AI needed. PH: Tai commented on 3 launches (Claude Academy, PaymentKit, Google Antigravity). Apple Creator Studio activated-ish (3mo free till ~Oct): Final Cut, Pixelmator, Logic + Apple AI. FCP has ShareChef AI library; old July project cleaned — Pinterest-sourced caramel image DELETED (copyright, Tai caught it). TUESDAY PLAN: (1) morning numbers, (2) Tai's Pinterest mood board → recreate ideas in Image Playground/Pixelmator (free, our palette: caramel-over-iPhone brand shot for Sunday launch teaser), (3) Final Cut first guided edit, (4) AVATAR: AI-Tai with his real face + cloned voice via Higgsfield (needs 5-20 photos + voice sample + credits — quote price BEFORE spending), or free alternative: coached 20s real take. (5) post day5-time at 5 PM. Also pending: "SET IT" daily 5PM reminder offer, WhatsApp used-the-app names, 1.6 build Thursday, LinkedIn founder post Wednesday.
- RULE (Tai, 2026-08-27, permanent): STRICT start-to-finish. One task at a time, chronological order, a task must be FINISHED (or formally PARKED with a written return-condition) before the next begins. Never jump projects mid-task. Claude keeps ONE "active task" named at all times.
- PARKED 2026-08-27: Avatar build — material 100% uploaded (voice tai-voice-1/2 + 12 photos, media_ids in session), Higgsfield $0 trial paid & Amex-verified but credits not delivered by Higgsfield. Return condition: credits appear (recheck hourly) → immediately run create_voice_from_confirmed_audio (audio_media_id 0893238d-3474-419e-b695-730e007fdc35) + show_characters train with the 12 image ids. Protection: if not delivered by tonight, say "cancel auto-renewal" in chat so the $49 renewal can never fire.
- ACTIVE TASK 2026-08-27: iOS 1.6 build & submit to Apple (nutrition, password eye, full-recipe share, YouTube button → iPhone). Then next: PH page. Launch Mon Aug 31.
- 2026-08-27 afternoon STATE: 1.6 SUBMITTED to Apple (Waiting for Review). PH draft 90% built — see marketing/ph-launch/RESUME-HERE.md for exact remaining steps (images via paste-URL, makers, SCHEDULE for Mon Aug 31 12:01 AM PDT). All PH copy approved+saved in ph-launch/ph-page-copy.md, WhatsApp message approved in whatsapp-launch-message.md. Avatar parked (Higgsfield credits undelivered despite paid $0 trial — protect: "cancel auto-renewal" before 3 days if undelivered). Voice takes + 27 photos in avatar-assets/, 12 photos + voice already uploaded to Higgsfield (media ids in RESUME context). Tai's usage window may cut sessions — resume from THIS file.
