import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, setGuest } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { RealtimeVoice } from '../voice/realtimeVoice'
import { noteFinishedCook } from '../lib/appReview'
import type { VoiceStatus } from '../voice/realtimeVoice'
import { generateRecipe, recipeFromCook } from '../lib/recipeApi'
import type { GeneratedRecipe } from '../lib/recipeApi'
import { getStarProgress } from '../lib/stars'
import { LANGUAGES, initialLanguage, saveLanguage, savedLanguage } from '../lib/language'
import { track } from '../lib/events'
import { UpgradeSheet } from '../components/UpgradeSheet'
import { DishPhotoPrompt } from '../components/DishPhotoPrompt'
import { syncPlusWithServer } from '../lib/purchases'
import { canUseRecordingMode } from '../lib/recordingMode'
import { ScreenRecorder, canRecordInApp } from '../lib/screenRecorder'
import { startTape, stopTape, isTaping } from '../lib/soundTape'

type Line = { role: 'user' | 'chef'; text: string }

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: 'Tap to talk to Micheli',
  connecting: 'Connecting…',
  ready: 'Say hello to Micheli',
  listening: 'Listening…',
  processing: 'Micheli is thinking…',
  speaking: 'Micheli is speaking…',
}

export function HomePage() {
  const { userId } = useAuth()
  // In-app recorder (owner only). See lib/screenRecorder.
  const showRecorder = canUseRecordingMode(userId) && canRecordInApp()
  const [recording, setRecording] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)
  const [savingClip, setSavingClip] = useState(false)
  const [recInfo, setRecInfo] = useState<string | null>(null)
  async function toggleRecording() {
    setRecError(null)
    setRecInfo(null)
    try {
      if (recording) {
        setRecording(false)
        setSavingClip(true)
        const tape = stopTape()
        const info = `Sound kept: ${Math.round(tape.seconds)}s, level ${Math.round(tape.peak * 100)}%, Micheli parts ${tape.voiceChunks}, your parts ${tape.micChunks}`
        setRecInfo(info)
        const res = await ScreenRecorder.stop({ audioWav: tape.wav })
        setRecInfo(`${info}. Joined to video: ${res.audioTracks > 0 ? 'yes' : 'NO'}. Saved to Photos.`)
      } else {
        await ScreenRecorder.start({ microphone: false })
        startTape()
        setRecording(true)
      }
    } catch (e) {
      if (isTaping()) stopTape()
      setRecording(false)
      setRecError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingClip(false)
    }
  }
  const nav = useNavigate()

  // ── voice ──
  const voiceRef = useRef<RealtimeVoice | null>(null)
  const startingRef = useRef(false)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [limitInfo, setLimitInfo] = useState<{ used: number; limit: number; reason?: 'cooks' | 'time' } | null>(null)
  // What the server says about this session. Null until a session starts.
  const [serverAuth, setServerAuth] = useState<'user' | 'guest' | null>(null)
  const convoRef = useRef<HTMLDivElement | null>(null)

  // ── recipe ──
  const [language, setLanguage] = useState(initialLanguage)
  const [draft, setDraft] = useState('')
  const [ingredients, setIngredients] = useState<string[]>([])
  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // After a save: the new recipe's id, and whether the "snap your dish" step is done.
  const [savedId, setSavedId] = useState<string | null>(null)
  const [photoStep, setPhotoStep] = useState<'ask' | 'saved' | 'skipped'>('ask')

  // ── gamification ──
  const [savedCount, setSavedCount] = useState(0)
  const star = useMemo(() => getStarProgress(savedCount), [savedCount])

  useEffect(() => {
    const v = new RealtimeVoice({
      onStatus: (s) => setStatus(s),
      onTranscript: (text, role) => setLines((prev) => [...prev, { role, text }]),
      onError: (m) => setVoiceError(m),
      onSession: (info) => setServerAuth(info.auth),
      onLimit: (info) => { startingRef.current = false; setLimitInfo(info) },
    })
    voiceRef.current = v
    return () => v.disconnect()
  }, [])

  useEffect(() => {
    if (status === 'ready' && startingRef.current) {
      startingRef.current = false
      voiceRef.current?.triggerGreeting()
      voiceRef.current?.startListening()
    }
  }, [status])

  useEffect(() => {
    convoRef.current?.scrollTo({ top: convoRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines])

  const loadCount = async () => {
    if (!userId) { setSavedCount(0); return }
    const [recipesRes, sharesRes] = await Promise.all([
      supabase.from('recipes').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('shares').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    ])
    setSavedCount((recipesRes.count ?? 0) + (sharesRes.count ?? 0))
  }
  useEffect(() => { loadCount() /* eslint-disable-line */ }, [userId])
  useEffect(() => { if (userId) void syncPlusWithServer() }, [userId])

  // A signed-in user's saved language pick follows their account across devices.
  useEffect(() => {
    if (!userId) return
    supabase.from('profiles').select('language').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (data?.language && LANGUAGES.includes(data.language)) {
          setLanguage(data.language)
          saveLanguage(data.language)
        }
      })
  }, [userId])

  // An explicit pick wins forever: saved on this device, and on the account too.
  const changeLanguage = (value: string) => {
    setLanguage(value)
    saveLanguage(value)
    if (userId) supabase.from('profiles').update({ language: value }).eq('id', userId).then(() => {})
  }

  const toggleVoice = async () => {
    const v = voiceRef.current
    if (!v) return
    setVoiceError(null)
    if (status === 'idle') {
      setCookWrapUp('idle')
      startingRef.current = true
      setStatus('connecting')
      await v.unlockAudio()
      if (!startingRef.current) return
      // Hand the voice client a token PROVIDER, not a token — it re-fetches a
      // fresh one on every connect and every automatic reconnect, so a stale
      // token can never silently downgrade the session to guest.
      v.connect(async () => {
        const { data } = await supabase.auth.getSession()
        return data.session?.access_token ?? null
      }, () => savedLanguage())
    } else {
      startingRef.current = false
      v.disconnect()
      const said = lines
      setLines([])
      setServerAuth(null)
      void finishVoiceCook(said)
    }
  }

  const addIngredient = (e: FormEvent) => {
    e.preventDefault()
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return
    setIngredients((prev) => Array.from(new Set([...prev, ...parts])))
    setDraft('')
  }
  const removeIngredient = (i: string) =>
    setIngredients((prev) => prev.filter((x) => x !== i))

  const onGenerate = async () => {
    if (ingredients.length === 0) return
    setGenBusy(true)
    setGenError(null)
    setRecipe(null)
    setSaveState('idle')
    setSavedId(null)
    setPhotoStep('ask')
    setRecipeSource('typed')
    setCookWrapUp('idle')
    try {
      const { data } = await supabase.auth.getSession()
      const r = await generateRecipe(ingredients, language, data.session?.access_token ?? null)
      setRecipe(r)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Could not create a recipe. Try again.')
    } finally {
      setGenBusy(false)
    }
  }

  const onSave = async () => {
    if (!recipe) return
    if (!userId) { setGuest(false); nav('/login'); return } // guests sign in to save (leave guest mode or /login bounces back)
    setPhotoStep('ask')
    await saveRecipe(recipe, userId)
  }

  // Shared by the Save button (typed recipes) and the end of a voice cook.
  const saveRecipe = async (recipe: GeneratedRecipe, userId: string) => {
    setSaveState('saving')
    const row = {
      user_id: userId,
      title: recipe.title,
      description: recipe.description || null,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      cook_time_minutes: recipe.cook_time_minutes,
      servings: recipe.servings,
      tags: recipe.tags,
      nutrition: recipe.nutrition || null,
    }
    let { data: inserted, error } = await supabase.from('recipes').insert(row).select('id').single()
    // Database not migrated yet (recipes.nutrition missing): save the recipe
    // without it rather than lose the save.
    if (error?.code === 'PGRST204' && error.message.includes('nutrition')) {
      const { nutrition: _skip, ...withoutNutrition } = row
      ;({ data: inserted, error } = await supabase.from('recipes').insert(withoutNutrition).select('id').single())
    }
    if (error) {
      setGenError(error.message)
      setSaveState('idle')
      return
    }
    {
      const { data } = await supabase.auth.getSession()
      track('dish_saved', undefined, data.session?.access_token ?? null)
    }
    setSavedId(inserted?.id ?? null)
    setSaveState('saved')
    loadCount()
  }

  // ── voice cook → recipe ──
  // Ending a voice cook writes it up as a recipe and saves it, hands-free, so
  // the photo prompt and sharing work exactly as for a typed recipe.
  const recipeCardRef = useRef<HTMLDivElement | null>(null)
  const lastCookRef = useRef<Line[]>([])
  const [recipeSource, setRecipeSource] = useState<'typed' | 'voice'>('typed')
  const [cookWrapUp, setCookWrapUp] = useState<'idle' | 'working' | 'none' | 'error'>('idle')

  const finishVoiceCook = async (said: Line[]) => {
    // Nothing worth writing up: Micheli never heard the user, or never answered.
    if (!said.some((l) => l.role === 'user') || !said.some((l) => l.role === 'chef')) return
    lastCookRef.current = said
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token || !userId) return // voice cooks are signed-in only
    setCookWrapUp('working')
    try {
      const r = await recipeFromCook(said, language, token)
      if (!r) { setCookWrapUp('none'); return }
      setCookWrapUp('idle')
      setGenError(null)
      setRecipe(r)
      setRecipeSource('voice')
      setSavedId(null)
      setPhotoStep('ask')
      await saveRecipe(r, userId)
      recipeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // 3rd finished cook with a saved recipe: ask for an App Store rating (once).
      void noteFinishedCook()
    } catch {
      setCookWrapUp('error')
    }
  }

  return (
    <div className="container stack">
      <div className="hero-head">
        <div className="eyebrow">ShareChef</div>
        <h1 className="page-title">What's in your kitchen tonight?</h1>
        <p className="page-sub" style={{ margin: '10px auto 0' }}>
          Talk to Micheli, or list a few ingredients — she'll cook with exactly what you have.
        </p>
      </div>

      {/* Micheli Star */}
      <div className="card star-card">
        <div className="star-badge">★</div>
        <div className="grow">
          <div className="star-tier">Micheli Star: {star.tier.name}</div>
          <div className="star-sub">
            {!userId
              ? 'Sign in to track your Micheli Star and save recipes.'
              : star.next
                ? `${star.toNext} more saved ${star.toNext === 1 ? 'recipe' : 'recipes'} to reach ${star.next.name}`
                : 'Top tier reached — a star is earned.'}
          </div>
          <div className="star-bar"><div className="star-fill" style={{ width: `${Math.round(star.progress * 100)}%` }} /></div>
        </div>
      </div>

      {/* Voice */}
      <div className="card">
        <div className="voice-stage">
          <button
            type="button"
            className={`orb is-${status}`}
            onClick={toggleVoice}
            aria-label={status === 'idle' ? 'Start talking to Micheli' : 'End session'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1.8a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0v-6a3 3 0 0 0-3-3Z" fill="currentColor" stroke="none" />
              <path d="M5 10.5a7 7 0 0 0 14 0" />
              <path d="M12 17.5V21" /><path d="M8.5 21h7" />
            </svg>
          </button>
          <div className="orb-label">{STATUS_LABEL[status]}</div>
          {/* Guest mode used to fail silently — this line makes it impossible to miss. */}
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {userId && serverAuth === 'guest' ? (
              <>
                Your sign-in has expired — Micheli won't remember this session.{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={async () => { await supabase.auth.signOut(); setGuest(false); nav('/login') }}
                >
                  Sign in again
                </button>
              </>
            ) : userId ? (
              'Micheli knows you — this cook will be remembered.'
            ) : (
              <>
                Guest mode — Micheli won't remember this session.{' '}
                {/* Guest mode counts as "signed in" to the router, so a plain
                    link to /login bounces straight back. Leave guest mode
                    first, then go. */}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => { setGuest(false); nav('/login') }}
                >
                  Sign in
                </button>
              </>
            )}
          </div>
          {showRecorder && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              disabled={savingClip}
              onClick={() => { void toggleRecording() }}
            >
              {savingClip ? 'Saving video…' : recording ? '■ Stop recording' : '● Record this cook'}
            </button>
          )}
          {recError && <div className="alert alert-error" style={{ marginTop: 6 }}>{recError}</div>}
          {showRecorder && recInfo && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{recInfo} (build 30)</div>}
          {status !== 'idle' && (
            <button type="button" className="link-btn" onClick={toggleVoice}>End session</button>
          )}
          {voiceError && <div className="alert alert-error" style={{ marginTop: 6 }}>{voiceError}</div>}
          {cookWrapUp === 'working' && <div className="muted" style={{ marginTop: 6 }}>Saving your cook as a recipe…</div>}
          {cookWrapUp === 'none' && <div className="muted" style={{ marginTop: 6 }}>No dish to save from that chat.</div>}
          {cookWrapUp === 'error' && (
            <div className="alert alert-error" style={{ marginTop: 6 }}>
              Couldn't save this cook as a recipe.{' '}
              <button type="button" className="link-btn" onClick={() => { void finishVoiceCook(lastCookRef.current) }}>
                Try again
              </button>
            </div>
          )}
          {limitInfo && (
            <UpgradeSheet
              used={limitInfo.used}
              limit={limitInfo.limit}
              headline={limitInfo.reason === 'time' ? 'Your free cook time is up' : undefined}
              userId={userId}
              onClose={() => setLimitInfo(null)}
              onUnlocked={() => { setLimitInfo(null); void toggleVoice() }}
              onNeedSignIn={() => { setLimitInfo(null); nav('/login') }}
            />
          )}
        </div>

        {lines.length > 0 && (
          <>
            <hr className="sep" />
            <div className="convo" ref={convoRef}>
              {lines.map((l, i) => (
                <div key={i} className={`bubble ${l.role === 'user' ? 'bubble-user' : 'bubble-chef'}`}>
                  {l.text}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Recipe builder */}
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="section-title">Make something now</h2>
            <div className="muted" style={{ fontSize: 14 }}>Add what you have. Micheli won't ask you to buy anything.</div>
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label className="label">Micheli's language</label>
            <select value={language} onChange={(e) => changeLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <form className="add-row" onSubmit={addIngredient}>
          <input
            className="grow"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. eggs, rice, spinach"
          />
          <button type="submit" className="btn btn-ghost">Add</button>
        </form>

        {ingredients.length > 0 && (
          <div className="chips">
            {ingredients.map((i) => (
              <span key={i} className="chip">
                {i}
                <button type="button" onClick={() => removeIngredient(i)} aria-label={`Remove ${i}`}>×</button>
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={onGenerate}
          disabled={genBusy || ingredients.length === 0}
        >
          {genBusy ? 'Creating your recipe…' : 'Create a recipe'}
        </button>
        {genError && <div className="alert alert-error">{genError}</div>}
      </div>

      {/* Recipe result */}
      {recipe && (
        <div className="card recipe-card stack" ref={recipeCardRef}>
          <div>
            {recipeSource === 'voice' && <div className="eyebrow">From your cook with Micheli</div>}
            <h3 className="recipe-title">{recipe.title}</h3>
            {recipe.description && <p className="recipe-desc">{recipe.description}</p>}
            <div className="recipe-meta">
              {recipe.cook_time_minutes != null && <span className="badge">⏱ {recipe.cook_time_minutes} min</span>}
              {recipe.servings != null && <span className="badge">🍽 serves {recipe.servings}</span>}
              {recipe.tags.map((t) => <span key={t} className="badge">#{t}</span>)}
            </div>
          </div>

          <div className="recipe-cols">
            <div>
              <h4>Ingredients</h4>
              <ul>{recipe.ingredients.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
            <div>
              <h4>Steps</h4>
              <ol>{recipe.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          </div>

          {recipe.nutrition && <div className="muted" style={{ marginTop: 8 }}>🥗 Nutrition (per serving, estimate): {recipe.nutrition}</div>}

          {recipe.tip && <div className="tip">💡 {recipe.tip}</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={saveState !== 'idle'}
            >
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved ✓'
                  : userId ? 'Save to my recipes' : 'Sign in to save'}
            </button>
          </div>

          {userId && savedId && photoStep === 'ask' && (
            <DishPhotoPrompt
              userId={userId}
              recipeId={savedId}
              onSaved={() => setPhotoStep('saved')}
              onSkip={() => setPhotoStep('skipped')}
            />
          )}
          {savedId && photoStep !== 'ask' && (
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div className="muted">{photoStep === 'saved' ? '📸 Photo saved with your recipe.' : 'Saved without a photo.'}</div>
              <button type="button" className="btn btn-ghost" onClick={() => nav(`/saved/${savedId}`)}>
                Share it →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
