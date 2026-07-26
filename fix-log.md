## 2026-07-26 — "Micheli doesn't work" (French / forgetting / kicked out)
Symptom: refuses French, comes back in English and restarts, forgets prior cooking, app drops mid-session (both local and Railway).
Root cause 1 (FIXED in server.js, pending deploy): system prompt hard-anchored Micheli to English and the greeting/resume lines were hardcoded English; nothing carried the session language. Rewrote language rules, made greeting/resume language-aware, memory now records the user's cooking language.
Root cause 2 (OPEN): every production voice session this week logged "auth: guest" — the iOS app never authenticates, so memory/resume/dietary never apply there. Web login verified working 17:32 EDT ("auth: user ... profile loaded, memory loaded"). Investigate iOS (Capacitor) session persistence next.
Root cause 3 (OPEN): mid-cook disconnects are client-side (WS close 1005/1006 from the browser/app, OpenAI always closes cleanly afterward). Not an OpenAI or server failure. Investigate iOS WebView socket drops next.
Also noted: Railway has SUPABASE_SERVICE_ROLE_KEY set — server code never uses it and the registry forbids it on this server; delete it. EMAIL_SECRET / NEXT_PUBLIC_APP_URL look like leftovers from another stack.

## 2026-07-26 — v1.4 app fixes (built, awaiting real-iPhone test)
Login persistence: supabaseClient.ts now stores the Supabase session in Capacitor Preferences (iOS UserDefaults) on native builds instead of purgeable WKWebView localStorage. Requires: npm install (adds @capacitor/preferences) + npx cap sync ios. Users must sign in once more after updating.
Voice resilience: realtimeVoice.ts auto-reconnects up to 3 times after an unexpected drop, fetches a fresh auth token on every (re)connect, and asks Micheli to resume the cook. Deliberate "End session" never reconnects.
Visibility: Home.tsx shows under the mic whether Micheli knows the user or the session is guest mode — silent guest sessions are no longer possible.
iOS version bumped to 1.4 (build 9). TypeScript + vite build verified clean in a clean environment. GATE: no App Store submission until Tai confirms on a real iPhone: login survives app restart, voice session reconnects after a drop, and the signed-in line shows under the mic.
