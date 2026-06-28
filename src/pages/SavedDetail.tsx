import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Recipe } from '../types/recipe'

export function SavedDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      if (!id) { setLoading(false); return }
      setLoading(true)
      setError(null)
      const { data, error } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle()
      setLoading(false)
      if (error) return setError(error.message)
      setRecipe((data ?? null) as Recipe | null)
    }
    run()
  }, [id])

  const onDelete = async () => {
    if (!id) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('recipes').delete().eq('id', id)
    setBusy(false)
    if (error) return setError(error.message)
    nav('/saved', { replace: true })
  }

  return (
    <div className="container stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to="/saved" className="btn btn-ghost">← My recipes</Link>
      </div>

      {loading ? (
        <div className="card">Loading…</div>
      ) : !id || !recipe ? (
        <div className="card empty">
          <div className="empty-mark">🤔</div>
          <div className="section-title">Recipe not found</div>
          <div className="muted" style={{ marginTop: 6 }}>It may have been deleted, or the link is wrong.</div>
        </div>
      ) : (
        <div className="card recipe-card stack">
          <div>
            <h1 className="recipe-title">{recipe.title}</h1>
            {recipe.description && <p className="recipe-desc">{recipe.description}</p>}
            <div className="recipe-meta">
              {recipe.cook_time_minutes != null && <span className="badge">⏱ {recipe.cook_time_minutes} min</span>}
              {recipe.servings != null && <span className="badge">🍽 serves {recipe.servings}</span>}
              {(recipe.tags ?? []).map((t) => <span key={t} className="badge">#{t}</span>)}
            </div>
          </div>

          <div className="recipe-cols">
            <div>
              <h4>Ingredients</h4>
              <ul>{(recipe.ingredients ?? []).map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
            <div>
              <h4>Steps</h4>
              <ol>{(recipe.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Removing…' : 'Delete recipe'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
