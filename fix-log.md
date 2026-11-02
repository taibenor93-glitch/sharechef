# Fix log

Oldest at top, newest at bottom.

- 2026-11-01: Symptom: signed-in users saw "Please sign in to cook with Micheli" at random when tapping the mic (iPad and iPhone). Root cause: the Oct 31 same-cook lookup (f281e82) added an await after authInFlight was cleared, so the app's first frames hit the no-auth-frame branch. Fix: keep authInFlight true until startOpenAI(). Watch: Railway logs should show "Connected to OpenAI Realtime" after every "[WS] auth: user".
