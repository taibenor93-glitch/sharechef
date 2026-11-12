import { useCallback, useEffect, useState } from 'react'
import {
  type CaresLink,
  canReceiveCheckIns,
  checkInsPermission,
  createLinkCode,
  listLinks,
  redeemLinkCode,
  removeLink,
  turnOnCheckInsOnThisPhone,
} from '../lib/micheliCares'

// Micheli Cares 💛 — sits on the Preferences page, after the food settings.
// Parent side: type the teen's code, allow notifications. Teen side: make a code.
export function MicheliCares({ userId }: { userId: string }) {
  const [links, setLinks] = useState<CaresLink[]>([])
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [role, setRole] = useState<'none' | 'parent' | 'teen'>('none')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Parent side
  const [codeInput, setCodeInput] = useState('')
  const [isGuardian, setIsGuardian] = useState(false)
  const [phoneOn, setPhoneOn] = useState<'granted' | 'denied' | 'notDetermined' | 'unsupported'>('notDetermined')

  // Teen side
  const [teenName, setTeenName] = useState('')
  const [isThirteen, setIsThirteen] = useState(false)
  const [code, setCode] = useState<{ code: string; expiresAt: Date } | null>(null)

  const asParent = links.filter((l) => l.parentId === userId)
  const asTeen = links.filter((l) => l.teenId === userId)

  const refresh = useCallback(async () => {
    try {
      setLinks(await listLinks())
      setUnavailable(false)
    } catch {
      setUnavailable(true) // tables not set up yet on this server: hide quietly
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    void checkInsPermission().then(setPhoneOn)
  }, [refresh])

  // A linked parent with notifications allowed: quietly refresh this phone's
  // push address (Apple can change it, e.g. after a restore).
  useEffect(() => {
    if (asParent.length > 0 && phoneOn === 'granted') {
      turnOnCheckInsOnThisPhone(userId).catch(() => undefined)
    }
  }, [asParent.length, phoneOn, userId])

  const turnOnPhone = async () => {
    try {
      const result = await turnOnCheckInsOnThisPhone(userId)
      setPhoneOn(result === 'on' ? 'granted' : 'denied')
      return result
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'Could not turn on check-ins on this phone.' })
      return 'denied'
    }
  }

  const onConnect = async () => {
    if (busy) return
    // Say what is missing instead of a button that silently does nothing.
    if (codeInput.trim().length < 6) {
      setMessage({ kind: 'error', text: 'Type the 6-character code your teen reads to you.' })
      return
    }
    if (!isGuardian) {
      setMessage({ kind: 'error', text: 'Check the box to confirm you’re this teen’s parent or guardian.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const name = await redeemLinkCode(codeInput)
      if (!name) {
        setMessage({ kind: 'error', text: 'That code didn’t work. Codes last 10 minutes. Ask your teen for a new one.' })
        return
      }
      setCodeInput('')
      await refresh()
      const phone = await turnOnPhone()
      setMessage({
        kind: 'ok',
        text: phone === 'on'
          ? `Connected to ${name}. You’ll get a check-in when ${name} cooks with Micheli. 💛`
          : `Connected to ${name}. To get check-ins, allow notifications for ShareChef in your iPhone Settings.`,
      })
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const onMakeCode = async () => {
    if (busy) return
    // Say what is missing instead of a button that silently does nothing.
    if (!teenName.trim()) {
      setMessage({ kind: 'error', text: 'Type your first name first.' })
      return
    }
    if (!isThirteen) {
      setMessage({ kind: 'error', text: 'Check the box to confirm you’re 13 or older.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      setCode(await createLinkCode(userId, teenName))
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'Could not make a code. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (link: CaresLink) => {
    setBusy(true)
    setMessage(null)
    try {
      await removeLink(link)
      await refresh()
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'Could not remove. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (!loaded || unavailable) return null

  return (
    <div className="card stack">
      <div className="field">
        <label className="label">Micheli Cares 💛</label>
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          Get a check-in when your teen cooks.
        </p>
      </div>

      {asParent.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {asParent.map((l) => (
            <div key={l.teenId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>You get check-ins when <strong>{l.teenName}</strong> cooks.</span>
              <button type="button" className="btn btn-ghost" onClick={() => onRemove(l)} disabled={busy}>Remove</button>
            </div>
          ))}
          {phoneOn === 'denied' && (
            <div className="muted" style={{ fontSize: 13 }}>
              Notifications are off for ShareChef. Turn them on in your iPhone Settings, then come back here.
            </div>
          )}
          {phoneOn === 'notDetermined' && canReceiveCheckIns() && (
            <button type="button" className="btn btn-primary" onClick={() => void turnOnPhone()} disabled={busy}>
              Turn on check-ins on this phone
            </button>
          )}
        </div>
      )}

      {asTeen.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {asTeen.map((l) => (
            <div key={l.parentId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>Your parent gets a check-in when you cook.</span>
              <button type="button" className="btn btn-ghost" onClick={() => onRemove(l)} disabled={busy}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {role === 'none' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={() => { setRole('parent'); setMessage(null) }}>
            I’m the parent
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setRole('teen'); setMessage(null) }}>
            I’m the teen
          </button>
        </div>
      )}

      {role === 'parent' && (
        canReceiveCheckIns() ? (
          <div className="stack">
            <div className="field">
              <label className="label">Your teen’s code</label>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="6 letters and numbers"
                autoCapitalize="characters"
                autoCorrect="off"
                maxLength={8}
              />
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Your teen opens ShareChef on their phone, taps “I’m the teen”, and reads you the code.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={isGuardian} onChange={(e) => setIsGuardian(e.target.checked)} />
              I’m this teen’s parent or guardian.
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-primary" onClick={onConnect} disabled={busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setRole('none')} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Check-ins arrive as notifications on iPhone and iPad. Open ShareChef on your iPhone to connect.
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => setRole('none')}>Back</button>
          </div>
        )
      )}

      {role === 'teen' && (
        code ? (
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 14 }}>Read this code to your parent:</div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 6 }}>{code.code}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              It works for 10 minutes. Your parent types it in ShareChef on their phone.
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => { setCode(null); setRole('none'); void refresh() }}>Done</button>
          </div>
        ) : (
          <div className="stack">
            <div className="field">
              <label className="label">Your first name</label>
              <input value={teenName} onChange={(e) => setTeenName(e.target.value)} placeholder="So check-ins say who’s cooking" maxLength={40} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={isThirteen} onChange={(e) => setIsThirteen(e.target.checked)} />
              I’m 13 or older.
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-primary" onClick={onMakeCode} disabled={busy}>
                {busy ? 'Making your code…' : 'Get my code'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setRole('none')} disabled={busy}>Cancel</button>
            </div>
          </div>
        )
      )}

      {message && <div className={`alert ${message.kind === 'error' ? 'alert-error' : 'alert-ok'}`}>{message.text}</div>}

      <div className="muted" style={{ fontSize: 12 }}>
        Micheli is a cooking helper, not adult supervision. She can’t see the stove. Check-ins share what your teen tells her.
      </div>
    </div>
  )
}
