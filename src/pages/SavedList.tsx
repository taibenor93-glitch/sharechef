import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useSession } from '../hooks/useSession'
import type { Recipe } from '../types/recipe'

type SortMode = 'recent' | 'title'

export function SavedListPage() {
  const { session } = useSession()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [error, setError] = useState<string | null>(null)

  const fetchRecipes = async () => {
    if (!session) return
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('recipes')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })

    setLoading(false)
    if (error) return setError(error.message)
    setRecipes((data ?? []) as Recipe[])
  }

  useEffect(() => {
    fetchRecipes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let rows = [...recipes]

    if (query) {
      rows = rows.filter(r => {
        const inTitle = (r.title ?? '').toLowerCase().includes(query)
        const ingredients = Array.isArray(r.ingredients) ? r.ingredients.join(' ') : ''
        const inIngredients = ingredients.toLowerCase().includes(query)
        return inTitle || inIngredients
      })
    }

    if (sort === 'title') {
      rows.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    } else {
      rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    }

    return rows
  }, [recipes, q, sort])

  return (
    <div className="container">
      <div className="stack">
        <div className="card">
          <div className="h1">My Recipes</div>
          <div className="muted">Saved recipes for your account.</div>
        </div>

        <div className="card">
          <div className="row">
            <div className="grow">
              <input
                placeholder="Search title or ingredients…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div style={{ width: 210 }}>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                <option value="recent">Most recent</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>
        </div>

        {error && <div className="card" style={{ borderColor: '#ffd4d4', background: '#fff5f5' }}>{error}</div>}

        {loading ? (
          <div className="card">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="card">No saved recipes yet.</div>
        ) : (
          <div className="stack">
            {filtered.map(r => (
              <Link to={`/saved/${r.id}`} key={r.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="h2">{r.title}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{r.description ?? ''}</div>
                    <div>
                      {r.cook_time_minutes != null && <span className="badge">⏱ {r.cook_time_minutes} min</span>}
                      {r.servings != null && <span className="badge">🍽 {r.servings}</span>}
                      {(r.tags ?? []).slice(0, 4).map(t => <span key={t} className="badge">#{t}</span>)}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 14 }}>Open →</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="muted" style={{ fontSize: 12 }}>
          Tip: The list above is pulled from your saved rows. If you delete a recipe in the detail page, it will be removed.
        </div>
      </div>
    </div>
  )
}
