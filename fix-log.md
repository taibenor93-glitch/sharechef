# Fix log

Oldest at top, newest at bottom.

- 2026-11-01: Symptom: signed-in users saw "Please sign in to cook with Micheli" at random when tapping the mic (iPad and iPhone). Root cause: the Oct 31 same-cook lookup (f281e82) added an await after authInFlight was cleared, so the app's first frames hit the no-auth-frame branch. Fix: keep authInFlight true until startOpenAI(). Watch: Railway logs should show "Connected to OpenAI Realtime" after every "[WS] auth: user".
- 2026-11-17: Symptom: the set-password screen never named the account, so password managers offered an old test login and Tai could not tell which account was being reset; anyone already signed in who opened /reset went straight to changing that session's password. Fix (ee27373): show the account email, a read-only username field for password managers, and a "Reset a different account" button that signs out. Web only, iPhone app unchanged until the next App Store release. Watch: auth logs for user_recovery_requested followed by a password update on the same actor.
