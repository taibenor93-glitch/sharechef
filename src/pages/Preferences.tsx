import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'

export function PreferencesPage() {
  const { userId } = useAuth()

  const [glutenFree, setGlutenFree] = useState(false)
  const [dairyFree, setDairyFree] = useState(false)
  const [kosher, setKosher] = useState(false)
  const [celiac, setCeliac] = useState(false)
  const [allergiesDraft, setAllergiesDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    let alive = true
    supabase
      .from('profiles')
      .select('gluten_free, dairy_free, kosher, celiac, allergies')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (!error && data) {
          setGlutenFree(!!data.gluten_free)
          setDairyFree(!!data.dairy_free)
          setKosher(!!data.kosher)
          setCeliac(!!data.celiac)
          setAllergiesDraft(Array.isArray(data.allergies) ? data.allergies.join(', ') : '')
        }
        setLoading(false)
      })
    return () => { alive = false }
  }, [userId])

  const onSave = async () => {
    if (!userId) return
    setSaveState('saving')
    setError(null)
    const allergies = allergiesDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      gluten_free: glutenFree,
      dairy_free: dairyFree,
      kosher,
      celiac,
      allergies,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setError(error.message)
      setSaveState('idle')
      return
    }
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 2000)
  }

  if (!userId) {
    return (
      <div className="container stack">
        <h1 className="page-title">Culinary preferences</h1>
        <div className="card">
          <p className="muted">Sign in to set your dietary preferences — Micheli will remember them every time you cook together.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container stack">
      <div className="hero-head">
        <h1 className="page-title">Culinary preferences</h1>
        <p className="page-sub" style={{ margin: '10px auto 0' }}>
          Micheli follows these every time she cooks with you — no need to remind her.
        </p>
      </div>

      <div className="card stack">
        {loading ? (
          <p className="muted">Loading your preferences…</p>
        ) : (
          <>
            <div className="field">
              <label className="label">Dietary restrictions</label>
              <div className="stack" style={{ gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={glutenFree} onChange={(e) => setGlutenFree(e.target.checked)} />
                  Gluten-free
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={dairyFree} onChange={(e) => setDairyFree(e.target.checked)} />
                  Dairy-free
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={kosher} onChange={(e) => setKosher(e.target.checked)} />
                  Kosher
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={celiac} onChange={(e) => setCeliac(e.target.checked)} />
                  Celiac
                </label>
              </div>
            </div>

            <div className="field">
              <label className="label">Allergies</label>
              <input
                value={allergiesDraft}
                onChange={(e) => setAllergiesDraft(e.target.value)}
                placeholder="e.g. peanuts, shellfish"
              />
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Separate with commas. Micheli treats every allergy as serious.
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save preferences'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
