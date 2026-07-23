import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { RealtimeVoice } from '../voice/realtimeVoice'
import type { VoiceStatus } from '../voice/realtimeVoice'
import { generateRecipe } from '../lib/recipeApi'
import type { GeneratedRecipe } from '../lib/recipeApi'
import { getStarProgress } from '../lib/stars'

type Line = { role: 'user' | 'chef'; text: string }

const LANGUAGES = [
  'English', 'Spanish', 'French', 'Italian', 'German',
  'Portuguese', 'Hindi', 'Mandarin', 'Arabic', 'Japanese',
]

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
  const nav = useNavigate()

  // ── voice ──
  const voiceRef = useRef<RealtimeVoice | null>(null)
  const startingRef = useRef(false)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const convoRef = useRef<HTMLDivElement | null>(null)

  // ── recipe ──
  const [language, setLanguage] = useState('English')
  const [draft, setDraft] = useState('')
  const [ingredients, setIngredients] = useState<string[]>([])
  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  // ── gamification ──
  const [savedCount, setSavedCount] = useState(0)
  const star = useMemo(() => getStarProgress(savedCount), [savedCount])

  useEffect(() => {
    const v = new RealtimeVoice({
      onStatus: (s) => setStatus(s),
      onTranscript: (text, role) => setLines((prev) => [...prev, { role, text }]),
      onError: (m) => setVoiceError(m),
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

  const toggleVoice = async () => {
    const v = voiceRef.current
    if (!v) return
    setVoiceError(null)
    if (status === 'idle') {
      startingRef.current = true
      await v.unlockAudio()
      // Fetch a fresh token at connect time — the one in React state can be
      // stale if the app sat in the background past the token's expiry.
      const { data } = await supabase.auth.getSession()
      v.connect(data.session?.access_token ?? null)
    } else {
      startingRef.current = false
      v.disconnect()
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
    if (!userId) { nav('/login'); return } // guests sign in to save
    setSaveState('saving')
    const { error } = await supabase.from('recipes').insert({
      user_id: userId,
      title: recipe.title,
      description: recipe.description || null,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      cook_time_minutes: recipe.cook_time_minutes,
      servings: recipe.servings,
      tags: recipe.tags,
    })
    if (error) {
      setGenError(error.message)
      setSaveState('idle')
      return
    }
    setSaveState('saved')
    loadCount()
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
          {status !== 'idle' && (
            <button type="button" className="link-btn" onClick={toggleVoice}>End session</button>
          )}
          {voiceError && <div className="alert alert-error" style={{ marginTop: 6 }}>{voiceError}</div>}
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
            <label className="label">Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
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
        <div className="card recipe-card stack">
          <div>
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
        </div>
      )}
    </div>
  )
}
