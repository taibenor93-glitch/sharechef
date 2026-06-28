import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import type { Recipe } from '../types/recipe'

type SortMode = 'recent' | 'title'

export function SavedListPage() {
  const { userId } = useAuth()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      if (!userId) { setRecipes([]); setLoading(false); return }
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      setLoading(false)
      if (error) return setError(error.message)
      setRecipes((data ?? []) as Recipe[])
    }
    run()
  }, [userId])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let rows = [...recipes]
    if (query) {
      rows = rows.filter((r) => {
        const inTitle = (r.title ?? '').toLowerCase().includes(query)
        const ing = Array.isArray(r.ingredients) ? r.ingredients.join(' ') : ''
        return inTitle || ing.toLowerCase().includes(query)
      })
    }
    if (sort === 'title') rows.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    else rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    return rows
  }, [recipes, q, sort])

  if (!userId) {
    return (
      <div className="container stack">
        <div className="hero-head" style={{ textAlign: 'left' }}>
          <div className="eyebrow">Your cookbook</div>
          <h1 className="page-title">My recipes</h1>
        </div>
        <div className="card empty">
          <div className="empty-mark">🔖</div>
          <div className="section-title">Sign in to build your cookbook</div>
          <div className="muted" style={{ marginTop: 6 }}>
            You're cooking as a guest. Create a free account to save recipes and earn your Micheli Star.
          </div>
          <div style={{ marginTop: 16 }}>
            <Link to="/login" className="btn btn-primary">Sign in or create account</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container stack">
      <div className="hero-head" style={{ textAlign: 'left' }}>
        <div className="eyebrow">Your cookbook</div>
        <h1 className="page-title">My recipes</h1>
      </div>

      <div className="card toolbar">
        <input
          className="grow"
          placeholder="Search by title or ingredient…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} style={{ width: 180 }}>
          <option value="recent">Most recent</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="card">Loading your recipes…</div>
      ) : filtered.length === 0 ? (
        <div className="card empty">
          <div className="empty-mark">🍳</div>
          <div className="section-title">No saved recipes yet</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Cook something on the home page and tap “Save to my recipes”.
          </div>
          <div style={{ marginTop: 16 }}>
            <Link to="/" className="btn btn-primary">Start cooking</Link>
          </div>
        </div>
      ) : (
        <div className="grid">
          {filtered.map((r) => (
            <Link to={`/saved/${r.id}`} key={r.id} className="tile">
              <div className="tile-title">{r.title}</div>
              {r.description && <div className="tile-desc">{r.description}</div>}
              <div>
                {r.cook_time_minutes != null && <span className="badge">⏱ {r.cook_time_minutes} min</span>}
                {r.servings != null && <span className="badge">🍽 {r.servings}</span>}
                {(r.tags ?? []).slice(0, 3).map((t) => <span key={t} className="badge">#{t}</span>)}
              </div>
              <div className="tile-foot">
                <span className="muted" style={{ fontSize: 13 }}>Open →</span>
                {r.created_at && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
