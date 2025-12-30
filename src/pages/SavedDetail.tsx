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
      if (!id) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('id', id)
        .maybeSingle()

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
    <div className="container">
      <div className="stack">
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="h1" style={{ marginBottom: 2 }}>Recipe</div>
            <div className="muted">Details</div>
          </div>
          <Link className="pill" to="/saved">Back to My Recipes</Link>
        </div>

        {loading ? (
          <div className="card">Loading…</div>
        ) : !id || !recipe ? (
          <div className="card">
            <div className="h2">Recipe not found</div>
            <div className="muted" style={{ marginTop: 6 }}>
              This can happen if the link is wrong or you do not have access.
            </div>
            <div style={{ marginTop: 12 }}>
              <Link className="pill" to="/saved">Back to My Recipes</Link>
            </div>
          </div>
        ) : (
          <div className="card stack">
            <div>
              <div className="h1" style={{ marginBottom: 4 }}>{recipe.title}</div>
              {recipe.description && <div className="muted">{recipe.description}</div>}
              <div style={{ marginTop: 10 }}>
                {recipe.cook_time_minutes != null && <span className="badge">⏱ {recipe.cook_time_minutes} min</span>}
                {recipe.servings != null && <span className="badge">🍽 {recipe.servings}</span>}
                {(recipe.tags ?? []).map(t => <span key={t} className="badge">#{t}</span>)}
              </div>
            </div>

            <hr />

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="h2">Ingredients</div>
                <ul>
                  {(recipe.ingredients ?? []).map(i => <li key={i}>{i}</li>)}
                </ul>
              </div>
              <div className="grow">
                <div className="h2">Steps</div>
                <ol>
                  {(recipe.steps ?? []).map(s => <li key={s}>{s}</li>)}
                </ol>
              </div>
            </div>

            {error && <div className="card" style={{ borderColor: '#ffd4d4', background: '#fff5f5' }}>{error}</div>}

            <button className="danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete / Unsave'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
